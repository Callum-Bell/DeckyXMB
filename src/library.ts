// Reads the library from Steam's internal stores (not a public API field
// names can shift between client updates, so everything degrades to empty).
// Store access patterns from Spindeck (BSD-3-Clause).
import { call } from "@decky/api";
import { Navigation } from "@decky/ui";
import { formatDate } from "./datetime";
import { musicStop } from "./music";
import { stopSoundtrack } from "./soundtracks";
import { getSettings, Settings, updateSettings } from "./settings";
import { save, saved } from "./saved";
import { useEffect } from "react";
import { refreshRetro, retroProgress, retroTrophies } from "./retro";
import { signal } from "./signal";
import { sleep, timeout } from "./async";
import { findExport, lookup } from "./webpack";

declare const collectionStore: any;
declare const appStore: any;
declare const appDetailsStore: any;
declare const SteamClient: any;

export interface Game {
  appid: number;
  gameid: string; // what RunGame wants (differs from appid for non-Steam shortcuts)
  name: string;
  lastPlayed: number; // unix seconds
  minutes: number;
  installed: boolean;
  icon: string[]; // landscape art candidates (PS3 ICON0 is landscape too)
  logo: string[]; // its logo's candidates, then its landscape art's (if it has no logo)
  background: string[]; // hero art candidates (PS3 PIC1)
  cover?: string[]; // a soundtrack's square album cover candidates
  overview: any;
}

export interface Collection {
  id: string;
  name: string;
  games: () => Game[];
}

const APP_TYPE_GAME = 1;
const APP_TYPE_SHORTCUT = 1073741824;
const APP_TYPE_MUSIC = 8192;
export const CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps"; // Steam's art, by app id
const LOCAL = "/assets"; // Steam's cache of its library's art, by app id (as its own library loads it)

function custom(fn: string, app: any): string[] {
  try {
    const r = appStore?.[fn]?.(app);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

function toGame(a: any): Game {
  const shortcut = a.app_type === APP_TYPE_SHORTCUT;
  const icon = [...custom("GetCustomLandcapeImageURLs", a), ...custom("GetCustomLandscapeImageURLs", a)];
  const background = custom("GetCustomHeroImageURLs", a);
  const logo = custom("GetCustomLogoImageURLs", a);
  if (!shortcut) {
    // (Steam's own copies first, kept for its library: loaded in a moment, where its servers can take seconds)
    icon.push(`${LOCAL}/${a.appid}/header.jpg`, `${CDN}/${a.appid}/header.jpg`, `${CDN}/${a.appid}/capsule_616x353.jpg`);
    background.push(`${LOCAL}/${a.appid}/library_hero.jpg`, `${CDN}/${a.appid}/library_hero.jpg`);
    logo.push(`${LOCAL}/${a.appid}/logo.png`, `${CDN}/${a.appid}/logo.png`);
  }
  return {
    appid: a.appid,
    gameid: String(a.m_gameid ?? a.gameid ?? a.appid),
    name: a.display_name ?? a.sort_as ?? String(a.appid),
    lastPlayed: a.rt_last_time_played ?? a.rt_last_time_locally_played ?? 0,
    minutes: Number(a.minutes_playtime_forever ?? 0),
    installed: shortcut ? true : !!(a.installed ?? a.local_per_client_data?.installed),
    icon,
    logo: [...logo, ...icon],
    background,
    overview: a,
  };
}

const isGame = (a: any) => a && (a.app_type === APP_TYPE_GAME || a.app_type === APP_TYPE_SHORTCUT);

function toGames(apps: any[]): Game[] {
  return (apps ?? []).filter(isGame).map(toGame);
}

const byRecent = (a: Game, b: Game) => b.lastPlayed - a.lastPlayed;
const byName = (a: Game, b: Game) => a.name.localeCompare(b.name);

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    console.warn("[DeckyXMB] library read failed", e);
    return fallback;
  }
}

/** A collection's games as Steam lists them: without the ones hidden from the library. */
const shown = (c: any): any[] => c?.visibleApps ?? c?.allApps ?? [];

function allApps(): any[] {
  return shown(collectionStore?.GetCollection?.("type-games") ?? collectionStore?.allGamesCollection ?? collectionStore?.allAppsCollection);
}

export const recentGames = (installedOnly: boolean) =>
  safe(
    () =>
      toGames(allApps())
        .filter((g) => !installedOnly || g.installed)
        .sort(byRecent),
    [],
  );

