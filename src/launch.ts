// Starting a game as the PS3 does. The XMB plays it: the game's art goes, the menu zooms towards you and fades, and the
// game starts with the XMB's background (and the game's music) carrying on. Steam's own pages for a game starting are
// kept off the screen meanwhile: its game page isn't gone to, and (in Game Mode) its app running page, where it shows
// the game, waits. Once the game is ready to be seen, the background goes black but for the wave's sparkles, which
// drift on, spread towards you and fade, the music fading with them; then the game is shown.
import { Game, launchGame } from "./library";
import { musicHold, musicRelease } from "./music";
import { muteSteamSounds } from "./sound";
import { inGamescope, mainHistory } from "./system";

declare const SteamClient: any;

export const LAUNCH_ART_MS = 700; // the game's art fading away
export const LAUNCH_MENU_DELAY_MS = 350; // the menu zooming towards you and fading, after this
export const LAUNCH_MENU_MS = 550; // (over this)
export const LAUNCH_START_MS = LAUNCH_MENU_DELAY_MS + LAUNCH_MENU_MS; // the game started (the menu gone)
export const LAUNCH_BLACK_MS = 900; // the background going black, once the game's ready
export const LAUNCH_SPARKS_MS = 2200; // the sparkles left, then fading out (from when it starts going black); then the game
const RESET_MS = 400; // the XMB put back as it was, once the game's on show
const RUNNING_HOLD_MS = 25000; // the game shown this long after it's running, if it's never seen to be ready
const GIVE_UP_MS = 60000; // (and the XMB back, if it's never running)
const STEAM_APPID = 769; // what has the focus while Big Picture is in front
const WATCH_MS = 250;
const APP_RUNNING = "/apprunning"; // (in Game Mode, where Steam shows the game: Big Picture goes clear over it)
const APP_PAGE = "/library/app/";

/** The app whose window is in front (gamescope's focus, as Steam's UI sounds follow it). */
function focusedApp(): number | undefined {
  try {
    return (globalThis as any).SteamUIStore?.m_GamepadUIAudioStore?.m_currentlyFocusedAppid?.m_currentValue;
  } catch {
    return undefined;
  }
}

// Steam's requests while a game starts that put up a question (the rest it answers itself).
const ASKS = new Set([
  "ShowEula",
  "ShowLaunchOption",
  "ShowVROculusOnly",
  "RunningInstallScript",
  "KickingOtherSession",
  "SynchronizingControllerConfig",
  "SynchronizingCloud",
  "ShowDurationControl",
  "ShowCDKey",
]);

/** Whether a game is running (Steam's running apps). */
export function isRunning(g: Game): boolean {
  try {
    return !!(globalThis as any).SteamUIStore?.RunningApps?.some((a: any) => a?.appid === g.appid);
  } catch {
    return false;
  }
}

/** Back to a running game, as Steam's Resume does: (in Game Mode) its app running page, and its window raised. */
function resumeGame(g: Game) {
  try {
    const store = (globalThis as any).SteamUIStore;
    if (inGamescope()) store.WindowStore.GamepadUIMainWindowInstance?.NavigateToRunningApp();
    store.SetRunningApp(g.appid);
    store.WindowStore.GetOverlayInstances?.(g.appid)?.forEach((w: any) => w?.NavigateToRunningApp?.());
    SteamClient.Apps.RaiseWindowForGame(g.gameid);
  } catch {
    /* not there */
  }
}

let animate: ((g: Game) => void) | null = null;

/** Starts a game (or, already running, goes back to it): with the XMB's animation if it's on screen, or else straight away. */
export function startGame(g: Game) {
  if (isRunning(g)) resumeGame(g);
  else if (animate) animate(g);
  else launchGame(g);
}

/** The XMB's animation, while it's on screen. Returns what takes it off. */
export function setLaunchAnimator(fn: (g: Game) => void) {
  animate = fn;
  return () => {
    if (animate === fn) animate = null;
  };
}

/** What the XMB does as the game comes: goes black but for the sparkles, and is put back as it was after. */
export interface LaunchScreen {
  dark(): void;
  done(): void;
}

