# RetroAchievements, for the non-Steam games Emuchievements can't match (it matches a game by its ROM's hash, and gives
# Steam nothing for those it doesn't know): asked of RetroAchievements directly, with the account Emuchievements is
# signed in with (its settings), and matched to games by their names (see library.ts).
import functools
import json
import os
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import decky

API = "https://retroachievements.org/API/"
MEDIA = "https://media.retroachievements.org"


last_error = ""  # (what went wrong last, for the frontend to keep: "" when it worked)


def _account():
    """Emuchievements' username and web API key, or None (it isn't installed, or isn't signed in)."""
    global last_error
    # Its settings are in its own folder beside ours, named as its plugin folder is (looked for, not assumed).
    root = os.path.dirname(decky.DECKY_PLUGIN_SETTINGS_DIR)
    try:
        folders = [d for d in os.listdir(root) if "emuchiev" in d.lower()]
    except Exception:
        folders = []
    for folder in folders:
        try:
            with open(os.path.join(root, folder, "settings.json"), "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        ra = data.get("retroachievements") if isinstance(data.get("retroachievements"), dict) else data
        user, key = ra.get("username"), ra.get("api_key")
        if user and key:
            return (str(user), str(key))
    last_error = f"no RetroAchievements account in Emuchievements' settings (looked in {root}: {folders or 'none found'})"
    return None


@functools.lru_cache(maxsize=1)
def _context():
    """HTTPS that can check certificates: Decky's own Python may not know where they are, certifi (which Decky ships) does."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _get(endpoint: str, account=None, **params):
    global last_error
    account = account or _account()
    if not account:
        return None
    query = urllib.parse.urlencode({"u": account[0], "y": account[1], **params})
    request = urllib.request.Request(f"{API}{endpoint}?{query}", headers={"User-Agent": "DeckyXMB"})
    try:
        with urllib.request.urlopen(request, timeout=20, context=_context()) as r:
            data = json.load(r)
        last_error = ""
        return data
    except Exception as e:
        last_error = f"{endpoint}: {type(e).__name__}: {e}"
        raise


def _unix(date) -> int:
    """RetroAchievements' dates ("2024-01-31 18:04:05", UTC) as unix seconds."""
    try:
        return int(datetime.strptime(str(date), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
    except Exception:
        return 0


def games():
    """Every game played on the account, with how much of it is earned; None if there's no account."""
    account = _account()
    if not account:
        return None
    out, offset = [], 0
    while True:
        page = _get("API_GetUserCompletionProgress.php", account, c=500, o=offset) or {}
        results = page.get("Results") or []
        for g in results:
            out.append(
                {
                    "id": int(g.get("GameID") or 0),
                    "title": str(g.get("Title") or ""),
                    "console": str(g.get("ConsoleName") or ""),
                    "total": int(g.get("MaxPossible") or 0),
                    "earned": max(int(g.get("NumAwarded") or 0), int(g.get("NumAwardedHardcore") or 0)),
                }
            )
        offset += len(results)
        if not results or offset >= int(page.get("Total") or 0):
            break
    return out


def achievements(game_id: int):
    """One game's achievements, as the trophy lists want them; None if there's no account."""
    game = _get("API_GetGameInfoAndUserProgress.php", g=int(game_id))
    if game is None:
        return None
    players = int(game.get("NumDistinctPlayers") or 0)
    out = []
    for a in sorted((game.get("Achievements") or {}).values(), key=lambda a: (int(a.get("DisplayOrder") or 0), int(a.get("ID") or 0))):
        earned = a.get("DateEarnedHardcore") or a.get("DateEarned")
        badge = str(a.get("BadgeName") or "")
        out.append(
            {
                "id": str(a.get("ID")),
                "name": str(a.get("Title") or ""),
                "description": str(a.get("Description") or ""),
                "image": f"{MEDIA}/Badge/{badge}{'' if earned else '_lock'}.png" if badge else "",
                "achieved": bool(earned),
                "unlocked": _unix(earned) if earned else 0,
                "hidden": False,
                "rarity": round(int(a.get("NumAwarded") or 0) * 100 / players, 1) if players else 0,
            }
        )
    return out