export const allGamesByName = () => safe(() => toGames(allApps()).sort(byName), []);

/** Every game's app id (without making a Game of each). */
export const allGameIds = (): number[] =>
  safe(
    () =>
      allApps()
        .filter(isGame)
        .map((a) => a.appid),
    [],
  );

/** A soundtrack's album cover, as Steam's Soundtracks shelf shows it: the local copy first (works offline), then Steam's. */
function albumCover(a: any): string[] {
  const urls: string[] = [];
  for (const fn of ["GetCachedAlbumCoverURL", "GetAlbumCoverURLForApp"]) {
    try {
      const u = appStore?.[fn]?.(a);
      if (typeof u === "string" && u) urls.push(u);
    } catch {
      // not in this client version
    }
  }
  return urls;
}

/** Owned soundtracks (Steam's "Soundtracks" library filter), by name. */
export const soundtracks = () =>
  safe(() => {
    const apps: any[] = shown(collectionStore?.GetCollection?.("type-music") ?? collectionStore?.allAppsCollection);
    return apps
      .filter((a) => a?.app_type === APP_TYPE_MUSIC)
      .map((a) => ({ ...toGame(a), cover: albumCover(a) }))
      .sort(byName);
  }, []);

export function collections(): Collection[] {
  return safe(() => {
    const out: Collection[] = [];
    const gamesOf = (c: any) => () => safe(() => toGames(shown(c)).sort(byName), []);
    const fav = collectionStore?.GetCollection?.("favorite");
    if (fav) out.push({ id: "favorite", name: fav.displayName || "Favorites", games: gamesOf(fav) });
    for (const c of collectionStore?.userCollections ?? []) {
      if (!c?.id || c.id === "favorite" || c.id === "hidden") continue;
      out.push({ id: String(c.id), name: c.displayName || String(c.id), games: gamesOf(c) });
    }
    return out;
  }, []);
}

/** Starts a game; false if it couldn't be (its page is opened instead). */
export function launchGame(g: Game): boolean {
  musicStop();
  stopSoundtrack();
  try {
    SteamClient.Apps.RunGame(g.gameid, "", -1, 100);
    return true;
  } catch {
    openGamePage(g);
    return false;
  }
}

export function openGamePage(g: Game) {
  Navigation.Navigate(`/library/app/${g.appid}`);
}

/**
 * Steam's achievements page. Built with Steam's own route table
 * (Routes.Library.App.Achievements.My.Individual, confirmed on device 2026-10),
 * falling back to the path it produced there.
 */
const routes = lookup<any>(() => findExport("/achievements/my/individual", (v) => typeof v.Library?.App?.Achievements?.My?.Individual === "function"));
function achievementsPath(appid: number): string {
  try {
    const path = routes()?.Library.App.Achievements.My.Individual(appid);
    if (typeof path === "string" && path.includes(String(appid))) return path;
  } catch {
    /* fall back */
  }
  return `/library/app/${appid}/achievements/my/individual`;
}

/** Our PS3-style trophy page (registered in index.tsx). */
export const TROPHY_ROUTE = "/deckyxmb/trophies/:appid";
let pendingTrophyApp: Game | null = null;

let fromCollection = false;
/** The trophy page; from Trophy Collection, △ on it lists its trophies in the XMB instead. */
export function openAchievements(g: Game, collection = false) {
  pendingTrophyApp = g;
  fromCollection = collection;
  Navigation.Navigate(TROPHY_ROUTE.replace(":appid", String(g.appid)));
}

// △ switches between the two ways of showing a game's trophies, remembered for next time: the trophy page, or its
// trophies listed in the XMB (Network > Trophy Collection, that game opened, as the PS3 lists them).
let listOnReturn = 0;
export function showTrophyPage(g: Game) {
  updateSettings({ trophyCollection: "page" });
  openAchievements(g, true);
}
export function showTrophiesInXMB(appid: number) {
  updateSettings({ trophyCollection: "xmb" });
  requestTrophyList(appid);
  Navigation.NavigateBack();
}
/** Whether the trophy page was opened from Trophy Collection (△ goes back to it). */
export const trophyPageFromCollection = () => fromCollection;
export const setTrophyPageFromCollection = (on: boolean) => void (fromCollection = on);
/** The XMB, shown again, opens this game's trophies in Trophy Collection. */
export const requestTrophyList = (appid: number) => void (listOnReturn = appid);
/** The game whose trophies the XMB should open as it's shown (once). */
export function takeTrophyListRequest() {
  const a = listOnReturn;
  listOnReturn = 0;
  return a;
}

