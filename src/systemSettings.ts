// Settings > System Settings: the language, hostname and developer mode, set as Steam's own System settings page sets them;
// Settings > Sound Settings: the audio devices, their volumes and UI sounds, as its Audio page sets them;
// and Settings > Display Settings: brightness, night mode, HDR and the like, as its Display page sets them.
import { ConfirmModal, showModal, TextField } from "@decky/ui";
import { createElement, useState } from "react";
import { connectionInUse } from "./network";
import { signal } from "./signal";
import { findExport, lookup } from "./webpack";

declare const SteamClient: any;

const changes = signal();
export const notifySystemSettings = changes.notify; // (for the settings kept elsewhere: Bluetooth)
export const useSystemSettings = changes.use;
const notifySoon = () => setTimeout(() => changes.notify(), 300); // (once Steam's store has a change made)

let languages: { value: string; label: string }[] = [];
const languageIds = new Map<string, number>(); // (Steam's ELanguage for each)
let language = "";
let languageAtStart = ""; // (a new language is only used once Steam restarts)
let hostname = "";

const localize = (token: string) => {
  try {
    const s = (globalThis as any).LocalizationManager?.LocalizeString(token);
    return s && s !== token ? s : null;
  } catch {
    return null;
  }
};

/** Read them again from Steam (on showing the home screen); notifies if any changed. */
export async function refreshSystemSettings() {
  void refreshAudio();
  void refreshDisplay();
  try {
    const [list, cur, info] = await Promise.all([
      SteamClient.Settings.GetAvailableLanguages(),
      SteamClient.Settings.GetCurrentLanguage(),
      SteamClient.System.GetSystemInfo(),
    ]);
    for (const l of list ?? []) languageIds.set(String(l.strShortName), Number(l.language));
    const next = (list ?? [])
      .map((l: any) => String(l.strShortName))
      .map((v: string) => ({ value: v, label: localize(`#Language_${v}`) ?? v[0].toUpperCase() + v.slice(1) }))
      .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));
    const before = JSON.stringify([languages, language, hostname]);
    languages = next;
    language = String(cur ?? "");
    languageAtStart ||= language;
    hostname = String(info?.sHostname ?? "");
    if (JSON.stringify([languages, language, hostname]) !== before) changes.notify();
  } catch (e) {
    console.warn("[DeckyXMB] system settings unavailable", e);
  }
}

export const systemLanguages = () => languages;
export const systemLanguage = () => language;
export const languageNeedsRestart = () => !!languageAtStart && language !== languageAtStart;
// Steam's on-screen keyboard settings
const keyboardStore = lookup(() => findExport("AddValidKeyboardLayoutByLanguage", (v) => typeof v?.AddValidKeyboardLayoutByLanguage === "function"));
export function setSystemLanguage(value: string) {
  SteamClient.Settings.SetCurrentLanguage(value);
  // As Steam's own settings do: the on-screen keyboard gets the new language's layout too.
  try {
    const keyboard = keyboardStore();
    const id = languageIds.get(value);
    if (keyboard && id !== undefined) keyboard.AddValidKeyboardLayoutByLanguage(id);
  } catch (e) {
    console.warn("[DeckyXMB] keyboard layout not added", e);
  }
  language = value;
  changes.notify();
}

export const systemHostname = () => hostname;

/** Steam's own "Change the name of this device" step: a new name, then the system restarts to use it. */
export function changeHostname() {
  const Dialog = (props: { closeModal?: () => void }) => {
    const [name, setName] = useState(hostname);
    const ok = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(name);
    return createElement(
      ConfirmModal,
      {
        strTitle: "Change the name of this device",
        strDescription: "This will require a restart of the system.",
        strOKButtonText: "Change & Restart",
        bOKDisabled: !ok || name === hostname,
        closeModal: props.closeModal,
        onOK: () => {
          SteamClient.Settings.SetHostname(name);
          SteamClient.System.RestartPC();
        },
      },
      createElement(TextField, { value: name, focusOnMount: true, onChange: (e: any) => setName(e.target.value) }),
    );
  };
  showModal(createElement(Dialog));
}

