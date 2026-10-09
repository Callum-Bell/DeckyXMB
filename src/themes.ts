// PS3 themes (.p3t): installing them (the backend unpacks them) and the active
// theme's icons and background. "Original" (no theme) is the wave.
import { call, FileSelectionType, openFilePicker, toaster } from "@decky/api";
import { fromBase64, sleep } from "./async";
import { signal } from "./signal";
import { getSettings, subscribeSettings, updateSettings } from "./settings";
import type { SceneData } from "./dynamic/scene";
import type { TextureData } from "./dynamic/render";
import type { IconName } from "./xmb/icons";

export interface ThemeInfo {
  id: string;
  name: string;
  author?: string;
  comment?: string;
  dynamic?: boolean; // has an animated background
  scene?: boolean; // ...which could be unpacked and is drawn (else its still background is used)
  thumbData?: string | null; // its own icon, shown in the theme list
  path?: string;
}

export interface Assets {
  id: string;
  key: string; // this load of it (a theme reinstalled while on show is loaded again)
  icons: Record<string, string>; // PS3 icon id → data URI
  background: string | null;
  scene?: { data: SceneData; script: Uint8Array } | null; // a dynamic theme's animated scene
}

let installed: ThemeInfo[] = [];
let assets: Assets | null = null;
let loadingId = "";
let loaded: Promise<void> = Promise.resolve(); // the active theme, loaded with everything it shows
let switching = false; // "Please wait..." while a newly chosen theme loads
let staged: Assets | null | undefined; // the theme loaded behind "Please wait...", shown as it closes
let stagedDrawn = ""; // the staged theme whose animated background has drawn (it's built, hidden, during the wait)
let onStagedDrawn: (() => void) | null = null;
let installing = false;
let progress: InstallProgress | null = null; // the install under way, shown on the install screen
let reloadId = ""; // reinstalled while on show: load it again
let loads = 0;
let browseDir = ""; // where Install's file browser opens: the last folder a file was chosen from
const changes = signal();
const notify = changes.notify;

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function initThemes() {
  await refreshInstalled();
  subscribeSettings(syncActive);
  syncActive();
}

async function refreshInstalled() {
  installed = asArray<ThemeInfo>(await call<[], ThemeInfo[]>("list_themes").catch(() => []));
  notify();
}

/** Load the chosen theme's icons and background when the setting changes. */
function syncActive() {
  const id = getSettings().customTheme;
  if (!id) {
    loadingId = "";
    loaded = Promise.resolve();
    show(null);
    return;
  }
  if ((assets?.id === id && reloadId !== id) || loadingId === id) return;
  reloadId = "";
  loadingId = id;
  const key = `${id}#${++loads}`;
  // Couldn't be read: switching to it, the theme on show stays (and is the one chosen again); at start, the wave meanwhile.
  const failed = () => {
    if (getSettings().customTheme !== id) return;
    if (!switching) return show(null);
    toast("Couldn't load theme", "Its files couldn't be read. Try installing it again.");
    updateSettings({ customTheme: assets?.id ?? "" });
  };
  loaded = call<[string], { iconData?: Record<string, string>; backgroundData?: string | null; scene?: boolean } | null>("get_theme", id)
    .then(async (t) => {
      if (getSettings().customTheme !== id) return;
      const icons = t?.iconData ?? {};
      const background = t?.backgroundData ?? null;
      // Decoded before they're shown, so they appear at once rather than one by one.
      await Promise.all([...Object.values(icons), background].map(decode));
      if (getSettings().customTheme !== id) return;
      if (!t) return failed();
      if (!t.scene) return show({ id, key, icons, background });
      const s = await call<[string], { scene: string; script: string } | null>("get_theme_scene", id).catch(() => null);
      if (getSettings().customTheme !== id) return;
      const next: Assets = {
        id,
        key,
        icons,
        background,
        scene: s ? { data: JSON.parse(s.scene), script: new Uint8Array(await (await fromBase64(s.script)).arrayBuffer()) } : null,
      };
      if (next.scene) await Promise.all(next.scene.data.textures.map((_, i) => loadTexture(next, i)));
      if (getSettings().customTheme === id) show(next);
    })
    .catch(failed)
    .finally(() => loadingId === id && (loadingId = ""));
}

/** Show a theme (or the wave, for null): at once, or as "Please wait..." closes if it's up. */
function show(next: Assets | null) {
  if (switching) {
    staged = next;
    return notify(); // its animated background starts building, hidden
  }
  if (assets === next) return;
  assets = next;
  notify();
}