export const openSteamAchievements = (appid: number) => Navigation.Navigate(achievementsPath(appid));

/** App id of the last trophy page opened (used if the route's params can't be read). */
export const lastTrophyAppid = () => pendingTrophyApp?.appid ?? 0;

/** The game the trophy page was opened for (falls back to a lookup by app id). */
export function trophyGame(appid: number): Game | null {
  if (pendingTrophyApp?.appid === appid) return pendingTrophyApp;
  return gameByAppid(appid);
}

export const gameByAppid = (appid: number): Game | null =>
  safe(() => {
    const a = appStore?.GetAppOverviewByAppID?.(appid);
    return a ? toGame(a) : null;
  }, null);

export interface Trophy {
  id: string;
  name: string;
  description: string;
  image: string;
  achieved: boolean;
  unlocked: number; // unix seconds
  hidden: boolean;
  rarity: number; // % of players who have it
  progress?: { current: number; max: number };
}

const toTrophy = (a: any): Trophy => ({
  id: String(a.strID),
  name: String(a.strName ?? a.strID),
  description: String(a.strDescription ?? ""),
  image: String(a.strImage ?? ""),
  achieved: !!a.bAchieved,
  unlocked: Number(a.rtUnlocked ?? 0),
  hidden: !!a.bHidden,
  rarity: Number(a.flAchieved ?? 0),
  // Emuchievements reports 0/1 "progress" for plain unlocks; only show real counters.
  progress: a.flMaxProgress > 1 ? { current: Number(a.flCurrentProgress ?? 0), max: Number(a.flMaxProgress) } : undefined,
});

/** How many of these are earned, of how many. */
export const countOf = (t: Trophy[]): AchievementProgress => ({ achieved: t.filter((x) => x.achieved).length, total: t.length });

/** The orders a game's trophies can be listed in (Sort By), shared by the XMB's list and the trophy page. */
export const TROPHY_SORTS: [Settings["trophySort"], string][] = [
  ["original", "Original Order"],
  ["name", "Title Name"],
  ["newest", "Earned Date ▼"],
  ["oldest", "Earned Date ▲"],
  ["unearned", "Unearned First"],
  ["grade", "Grade"],
];

/**
 * In the order chosen: by date, the earned ones first (the unearned after them, as the game lists them); unearned first,
 * those not yet earned (as the game lists them) then the earned, latest first; by grade, the rarest first.
 */
export function sortTrophies(list: Trophy[], by: Settings["trophySort"], label: (t: Trophy) => string = (t) => t.name): Trophy[] {
  if (by === "name") return [...list].sort((a, b) => label(a).localeCompare(label(b)));
  if (by === "grade") return [...list].sort((a, b) => a.rarity - b.rarity);
  if (by === "newest" || by === "oldest" || by === "unearned") {
    const dir = by === "oldest" ? 1 : -1;
    const first = by === "unearned" ? -1 : 1; // (which come first: the earned, or those not yet)
    return [...list].sort((a, b) => first * (Number(b.achieved) - Number(a.achieved)) || (a.achieved ? dir * (a.unlocked - b.unlocked) : 0));
  }
  return list;
}

/** Steam's own list of a game's achievements: [] if it says there are none, null if it couldn't be asked. */
async function steamAchievements(appid: number): Promise<Trophy[] | null> {
  try {
    const r = await SteamClient.Apps.GetMyAchievementsForApp(String(appid));
    return r ? ((r.data?.rgAchievements ?? []) as any[]).map(toTrophy) : null;
  } catch {
    return null;
  }
}

/**
 * Steam's achievements store (not exported; found by content). Emuchievements
 * fills its m_mapMyAchievements for non-Steam shortcuts, in the same shape as
 * Steam's own entries: { loading, data: { achieved, unachieved, hidden } }.
 */
const achievementsStore = lookup<any>(() => findExport("m_mapMyAchievements", (v) => !!v.m_mapMyAchievements));

