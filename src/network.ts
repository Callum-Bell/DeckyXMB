// Settings > Network Settings: Wi-Fi on or off, the networks this system can see (connect, disconnect, forget...),
// Test Connection and the Settings and Connection Status List, as the PS3's, through Steam's own network store, as its
// Internet page uses it. Its state is read live from that store; changes notify as System Settings' do (one rebuild).
import { sleep } from "./async";
import { ip4, notifySystemSettings } from "./systemSettings";
import { findExport, lookup } from "./webpack";

declare const SteamClient: any;

// Steam's enums (its network device types and states, wireless security, connectivity test results, proxy modes).
const WIRED = 1;
const WIRELESS = 2;
const STATES: Record<number, string> = { 1: "Failed", 3: "Disconnecting...", 4: "Connecting...", 5: "Connected", 6: "Retrying..." };
const SECURITY: Record<number, string> = { 0: "None", 1: "WEP", 2: "WEP", 4: "WPA", 8: "WPA Enterprise", 16: "WPA2", 32: "WPA2 Enterprise", 64: "WPA3" };
enum Test {
  Unknown = 0,
  Connected = 1,
  CaptivePortal = 2,
  TimedOut = 3,
  Failed = 4,
  WifiDisabled = 5,
  NoLAN = 6,
}

const store = (): any => (globalThis as any).SystemNetworkStore ?? null;
const managed = () => !!store()?.networkManagementAvailable;

/** A network this system can see: a wired connection, or a Wi-Fi network. */
export interface Network {
  key: string;
  name: string;
  wireless: boolean;
  status: string; // "Connected", "Connecting..." (empty when it isn't)
  strength?: number; // percent, Wi-Fi only
  security: string;
  saved: boolean;
  autoconnect: boolean;
  connectable: boolean;
  disconnectable: boolean;
  forgettable: boolean;
}

const apOf = (key: string) => store()?.accessPoints?.find((a: any) => a.key === key);

/** The networks, as Steam's page lists them (not loopback ones): connected first, then wired, then strongest first. */
export function networks(): Network[] {
  const list: any[] = store()?.userVisibleAccessPoints ?? [];
  return list
    .filter((a) => a && !a.isLoopback)
    .map((a) => {
      const w = a.wirelessAPInfo;
      return {
        key: String(a.key),
        name: String(a.displayName ?? (a.type === WIRELESS ? "Wireless Network" : "Wired Network")),
        wireless: a.type === WIRELESS,
        status: STATES[a.state] ?? "",
        strength: w ? Math.max(0, Math.min(100, Number(w.strength_raw) || 0)) : undefined,
        security: w ? (SECURITY[w.esecurity] ?? "Unknown") : "",
        saved: !!a.isSaved,
        autoconnect: !!a.isAutoconnectEnabled,
        connectable: !!a.isConnectable,
        disconnectable: !!a.isDisconnectable,
        forgettable: !!a.isForgettable,
      };
    })
    .sort(
      (a, b) =>
        Number(b.status === "Connected") - Number(a.status === "Connected") ||
        Number(!a.wireless) - Number(!b.wireless) ||
        (b.strength ?? 0) - (a.strength ?? 0),
    );
}

export const networkAvailable = () => !!store();
export const networkManaged = managed;
export const wifiAvailable = () => managed() && !!store()?.hasWirelessDevice;
export const wifiEnabled = () => !!store()?.isWifiEnabled;
export function setWifiEnabled(on: boolean) {
  store()?.SetWifiEnabled?.(on);
  settle();
}

/** Looks for Wi-Fi networks while Internet Connection Settings is open (as Steam's page does); returns a stop. */
export function scanForNetworks(): () => void {
  const s = store();
  if (!managed()) return () => {};
  try {
    s.StartScanningForNetworks();
  } catch (e) {
    console.warn("[DeckyXMB] can't scan for networks", e);
  }
  return () => {
    try {
      s.StopScanningForNetworks();
    } catch {
      /* gone */
    }
  };
}