/**
 * Starts the game with the XMB left on screen. Big Picture's page changes are held meanwhile: to the game's page,
 * dropped; to the app running page (Game Mode's showing the game), kept till the XMB has gone black. A question or
 * error from Steam puts the XMB straight back, to be seen.
 */
export function launchBehindXMB(g: Game, screen: LaunchScreen) {
  const history = mainHistory();
  if (!history) {
    screen.done();
    launchGame(g);
    return;
  }
  musicHold();
  muteSteamSounds(true);
  const handles: { unregister?: () => void }[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let held: (() => void) | null = null; // the app running page, waiting
  let showing = false;
  let finished = false;

  // The game's ready: the XMB goes black but for the sparkles, the music fading with them, then the game is shown.
  const show = () => {
    if (showing || finished) return;
    showing = true;
    screen.dark();
    musicRelease(LAUNCH_SPARKS_MS);
    timers.push(setTimeout(() => finish(true), LAUNCH_SPARKS_MS));
  };
  const unpatch = holdPages(history, (path, go) => {
    if (path.startsWith(APP_PAGE)) return true;
    if (path !== APP_RUNNING) return false;
    held = go;
    show();
    return true;
  });
  const finish = (shown: boolean) => {
    if (finished) return;
    finished = true;
    clearInterval(watch);
    timers.forEach(clearTimeout);
    for (const h of handles) {
      try {
        h?.unregister?.();
      } catch {
        /* gone */
      }
    }
    unpatch();
    muteSteamSounds(false);
    if (!showing) musicRelease();
    const go = held;
    held = null;
    go?.();
    if (shown) setTimeout(() => screen.done(), RESET_MS);
    else screen.done();
  };

  // Ready once its window is in front of Big Picture (outside Game Mode, where it comes in front by itself); and if Steam
  // got to its game page anyway, back from it.
  let back = 0;
  const watch = setInterval(() => {
    const app = focusedApp();
    if (app && app !== STEAM_APPID) show();
    const path: string | undefined = history.location?.pathname;
    if (path?.startsWith(APP_PAGE) && Date.now() - back > 3 * WATCH_MS) {
      back = Date.now();
      try {
        history.goBack();
      } catch {
        /* stays */
      }
    }
  }, WATCH_MS);
  const on = (register: () => any) => {
    try {
      const h = register();
      if (h) handles.push(h);
    } catch {
      /* not there */
    }
  };
  // (or a while after it's running, if it's never seen to be ready)
  on(() =>
    SteamClient.GameSessions.RegisterForAppLifetimeNotifications((n: any) => {
      if (n?.bRunning) timers.push(setTimeout(show, RUNNING_HOLD_MS));
    }),
  );
  // Steam has something to ask or tell (a launch option, a cloud conflict, an error): it has to be seen.
  on(() =>
    SteamClient.Apps.RegisterForGameActionUserRequest((_id: number, _game: string, _action: string, request: string) => ASKS.has(request) && finish(false)),
  );
  on(() => SteamClient.Apps.RegisterForGameActionShowError(() => finish(false)));
  timers.push(setTimeout(() => finish(showing), GIVE_UP_MS));
  if (!launchGame(g)) finish(false);
}

/**
 * Holds Big Picture's page changes: `hold` is asked about each (with what makes it), and returns true to keep it back.
 * Returns what puts them back.
 */
function holdPages(history: any, hold: (path: string, go: () => void) => boolean): () => void {
  const saved = (["push", "replace"] as const).map((m) => ({ m, own: Object.prototype.hasOwnProperty.call(history, m), fn: history[m] }));
  for (const { m, fn } of saved) {
    history[m] = function (to: any, ...rest: unknown[]) {
      const go = () => fn.call(history, to, ...rest);
      const path = typeof to === "string" ? to.split(/[?#]/)[0] : to?.pathname;
      if (typeof path === "string" && hold(path, go)) return;
      return go();
    };
  }
  return () => {
    for (const { m, own, fn } of saved) {
      if (own) history[m] = fn;
      else delete history[m];
    }
  };
}