/** Achievements from Steam's store (where Emuchievements puts them), waiting briefly while it loads. */
async function storeTrophies(appid: number): Promise<Trophy[]> {
  const store = achievementsStore();
  if (!store) return [];
  for (let i = 0; i < 40; i++) {
    // Emuchievements only fills the store once its own fetch has finished, so keep asking.
    if (i % 5 === 0) {
      try {
        store.LoadMyAchievements?.(appid);
      } catch {
        /* not supported */
      }
    }
    const entry = store.m_mapMyAchievements?.get?.(appid);
    const d = entry?.data;
    if (d && !entry.loading) {
      return [...Object.values(d.achieved ?? {}), ...Object.values(d.unachieved ?? {}), ...Object.values(d.hidden ?? {})].map(toTrophy);
    }
    await sleep(200);
  }
  return [];
}

const SHORTCUTS = 0x80000000; // (non-Steam games' app ids are from here)

/**
 * Every achievement for the signed-in user. Steam games come from Steam's own
 * client call; non-Steam shortcuts (Emuchievements) from Steam's achievements
 * store. Both confirmed on device 2026-10.
 */
export async function loadTrophies(appid: number): Promise<Trophy[]> {
  const t = await readTrophies(appid);
  // (the game's progress, from the list just read: its percentage matches it, without asking again)
  if (t.length) {
    setProgress(appid, countOf(t));
    // (and the list kept, to show at once next time, after a restart too)
    void saved<Trophy[]>("trophies", appid).then((had) => JSON.stringify(had) !== JSON.stringify(t) && save("trophies", appid, t));
  }
  return t;
}

/** A game's trophies as last read (this session, or kept from before), while they're read again. */
export async function lastTrophies(appid: number): Promise<Trophy[] | undefined> {
  return lists.get(appid) ?? saved<Trophy[]>("trophies", appid);
}

async function readTrophies(appid: number): Promise<Trophy[]> {
  const steam = await steamAchievements(appid);
  if (steam?.length) return steam;
  if (appid >= SHORTCUTS) {
    const retro = await retroTrophies(gameByAppid(appid)?.name ?? "");
    if (retro) return retro;
  }
  return storeTrophies(appid);
}

export interface AchievementProgress {
  achieved: number;
  total: number;
}

// Group Content: a game's trophies by the DLC (or free update) they came with, as Steam Hunters groups them (the
// backend asks it: see py_modules/steamhunters.py), the base game's first. Steam games only; asked once a session.
export interface TrophyGroup {
  name: string;
  appid: number | null; // whose art it has (the DLC's)
  ids: string[]; // its trophies (their Steam API names)
}

export interface TrophySection {
  key: string;
  name: string;
  art: string[];
  trophies: Trophy[];
}

const groupsAsked = new Map<number, Promise<TrophyGroup[]>>();
const groupsRead = new Map<number, TrophyGroup[]>();

const GROUPS_KEEP_MS = 7 * 24 * 3600 * 1000; // (kept across restarts this long: a game's DLC rarely changes)

/** A game's groups ([] if it has none, or they couldn't be read: asked again next session). */
export function loadTrophyGroups(appid: number): Promise<TrophyGroup[]> {
  if (appid >= SHORTCUTS) return Promise.resolve([]);
  let p = groupsAsked.get(appid);
  if (!p) {
    p = saved<{ at: number; groups: TrophyGroup[] }>("groups", appid)
      .then((kept) => {
        if (kept && Date.now() - kept.at < GROUPS_KEEP_MS) return kept.groups;
        return call<[number], TrophyGroup[] | null>("trophy_groups", appid)
          .catch(() => null)
          .then((g) => {
            if (g) save("groups", appid, { at: Date.now(), groups: g });
            return g;
          });
      })
      .then((g) => {
        if (!g) groupsAsked.delete(appid); // (a failure is asked again, the next time the list is opened)
        groupsRead.set(appid, g ?? []);
        return g ?? [];
      });
    groupsAsked.set(appid, p);
  }
  return p;
}

/**
 * A game's trophies in its groups, when Group Content is on and it has any: its base game's (named as the game) and then
 * each group's, in Steam Hunters' order, none of them empty. null: listed all together. (`always`: whether it has
 * groups, Group Content on or off.)
 */