// Developer mode and UI sounds are among Steam's client settings: read from its settings store, set through its own
// setter (found by what it does, as minified names change between Steam updates).
const clientSetter = lookup<(key: string, value: unknown) => unknown>(() =>
  findExport("Settings.SetSetting", (v) => typeof v === "function" && v.length === 2 && String(v).includes("SetSetting(")),
);
export const clientSetting = (key: string) => (globalThis as any).settingsStore?.m_ClientSettings?.[key];
export function setClient(key: string, value: unknown) {
  const set = clientSetter();
  if (!set) return console.warn("[DeckyXMB] can't set", key, "on this Steam");
  set(key, value);
  notifySoon();
}
export const developerMode = () => !!clientSetting("developer_mode_enabled");
export const setDeveloperMode = (on: boolean) => setClient("developer_mode_enabled", on);
export const uiSounds = () => clientSetting("enable_ui_sounds") ?? true;
export const setUiSounds = (on: boolean) => setClient("enable_ui_sounds", on);

// Sound Settings: the devices sound plays on and is recorded from, and their volumes, set as Steam's Audio page sets them

/** Steam's: which way a device is used (also the volume to set: a device's whole output, or its input). */
export enum AudioDirection {
  Input = 0,
  Output = 1,
}
const NO_DEVICE = -1; // (no device chosen: Steam's default)
interface AudioDevice {
  id: number;
  name: string;
  has: Record<AudioDirection, boolean>;
  volume: Record<AudioDirection, number>; // 0 to 1
}
let audioDevices: AudioDevice[] = [];
let audioActive: Record<AudioDirection, number> = { [AudioDirection.Input]: NO_DEVICE, [AudioDirection.Output]: NO_DEVICE };
let audioChosen: Record<AudioDirection, number> = { [AudioDirection.Input]: NO_DEVICE, [AudioDirection.Output]: NO_DEVICE };

async function readAudio() {
  const d = await SteamClient.System?.Audio?.GetDevices?.();
  if (!d) return;
  audioDevices = (d.vecDevices ?? []).map((x: any) => ({
    id: Number(x.id),
    name: String(x.sName ?? ""),
    has: { [AudioDirection.Input]: !!x.bHasInput, [AudioDirection.Output]: !!x.bHasOutput },
    volume: { [AudioDirection.Input]: Number(x.flInputVolume) || 0, [AudioDirection.Output]: Number(x.flOutputVolume) || 0 },
  }));
  audioActive = { [AudioDirection.Input]: Number(d.activeInputDeviceId ?? NO_DEVICE), [AudioDirection.Output]: Number(d.activeOutputDeviceId ?? NO_DEVICE) };
  audioChosen = {
    [AudioDirection.Input]: Number(d.overrideInputDeviceId ?? NO_DEVICE),
    [AudioDirection.Output]: Number(d.overrideOutputDeviceId ?? NO_DEVICE),
  };
}

/** Read the devices again (on showing the home screen, and after one is changed); notifies if any changed. */
export async function refreshAudio() {
  try {
    const before = JSON.stringify([audioDevices, audioActive, audioChosen]);
    await readAudio();
    if (JSON.stringify([audioDevices, audioActive, audioChosen]) !== before) changes.notify();
  } catch (e) {
    console.warn("[DeckyXMB] audio devices unavailable", e);
  }
}
const audioChanged = () => setTimeout(() => void refreshAudio(), 300); // (once Steam has made the change)

/** Whether there's a device to play sound on (Output) or record from (Input). */
export const audioHas = (dir: AudioDirection) => audioDevices.some((d) => d.has[dir]);

/** Keeps the volumes shown current as they're changed elsewhere (the volume buttons, Quick Access); returns a stop. */
export function watchAudioVolumes(): () => void {
  try {
    const reg = SteamClient.System?.Audio?.RegisterForDeviceVolumeChanged?.((id: number, channel: number, volume: number) => {
      const d = audioDevices.find((d) => d.id === id);
      // (Steam's channels: Input is 0, all of the output 1; the rest are single speakers, not shown here)
      if (!d || (channel !== AudioDirection.Input && channel !== AudioDirection.Output) || d.volume[channel as AudioDirection] === volume) return;
      d.volume[channel as AudioDirection] = volume;
      changes.notify();
    });
    return () => reg?.unregister?.();
  } catch {
    return () => {};
  }
}