// Steam's own Connect dialog (the password, a hidden network's name, your own IP address...): shown over the XMB as it
// shows it over its page; Steam's page is opened if this Steam doesn't have it.
const connectDialog = lookup<(props?: any) => void>(() =>
  findExport("band_filter", (v) => typeof v === "function" && /^function \w+\(e=\{\},t\)/.test(String(v)) && String(v).includes(",window,t)")),
);

/** Opens Steam's dialog to connect to a network (or, without one, to a network by its name); false if it can't. */
export function connectWithDialog(n?: Network): boolean {
  const show = connectDialog();
  if (!show) return false;
  const accessPoint = n ? apOf(n.key) : undefined;
  if (n && !accessPoint) return false;
  try {
    show(accessPoint ? { accessPoint } : {});
    return true;
  } catch (e) {
    console.warn("[DeckyXMB] can't show Steam's network dialog", e);
    return false;
  }
}

/**
 * Connects to a network. One Steam knows already (saved, or with no password) connects at once, as its dialog would;
 * any other, or one that then fails, opens Steam's dialog for what it needs. False if neither can be done here.
 */
export function connectNetwork(n: Network): boolean {
  const a = apOf(n.key);
  if (!a) return false;
  const w = a.wirelessAPInfo;
  if (a.type !== WIRELESS || !w || !(n.saved || w.esecurity === 0)) return connectWithDialog(n);
  store()
    .Connect({
      deviceId: a.deviceId,
      deviceWapId: a.deviceWapId,
      credentials: { username: "", password: w.password ?? "" },
      wireless: { band_filter: a.bandFilter },
    })
    .then((ok: boolean) => ok || connectWithDialog(n))
    .catch((e: unknown) => console.warn("[DeckyXMB] network connect failed", e))
    .finally(settle);
  settle();
  return true;
}

export function disconnectNetwork(n: Network) {
  apOf(n.key)?.Disconnect?.().finally(settle);
}
export function forgetNetwork(n: Network) {
  apOf(n.key)?.Forget?.().finally(settle);
}
export function setAutoconnect(n: Network, on: boolean) {
  apOf(n.key)?.SetAutoconnectEnabled?.(on).finally(settle);
}

// keeping the XMB current
// Steam's store hears of each change itself; this checks a little after it has (changes during a scan are many and
// small: only what's shown is compared, so a signal changing by a percent or two doesn't rebuild the column).
let shown = "";
let pending: ReturnType<typeof setTimeout> | undefined;
function settle() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    const now = JSON.stringify([
      wifiEnabled(),
      managed(),
      networks().map((n) => [n.key, n.name, n.status, Math.round((n.strength ?? 0) / 10), n.saved, n.autoconnect, n.connectable, n.disconnectable]),
    ]);
    if (now !== shown) {
      shown = now;
      notifySystemSettings();
    }
  }, 200);
}

/** Keeps the networks shown current as they come and go and connect; returns a stop. */
export function watchNetwork(): () => void {
  const regs: any[] = [];
  for (const call of ["RegisterForDeviceChanges", "RegisterForConnectivityTestChanges", "RegisterForConnectionStateUpdate"]) {
    try {
      regs.push(SteamClient.System.Network?.[call]?.(() => settle()));
    } catch {
      /* not on this Steam */
    }
  }
  settle();
  return () => {
    clearTimeout(pending);
    for (const r of regs) r?.unregister?.();
  };
}

// Test Connection and the Settings and Connection Status List

/** The connection in use: the default route, else any connected one (also System Information's). */
export function connectionInUse(): any {
  const all: any[] = (store()?.accessPoints ?? []).filter((a: any) => a?.isConnected && !a.isLoopback);
  return all.find((a) => a.isDefaultRoute) ?? all[0] ?? null;
}

const method = (a: any) => (a ? (a.type === WIRELESS ? "Wireless" : a.type === WIRED ? "Wired" : "Other") : "-");
const address = (n: unknown) => (typeof n === "number" && n ? ip4(n) : "-");
const netmask = (n: unknown) => (typeof n === "number" ? ip4(n) : "-");

function testResult(r: number, steam: boolean): string {
  if (steam || r === Test.Connected) return "Succeeded";
  if (r === Test.CaptivePortal) return "Sign-in Required";
  if (r === Test.TimedOut) return "Timed Out";
  if (r === Test.Unknown) return "-";
  return "Failed";
}