export function trophySections(g: Game, list: Trophy[], groups = groupsRead.get(g.appid), always = false): TrophySection[] | null {
  if ((!always && !getSettings().trophyGroups) || !groups?.length || !list.length) return null;
  // Each trophy in the first group that has it, else the base game's; each group in the game's order (Sort By sorts them).
  const groupOf = new Map<string, number>();
  groups.forEach((grp, i) => grp.ids.forEach((id) => groupOf.has(id) || groupOf.set(id, i)));
  // (named as Steam Hunters names them; keyed by place, as a DLC can have more than one group: Frostpunk's On The Edge)
  const out: TrophySection[] = groups.map((grp, i) => ({
    key: String(i),
    name: grp.name,
    art: grp.appid ? [`${CDN}/${grp.appid}/header.jpg`, ...g.icon] : g.icon,
    trophies: list.filter((t) => groupOf.get(t.id) === i),
  }));
  out.unshift({ key: "base", name: g.name, art: g.icon, trophies: list.filter((t) => !groupOf.has(t.id)) });
  const shown = out.filter((s) => s.trophies.length);
  return shown.length > 1 ? shown : null;
}

/** Counts from appDetailsStore, which Emuchievements patches for non-Steam games. */
function storeCounts(appid: number): AchievementProgress | null {
  try {
    const a = appDetailsStore?.GetAppData?.(appid)?.details?.achievements;
    return a?.nTotal > 0 ? { achieved: a.nAchieved ?? 0, total: a.nTotal } : null;
  } catch {
    return null;
  }
}

// Trophy Collection: each game's progress, asked for as its row comes on screen (a few at a time, the newest
// first: those passed by while scrolling wait), and, while the collection is open, any game not known yet behind them.
// What's known is kept (across restarts too) and shown at once; each game on screen is asked again once each time the
// collection is opened (in the background: a game's trophy list and back doesn't blank them while they're read again).
const CACHE_KEY = "DeckyXMB.achievementProgress";
const progress = new Map<number, AchievementProgress | null>(readCache()); // (null: it has none)
const fresh = new Set<number>(); // (asked since the collection was opened)
const progressChanged = signal();
const wanted: number[] = [];
let unknown: number[] = []; // (the collection's games not known yet, asked for once those on screen have been)
let asking = 0;
const ASK_AT_ONCE = 3;

function readCache(): [number, AchievementProgress | null][] {
  try {
    return Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}")).map(([k, v]) => [Number(k), v as AchievementProgress | null]);
  } catch {
    return [];
  }
}
let saving: ReturnType<typeof setTimeout> | undefined;
function saveCache() {
  clearTimeout(saving);
  saving = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(progress)));
    } catch {
      /* not kept: asked again next time */
    }
  }, 2000);
}

/**
 * Steam's own record of a game's progress (its library keeps one, saved across restarts): null if Steam has checked and
 * it has no achievements; undefined if Steam hasn't checked (non-Steam games aren't). It may be behind (new ones since).
 */
function steamProgress(appid: number): AchievementProgress | null | undefined {
  try {
    const c = (globalThis as any).appAchievementProgressCache?.m_achievementProgress?.mapCache?.get(appid);
    if (!c?.vetted) return undefined;
    return c.total > 0 ? { achieved: Number(c.unlocked) || 0, total: Number(c.total) } : null;
  } catch {
    return undefined;
  }
}

/**
 * A game's progress, asked for. `thorough` (Sync with Server) waits for Emuchievements even for a non-Steam game already
 * known to have none; otherwise that's only looked at again on RetroAchievements (not waited for: Plex, YouTube...).
 */
async function fetchProgress(appid: number, thorough = false, recheck = false): Promise<AchievementProgress | null> {
  if (!recheck && steamProgress(appid) === null) return null; // (none: nothing to ask)
  const known = storeCounts(appid);
  if (known) return known;
  // A non-Steam game: RetroAchievements' count, if it's there (Emuchievements' would be the same, if it could match it).
  if (appid >= SHORTCUTS) {
    const retro = await retroProgress(gameByAppid(appid)?.name ?? "");
    if (retro) return retro;
  }
  const steam = await steamAchievements(appid);
  if (steam?.length) return countOf(steam);
  if (steam && appid < SHORTCUTS) return null; // (a Steam game Steam says has none; a non-Steam one may have Emuchievements')
  if (!thorough && !recheck && progress.get(appid) === null) return null;
  const t = await storeTrophies(appid);
  return t.length ? countOf(t) : null;
}

function setProgress(appid: number, p: AchievementProgress | null) {
  const before = progress.get(appid);
  progress.set(appid, p);
  if (JSON.stringify(before) !== JSON.stringify(p)) {
    progressChanged.notify();
    saveCache();
  }
}

