// Your profile, as the PS3's (your entry atop Friends, and the card it opens): your Steam level, your latest trophies,
// and your colour. What was last read is kept (across restarts too) and shown at once, then read again, at most once a minute.
import { friendMiniProfile, MiniProfile, myMiniProfile } from "./friends";
import { recentTrophies } from "./library";
import { sleep } from "./async";
import { signal } from "./signal";
import { callService, steamService } from "./webpack";

export interface Profile {
  steamid: string; // (whose it is: another account's isn't shown)
  level: number | null;
  recent: { name: string; image: string }[]; // the latest trophies, newest first
  background: string[]; // your mini-profile's animated background (its video, each format), if you've chosen one
}

const KEY = "DeckyXMB.profile";
const EMPTY: Profile = { steamid: "", level: null, recent: [], background: [] };
const RECENT = 8; // (as many as the card has room for)
const AGAIN_MS = 60000;

let profile: Profile = read();
let asked = 0;
const changed = signal();

function read(): Profile {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return EMPTY;
  }
}

function set(patch: Partial<Profile>) {
  const next = { ...profile, ...patch };
  if (JSON.stringify(next) === JSON.stringify(profile)) return;
  profile = next;
  changed.notify();
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* not kept */
  }
}

/** Your profile, re-rendering as it's read. */
export function useProfile(): Profile {
  changed.use();
  return profile;
}

/** Reads your profile again (not if it was read within the last minute). */
export function refreshProfile(steamid: string) {
  if (profile.steamid !== steamid) {
    set({ ...EMPTY, steamid });
    asked = 0;
  }
  if (Date.now() - asked < AGAIN_MS) return;
  asked = Date.now();
  void loadedMini(myMiniProfile).then((mini) => mini && set(mini)); // (Steam's own, its friends UI's)
  recentTrophies(RECENT)
    .then((t) => set({ recent: t.map(({ name, image }) => ({ name, image })) }))
    .catch(() => {});
}

// The PS3's twenty profile colours, as its picker lays them out (five to a row).
// prettier-ignore
export const PROFILE_COLOURS = [
  "#a9a9a9", "#2fb4ef", "#1db5c4", "#8ebb24", "#f1b31c",
  "#f28a1b", "#f27a92", "#f2a6c8", "#b7a3dc", "#8fa5ee",
  "#e6452a", "#2165c4", "#13874f", "#7a8b3d", "#c98b2a",
  "#62248c", "#b0246a", "#a3191a", "#7a5b3e", "#4d4d4d",
];

// A friend's card: their level, latest trophies and trophy count. Steam's client keeps none of it for others, and their
// community page refuses the plugin (too many requests), so the trophies are asked of Steam's own Player service, over
// the client's connection (as Steam's pages ask): their games, how many trophies in each, and those of the games they
// played last; their level and animated background are Steam's friends UI's. (What a private profile hides stays unknown.)
// What was last read is kept (across restarts too, for the friends last looked at) and shown at once, then read again, at
// most once a minute.
export interface FriendProfile {
  level: number | null;
  recent: { name: string; image: string }[];
  trophies: number | null;
  background: string[]; // their mini-profile's animated background (its video, each format), if they've chosen one
}

const NO_FRIEND: FriendProfile = { level: null, recent: [], trophies: null, background: [] };
const FRIENDS_KEY = "DeckyXMB.friendProfiles";
const FRIENDS_KEPT = 100; // (the friends last read: the rest are dropped)
const ICONS = "https://shared.fastly.steamstatic.com/community_assets/images/apps";
const RECENT_GAMES = 4; // (the games their latest trophies are looked for in)
const PER_CALL = 100; // (games asked about at once)
const COUNT_AGAIN_MS = 10 * 60000; // (their trophies in every game: asked about again only this often, it's many asks)

// (each as last read, oldest first; asked: when last asked for, this run; loading: being read)
const friends = new Map<string, { profile: FriendProfile | null; asked: number; loading?: boolean }>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(FRIENDS_KEY) ?? "{}") as Record<string, FriendProfile>).map(([id, profile]) => [
        id,
        { profile: { ...NO_FRIEND, ...profile }, asked: 0 }, // (as kept by an older version too: what it lacks, unknown)
      ]);
    } catch {
      return [];
    }
  })(),
);
const friendsChanged = signal();
// (how many trophies they have in each game, as last counted this run)
const counted = new Map<string, { at: number; unlocked: Map<number, number> }>();

function keepFriends() {
  try {
    const kept: Record<string, FriendProfile> = {};
    for (const [id, f] of [...friends].slice(-FRIENDS_KEPT)) if (f.profile) kept[id] = f.profile;
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(kept));
  } catch {
    /* not kept */
  }
}