/** The devices that can be chosen for output (or input), Default (Steam's choice) first, labelled as Steam's page does. */
export function audioDeviceOptions(dir: AudioDirection): { value: string; label: string }[] {
  const active = audioDevices.find((d) => d.id === audioActive[dir]);
  const auto = audioChosen[dir] === NO_DEVICE && active ? `Default (${active.name})` : "Default (auto)";
  return [{ value: "default", label: auto }, ...audioDevices.filter((d) => d.has[dir]).map((d) => ({ value: String(d.id), label: d.name }))];
}
export const audioDevice = (dir: AudioDirection) => (audioChosen[dir] === NO_DEVICE ? "default" : String(audioChosen[dir]));
export function setAudioDevice(dir: AudioDirection, value: string) {
  if (value === "default") SteamClient.System.Audio.ClearDefaultDeviceOverride(dir);
  else SteamClient.System.Audio.SetDefaultDeviceOverride(Number(value), dir);
  audioChanged();
}

/** The volume of the device in use, in steps of 0 to 10 (as the XMB's lists choose it). */
export const AUDIO_STEPS = 10;
export function audioVolume(dir: AudioDirection): string {
  const d = audioDevices.find((d) => d.id === audioActive[dir]);
  return String(Math.round(Math.min(1, Math.max(0, d?.volume[dir] ?? 0)) * AUDIO_STEPS));
}
export function setAudioVolume(dir: AudioDirection, step: string) {
  const d = audioDevices.find((d) => d.id === audioActive[dir]);
  if (!d) return;
  d.volume[dir] = Number(step) / AUDIO_STEPS;
  SteamClient.System.Audio.SetDeviceVolume(d.id, dir, d.volume[dir]);
  changes.notify();
  audioChanged();
}

// Display Settings, as Steam's Display page sets them
// Brightness and night mode are SteamOS system settings, kept by Steam's display store (its setters build the
// settings message for us); HDR, the magnifier and the game resolution are client settings.

// Steam's stores are made the first time something asks for one (each class's Get()), which may not have happened
// yet: the class is found by what it holds and asked itself.
const storeClass = (needle: string, method: string) =>
  lookup(() => findExport(needle, (v) => typeof v?.Get === "function" && typeof v.Get()?.[method] === "function"));
const displayStoreClass = storeClass("set_display_nightmode_schedule_enabled", "SetNightModeEnabled");
const displayManagerClass = storeClass("CSystemDisplayManagerStore", "GetState");
// (Steam's own names for them, typo and all, once made)
const displayStore = (): any => (globalThis as any).SystemStoragStore ?? displayStoreClass()?.Get();
const displayManager = (): any => (globalThis as any).SystemDisplayManagerStore ?? displayManagerClass()?.Get();

const displayMsg = (): Record<string, any> => displayStore()?.msgSettings ?? {};
function displaySet(method: string, value: unknown) {
  const store = displayStore();
  if (typeof store?.[method] !== "function") return console.warn("[DeckyXMB] can't", method, "on this Steam");
  store[method](value);
  notifySoon();
}

export const displaySupported = () => !!displayStore();

/** Brightness, 0 to 10 (where the screen's can be set: not a TV's). */
export const BRIGHTNESS_STEPS = 10;
export const brightnessAvailable = () => displaySupported() && (displayMsg().is_display_brightness_available ?? true);
export const displayBrightness = () => String(Math.round((displayStore()?.DisplayBrightness?.Value ?? 1) * BRIGHTNESS_STEPS));
export const setDisplayBrightness = (step: string) => displaySet("SetDisplayBrightness", Number(step) / BRIGHTNESS_STEPS);

export const adaptiveBrightnessAvailable = () => !!displayMsg().is_adaptive_brightness_available;
export const adaptiveBrightness = () => !!displayMsg().display_adaptive_brightness_enabled;
export const setAdaptiveBrightness = (on: boolean) => displaySet("SetDisplayAdaptiveBrightnessEnabled", on);

