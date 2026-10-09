// Settings > Bluetooth Settings: Bluetooth on or off, and the devices paired with this system (connect, disconnect,
// forget...), through Steam's own Bluetooth service, as its Bluetooth page uses it. Its state is read again on showing
// the home screen and whenever Steam says it has changed; changes notify as System Settings' do (one rebuild for both).
import { clientSetting, notifySystemSettings, setClient } from "./systemSettings";
import { findExport, lookup } from "./webpack";

export interface BluetoothDevice {
  id: number;
  name: string;
  connected: boolean;
  battery?: number; // percent, for devices that report it
  wakeSupported: boolean;
  wake: boolean; // may wake the system
  trusted: boolean;
}

// Steam's Bluetooth service: each call takes a plain request and answers with a message (BSuccess(), Body()).
const service = lookup<any>(() => findExport("BluetoothManager.GetState#1", (v) => typeof v?.GetState === "function" && typeof v.Connect === "function"));

let available = false; // (there's a Bluetooth adapter Steam can use)
let devices: BluetoothDevice[] = [];

/** A device found nearby while searching (Register New Device), not paired yet. */
export interface FoundDevice {
  id: number;
  name: string;
  pairing: boolean;
}
let found: FoundDevice[] = [];
let searching = 0; // (Register New Device is open: found devices are listed)
const pairing = new Set<number>(); // (asked to pair, not answered yet)
const names = new Map<number, string | null>(); // found devices' names: they don't change (null: it has none, only an address)

async function ask(call: Promise<any>): Promise<any> {
  const r = await call;
  return r?.BSuccess?.() ? r.Body().toObject() : null;
}
const details = (bt: any, id: number) =>
  ask(bt.GetDeviceDetails({ id })).then(
    (x) => x?.device ?? null,
    () => null,
  );

/** Read the state again; notifies if it changed. */
export async function refreshBluetooth() {
  const bt = service();
  if (!bt) return;
  try {
    const state = await ask(bt.GetState({}));
    if (!state) return;
    const all: any[] = state.devices ?? [];
    // The devices paired (or connected): their names and the rest are in each one's details.
    const paired = all.filter((d) => d.is_paired || d.is_connected);
    const info = await Promise.all(paired.map((d) => details(bt, d.id)));
    const next: BluetoothDevice[] = paired
      .map((d, i) => {
        const x = info[i] ?? {};
        return {
          id: Number(d.id),
          name: String(x.name || x.mac || "Bluetooth Device"),
          connected: !!d.is_connected,
          battery: x.battery_percent ?? undefined,
          wakeSupported: !!x.wake_allowed_supported,
          wake: !!x.wake_allowed,
          trusted: !!x.is_trusted,
        };
      })
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
    // While searching, the others found nearby, strongest first: as Steam's page, not those it hides, and only those
    // with a name (the rest are just addresses: other people's phones, TVs and the like).
    let nextFound = found;
    if (searching) {
      const near = all.filter((d) => !d.is_paired && !d.is_connected && !d.should_hide_hint).sort((a, b) => (b.strength_raw ?? 0) - (a.strength_raw ?? 0));
      await Promise.all(near.filter((d) => !names.has(d.id)).map(async (d) => names.set(d.id, (await details(bt, d.id))?.name || null)));
      nextFound = near.filter((d) => names.get(d.id)).map((d) => ({ id: Number(d.id), name: names.get(d.id)!, pairing: pairing.has(d.id) }));
    }
    const before = JSON.stringify([available, devices, found]);
    available = !!state.is_service_available;
    devices = next;
    found = nextFound;
    if (JSON.stringify([available, devices, found]) !== before) notifySystemSettings();
  } catch (e) {
    console.warn("[DeckyXMB] Bluetooth unavailable", e);
  }
}

// Steam's Bluetooth store: searching is shared through it (each asker gets a stop), so Steam's own page searching at
// the same time isn't stopped by ours ending.
const store = lookup<any>(() => findExport("RequestDiscovery", (v) => typeof v?.RequestDiscovery === "function"));

/** Searches for devices to pair while Register New Device is open; returns a stop. */
export function searchForDevices(): () => void {
  const bt = service();
  if (!bt) return () => {};
  searching++;
  let stop: (() => void) | undefined;
  try {
    stop = store()?.RequestDiscovery?.();
    if (!stop) {
      void ask(bt.SetDiscovering({ enabled: true }));
      stop = () => void ask(bt.SetDiscovering({ enabled: false }));
    }
  } catch (e) {
    console.warn("[DeckyXMB] can't search for Bluetooth devices", e);
  }
  void refreshBluetooth();
  return () => {
    searching--;
    stop?.();
    if (!searching) found = [];
  };
}

export const foundDevices = () => found;

/** Pairs with a device found nearby; once paired it's listed with the others (Steam asks for a code itself, if one's needed). */
export function pairDevice(d: FoundDevice) {
  const bt = service();
  if (!bt?.Pair) return console.warn("[DeckyXMB] can't pair a Bluetooth device on this Steam");
  pairing.add(d.id);
  void refreshBluetooth();
  ask(bt.Pair({ device: d.id }))
    .catch((e) => console.warn("[DeckyXMB] Bluetooth pairing failed", e))
    .finally(() => {
      pairing.delete(d.id);
      void refreshBluetooth();
    });
}

/** Keeps the devices shown current as they connect, disconnect or are paired elsewhere; returns a stop. */
export function watchBluetooth(): () => void {
  try {
    const reg = service()?.RegisterForNotifyStateChanged?.(() => {
      void refreshBluetooth();
      return 1; // (handled: Steam's OK)
    });
    return () => reg?.unregister?.();
  } catch {
    return () => {};
  }
}

export const bluetoothAvailable = () => available;
export const bluetoothEnabled = () => !!clientSetting("system_bluetooth_enabled");
export const setBluetoothEnabled = (on: boolean) => setClient("system_bluetooth_enabled", on);
export const bluetoothDevices = () => devices;

/** Asks Steam's service to do something to a device, then reads the state again (it also says when it's done). */
function act(call: string, request: Record<string, unknown>) {
  const bt = service();
  if (!bt?.[call]) return console.warn("[DeckyXMB] can't", call, "a Bluetooth device on this Steam");
  ask(bt[call](request))
    .catch((e) => console.warn("[DeckyXMB] Bluetooth", call, "failed", e))
    .finally(() => void refreshBluetooth());
}
export const connectDevice = (d: BluetoothDevice) => act("Connect", { device: d.id });
export const disconnectDevice = (d: BluetoothDevice) => act("Disconnect", { device: d.id });
export const forgetDevice = (d: BluetoothDevice) => act("Forget", { device: d.id });
export const setDeviceWake = (d: BluetoothDevice, allowed: boolean) => act("SetWakeAllowed", { device: d.id, allowed });
export const setDeviceTrusted = (d: BluetoothDevice, trusted: boolean) => act("SetTrusted", { device: d.id, trusted });
