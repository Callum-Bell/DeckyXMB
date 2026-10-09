// The Steam friends list, read from Steam's own friends store (the one its
// friends UI uses). Not a public API: getters confirmed on device 2026-10
// (display_name, persona.online_state / avatar_url_*, current_game_name,
// current_game_rich_presence, localized_online_status). Degrades to empty.
import { Navigation } from "@decky/ui";
import { CDN } from "./library";
import { signal } from "./signal";
import { openWeb } from "./system";

declare const appStore: any;

export type Presence = "ingame" | "online" | "away" | "offline";

export interface Friend {
  steamid: string;
  name: string;
  avatar: string; // medium (64px)
  avatarFull: string; // full (184px)
  presence: Presence;
  game: string; // what they're playing ("" if nothing)
  appid: number;
  detail: string; // rich presence when in a game, else Steam's status text ("Last online 17 hours ago")
  profileUrl: string;
}

const ORDER: Record<Presence, number> = { ingame: 0, online: 1, away: 2, offline: 3 };

function presenceOf(p: any): Presence {
  if (!p?.is_online) return "offline";
  if (p.is_ingame) return "ingame";
  return p.is_awayOrSnooze ? "away" : "online";
}

function toFriend(f: any): Friend {
  const p = f.persona;
  const presence = presenceOf(p);
  return {
    steamid: String(f.steamid64 ?? p.GetSteamIDAsString?.() ?? f.accountid),
    name: String(f.display_name ?? p.m_strPlayerName ?? ""),
    avatar: p.avatar_url_medium ?? "",
    avatarFull: p.avatar_url_full ?? p.avatar_url_medium ?? "",
    presence,
    game: presence === "ingame" ? String(f.current_game_name ?? "") : "",
    appid: Number(p.m_unGamePlayedAppID ?? 0),
    detail: presence === "ingame" ? String(f.current_game_rich_presence ?? "") : String(f.localized_online_status ?? ""),
    profileUrl: f.GetCommunityProfileURL?.() ?? p.GetCommunityProfileURL?.() ?? "",
  };
}

export function loadFriends(): Friend[] {
  try {
    const all: any[] = (globalThis as any).friendStore?.allFriends ?? [];
    return all
      .filter((f) => f?.is_friend !== false && f?.persona)
      .map(toFriend)
      .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || a.name.localeCompare(b.name));
  } catch (e) {
    console.warn("[DeckyXMB] friends read failed", e);
    return [];
  }
}

// You: your own entry atop the friends, from the store Steam's friends UI keeps (its self, and the status you've set:
// SetUserPersonaState(state, true) is what its own status menu calls; confirmed on device 2026-10).
export type MyStatus = "online" | "away" | "invisible";
export const MY_STATUSES: [MyStatus, string][] = [
  ["online", "Online"],
  ["away", "Away"],
  ["invisible", "Invisible"],
];
const PERSONA_STATE: Record<MyStatus, number> = { online: 1, away: 3, invisible: 7 }; // (Steam's EPersonaState)
const SNOOZE = 4; // (Steam's away for being idle)
const uiStore = () => (globalThis as any).friendStore?.m_FriendsUIFriendStore;
const statusChanged = signal();
export const useMyStatus = statusChanged.use;

/** The status you've set (Away also while Steam has you away for being idle: its 4 is Snooze). */
export function myStatus(): MyStatus {
  const s = uiStore()?.m_eUserPersonaState;
  return s === PERSONA_STATE.invisible ? "invisible" : s === PERSONA_STATE.away || s === SNOOZE ? "away" : "online";
}

export function setMyStatus(s: MyStatus) {
  try {
    uiStore()?.SetUserPersonaState?.(PERSONA_STATE[s], true);
  } catch (e) {
    console.warn("[DeckyXMB] status not set", e);
  }
  statusChanged.notify();
}

/** You, as a friend entry: your status (Invisible looking offline to you as to them), or your game. */
export function loadMe(): Friend | null {
  try {
    const self = uiStore()?.self;
    if (!self?.persona) return null;
    const me = toFriend(self);
    const s = myStatus();
    if (s === "invisible") return { ...me, presence: "offline", game: "", detail: "Invisible" };
    if (me.presence === "ingame") return me;
    const away = s === "away" || me.presence === "away";
    return { ...me, presence: away ? "away" : "online", detail: away ? "Away" : "Online" };
  } catch (e) {
    console.warn("[DeckyXMB] own profile read failed", e);
    return null;
  }
}

/** What a mini-profile (Steam's friends UI's card) shows: the Steam level, and the animated background chosen for it. */
export interface MiniProfile {
  level: number;
  background: string[]; // its video, as each format it's given in (webm first); none if none chosen
}

/** A mini-profile as Steam's friends UI knows it (loaded once asked for), if it's known yet. */
function miniProfile(player: any): MiniProfile | undefined {
  try {
    const mini = player?.miniProfileData;
    mini?.EnsureCommunityDataLoaded?.();
    const level = mini?.player_level;
    if (typeof level !== "number") return undefined;
    const bg = mini?.m_communityData?.profile_background ?? {};
    return { level, background: ["video/webm", "video/mp4"].map((type) => bg[type]).filter((src): src is string => typeof src === "string" && !!src) };
  } catch {
    return undefined;
  }
}

/** Your mini-profile, if Steam's friends UI knows it yet. */
export const myMiniProfile = () => miniProfile(uiStore()?.self);

/** A friend's mini-profile, if Steam's friends UI knows it yet. */
export const friendMiniProfile = (steamid: string) =>
  miniProfile(((globalThis as any).friendStore?.allFriends ?? []).find((f: any) => String(f.steamid64) === steamid));

/** The friend's Steam Community profile, in Steam's own browser. */
export const openProfile = (f: Friend) => void openWeb(f.profileUrl, `steam://url/SteamIDPage/${f.steamid}`);

/** The game a friend is playing: its library page if you own it, otherwise its store page. */
export function openFriendGame(f: Friend) {
  if (!f.appid) return;
  let owned = false;
  try {
    owned = !!appStore?.GetAppOverviewByAppID?.(f.appid);
  } catch {
    /* treat as not owned */
  }
  if (owned) return Navigation.Navigate(`/library/app/${f.appid}`);
  openWeb(`https://store.steampowered.com/app/${f.appid}/`);
}

/** Landscape art for a friend's game (Steam's CDN, same as the Game column). */
export const friendGameArt = (f: Friend) => (f.appid ? [`${CDN}/${f.appid}/header.jpg`] : []);
