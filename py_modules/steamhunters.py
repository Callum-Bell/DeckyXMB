# Steam Hunters' achievement groups: which of a game's achievements came with which DLC (or free update), for the trophy
# lists' Group Content. Its public API (https://steamhunters.com/api/Help), no account needed. Steam's own data has no
# such groups. (What's read is kept by the frontend, across restarts too: here only a failure is remembered.)
import functools
import json
import ssl
import time
import urllib.request

import decky

API = "https://steamhunters.com/api/GetAchievementGroups/v1"
# (its site sits behind Cloudflare, which turns away requests that don't look like a browser's)
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 DeckyXMB",
}
RETRY_S = 300  # (after a failure: not asked again at once for each list opened)

_failed = {}  # appid: when it last failed


@functools.lru_cache(maxsize=1)
def _context():
    """HTTPS that can check certificates: Decky's own Python may not know where they are, certifi (which Decky ships) does."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def groups(appid: int):
    """
    A Steam game's DLC and update groups: [{name, appid (whose art: the DLC's, or None), ids (its achievements' API names)}], in Steam
    Hunters' order; [] if it has none (its achievements are all the base game's). None if Steam Hunters couldn't be asked.
    """
    appid = int(appid)
    if time.time() - _failed.get(appid, 0) < RETRY_S:
        return None
    try:
        request = urllib.request.Request(f"{API}?appId={appid}&groupBy=dlcandupdate", headers=HEADERS)
        with urllib.request.urlopen(request, timeout=20, context=_context()) as r:
            data = json.load(r)
        out = [
            {
                "name": str(g.get("dlcAppName") or g.get("name") or ""),
                # (whose art it has: the DLC's, or for a group that isn't one, such as GTA IV's episodes, its logo's)
                "appid": int(g.get("dlcAppId") or g.get("logoAppId") or 0) or None,
                "ids": [str(n) for n in g.get("achievementApiNames") or []],
            }
            for g in data.get("groups") or []
        ]
        out = [g for g in out if g["ids"]]
    except Exception as e:
        decky.logger.warning(f"Steam Hunters groups for {appid} failed: {type(e).__name__}: {e}")
        _failed[appid] = time.time()
        return None
    _failed.pop(appid, None)
    return out