// While Trophy Collection is scrolling nothing new is asked: each answer re-renders the list, which (on the Deck) makes
// the rows coming on jump into place rather than slide. Once it settles, the games either side of the selection first.
const SETTLE_MS = 350;
let settling = 0;
let settled: ReturnType<typeof setTimeout> | undefined;

/** Trophy Collection's selection moved: `near`, the games by it (the nearest first), are asked for once it settles. */
export function achievementsScrolled(near: number[]) {
  settling = Date.now() + SETTLE_MS;
  for (const appid of [...near].reverse()) {
    if (fresh.has(appid)) continue;
    const i = wanted.indexOf(appid);
    if (i >= 0) wanted.splice(i, 1);
    wanted.push(appid); // (the nearest last: asked first)
  }
  clearTimeout(settled);
  settled = setTimeout(askNext, SETTLE_MS);
}

function askNext() {
  if (Date.now() < settling) return;
  while (asking < ASK_AT_ONCE && (wanted.length || unknown.length)) {
    const appid = wanted.length ? wanted.pop()! : unknown.shift()!;
    if (fresh.has(appid)) continue;
    fresh.add(appid);
    asking++;
    fetchProgress(appid)
      .catch(() => null)
      .then((p) => setProgress(appid, p))
      .finally(() => {
        asking--;
        askNext();
      });
  }
}

/** Re-renders as any game's progress becomes known. */
export const useAchievementProgressChanges = progressChanged.use;

/** A game's progress as far as it's known (the collection's, else Steam's), not asking: null if it has none. */
const knownOrSteam = (appid: number) => (progress.has(appid) ? progress.get(appid) : steamProgress(appid));

/** How many achievements you've earned, in all the games whose progress is known. */
export const trophiesEarned = () => allGameIds().reduce((n, appid) => n + (knownOrSteam(appid)?.achieved ?? 0), 0);

// (each game's earned achievements, as of when it was last played: read again only once it's been played since, and the
// game played last always, as it may be running)
const earnedByGame = new Map<number, { lastPlayed: number; earned: Trophy[] }>();

/** Your most recently earned achievements: from the games played last (those not known to have none). */
export async function recentTrophies(count: number, games = 8): Promise<Trophy[]> {
  const played = recentGames(false)
    .filter((g) => g.lastPlayed > 0 && knownOrSteam(g.appid) !== null)
    .slice(0, games);
  const lists = await Promise.all(
    played.map(async (g, i) => {
      const had = earnedByGame.get(g.appid);
      if (i > 0 && had?.lastPlayed === g.lastPlayed) return had.earned;
      const earned = (await loadTrophies(g.appid).catch((): Trophy[] => [])).filter((t) => t.achieved && t.unlocked > 0 && t.image);
      earnedByGame.set(g.appid, { lastPlayed: g.lastPlayed, earned });
      return earned;
    }),
  );
  return lists
    .flat()
    .sort((a, b) => b.unlocked - a.unlocked)
    .slice(0, count);
}

/**
 * Whether Trophy Collection hides a game: hidden with △ (Hide Game), or known to have no achievements (it's not asked
 * about again, the next time it's listed or synced, till it's unhidden).
 */
export const trophyGameHidden = (appid: number) => getSettings().trophyHidden.includes(appid) || knownOrSteam(appid) === null;

/** △ on a game in Trophy Collection: hidden, or unhidden (and its achievements looked for again, Steam's word aside). */
export function hideTrophyGame(appid: number, hide: boolean) {
  const hidden = getSettings().trophyHidden.filter((a) => a !== appid);
  updateSettings({ trophyHidden: hide ? [...hidden, appid] : hidden });
  if (hide) return;
  fresh.add(appid);
  fetchProgress(appid, true, true)
    .catch(() => null)
    .then((p) => setProgress(appid, p));
}

/** What's known of a game's progress (not asking for it). */
export const knownAchievementProgress = (appid: number) => progress.get(appid);

/** A game's achievement progress: undefined until it's first known, null if it has none. */
export function useAchievementProgress(appid: number): AchievementProgress | null | undefined {
  progressChanged.use();
  useEffect(() => {
    if (fresh.has(appid)) return;
    const i = wanted.indexOf(appid);
    if (i >= 0) wanted.splice(i, 1);
    wanted.push(appid);
    askNext();
  }, [appid]);
  return knownOrSteam(appid); // (Steam's, till it's been asked)
}

