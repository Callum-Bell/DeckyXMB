// Per-game music on hover, using the tracks the user set up in ThemeDeck
// (https://github.com/BrenticusMaximus/ThemeDeck). ThemeDeck isn't modified:
// its backend is called through Decky (get_tracks / load_track_audio) and the
// audio is played here. Without ThemeDeck installed this does nothing.
import { fromBase64 } from "./async";
import { getSettings } from "./settings";
import { mainHistory } from "./system";

const THEMEDECK = "ThemeDeck";
const HOVER_DELAY_MS = 800; // like the PS3, music starts once you rest on a game
const FADE_IN_MS = 900;
const FADE_OUT_MS = 450;
const STOP_GRACE_MS = 400; // lets the trophy page pick up the same track without a gap
const MAX_CACHED = 6;

interface Track {
  path: string;
  volume?: number;
  loop?: boolean;
  start_offset?: number;
}

function callThemeDeck<T>(method: string, ...args: any[]): Promise<T> {
  const backend = (globalThis as any).DeckyBackend;
  if (!backend?.call) return Promise.reject(new Error("Decky backend unavailable"));
  return backend.call("loader/call_plugin_method", THEMEDECK, method, ...args);
}

let tracks: Record<string, Track> | null = null;
let tracksAt = 0;
async function getTracks(): Promise<Record<string, Track>> {
  if (tracks && Date.now() - tracksAt < 30000) return tracks;
  try {
    tracks = (await callThemeDeck<Record<string, Track>>("get_tracks")) ?? {};
  } catch {
    tracks = {}; // ThemeDeck not installed / not loaded
  }
  tracksAt = Date.now();
  return tracks;
}

// ThemeDeck keys non-Steam shortcuts by their unsigned app id.
const trackFor = (all: Record<string, Track> | null, appid: number) => all?.[String(appid)] ?? all?.[String(appid >>> 0)];

const targetVolume = (track: Track | undefined) => Math.max(0, Math.min(1, track?.volume ?? 1)); // the track's own ThemeDeck volume

/** Base64 audio from a backend as a blob URL. */
export async function audioUrl(data: string, mime: string): Promise<string> {
  return URL.createObjectURL(await (await fromBase64(data, mime)).blob());
}

// Decoded tracks as blob URLs, most recent last.
const cache = new Map<string, string>();
async function urlFor(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit) {
    cache.delete(path);
    cache.set(path, hit);
    return hit;
  }
  const r = await callThemeDeck<{ data: string; mime: string }>("load_track_audio", path);
  const url = await audioUrl(r.data, r.mime || "audio/mpeg");
  cache.set(path, url);
  while (cache.size > MAX_CACHED) {
    const [oldPath, oldUrl] = cache.entries().next().value as [string, string];
    cache.delete(oldPath);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

interface Playing {
  appid: number;
  audio: HTMLAudioElement;
  target: number;
}

let playing: Playing | null = null;
let wanted = 0; // app id the music should follow (0 = silence)
let hoverTimer: any = null;
let stopTimer: any = null;
let generation = 0;
// ThemeDeck's own player, if we paused it to avoid two tracks at once.
let pausedThemeDeck: HTMLAudioElement | null = null;

function fade(audio: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const from = audio.volume;
  const start = Date.now();
  const id = setInterval(() => {
    const k = Math.min(1, (Date.now() - start) / ms);
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k >= 1) {
      clearInterval(id);
      done?.();
    }
  }, 30);
  (audio as any)._fade && clearInterval((audio as any)._fade);
  (audio as any)._fade = id;
}

function fadeOutCurrent(ms = FADE_OUT_MS) {
  const p = playing;
  playing = null;
  if (!p) return;
  fade(p.audio, 0, ms, () => {
    p.audio.pause();
    p.audio.removeAttribute("src");
    p.audio.load();
  });
}

function resumeThemeDeck() {
  const td = pausedThemeDeck;
  pausedThemeDeck = null;
  if (td && td.paused && td.src) td.play().catch(() => {});
}

async function start(appid: number) {
  const gen = ++generation;
  const all = await getTracks();
  const track = trackFor(all, appid);
  if (gen !== generation) return;
  if (!track?.path) {
    fadeOutCurrent();
    resumeThemeDeck();
    return;
  }
  let url: string;
  try {
    url = await urlFor(track.path);
  } catch (e) {
    console.warn("[DeckyXMB] couldn't load ThemeDeck track", e);
    return;
  }
  if (gen !== generation || wanted !== appid) return;

  fadeOutCurrent();
  const td: HTMLAudioElement | undefined = (globalThis as any).__themedeckSharedAudio;
  if (td && !td.paused) {
    td.pause();
    pausedThemeDeck = td;
  }

  const audio = document.createElement("audio");
  audio.src = url;
  audio.loop = track.loop !== false;
  audio.volume = 0;
  const target = targetVolume(track);
  playing = { appid, audio, target };
  const begin = () => {
    if (track.start_offset) audio.currentTime = track.start_offset;
    audio.play().then(() => fade(audio, target, FADE_IN_MS)).catch((e) => console.warn("[DeckyXMB] music playback blocked", e));
  };
  if (audio.readyState >= 1) begin();
  else audio.addEventListener("loadedmetadata", begin, { once: true });
}

// Steam may keep the home mounted behind other pages, so also watch the route:
// music only belongs on the XMB and our trophy list.
let routeWatch: any = null;
const ourRoute = (path: string) => path === "/library/home" || path.startsWith("/deckyxmb/");
function watchRoute() {
  if (routeWatch) return;
  routeWatch = setInterval(() => {
    if (!wanted && !playing) {
      clearInterval(routeWatch);
      routeWatch = null;
      return;
    }
    const path: string | undefined = mainHistory()?.location?.pathname;
    if (path && !ourRoute(path)) musicStop();
  }, 500);
}

// A soundtrack playing in the Soundtracks column silences the per-game music.
let blocked = false;
export function setMusicBlocked(b: boolean) {
  blocked = b;
  if (b) musicStop();
}

/** The selection rested on (or left) a game. `immediate` skips the hover delay. */
export function musicFocus(appid: number | null, immediate = false) {
  watchRoute();
  clearTimeout(stopTimer);
  clearTimeout(hoverTimer);
  const next = appid && getSettings().music && !blocked ? appid : 0;
  if (next === wanted && (playing?.appid === next || !next)) return;
  wanted = next;
  if (!next) {
    generation++;
    fadeOutCurrent();
    resumeThemeDeck();
    return;
  }
  if (playing?.appid === next) return;
  hoverTimer = setTimeout(() => start(next), immediate ? 0 : HOVER_DELAY_MS);
}

/** Leaving our screens: stop shortly unless another of our screens takes over. */
export function musicLeave() {
  clearTimeout(hoverTimer);
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => musicStop(), STOP_GRACE_MS);
}

// A game starting (launch.ts): its music plays on through the launch, till the game is in front.
let held = false;
export function musicHold() {
  held = true;
  clearTimeout(hoverTimer);
  clearTimeout(stopTimer);
}
/** The game is in front: its music fades out (over `ms`). */
export function musicRelease(ms?: number) {
  held = false;
  musicStop(ms);
}

/** Stop now (e.g. a game is launching). ThemeDeck's own music is left for it to manage. */
export function musicStop(ms?: number) {
  if (held) return; // (till the game is in front)
  clearTimeout(hoverTimer);
  clearTimeout(stopTimer);
  wanted = 0;
  generation++;
  fadeOutCurrent(ms);
  pausedThemeDeck = null;
}