function decode(src: string | null): Promise<void> {
  if (!src) return Promise.resolve();
  const img = new Image();
  img.src = src;
  return img.decode().catch(() => {});
}

const SWITCH_MIN_MS = 1500; // the PS3 always showed "Please wait..." for a moment
const SWITCH_MAX_MS = 10000;

/**
 * Switch theme as the PS3 does: the XMB gives way to "Please wait..." until the new
 * theme has loaded, then comes back with it all in place (no icons popping in).
 */
export async function applyTheme(id: string, again = false) {
  const current = id === getSettings().customTheme;
  if (switching || (current && !again)) return;
  switching = true;
  stagedDrawn = "";
  notify();
  const start = Date.now();
  await sleep(250); // let the XMB fade out first
  if (current) {
    reloadId = id; // (again: it was reinstalled)
    syncActive();
  } else updateSettings({ customTheme: id }); // starts loading it (syncActive)
  const timeout = sleep(start + SWITCH_MAX_MS - Date.now());
  await Promise.race([loaded, timeout]);
  // A dynamic theme: wait until its scene has drawn, so it appears as it should rather than its preview.
  if (staged?.scene && stagedDrawn !== staged.id) await Promise.race([new Promise<void>((r) => (onStagedDrawn = r)), timeout]);
  onStagedDrawn = null;
  await sleep(start + SWITCH_MIN_MS - Date.now());
  switching = false;
  if (staged !== undefined) assets = staged;
  staged = undefined;
  notify();
}

/** Whether "Please wait..." is up (a theme is being switched to). */
export const themeSwitching = () => switching;

/** The theme on show (null: the wave), and the one being switched to behind "Please wait..." (if it's loaded). */
export const activeTheme = () => assets;
export const stagedTheme = () => (switching ? staged : undefined);

/** A theme's animated background has drawn its first frame. */
export function sceneDrawn(id: string) {
  if (staged?.id !== id) return;
  stagedDrawn = id;
  onStagedDrawn?.();
}

export interface InstallProgress {
  file: string;
  size: number; // bytes (0: not known yet)
  icon: string | null; // the package's icon, if it has one
  done: number; // 0-1
}

/** The install under way (the install screen shows while there is one), or null. */
export const installProgress = () => progress;

const INSTALL_POLL_MS = 250;
const INSTALL_DONE_MS = 600; // the finished bar stays a moment, as on the PS3

type InstallResult = Partial<ThemeInfo> & {
  error?: string;
  rap?: string; // a licence (.rap) was added
  needsRap?: string; // the content ID of the licence a locked theme needs
};

const toast = (title: string, body: string) => toaster.toast({ title, body });

/**
 * Theme > Install: choose a file in Decky's file browser. A .p3t (or the theme in a .pkg) is
 * installed and switched to. A .rap is kept for locked themes (and the last one that needed
 * a licence is installed with it).
 */
export async function browseTheme() {
  if (installing) return;
  if (!browseDir) browseDir = await call<[], string>("theme_browse_dir").catch(() => "/home/deck");
  let file: string;
  try {
    const picked = await openFilePicker(FileSelectionType.FILE, browseDir, true, true, undefined, ["p3t", "pkg", "rap"], false, false);
    file = picked.realpath || picked.path;
  } catch {
    return; // closed without choosing
  }
  browseDir = file.slice(0, file.lastIndexOf("/")) || "/";
  const name = file.slice(file.lastIndexOf("/") + 1);
  installing = true;
  // The install screen, with the backend's progress (a .rap shows it only if it installs the package that needed it).
  if (!/.rap$/i.test(name)) {
    progress = { file: name, size: 0, icon: null, done: 0 };
    notify();
  }
  const poll = setInterval(() => {
    call<[], InstallProgress | null>("install_progress")
      .then((p) => {
        if (!installing || !p) return;
        progress = { ...p, done: Math.max(p.done, progress?.done ?? 0) };
        notify();
      })
      .catch(() => {});
  }, INSTALL_POLL_MS);
  const r = await call<[string], InstallResult | null>("install_theme", file).catch((e) => ({ error: String(e) }) as InstallResult);
  clearInterval(poll);
  installing = false;
  if (progress) {
    if (r?.id) {
      progress = { ...progress, done: 1 };
      notify();
      await sleep(INSTALL_DONE_MS);
    }
    progress = null;
    notify();
  }
  if (r?.id) {
    previews.delete(r.id); // reinstalled: its preview may be new
    await refreshInstalled();
    void applyTheme(r.id, true);
    toast(r.rap ? "Licence added, theme installed" : "Theme installed", r.name || name);
  } else if (r?.rap && !r.error) {
    toast("Licence added", "Themes that need it can now be installed.");
  } else {
    const why = r?.needsRap ? `Needs ${r.needsRap}.rap. Choose it in Install, and this theme installs with it.` : r?.error || "Couldn't install this theme";
    toast(r?.rap && r.needsRap ? "Licence added, but it doesn't fit" : "Couldn't install theme", why);
  }
}

