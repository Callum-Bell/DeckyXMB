// Steam navigation / system actions used by the non-game XMB items. Every one
// is best-effort: Steam internals move, so each has a fallback.
import { Navigation } from "@decky/ui";
import { findExport, findLoadedExport, lookup } from "./webpack";

declare const SteamClient: any;

const nav: any = Navigation;

/**
 * Calls `obj[fn](...args)` if that function exists; returns false if it doesn't
 * (or throws), so callers can chain fallbacks with `||`.
 */
function invoke(obj: any, fn: string, ...args: any[]): boolean {
  try {
    if (typeof obj?.[fn] !== "function") return false;
    obj[fn](...args);
    return true;
  } catch {
    return false;
  }
}

export const go = (route: string) => () => Navigation.Navigate(route);

export const openQuickAccess = () => invoke(nav, "OpenQuickAccessMenu");
export const openSteamMenu = () => invoke(nav, "OpenMainMenu");
export const openPowerMenu = () => invoke(nav, "OpenPowerMenu") || openSteamMenu();

/** A web page in Steam's own browser; else `steamUrl` (a steam:// link) for Steam to open. */
export const openWeb = (url: string, steamUrl = `steam://openurl/${url}`) =>
  (!!url && invoke(nav, "NavigateToSteamWeb", url)) || invoke(SteamClient?.URL, "ExecuteSteamURL", steamUrl);
export const openStore = () => openWeb("https://store.steampowered.com/");
export const openFriends = () => invoke(nav, "NavigateToChat") || invoke(nav, "Navigate", "/chat");

/** A SteamClient.System action, or Steam's power menu if it's unavailable. */
const system = (fn: string) => () => invoke(SteamClient?.System, fn) || openPowerMenu();
export const suspend = system("SuspendPC");
export const restart = system("RestartPC");
export const shutdown = system("ShutdownPC");
// Switch to Desktop isn't in SteamClient: Steam's power menu asks SteamOS for it (its SteamOSManager service). With
// "Lock on Desktop Mode" on, Steam asks for the PIN first, so then its power menu is opened to do that.
const steamOS = lookup<any>(() =>
  findExport("SteamOSManager.SwitchToDesktop#1", (v) => typeof v?.SwitchToDesktop === "function" && !!v.SwitchToDesktopHandler),
);
const lockScreen = lookup<any>(() =>
  findExport("LockScreenSettings", (v) => typeof v?.GetSettings === "function" && "bLockDesktopMode" in (v.GetSettings() ?? {})),
);
export function switchToDesktop() {
  try {
    const os = steamOS();
    const lock = lockScreen();
    if (os && lock && !lock.GetSettings().bLockDesktopMode) return void os.SwitchToDesktop({});
  } catch (e) {
    console.warn("[DeckyXMB] switch to desktop", e);
  }
  openPowerMenu();
}

// Steam's power menu offers Switch to Desktop only under gamescope (SteamOS's session); elsewhere (Big Picture on a
// desktop) it's Exit Big Picture Mode. Not known (Steam's config not found): Switch to Desktop, as before.
// (Its config is in modules already loaded: searching every module's code for IN_GAMESCOPE loaded each that mentions it, a
// great many, holding the XMB's first showing up for seconds. Not loaded yet: looked for again next time, not kept as missing.)
let config: any;
const steamConfig = () => (config ??= findLoadedExport((v) => typeof v?.IN_GAMESCOPE === "boolean" && "IN_CLIENT" in v));
export const inGamescope = () => steamConfig()?.IN_GAMESCOPE ?? true;
export const canSwitchToDesktop = inGamescope;
export const exitBigPicture = () => invoke(SteamClient?.UI, "ExitBigPictureMode") || openPowerMenu();

/** Big Picture's page history (Steam's router: the window's own address doesn't follow it). */
export function mainHistory(): any {
  try {
    return (globalThis as any).SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.m_history;
  } catch {
    return undefined;
  }
}

export function userName(): string {
  try {
    const g: any = globalThis;
    // Your Steam profile name (the friends store's own entry for you); the account you sign in with until it's loaded.
    const self = g.friendStore?.m_FriendsUIFriendStore?.self ?? g.friendStore?.self;
    const persona = self?.display_name || self?.m_persona?.m_strPlayerName;
    return persona || g.App?.m_CurrentUser?.strPersonaName || g.App?.m_CurrentUser?.strAccountName || g.loginStore?.m_strAccountName || "User";
  } catch {
    return "User";
  }
}
