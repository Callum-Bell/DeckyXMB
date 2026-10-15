import asyncio
import base64
import json
import os
import shutil
import tempfile

import decky
import edat  # py_modules/edat.py: unlocks licence-locked themes with their .rap
import p3t  # py_modules/p3t.py: reads PS3 theme files
import pkg  # py_modules/pkg.py: reads the theme out of a PS3 package
import retro  # py_modules/retro.py: RetroAchievements, for games Emuchievements can't match
import soundtracks  # py_modules/soundtracks.py: Steam soundtracks
import steamhunters  # py_modules/steamhunters.py: which achievements came with which DLC


def _settings_path() -> str:
    return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")


def _themes_dir() -> str:
    return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "themes")


def _theme_dir(tid: str) -> str:
    return os.path.join(_themes_dir(), os.path.basename(tid))


def _cache_dir(kind: str) -> str:
    """Where one kind of saved data is kept (trophy lists, DLC groups...), a file for each entry."""
    return os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "cache", "".join(c for c in str(kind) if c.isalnum()))


def _cache_file(kind: str, key) -> str:
    return os.path.join(_cache_dir(kind), "".join(c for c in str(key) if c.isalnum() or c in "-_") + ".json")


def _cache_get(kind: str, key):
    try:
        with open(_cache_file(kind, key), "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except Exception as e:
        decky.logger.warning(f"cache {kind}/{key} unreadable: {e}")
        return None


def _cache_put(kind: str, key, value) -> bool:
    path = _cache_file(kind, key)
    tmp = None
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # (a temporary file of its own: the same entry can be saved twice at once, a game's list read by two pages)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
        return True
    except Exception as e:
        decky.logger.error(f"cache {kind}/{key} not written: {e}")
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
        return False


def _theme_meta(dest: str) -> dict:
    """A theme's theme.json."""
    with open(os.path.join(dest, "theme.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def _raps_dir() -> str:
    """The licences (.rap) chosen in Install, kept for the packages that need them."""
    return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "raps")


def _licences(near: str):
    """
    licences(content ID) for pkg.theme(): the .rap files that might unlock it, from the
    ones added in Install and the package's own folder. Those named after it come
    first; the rest are tried too, in case one was renamed. Tried one at a time, so
    afterwards find.last is the file of the one that fitted (if one was needed).
    """

    def find(cid: str):
        named, others, seen = [], [], set()
        for d in (_raps_dir(), os.path.dirname(near)):
            try:
                names = sorted(os.listdir(d))
            except OSError:
                continue
            for n in names:
                if not n.lower().endswith(".rap"):
                    continue
                try:
                    with open(os.path.join(d, n), "rb") as f:
                        rap = f.read(17)
                except OSError:
                    continue
                if len(rap) == 16 and rap not in seen:
                    seen.add(rap)
                    (named if n[:-4].upper() == cid.upper() else others).append((rap, os.path.join(d, n)))
        for rap, path in named + others:
            find.last = path
            yield rap

    find.last = None
    return find


_pending_pkg = None  # the last package that needed a licence it couldn't find
_progress = None  # the install under way, for the install screen: {"file", "size", "icon", "done": 0-1}

UNPACK_SHARE = 0.94  # of a package's install: getting the theme out (decrypting); the rest is installing it


async def _install(path: str) -> dict:
    global _pending_pkg, _progress
    if path.lower().endswith(".rap"):
        return await _add_rap(path)
    is_pkg = path.lower().endswith(".pkg")
    try:
        _progress = {"file": os.path.basename(path), "size": os.path.getsize(path), "icon": None, "done": 0.0}
    except OSError:
        _progress = None

    def report(share: float):
        if _progress:
            _progress["done"] = max(_progress["done"], min(1.0, share))

    def run():  # in a thread: unpacking a package can take a few seconds, unlocking one longer
        licences = _licences(path)
        data = None
        if is_pkg:
            package = pkg.load(path)  # (read once: it can be hundreds of MB)
            if _progress:
                _progress["icon"] = pkg.icon(package)
            data = pkg.theme(package, licences, lambda f: report(f * UNPACK_SHARE))[1]
        meta = p3t.install(path, _themes_dir(), data)
        if licences.last and os.path.dirname(licences.last) == _raps_dir() and meta.get("id"):
            _record_licence(meta["id"], os.path.basename(licences.last))
        return meta

    try:
        meta = await asyncio.to_thread(run)
        if _pending_pkg == path:
            _pending_pkg = None
        return meta
    except edat.NeedsLicence as e:
        _pending_pkg = path
        return {"error": str(e), "needsRap": e.content_id}
    except (pkg.PkgError, edat.EdatError) as e:
        return {"error": str(e)}
    except Exception as e:
        decky.logger.error(f"failed to install theme {path}: {e}")
        return {"error": str(e)}
    finally:
        _progress = None


def _record_licence(tid: str, name: str):
    """Note in a theme's theme.json which saved licence unlocked it, so deleting it can remove that too."""
    dest = _theme_dir(tid)
    try:
        meta = _theme_meta(dest)
        meta["licence"] = name
        with open(os.path.join(dest, "theme.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
    except Exception as e:
        decky.logger.error(f"couldn't note the licence of theme {tid}: {e}")


async def _add_rap(path: str) -> dict:
    try:
        with open(path, "rb") as f:
            rap = f.read(17)
        if len(rap) != 16:
            return {"error": "Not a PS3 licence (.rap)"}
        os.makedirs(_raps_dir(), exist_ok=True)
        shutil.copyfile(path, os.path.join(_raps_dir(), os.path.basename(path)))
    except OSError as e:
        return {"error": str(e)}
    added = {"rap": os.path.basename(path)}
    if not _pending_pkg or not os.path.isfile(_pending_pkg):
        return added
    return {**added, **await _install(_pending_pkg)}


_theme_entries = {}  # theme id -> (theme.json's mtime, its list entry): read once, until it's reinstalled


def _theme_entry(tid: str):
    """A theme's entry in the Theme list: its theme.json (less what the list doesn't need) and its icon."""
    dest = _theme_dir(tid)
    try:
        mtime = os.stat(os.path.join(dest, "theme.json")).st_mtime_ns
        hit = _theme_entries.get(tid)
        if hit and hit[0] == mtime:
            return hit[1]
        meta = _theme_meta(dest)
    except Exception:
        return None
    meta.pop("icons", None)
    meta.pop("sounds", None)
    meta["path"] = dest  # where its files are (shown in Information)
    # (themes installed by earlier versions have it as preview.png)
    thumb = next((p for p in (os.path.join(dest, n) for n in ("thumb.png", "preview.png")) if os.path.exists(p)), None)
    meta["thumbData"] = _data_uri(thumb, "image/png") if thumb else None
    _theme_entries[tid] = (mtime, meta)
    return meta


def _data_uri(path: str, mime: str) -> str:
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode("ascii")


def _read_b64(path: str):
    try:
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")
    except Exception:
        return None


# The Plugin methods' work, run in a thread (file reads and base64 of up to a track's tens of MB):
# Decky's backend serves every plugin from one event loop, which these would otherwise hold up.

def _list_themes():
    out = []
    try:
        ids = os.listdir(_themes_dir())
    except OSError:
        return out
    for tid in ids:
        entry = _theme_entry(tid)
        if entry:
            out.append(entry)
    for gone in set(_theme_entries) - set(ids):
        del _theme_entries[gone]
    return sorted(out, key=lambda t: t.get("name", "").lower())


def _background(meta: dict) -> str:
    """The file name of a theme's still background, or "" if it has none."""
    bg = meta.get("background")
    if bg is True:  # themes installed before the background's file name was recorded
        return "background.jpg"
    return os.path.basename(bg) if isinstance(bg, str) else ""


def _get_theme(tid: str):
    dest = _theme_dir(tid)
    try:
        meta = _theme_meta(dest)
    except Exception:
        return None
    icons = {}
    for iid in meta.get("icons", []):
        try:
            icons[iid] = _data_uri(os.path.join(dest, "icons", iid + ".png"), "image/png")
        except OSError:
            pass
    sounds = {}
    for sid in meta.get("sounds", []):
        try:
            sounds[sid] = _data_uri(os.path.join(dest, "sounds", os.path.basename(sid) + ".wav"), "audio/wav")
        except OSError:
            pass
    bg = _background(meta)
    path = os.path.join(dest, bg) if bg else ""
    mime = "image/png" if path.endswith(".png") else "image/jpeg"
    return {
        **meta,
        "iconData": icons,
        "soundData": sounds,
        "backgroundData": _data_uri(path, mime) if path and os.path.exists(path) else None,
    }


def _get_theme_preview(tid: str):
    dest = _theme_dir(tid)
    try:
        meta = _theme_meta(dest)
        for name in ("screenshot.png", _background(meta)):
            path = os.path.join(dest, name)
            if name and os.path.isfile(path):
                return _data_uri(path, "image/png" if name.endswith(".png") else "image/jpeg")
    except Exception as e:
        decky.logger.error(f"failed to read theme preview {tid}: {e}")
    return None


def _get_theme_scene(tid: str):
    dest = _theme_dir(tid)
    try:
        with open(os.path.join(dest, "scene.json"), "r", encoding="utf-8") as f:
            scene = f.read()  # passed through as text: the frontend parses it
        script = _read_b64(os.path.join(dest, "script.vsmx")) or ""
        return {"scene": scene, "script": script}
    except Exception:
        return None


def _delete_theme(tid: str) -> bool:
    dest = _theme_dir(tid)
    if not os.path.isdir(dest):
        return False
    try:
        licence = _theme_meta(dest).get("licence")
    except Exception:
        licence = None
    shutil.rmtree(dest, ignore_errors=True)
    if licence:
        still = []
        for other in os.listdir(_themes_dir()):
            try:
                still.append(_theme_meta(_theme_dir(other)).get("licence"))
            except Exception:
                pass
        if licence not in still:
            try:
                os.remove(os.path.join(_raps_dir(), os.path.basename(licence)))
            except OSError:
                pass
    return True


def _get_soundtrack(appid: int):
    try:
        return soundtracks.tracks(soundtracks.steam_root(decky.DECKY_USER_HOME), int(appid))
    except Exception as e:
        decky.logger.error(f"failed to read soundtrack {appid}: {e}")
        return {"downloaded": False, "tracks": []}


AUDIO_MIME = {".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".flac": "audio/flac", ".wav": "audio/wav"}


def _load_soundtrack_audio(path: str):
    if not soundtracks.is_music_file(soundtracks.steam_root(decky.DECKY_USER_HOME), path):
        return None
    data = _read_b64(path)
    return {"data": data, "mime": AUDIO_MIME[os.path.splitext(path)[1].lower()]} if data else None


class Plugin:
    async def get_settings(self):
        try:
            with open(_settings_path(), "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except FileNotFoundError:
            return None
        except Exception as e:
            decky.logger.error(f"failed to read settings: {e}")
            return None

    async def set_settings(self, settings: dict) -> bool:
        if not isinstance(settings, dict):
            return False
        path = _settings_path()
        tmp = path + ".tmp"
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)  # atomic write
            return True
        except Exception as e:
            decky.logger.error(f"failed to write settings: {e}")
            return False

    # PS3 themes (.p3t)

    async def theme_browse_dir(self):
        """Where Install's file browser starts: Downloads, if there is one."""
        home = decky.DECKY_USER_HOME
        downloads = os.path.join(home, "Downloads")
        return downloads if os.path.isdir(downloads) else home

    async def list_themes(self):
        """Installed themes (their theme.json, plus their icon as a data URI), by name."""
        return await asyncio.to_thread(_list_themes)

    async def install_progress(self):
        """The install under way (see _progress), or None."""
        return _progress

    async def install_theme(self, path: str):
        """
        Install a .p3t, or the theme inside a PS3 package. A .rap is kept for the packages that
        need it, and the last package that needed a licence is tried again with it.
        """
        return await _install(path)

    async def get_theme(self, tid: str):
        """A theme's icons (by PS3 icon id) and background, as data URIs."""
        return await asyncio.to_thread(_get_theme, tid)

    async def get_theme_preview(self, tid: str):
        """A theme's preview picture (themes installed before it was kept: their background instead), as a data URI."""
        return await asyncio.to_thread(_get_theme_preview, tid)

    async def get_theme_scene(self, tid: str):
        """A dynamic theme's scene (scene.json, as text) and its script (base64), if it has one."""
        return await asyncio.to_thread(_get_theme_scene, tid)

    async def get_theme_texture(self, tid: str, index: int):
        """One of a scene's textures: zlib-compressed pixels (DXT blocks or RGBA), base64."""
        return await asyncio.to_thread(_read_b64, os.path.join(_theme_dir(tid), f"tex{int(index)}.z"))

    async def delete_theme(self, tid: str) -> bool:
        """Delete a theme, and the saved licence that unlocked it (unless another theme needs it too)."""
        return await asyncio.to_thread(_delete_theme, tid)

    async def get_soundtrack(self, appid: int):
        """A soundtrack's tracks (Steam's list, downloaded or not) and their files once downloaded."""
        return await asyncio.to_thread(_get_soundtrack, appid)

    async def load_soundtrack_audio(self, path: str):
        """A downloaded track's audio, base64 (only files in a library's steamapps/music)."""
        return await asyncio.to_thread(_load_soundtrack_audio, path)

    # RetroAchievements

    async def retro_games(self):
        """The games played on Emuchievements' RetroAchievements account, with their progress (None: no account)."""
        try:
            return {"games": await asyncio.to_thread(retro.games), "error": retro.last_error}
        except Exception as e:
            decky.logger.error(f"RetroAchievements games failed: {e}")
            return {"games": None, "error": retro.last_error or str(e)}

    async def retro_achievements(self, game_id: int):
        """One RetroAchievements game's achievements (None: no account, or it couldn't be asked)."""
        try:
            return await asyncio.to_thread(retro.achievements, game_id)
        except Exception as e:
            decky.logger.error(f"RetroAchievements game {game_id} failed: {e}")
            return None

    # Saved data (trophy lists, DLC groups, RetroAchievements' games): kept across restarts, shown at once, read again behind

    async def cache_get(self, kind: str, key):
        """One saved entry (None: there isn't one)."""
        return await asyncio.to_thread(_cache_get, kind, key)

    async def cache_put(self, kind: str, key, value) -> bool:
        """Saves one entry."""
        return await asyncio.to_thread(_cache_put, kind, key, value)

    # Steam Hunters

    async def trophy_groups(self, appid: int):
        """A Steam game's achievements grouped by the DLC (or update) they came with ([]: none; None: couldn't be asked)."""
        return await asyncio.to_thread(steamhunters.groups, appid)

    async def _main(self):
        pass

    async def _unload(self):
        pass

    async def _uninstall(self):
        shutil.rmtree(os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "cache"), ignore_errors=True)
        for p in (_settings_path(), _settings_path() + ".tmp"):
            try:
                os.remove(p)
            except FileNotFoundError:
                pass