const previews = new Map<string, string | null>(); // by theme id; null if it has none

/** A theme's preview picture (fetched the first time it's asked for: undefined until then). */
export function themePreview(id: string): string | null | undefined {
  if (!previews.has(id)) {
    previews.set(id, null);
    call<[string], string | null>("get_theme_preview", id)
      .then((d) => previews.set(id, d ?? null))
      .catch(() => {})
      .finally(notify);
    return undefined;
  }
  return previews.get(id);
}

export async function deleteTheme(id: string) {
  previews.delete(id);
  await call<[string], boolean>("delete_theme", id).catch(() => false);
  if (getSettings().customTheme === id) updateSettings({ customTheme: "" });
  await refreshInstalled();
}

/** A texture's zlib-compressed pixels, inflated as they're decoded. */
async function inflate(b64: string): Promise<Uint8Array> {
  const stream = (await fromBase64(b64)).body!.pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The active theme's textures once fetched, so the home screen coming back (after a game,
// the trophy page...) doesn't fetch them all again.
const textureCache = new Map<string, Promise<TextureData | null>>();

/** One of a dynamic theme's textures: the one on show, or (by id) the one being switched to. */
export const loadSceneTexture = (index: number, id?: string) => loadTexture(id && staged?.id === id ? staged : assets, index);

function loadTexture(a: Assets | null, index: number): Promise<TextureData | null> {
  const meta = a?.scene?.data.textures[index];
  if (!a || !meta) return Promise.resolve(null);
  const key = `${a.key}:${index}`;
  if (!textureCache.has(key)) {
    const keep = [a, assets, staged].map((t) => t && `${t.key}:`).filter(Boolean) as string[];
    for (const k of textureCache.keys()) if (!keep.some((pre) => k.startsWith(pre))) textureCache.delete(k); // a theme no longer in use
    const load = call<[string, number], string | null>("get_theme_texture", a.id, index)
      .then(async (b64) => (b64 ? { ...meta, data: await inflate(b64) } : null))
      .catch(() => null);
    load.then((t) => !t && textureCache.delete(key)); // try again next time
    textureCache.set(key, load);
  }
  return textureCache.get(key)!;
}

export const installedThemes = () => installed;

// Which PS3 theme icon replaces each of ours (the first one the theme has).
const ICONS: Partial<Record<IconName, string[]>> = {
  users: ["icon_user"],
  settings: ["icon_setting"],
  update: ["icon_update"], // System Update
  cup: ["icon_trophy"], // Trophy Collection
  trophy: ["icon_trophy"],
  // (the Game column's folders: the PS3's Game Data Utility folder, which every theme has; else an album folder)
  folder: ["icon_gamedata", "icon_video_album_default", "icon_photo_album_default", "icon_music_album_default"],
  gamesFolder: ["icon_savedata", "icon_gamedata"], // All Games: the folder with a controller on it (Saved Data Utility's)
  photo: ["icon_photo"],
  music: ["icon_music"],
  video: ["icon_video"],
  game: ["icon_game"],
  network: ["icon_network"],
  friends: ["icon_friend"],
  display: ["icon_display_setting"],
  audio: ["icon_sound_setting"],
  controller: ["icon_accessory"],
  bluetooth: ["icon_accessory"],
  wifi: ["icon_network_setting"],
  system: ["icon_system_setting"],
  theme: ["icon_theme_setting"],
  clock: ["icon_datetime_setting"],
  setting: ["icon_setting_item"],
  download: ["icon_download"],
  browser: ["icon_browser"],
  chat: ["icon_chat"],
  info: ["icon_onlinemanual"],
};

/** The active theme's picture for an icon, if it has one. */
export function themeIcon(name: IconName): string | undefined {
  if (!assets) return undefined;
  for (const id of ICONS[name] ?? []) if (assets.icons[id]) return assets.icons[id];
  return undefined;
}

/** Re-renders when themes change; returns a counter that changes with them. */
export const useThemes = changes.use;