/**
 * While the collection (these games) is open: those not known yet are asked for behind the ones on screen, so they're
 * known by the time they're scrolled to. Leaving it (for a game's trophy list too), each game is to be asked again next time.
 */
export function refreshAchievementProgress(appids: number[]): () => void {
  // (those Steam says have none are known at once, together)
  unknown = [];
  let none = false;
  for (const a of appids) {
    if (progress.has(a)) continue;
    if (steamProgress(a) === null) {
      progress.set(a, null);
      none = true;
    } else unknown.push(a);
  }
  if (none) {
    progressChanged.notify();
    saveCache();
  }
  askNext();
  return () => {
    fresh.clear();
    wanted.length = 0;
    unknown = [];
  };
}

// Sync with Server (△ on Trophy Collection): every game's progress asked for again, more at once, as the
// PS3 synced its trophy information; what's read is kept as it comes (cancelling keeps what's been read so far).
const SYNC_AT_ONCE = 6;
let syncing: { done: number; total: number } | null = null;
let syncRun = 0;
const syncChanged = signal();

/** The sync under way (how far it's got), or null. */
export function useAchievementSync() {
  syncChanged.use();
  return syncing;
}

/** Games Trophy Collection hides (no achievements, or hidden with △) are skipped: unhiding one looks again. */
export function syncAchievements(appids: number[]) {
  const run = ++syncRun;
  const queue = appids.filter((a) => !trophyGameHidden(a));
  refreshRetro();
  const total = queue.length;
  let done = 0;
  syncing = { done, total };
  syncChanged.notify();
  const worker = async () => {
    while (run === syncRun && queue.length) {
      const appid = queue.shift()!;
      const p = await fetchProgress(appid, true).catch(() => null);
      if (run !== syncRun) return;
      fresh.add(appid); // (its row needn't ask again)
      setProgress(appid, p);
      syncing = { done: ++done, total };
      syncChanged.notify();
    }
  };
  void Promise.all(Array.from({ length: SYNC_AT_ONCE }, worker)).then(async () => {
    await sleep(400); // (the full bar, a moment)
    if (run === syncRun) cancelSync();
  });
}

export function cancelSync() {
  syncRun++;
  syncing = null;
  syncChanged.notify();
}

// A game's trophies listed in the XMB (Trophy Collection): read as its folder opens, the last read shown
// meanwhile (opened again, it doesn't go back to Loading).
const lists = new Map<number, Trophy[]>();
const listsChanged = signal();
export const useTrophyLists = listsChanged.use;
export const trophyList = (appid: number) => lists.get(appid);

/** Reads a game's trophies while its folder is open; returns a stop. */
export function watchTrophyList(appid: number): () => void {
  let open = true;
  // (the list kept from before shown meanwhile, rather than Loading)
  if (!lists.has(appid))
    void lastTrophies(appid).then((t) => {
      if (t && !lists.has(appid)) {
        lists.set(appid, t);
        listsChanged.notify();
      }
    });
  // (with its groups, so it isn't listed all together and then grouped: those that take long follow when they come)
  const known = groupsRead.has(appid);
  const groups = loadTrophyGroups(appid);
  if (!known) groups.then(() => listsChanged.notify());
  Promise.all([loadTrophies(appid).catch(() => []), timeout(groups, 3000, "groups").catch(() => [])])
    .then(([t]) => t)
    .then((t) => {
      if (!open && lists.has(appid)) return;
      const before = JSON.stringify(lists.get(appid));
      lists.set(appid, t);
      if (JSON.stringify(t) !== before) listsChanged.notify();
    });
  return () => {
    open = false;
  };
}

export function describeGame(g: Game): string {
  if (!g.installed) return "Not installed";
  const parts: string[] = [];
  if (g.lastPlayed) {
    const days = Math.floor((Date.now() / 1000 - g.lastPlayed) / 86400);
    parts.push(
      days <= 0
        ? "Played today"
        : days === 1
          ? "Played yesterday"
          : days < 30
            ? `Played ${days} days ago`
            : `Last played ${formatDate(new Date(g.lastPlayed * 1000))}`,
    );
  } else parts.push("Never played");
  if (g.minutes >= 60) parts.push(`${Math.round(g.minutes / 60)} h`);
  return parts.join("  ·  ");
}
