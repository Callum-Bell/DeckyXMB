// RetroAchievements, for the non-Steam games Emuchievements can't match by their ROM (it gives Steam nothing for
// those): asked of RetroAchievements by the plugin's backend, with Emuchievements' account, and matched to the games by
// name. The games played on the account are asked for once, and again on Sync with Server.
import { call } from "@decky/api";
import type { Trophy } from "./library";
import { save, saved } from "./saved";

interface RetroGame {
  id: number;
  title: string;
  console: string;
  total: number;
  earned: number;
}

/** The games played on the account, by name and by name without subtitle (made once per list, not per game). */
interface Played {
  byName: Map<string, RetroGame>;
  byHead: Map<string, RetroGame>;
}

let played: Promise<Played | null> | null = null;
const STATUS_KEY = "DeckyXMB.retroStatus"; // (what happened asking last: kept to look at if games don't show)
// The list last read is kept across restarts and used at once, while it's read again behind it (once a session).
const playedGames = () =>
  (played ??= saved<RetroGame[]>("retro", "games").then((games) => {
    const fresh = askPlayed().then((p) => {
      if (p) played = Promise.resolve(p);
      return p;
    });
    return games ? index(games) : fresh;
  }));
const askPlayed = () =>
  call<[], { games: RetroGame[] | null; error: string } | null>("retro_games")
    .catch((e) => ({ games: null, error: String(e) }))
    .then((r) => {
      const status = r?.error ? `failed: ${r.error}` : `${r?.games?.length ?? 0} games`;
      if (r?.error) console.warn("[DeckyXMB] RetroAchievements:", r.error);
      try {
        localStorage.setItem(STATUS_KEY, `${new Date().toISOString()} ${status}`);
      } catch {
        /* not kept */
      }
      // (asked again a minute later if it failed, not by every game at once)
      if (!r?.games) {
        setTimeout(() => (played = null), 60000);
        return null;
      }
      save("retro", "games", r.games);
      return index(r.games);
    });

/** Indexes the games with achievements (not hacks or subsets); the same game on more than one console: the one most earned in. */
function index(games: RetroGame[]): Played {
  const byName = new Map<string, RetroGame>();
  const byHead = new Map<string, RetroGame>();
  const keep = (map: Map<string, RetroGame>, key: string, g: RetroGame) => {
    const had = map.get(key);
    if (!had || g.earned > had.earned || (g.earned === had.earned && g.total > had.total)) map.set(key, g);
  };
  for (const g of games) {
    if (!(g.total > 0) || g.title.startsWith("~") || /\[subset/i.test(g.title)) continue;
    keep(byName, norm(g.title), g);
    keep(byHead, head(g.title), g);
  }
  return { byName, byHead };
}

/** Ask RetroAchievements for the games played on the account again (Sync with Server). */
export const refreshRetro = () => void (played = askPlayed());

// Names compared without case, punctuation or "the", with roman numerals as numbers ("Jak II: Renegade" and "Jak 2").
const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && w !== "the")
    .map((w) => ROMAN[w] ?? w)
    .join(" ");
/** A name without its subtitle ("Jak II: Renegade": "jak 2"). */
const head = (s: string) => norm(s.split(/:| - | – /)[0]);

/** The game on the account with this name (the whole name, else without its subtitle), or null. */
async function retroGame(name: string): Promise<RetroGame | null> {
  const p = name ? await playedGames() : null;
  return p?.byName.get(norm(name)) ?? p?.byHead.get(head(name)) ?? null;
}

/** A game's progress on RetroAchievements, or null if it isn't there. */
export async function retroProgress(name: string): Promise<{ achieved: number; total: number } | null> {
  const g = await retroGame(name);
  return g ? { achieved: g.earned, total: g.total } : null;
}

/** A game's achievements on RetroAchievements, or null if it isn't there. */
export async function retroTrophies(name: string): Promise<Trophy[] | null> {
  const g = await retroGame(name);
  if (!g) return null;
  const list = await call<[number], Trophy[] | null>("retro_achievements", g.id).catch(() => null);
  return list?.length ? list : null;
}