// Steam's Player service
const player = steamService("Player.GetOwnedGames#1", (v) => typeof v?.GetOwnedGames === "function" && typeof v?.GetTopAchievementsForGames === "function");

/** A Player service method's reply, or null (not OK, e.g. a private profile's). */
const ask = (method: string, body: Record<string, unknown>) => callService(player(), method, body);

/** A mini-profile (yours, or a friend's), once Steam's friends UI has loaded it (asked for, it loads in the background). */
async function loadedMini(get: () => MiniProfile | undefined): Promise<MiniProfile | null> {
  for (let i = 0; i < 20; i++) {
    const m = get();
    if (m) return m;
    await sleep(250);
  }
  return null;
}

/** How many trophies a friend has in each of these games (counted again only every few minutes). */
async function unlockedIn(steamid: string, appids: number[]): Promise<Map<number, number>> {
  const last = counted.get(steamid);
  if (last && Date.now() - last.at < COUNT_AGAIN_MS) return last.unlocked;
  const unlocked = new Map<number, number>();
  const batches: number[][] = [];
  for (let i = 0; i < appids.length; i += PER_CALL) batches.push(appids.slice(i, i + PER_CALL));
  for (const r of await Promise.all(batches.map((ids) => ask("GetAchievementsProgress", { steamid, language: "english", appids: ids }))))
    for (const a of r?.achievement_progress ?? []) unlocked.set(a.appid, a.unlocked ?? 0);
  counted.set(steamid, { at: Date.now(), unlocked });
  return unlocked;
}

/** A friend's trophies: their latest, and how many in all (null: not known, e.g. a private profile). */
async function trophiesOf(steamid: string): Promise<Pick<FriendProfile, "recent" | "trophies">> {
  const owned = await ask("GetOwnedGames", { steamid, include_appinfo: false, include_played_free_games: true, skip_unvetted_apps: false });
  const games: any[] = [...(owned?.games ?? [])].sort((a, b) => (b.rtime_last_played ?? 0) - (a.rtime_last_played ?? 0));
  const unlocked = await unlockedIn(
    steamid,
    games.map((g) => g.appid),
  );
  // (the games they played last that they've earned trophies in, the latest first: their rarest trophies in each)
  const latest: number[] = games
    .filter((g) => unlocked.get(g.appid))
    .slice(0, RECENT_GAMES)
    .map((g) => g.appid);
  const top = latest.length ? await ask("GetTopAchievementsForGames", { steamid, language: "english", max_achievements: RECENT, appids: latest }) : null;
  const recent = latest.flatMap((appid) =>
    ((top?.games ?? []).find((g: any) => g.appid === appid)?.achievements ?? [])
      .filter((a: any) => a.icon)
      .map((a: any) => ({ name: String(a.name ?? ""), image: /^https?:/.test(a.icon) ? a.icon : `${ICONS}/${appid}/${a.icon}` })),
  );
  return {
    recent: recent.slice(0, RECENT),
    trophies: unlocked.size ? [...unlocked.values()].reduce((n, k) => n + k, 0) : null,
  };
}

/** A friend's profile as last read (null till it is), and whether it's being read; re-rendering as it's read. */
export function useFriendProfile(steamid: string): { profile: FriendProfile | null; loading: boolean } {
  friendsChanged.use();
  const f = friends.get(steamid);
  return { profile: f?.profile ?? null, loading: !!f?.loading };
}

/** Reads a friend's profile again (not while it's being read, nor if it was asked for within the last minute). Their
 * level and trophies are shown as each arrives; what wasn't read this time stays as last read. */
export function refreshFriendProfile(steamid: string) {
  const known = friends.get(steamid);
  if (known && (known.loading || Date.now() - known.asked < AGAIN_MS)) return;
  // (moved to the end: the friends last read are those kept)
  friends.delete(steamid);
  friends.set(steamid, { profile: known?.profile ?? null, asked: Date.now(), loading: true });
  friendsChanged.notify();
  const update = (patch: Partial<FriendProfile>) => {
    const f = friends.get(steamid)!;
    f.profile = { ...(f.profile ?? NO_FRIEND), ...patch };
    friendsChanged.notify();
  };
  const level = loadedMini(() => friendMiniProfile(steamid)).then((m) => m && update(m));
  const trophies = trophiesOf(steamid).then(
    ({ recent, trophies }) => update({ ...(recent.length && { recent }), ...(trophies !== null && { trophies }) }),
    (e) => console.warn("[DeckyXMB] friend's trophies not read", steamid, e),
  );
  void Promise.all([level, trophies]).then(() => {
    friends.get(steamid)!.loading = false;
    keepFriends();
    friendsChanged.notify();
  });
}
