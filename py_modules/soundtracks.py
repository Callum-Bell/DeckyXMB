"""
Steam soundtracks: their track lists and, once downloaded, their audio files.

Track lists come from Steam's app info cache (appcache/appinfo.vdf, the
"albummetadata" section), so they're known before anything is downloaded.
Downloaded soundtracks live in <library>/steamapps/music/<installdir>, named by
the soundtrack's appmanifest; their files are matched to the track list.
"""

import os
import re
import struct

AUDIO = (".mp3", ".ogg", ".m4a", ".flac", ".wav")  # in order of preference when a soundtrack ships several formats


def steam_root(home: str) -> str:
    for d in (".local/share/Steam", ".steam/steam", ".steam/root"):
        p = os.path.join(home, d)
        if os.path.isdir(os.path.join(p, "steamapps")):
            return os.path.realpath(p)
    return os.path.join(home, ".local/share/Steam")


def library_folders(root: str) -> list:
    """Every Steam library (the internal one, SD cards, other drives)."""
    out = [root]
    try:
        with open(os.path.join(root, "steamapps", "libraryfolders.vdf"), "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        for p in re.findall(r'"path"\s+"((?:[^"\\]|\\.)*)"', text):
            p = os.path.realpath(p.replace("\\\\", "\\"))
            if p not in out:
                out.append(p)
    except OSError:
        pass
    return out


def _installdir(lib: str, appid: int):
    try:
        with open(os.path.join(lib, "steamapps", f"appmanifest_{appid}.acf"), "r", encoding="utf-8", errors="replace") as f:
            m = re.search(r'"installdir"\s+"((?:[^"\\]|\\.)*)"', f.read())
        return m.group(1) if m else None
    except OSError:
        return None


def music_dir(root: str, appid: int):
    """Where a downloaded soundtrack's files are, or None."""
    for lib in library_folders(root):
        name = _installdir(lib, appid)
        if name:
            d = os.path.join(lib, "steamapps", "music", name)
            if os.path.isdir(d):
                return d
    return None


def music_roots(root: str) -> list:
    return [os.path.join(lib, "steamapps", "music") for lib in library_folders(root)]


def audio_files(d: str) -> list:
    """The soundtrack's audio files, in one format (some ship MP3 and FLAC side by side)."""
    by_ext = {}
    for base, _dirs, names in os.walk(d):
        for n in names:
            ext = os.path.splitext(n)[1].lower()
            if ext in AUDIO:
                by_ext.setdefault(ext, []).append(os.path.join(base, n))
    for ext in AUDIO:
        if ext in by_ext:
            return sorted(by_ext[ext], key=lambda p: p.lower())
    return []


# appinfo.vdf

class _AppInfo:
    """Reads single apps out of appinfo.vdf without loading the whole file (it can be hundreds of MB)."""

    def __init__(self, path: str):
        self.path = path
        self.mtime = os.path.getmtime(path)
        self.index = {}  # appid → (offset of its key/values, end)
        self.strings = None
        with open(path, "rb") as f:
            magic, _universe = struct.unpack("<II", f.read(8))
            self.version = magic & 0xFF
            if magic >> 8 != 0x075644 or self.version < 0x27:
                raise ValueError("unknown appinfo.vdf version")
            if self.version >= 0x29:  # keys are indexes into a string table at the end
                (table,) = struct.unpack("<q", f.read(8))
                pos = f.tell()
                f.seek(table)
                (count,) = struct.unpack("<I", f.read(4))
                self.strings = f.read().split(b"\0")[:count]
                f.seek(pos)
            # Per app: appid, size, then state, last updated, PICS token, SHA-1, change number
            # (and from v28 a second SHA-1) before its key/values.
            skip = 4 + 4 + 8 + 20 + 4 + (20 if self.version >= 0x28 else 0)
            while True:
                head = f.read(8)
                if len(head) < 8:
                    break
                appid, size = struct.unpack("<II", head)
                if appid == 0:
                    break
                start = f.tell()
                self.index[appid] = (start + skip, start + size)
                f.seek(start + size)

    def get(self, appid: int):
        span = self.index.get(appid)
        if not span:
            return None
        with open(self.path, "rb") as f:
            f.seek(span[0])
            data = f.read(span[1] - span[0])
        return self._kv(data, 0)[0]

    def _kv(self, b: bytes, i: int):
        out = {}
        while i < len(b):
            t = b[i]
            i += 1
            if t in (8, 11):  # end of this map
                return out, i
            if self.strings is not None:
                (k,) = struct.unpack_from("<I", b, i)
                i += 4
                key = self.strings[k].decode("utf-8", "replace") if k < len(self.strings) else str(k)
            else:
                e = b.index(b"\0", i)
                key = b[i:e].decode("utf-8", "replace")
                i = e + 1
            if t == 0:
                out[key], i = self._kv(b, i)
            elif t == 1:
                e = b.index(b"\0", i)
                out[key] = b[i:e].decode("utf-8", "replace")
                i = e + 1
            elif t in (2, 4, 6):
                (out[key],) = struct.unpack_from("<i" if t == 2 else "<I", b, i)
                i += 4
            elif t == 3:
                (out[key],) = struct.unpack_from("<f", b, i)
                i += 4
            elif t in (7, 10):
                (out[key],) = struct.unpack_from("<Q" if t == 7 else "<q", b, i)
                i += 8
            else:
                raise ValueError(f"unknown key/value type {t}")
        return out, i


_appinfo = None


def _album(root: str, appid: int) -> dict:
    """The soundtrack's "albummetadata" section, or {}."""
    global _appinfo
    path = os.path.join(root, "appcache", "appinfo.vdf")
    try:
        if not _appinfo or _appinfo.path != path or _appinfo.mtime != os.path.getmtime(path):
            _appinfo = _AppInfo(path)
        app = _appinfo.get(appid) or {}
    except (OSError, ValueError, IndexError, struct.error):
        return {}
    app = app.get("appinfo", app)
    album = app.get("albummetadata")
    return album if isinstance(album, dict) else {}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _num(v, default=0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def tracks(root: str, appid: int) -> dict:
    """
    {"downloaded": bool, "tracks": [{"title", "disc", "number", "seconds", "path" (None until downloaded)}]}.
    The track list is Steam's; files that match none of its tracks are added at the end.
    """
    album = _album(root, appid)
    listed = []
    for _k, t in sorted((album.get("tracks") or {}).items(), key=lambda kv: _num(kv[0])):
        if not isinstance(t, dict):
            continue
        title = t.get("originalname") or t.get("name") or ""
        listed.append(
            {
                "title": title,
                "disc": _num(t.get("discnumber"), 1),
                "number": _num(t.get("tracknumber")),
                "seconds": _num(t.get("m")) * 60 + _num(t.get("s")),
                "path": None,
            }
        )
    listed.sort(key=lambda t: (t["disc"], t["number"]))

    d = music_dir(root, appid)
    files = audio_files(d) if d else []
    left = list(files)
    multi_disc = len({t["disc"] for t in listed}) > 1

    def take(p):
        left.remove(p)
        return p

    # By name first, then by the track number at the start of the file name, then (same count) by order.
    for t in listed:
        key = _norm(t["title"])
        if key:
            hit = next((p for p in left if key in _norm(os.path.splitext(os.path.basename(p))[0])), None)
            if hit:
                t["path"] = take(hit)
    if not multi_disc:
        for t in listed:
            if t["path"] is None and t["number"]:
                hit = next((p for p in left if _num((re.match(r"\s*(\d+)", os.path.basename(p)) or [None, None])[1], -1) == t["number"]), None)
                if hit:
                    t["path"] = take(hit)
    unmatched = [t for t in listed if t["path"] is None]
    if unmatched and len(unmatched) == len(left):
        for t, p in zip(unmatched, list(left)):
            t["path"] = take(p)
    for p in left:
        listed.append({"title": os.path.splitext(os.path.basename(p))[0], "disc": 0, "number": 0, "seconds": 0, "path": p})
    return {"downloaded": bool(files), "tracks": listed}


def is_music_file(root: str, path: str) -> bool:
    """Only files inside a library's steamapps/music may be read."""
    real = os.path.realpath(path)
    return os.path.splitext(real)[1].lower() in AUDIO and any(real.startswith(os.path.realpath(m) + os.sep) for m in music_roots(root))
