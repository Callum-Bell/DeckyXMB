import { call } from "@decky/api";
import { signal } from "./signal";
import type { DateFormat, TimeFormat } from "./datetime";

export type ThemeKey = "monthly" | "silver" | "gold" | "lime" | "pink" | "green" | "magenta" | "teal" | "blue" | "violet" | "amber" | "brown" | "red";

export interface Settings {
  enabled: boolean;
  theme: ThemeKey;
  wave: boolean;
  backgrounds: boolean; // fade in the selected game's art
  clock: boolean;
  sounds: boolean;
  gameAction: "menu" | "launch" | "page"; // what ✕ does on a game
  installedOnly: boolean; // Game column shows installed games only
  // Folders in the Game column besides All Games (△ there to choose): Favorites, installed games, Steam's other collections
  gameFavorites: boolean;
  gameInstalled: boolean;
  gameCollections: boolean;
  videoGames: number[]; // games moved to the Video column (their app ids), out of the Game column
  trophyCollection: "xmb" | "page"; // how a game's trophies were last shown (△ switches): listed in the XMB (as the PS3), or the trophy page
  trophySort: "original" | "name" | "newest" | "oldest" | "grade"; // a game's trophies, in the XMB (△ > Sort By) and on the trophy page (□): as the game lists them, by name, by when earned, or rarest first
  music: boolean; // play the game's ThemeDeck track while it's selected
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  customTheme: string; // an installed PS3 theme's id; "" = Original (the wave)
  brightness: string; // the background dimmed by this many steps: "0" (Normal) to "5" (-5)
  deepBlacks: "off" | "on"; // an installed theme's background with video levels (16 is black), as PS3 footage often shows it
  themeResolution: "native" | "1080p"; // an animated theme drawn at the screen's resolution, or at most 1080p (scaled up: less work)
  profileColour: string; // your colour (your profile, and your entry atop Friends): one of the PS3's twenty; "" = none chosen
  controllerGlyphs: string; // the button images shown throughout Steam: "ds2" / "ds3" (DualShock 2 / 3), or "steam" (Steam's own)
}

export const DEFAULTS: Settings = {
  enabled: true,
  theme: "monthly",
  wave: true,
  backgrounds: true,
  clock: true,
  sounds: true,
  gameAction: "menu",
  installedOnly: true,
  gameFavorites: false,
  gameInstalled: false,
  gameCollections: false,
  videoGames: [],
  trophyCollection: "xmb",
  trophySort: "original",
  music: true,
  dateFormat: "DMY",
  timeFormat: "24h",
  customTheme: "",
  brightness: "0",
  deepBlacks: "off",
  themeResolution: "native",
  controllerGlyphs: "ds3",
  profileColour: "",
};

let current: Settings = { ...DEFAULTS };
let loaded = false;
const changes = signal();
const notify = changes.notify;

export async function initSettings() {
  try {
    const saved = await call<[], Partial<Settings> | null>("get_settings");
    if (saved) current = { ...DEFAULTS, ...saved };
  } catch {
    /* backend unavailable: defaults */
  }
  loaded = true;
  notify();
}

export const getSettings = () => current;

export const subscribeSettings = changes.subscribe;

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  notify();
  call("set_settings", current).catch(() => {});
}

export function useSettings(): [Settings, boolean] {
  changes.use();
  return [current, loaded];
}