/** Test Connection's lines while the test runs. */
export function testingLines(): [string, string][] {
  const a = connectionInUse();
  return [
    ["Connection Method", method(a)],
    ...(a?.type === WIRELESS ? [["SSID", a.displayName] as [string, string]] : []),
    ["Obtain IP Address", a ? "Succeeded" : "Testing..."],
    ["Internet Connection", "Testing..."],
    ["Steam", "Testing..."],
  ];
}

/** Test Connection: Steam's own connectivity test, run again; its lines once it's done (as the PS3 shows them). */
export async function testConnection(): Promise<[string, string][]> {
  const s = store();
  if (s) {
    try {
      s.RecheckConnectivity();
      // It starts checking soon after it's asked, and answers within its own time-out; never wait past that.
      const started = Date.now();
      let seen = false;
      while (Date.now() - started < 20000) {
        await sleep(250);
        const checking = !!s.connectivityTestState?.bChecking;
        if (checking) seen = true;
        else if (seen || Date.now() - started > 1500) break;
      }
    } catch (e) {
      console.warn("[DeckyXMB] connection test failed", e);
    }
  }
  const a = connectionInUse();
  const steam = !!s?.hasSteamConnection;
  const ip = a?.m_DeviceInfo?.ip4?.addresses?.[0]?.ip;
  return [
    ["Connection Method", method(a)],
    ...(a?.type === WIRELESS ? [["SSID", a.displayName] as [string, string]] : []),
    ["Obtain IP Address", typeof ip === "number" && ip ? "Succeeded" : "Failed"],
    ["Internet Connection", a ? testResult(Number(s?.connectivityTestState?.eConnectivityTestResult ?? 0), steam) : "Failed"],
    ["Steam", steam ? "Succeeded" : "Failed"],
  ];
}

/** Settings and Connection Status List: the connection in use, as the PS3 lists it. */
export async function connectionStatus(): Promise<[string, string][]> {
  const s = store();
  const a = connectionInUse();
  const d = a?.m_DeviceInfo ?? {};
  const w = a?.wirelessAPInfo;
  const v4 = d.ip4 ?? {};
  const ip6 = (d.ip6?.addresses ?? []).map((x: any) => String(x.ip)).find((x: string) => !x.startsWith("fe80")) ?? d.ip6?.addresses?.[0]?.ip;
  const proxy = s?.proxyInfo ?? {};
  const lines: [string, string][] = [["Connection Method", method(a)]];
  if (a?.type === WIRELESS) {
    lines.push(["SSID", String(a.displayName)], ["Security Method", SECURITY[w?.esecurity] ?? "-"], ["Signal Strength", w ? `${w.strength_raw}%` : "-"]);
  } else if (d.wired) {
    lines.push(["Link Speed", d.wired.speed_mbit ? `${d.wired.speed_mbit} Mbps` : "-"]);
  }
  lines.push(
    ["IP Address Setting", a ? (v4.is_dhcp_enabled ? "Automatic" : "Manual") : "-"],
    ["IP Address", address(v4.addresses?.[0]?.ip)],
    ["Subnet Mask", a ? netmask(v4.addresses?.[0]?.netmask) : "-"],
    ["Default Router", address(v4.gateway_ip)],
    ["Primary DNS", address(v4.dns_ip?.[0])],
    ["Secondary DNS", address(v4.dns_ip?.[1])],
    ...(ip6 ? [["IPv6 Address", String(ip6)] as [string, string]] : []),
    ["MAC Address", String(a?.macAddress || s?.m_WirelessDevice?.mac || "-")],
    ["Proxy Server", proxy.proxy_mode === 2 ? `${proxy.address}:${proxy.port}` : proxy.proxy_mode === 3 ? "Automatic" : "Do Not Use"],
    ["Internet Connection", s?.hasInternetConnection ? "Available" : "Unavailable"],
    ["Steam", s?.hasSteamConnection ? "Connected" : "Not Connected"],
  );
  return lines;
}
