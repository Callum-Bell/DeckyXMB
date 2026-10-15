// The XMB's sound effects (the PS3's own, or an installed PS3 theme's where it has them): in the XMB, and
// (patchSteamSounds) in place of Steam's own UI sounds in the rest of Big Picture too.
import { getSettings } from "./settings";
import { activeTheme } from "./themes";
import cancel from "./sounds/se_cancel.wav";
import cursor from "./sounds/se_cursor.wav";
import error from "./sounds/se_system_ng.wav";
import trophy from "./sounds/se_trophy.wav";

// The XMB's own sound effects, by the PS3 theme ids (se_...) a theme's replace them by. ("" plays nothing.)
const XMB_SOUNDS: Record<string, string> = {
  se_cursor: cursor,
  se_decide: cursor, // (the PS3's selecting sound is its cursor's)
  se_cancel: cancel,
  se_optionmenu: cursor,
  se_system_ok: cursor,
  se_system_ng: error,
  se_trophy: trophy,
  se_none: "",
};

/** The sound effect to play for a PS3 theme sound id: the theme's own, or else the XMB's. */
function soundFor(id: string): { key: string; url: string } | undefined {
  const theme = activeTheme();
  const url = theme?.sounds[id] ?? XMB_SOUNDS[id];
  return url === undefined ? undefined : { key: theme?.key ?? "", url };
}

// The sound effect each of the XMB's sounds is (the PS3's, as it used them).
const SOUNDS = {
  move: "se_cursor",
  category: "se_cursor",
  open: "se_decide",
  launch: "se_decide",
  back: "se_cancel",
  options: "se_optionmenu", // △'s options
  dialog: "se_system_ok", // a yes/no question
  error: "se_system_ng", // nothing to do
} as const;

export function playSound(kind: keyof typeof SOUNDS) {
  if (!getSettings().sounds) return;
  const own = soundFor(SOUNDS[kind]);
  if (own) playThemed(own.key, own.url);
}

// The sound effect each of Big Picture's own UI sounds becomes. (Notifications, volume and typing keep Steam's.)
const STEAM_TO_THEME: Record<string, string> = {
  deck_ui_misc_10: "se_cursor", // moving focus
  deck_ui_navigation: "se_cursor", // paging
  deck_ui_tab_transition_01: "se_cursor", // changing tabs
  deck_ui_tile_scroll: "se_cursor",
  deck_ui_slider_up: "se_cursor",
  deck_ui_slider_down: "se_cursor",
  deck_ui_default_activation: "se_decide",
  deck_ui_into_game_detail: "se_decide",
  deck_ui_launch_game: "se_decide",
  deck_ui_switch_toggle_on: "se_decide",
  deck_ui_switch_toggle_off: "se_decide",
  deck_ui_out_of_game_detail: "se_cancel",
  deck_ui_hide_modal: "se_cancel",
  deck_ui_side_menu_fly_out: "se_cancel",
  deck_ui_side_menu_fly_in: "se_optionmenu", // the Steam and Quick Access menus
  deck_ui_show_modal: "se_system_ok",
  deck_ui_bumper_end_02: "se_none", // at the end of a list (the PS3 is silent)
  deck_ui_achievement_toast: "se_trophy",
};

// While a game starts behind the XMB (launch.ts): Steam's UI sounds meanwhile (its own launching, and so on) aren't heard.
let muted = false;
export function muteSteamSounds(on: boolean) {
  muted = on;
}

/**
 * Plays the XMB's sound effects (or the theme's) in place of Big Picture's own UI sounds, while the XMB is the home.
 * Every UI sound Steam makes goes through its audio playback manager's PlayAudioURL; the ones replaced are played here
 * instead. Returns what takes the patch off.
 */
export function patchSteamSounds(): () => void {
  let manager: any;
  try {
    manager = (globalThis as any).SteamUIStore?.m_GamepadUIAudioStore?.m_AudioPlaybackManager;
  } catch {
    /* not there */
  }
  if (typeof manager?.PlayAudioURL !== "function") return () => {};
  const had = Object.prototype.hasOwnProperty.call(manager, "PlayAudioURL");
  const original = manager.PlayAudioURL;
  const patched = function (this: any, url: unknown, ...rest: unknown[]) {
    if (muted) return;
    const name = typeof url === "string" ? /(deck_ui_[a-z0-9_]+)\.wav/.exec(url)?.[1] : undefined;
    // (Sounds off: Steam's own play, as without the XMB)
    const s = getSettings();
    const own = s.enabled && s.sounds && name && STEAM_TO_THEME[name] ? soundFor(STEAM_TO_THEME[name]) : undefined;
    if (own) return void playThemed(own.key, own.url);
    return original.call(this, url, ...rest);
  };
  manager.PlayAudioURL = patched;
  return () => {
    if (manager.PlayAudioURL !== patched) return; // (patched again over ours since: left alone)
    if (had) manager.PlayAudioURL = original;
    else delete manager.PlayAudioURL;
  };
}

// These sounds are played here rather than by Steam's audio store: it fetches what it plays with a library that only
// takes http(s) and file URLs, and turns away their data URIs. Each is decoded once, for the theme on show.
const IDLE_MS = 10000; // (then the audio output is let go, as Steam's own does)
let context: AudioContext | null = null;
let decodedFor = "";
const decoded = new Map<string, Promise<AudioBuffer | null>>();
let idle: ReturnType<typeof setTimeout> | undefined;

function playThemed(themeKey: string, url: string) {
  if (!url) return; // (silence)
  try {
    context ??= new AudioContext();
  } catch {
    return; // no audio
  }
  const ctx = context;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  if (decodedFor !== themeKey) {
    decoded.clear();
    decodedFor = themeKey;
  }
  let buffer = decoded.get(url);
  if (!buffer) {
    buffer = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    decoded.set(url, buffer);
  }
  void buffer.then((b) => {
    if (!b) return;
    const source = ctx.createBufferSource();
    source.buffer = b;
    source.connect(ctx.destination);
    source.start();
    clearTimeout(idle);
    idle = setTimeout(() => void ctx.suspend().catch(() => {}), IDLE_MS + b.duration * 1000);
  });
}