export const nightMode = () => !!displayMsg().display_nightmode_enabled;
export const setNightMode = (on: boolean) => displaySet("SetNightModeEnabled", on);
export const nightModeSchedule = () => !!displayMsg().display_nightmode_schedule_enabled;
export const setNightModeSchedule = (on: boolean) => displaySet("SetNightModeScheduleEnabled", on);

/** The hours night mode can start or end at, shown as the clock shows them (Steam's list). */
export function nightModeHours(): { value: string; label: string }[] {
  const hours: any[] = (globalThis as any).settingsStore?.m_Settings?.vecNightModeScheduledHours ?? [];
  if (hours.length) return hours.map((h) => ({ value: String(h.nHour), label: String(h.strDisplay) }));
  return Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h}:00` }));
}
export const nightModeStart = () => String(displayMsg().display_nightmode_schedule_starttime ?? 0);
export const setNightModeStart = (hour: string) => displaySet("SetNightModeScheduleStartTime", Number(hour));
export const nightModeEnd = () => String(displayMsg().display_nightmode_schedule_endtime ?? 0);
export const setNightModeEnd = (hour: string) => displaySet("SetNightModeScheduleEndTime", Number(hour));

/** Night mode's tint, Cool to Warm: Steam's slider (0.1 to 1) in five steps. */
export const NIGHT_TINTS = [
  { value: "0.1", label: "Coolest" },
  { value: "0.325", label: "Cool" },
  { value: "0.55", label: "Medium" },
  { value: "0.775", label: "Warm" },
  { value: "1", label: "Warmest" },
];
export function nightModeTint(): string {
  const v = Number(displayMsg().display_nightmode_tintstrength ?? 0.5);
  return NIGHT_TINTS.reduce((a, b) => (Math.abs(Number(b.value) - v) < Math.abs(Number(a.value) - v) ? b : a)).value;
}
export const setNightModeTint = (value: string) => displaySet("SetNightModeTintStrength", Number(value));

// The display in use and its resolutions, from Steam's display manager (read on showing the home screen).
let displayState: any = null;
async function readDisplayState() {
  displayState = (await displayManager()?.GetState?.()) ?? null;
}
export async function refreshDisplay() {
  try {
    const before = JSON.stringify(displayState);
    await readDisplayState();
    if (JSON.stringify(displayState) !== before) changes.notify();
  } catch (e) {
    console.warn("[DeckyXMB] display state unavailable", e);
  }
}
const primaryDisplay = () => displayState?.displays?.find((d: any) => d.is_primary) ?? displayState?.displays?.find((d: any) => d.is_enabled);

/** HDR: as Steam's page, only offered on an external display that can show it. */
export function hdrAvailable() {
  const d = primaryDisplay();
  return !!d && !d.is_internal && !!d.is_hdr_capable;
}
export const hdrEnabled = () => !!clientSetting("gamescope_hdr_enabled");
export const setHdrEnabled = (on: boolean) => setClient("gamescope_hdr_enabled", on);

/** The magnifier: as Steam's page, only on SteamOS (where there's a display manager). */
export const magnifierAvailable = () => !!displayState && clientSetting("steamos_magnifier_scale") !== undefined;
export const MAGNIFIER_SCALES = Array.from({ length: 19 }, (_, i) => ({ value: String(120 + i * 10), label: `${120 + i * 10}%` }));
export const magnifierScale = () => String(clientSetting("steamos_magnifier_scale") ?? 150);
export const setMagnifierScale = (pct: string) => setClient("steamos_magnifier_scale", Number(pct));

// Maximum Game Resolution: the most a game is given (it takes effect as the next game starts), listed as Steam's
// page lists it: Native, then the common sizes of the display's shape up to its own, its recommended one marked.
const RESOLUTIONS = [
  [5120, 2880],
  [3840, 2160],
  [2560, 1440],
  [1920, 1080],
  [1600, 900],
  [1280, 720],
  [1024, 576],
  [800, 450],
  [640, 360],
  [3840, 2400],
  [2560, 1600],
  [1920, 1200],
  [1600, 1000],
  [1280, 800],
  [1024, 640],
  [800, 500],
  [640, 400],
  [5120, 2160],
  [3840, 1600],
  [3440, 1440],
  [2560, 1080],
  [2160, 900],
  [1920, 800],
  [1680, 720],
  [1440, 600],
  [1280, 540],
  [7680, 2160],
  [6400, 1800],
  [5760, 1620],
  [5120, 1440],
  [3840, 1080],
  [2560, 720],
  [1600, 1200],
  [1400, 1050],
  [1024, 768],
  [800, 600],
  [640, 480],
  [2040, 1080],
];
export const gameResolutionAvailable = () => !!displayState?.game_resolution_override_native;
export function gameResolutions(): { value: string; label: string }[] {
  const native = displayState?.game_resolution_override_native;
  if (!native) return [];
  const def = displayState.game_resolution_override_default;
  const size = (w: number, h: number) => `${w}x${h}`;
  const shape = native.width / native.height;
  const fits = RESOLUTIONS.filter(
    ([w, h]) =>
      (def && w === def.width && h === def.height) ||
      (w === native.width && h === native.height) ||
      (w <= native.width && h <= native.height && Math.abs(w / h - shape) < 0.001),
  ).sort((a, b) => b[0] - a[0]);
  const recommended = def ?? native;
  const list = [
    { value: "Native", label: `${localize("#Settings_Display_GameResolution_Native") ?? "Native"} (${size(native.width, native.height)})` },
    ...fits.map(([w, h]) =>
      w === recommended.width && h === recommended.height
        ? { value: "Default", label: def ? `${size(w, h)} (${localize("#Settings_Display_GameResolution_Recommended") ?? "Recommended"})` : size(w, h) }
        : { value: size(w, h), label: size(w, h) },
    ),
  ];
  const cur = gameResolution();
  if (!list.some((o) => o.value === cur)) list.push({ value: cur, label: cur });
  return list;
}
export const gameResolution = () => String(clientSetting("gamescope_game_resolution_global") || "Default");
export const setGameResolution = (value: string) => setClient("gamescope_game_resolution_global", value);

// System Information (as the PS3's): the OS version, this device's address on the network, and free space

export const ip4 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
const gb = (bytes: number) => `${Math.round(bytes / 1024 ** 3)} GB`;

export async function systemInformation(): Promise<[string, string][]> {
  const g: any = globalThis;
  const lines: [string, string][] = [];
  try {
    const info = await SteamClient.System.GetSystemInfo();
    lines.push(["System Software", [info?.sOSName, info?.sOSVersionId].filter(Boolean).join(" ") || "-"]);
  } catch {
    lines.push(["System Software", "-"]);
  }
  // The connection in use (as Network Settings' status list shows it).
  try {
    const used = connectionInUse();
    const ip = used?.m_DeviceInfo?.ip4?.addresses?.[0]?.ip;
    lines.push(["IP Address", typeof ip === "number" ? ip4(ip) : "-"]);
    lines.push(["MAC Address", used?.macAddress || g.SystemNetworkStore?.m_WirelessDevice?.mac || "-"]);
  } catch {
    lines.push(["IP Address", "-"], ["MAC Address", "-"]);
  }
  // Each drive Steam installs to (several library folders can be on one), the internal one first.
  try {
    const folders: any[] = (await SteamClient.InstallFolder.GetInstallFolders()) ?? [];
    const drives = new Map<string, any>();
    for (const f of folders.filter((f) => f.bIsMounted && f.nCapacity > 0).sort((a, b) => Number(b.bIsFixed) - Number(a.bIsFixed))) {
      const key = f.strDriveName || f.strFolderPath;
      if (!drives.has(key)) drives.set(key, f);
    }
    const list = [...drives.values()];
    list.forEach((f, i) =>
      lines.push([i === 0 ? "Free Space" : f.bIsFixed ? `Free Space (${f.strDriveName})` : "Free Space (microSD)", `${gb(f.nFreeSpace)} / ${gb(f.nCapacity)}`]),
    );
    if (!list.length) lines.push(["Free Space", "-"]);
  } catch {
    lines.push(["Free Space", "-"]);
  }
  return lines;
}
