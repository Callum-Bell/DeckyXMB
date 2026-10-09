// System Update: checks for and installs Steam / SteamOS / firmware updates through Steam's own updater
// (UpdateStore, which Steam's System settings page uses), so Steam's state and dialogs stay in step with it.
import { RefObject, useEffect } from "react";
import { signal } from "./signal";

declare const SteamClient: any;

// Steam's EUpdaterState
export enum UpdateState {
  Invalid = 0,
  UpToDate = 2,
  Checking = 3,
  Available = 4,
  Applying = 5,
  ClientRestartPending = 6,
  SystemRestartPending = 7,
  RollBack = 8,
}

const TYPE_NAMES: Record<number, string> = {
  1: "Steam Client",
  2: "SteamOS",
  3: "Firmware",
};

export interface UpdateStatus {
  state: UpdateState;
  available: string[]; // what can be installed ("SteamOS 3.7.13", …)
  percent: number | null; // while applying
  checked: number | null; // unix seconds of the last check
  error: string | null; // the last check or install that failed
}

const updater = (): any => (globalThis as any).UpdateStore?.m_updater ?? null;
let error: string | null = null;
const onError = async (e: { eResult: number; strMsg: string | null }) => {
  error = e.strMsg || `error ${e.eResult}`;
  changes.notify();
};

export function updateStatus(): UpdateStatus {
  const u = updater();
  const st = u?.m_updateState;
  const available: string[] = [];
  for (const r of st?.update_check_results ?? []) {
    if (r?.available) available.push([TYPE_NAMES[r.type] ?? "Update", String(r.version ?? "").trim()].filter(Boolean).join(" "));
  }
  let percent: number | null = null;
  let checked: number | null = null;
  try {
    percent = u?.GetProgressPercent?.() ?? null;
    checked = u?.GetLastCheckTime?.() ?? null;
  } catch {}
  return { state: st?.state ?? UpdateState.Invalid, available, percent, checked, error };
}

export const updatesSupported = () => !!updater();

export function checkForUpdates() {
  error = null;
  void updater()?.CheckForUpdates(onError);
  changes.notify();
}

/** Download and install what the last check found (Steam asks first itself where a firmware update needs it). */
export function installUpdates() {
  const u = updater();
  if (!u) return;
  error = null;
  void u.ApplyUpdate(u.GetRecheckAndInstallUpdateTypes(), onError);
  changes.notify();
}

/** Finish an update that's waiting on a restart (of Steam, or of the system). */
export function finishUpdate() {
  const s = updateStatus().state;
  if (s === UpdateState.ClientRestartPending) SteamClient.User.StartRestart(false);
  else if (s === UpdateState.SystemRestartPending) SteamClient.System.RestartPC();
  else if (s === UpdateState.RollBack) SteamClient.System.RebootToAlternateSystemPartition();
}

// watching it: while something on screen uses it, Steam's state is looked at each second (it changes as an update runs)
const changes = signal();
let users = 0;
const watchers = new Set<RefObject<HTMLElement | null>>(); // (paused while none of them is on screen: in a game, say)
let timer: ReturnType<typeof setInterval> | undefined;
let last = "";
const key = () => JSON.stringify(updateStatus());
function start() {
  if (users++ === 0) {
    last = key();
    timer = setInterval(() => {
      if (![...watchers].some((w) => w.current && !w.current.ownerDocument.hidden)) return;
      const k = key();
      if (k !== last) {
        last = k;
        changes.notify();
      }
    }, 1000);
  }
  return () => {
    if (--users === 0) clearInterval(timer);
  };
}

/** Re-renders when the update state changes, while `on` (an element) is on screen; returns a counter that changes with it. */
export function useUpdates(on: RefObject<HTMLElement | null>): number {
  const n = changes.use();
  useEffect(() => {
    watchers.add(on);
    const stop = start();
    return () => {
      watchers.delete(on);
      stop();
    };
  }, [on]);
  return n;
}
