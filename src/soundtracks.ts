// Steam soundtracks in the Soundtracks column: their track lists (Steam's own, so they're
// known before downloading) and playing downloaded tracks right in the XMB.
// Playing an album pauses the per-game hover music; launching a game stops it.
import { call } from "@decky/api";
import { signal } from "./signal";
import { audioUrl, setMusicBlocked } from "./music";

export interface Track {
  title: string;
  disc: number;
  number: number;
  seconds: number; // 0 if unknown
  path: string | null; // null until downloaded
}

export interface Album {
  downloaded: boolean;
  tracks: Track[];
}

const REFRESH_MS = 10000; // re-read on opening after this, so finished downloads show up

const albums = new Map<number, { album: Album | null; at: number }>(); // null while loading
const changes = signal();
const notify = changes.notify;

/** A soundtrack's tracks, or null while they load (asking again later refreshes them). */
export function albumTracks(appid: number): Album | null {
  const hit = albums.get(appid);
  if (!hit || (hit.album && Date.now() - hit.at > REFRESH_MS)) {
    albums.set(appid, { album: hit?.album ?? null, at: Date.now() });
    call<[number], Album>("get_soundtrack", appid)
      .then((a) => albums.set(appid, { album: { downloaded: !!a?.downloaded, tracks: Array.isArray(a?.tracks) ? a.tracks : [] }, at: Date.now() }))
      .catch(() => albums.set(appid, { album: { downloaded: false, tracks: [] }, at: Date.now() }))
      .finally(notify);
  }
  return hit?.album ?? null;
}

// playing

interface Playing {
  appid: number;
  index: number;
  audio: HTMLAudioElement;
  url: string;
}
let playing: Playing | null = null;
let generation = 0;
// The album's next track, loaded while this one plays so the next starts without a wait.
let upcoming: { path: string; url: Promise<string> } | null = null;

const load = (path: string) =>
  call<[string], { data: string; mime: string } | null>("load_soundtrack_audio", path).then((r) => {
    if (!r) throw new Error("not readable");
    return audioUrl(r.data, r.mime);
  });

function dropUpcoming() {
  upcoming?.url.then(URL.revokeObjectURL, () => {});
  upcoming = null;
}

function urlFor(path: string): Promise<string> {
  if (upcoming?.path === path) {
    const url = upcoming.url;
    upcoming = null;
    return url;
  }
  dropUpcoming();
  return load(path);
}

/** The album's next downloaded track after `index`, or -1. */
const nextTrack = (appid: number, index: number) => (albums.get(appid)?.album?.tracks ?? []).findIndex((t, i) => i > index && t.path);

/** What's playing (or paused), if anything. */
export function nowPlaying(): { appid: number; index: number; paused: boolean } | null {
  return playing && { appid: playing.appid, index: playing.index, paused: playing.audio.paused };
}

function release() {
  const p = playing;
  playing = null;
  if (!p) return;
  p.audio.pause();
  p.audio.removeAttribute("src");
  p.audio.load();
  URL.revokeObjectURL(p.url);
}

export function stopSoundtrack() {
  generation++;
  dropUpcoming();
  if (!playing) return;
  release();
  setMusicBlocked(false);
  notify();
}

/** ✕ on a downloaded track: play it (or pause / resume it if it's the one playing). The album carries on from there. */
export async function playTrack(appid: number, index: number) {
  if (playing?.appid === appid && playing.index === index) {
    if (playing.audio.paused) playing.audio.play().catch(() => {});
    else playing.audio.pause();
    notify();
    return;
  }
  const path = albums.get(appid)?.album?.tracks[index]?.path;
  if (!path) return;
  const gen = ++generation;
  release();
  setMusicBlocked(true);
  notify();
  let url: string;
  try {
    url = await urlFor(path);
  } catch (e) {
    console.warn("[DeckyXMB] couldn't load soundtrack track", e);
    if (gen === generation) stopSoundtrack();
    return;
  }
  if (gen !== generation) return URL.revokeObjectURL(url);
  const audio = document.createElement("audio");
  audio.src = url;
  audio.addEventListener("ended", () => {
    if (playing?.audio !== audio) return;
    const next = nextTrack(appid, index);
    if (next >= 0) playTrack(appid, next);
    else stopSoundtrack();
  });
  playing = { appid, index, audio, url };
  audio.play().catch((e) => console.warn("[DeckyXMB] soundtrack playback blocked", e));
  notify();
  const next = nextTrack(appid, index);
  const nextPath = next >= 0 ? albums.get(appid)!.album!.tracks[next].path! : null;
  if (nextPath && upcoming?.path !== nextPath) {
    dropUpcoming();
    upcoming = { path: nextPath, url: load(nextPath) };
    upcoming.url.catch(() => {}); // a failure shows when it's played
  }
}

/** Re-renders when track lists load or playback changes; returns a counter that changes with them. */
export const useSoundtracks = changes.use;
