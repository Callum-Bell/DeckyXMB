// Screenshots, by game, for the Screenshots column: those Steam keeps on this device (SteamClient.Screenshots),
// and those uploaded to your Steam profile (Steam Cloud) that aren't on it.
// Local files are served from Steam's own loopback host, as its Media page shows them (with a thumbnail of each);
// uploaded ones are asked for as Steam's own UI does, over its signed-in connection (PublishedFile.GetUserFiles).
import { timeout } from "./async";
import { signal } from "./signal";
import { callService, steamService } from "./webpack";

declare const SteamClient: any;

export interface Shot {
  appid: number;
  id: string; // unique: "local:<app>:<handle>" or "cloud:<published file id>"
  url: string; // the full picture
  thumb: string; // a smaller one
  width: number;
  height: number;
  created: number; // unix seconds
  caption: string;
  cloud: boolean; // only on your Steam profile
}

const HOST = "https://steamloopback.host/";
const NOT_UPLOADED = ["", "0"];
const CLOUD_EVERY_MS = 10 * 60 * 1000; // (uploads change rarely: asked for again at most this often)
const WAIT_MS = 15000; // (a call Steam never answers is given up on, so later refreshes aren't held up behind it)
const changes = signal();
let local: { shot: Shot; published: string }[] = [];
let cloud: Shot[] = [];
let cloudAt = 0;
let shots: Shot[] = [];
let loading: Promise<void> | null = null;

/** Every screenshot, newest first (empty until loaded: see refreshScreenshots). */
export const allScreenshots = () => shots;

/** Whether Steam Cloud has been asked for your uploads yet (it can't be until Steam's signed-in connection is up). */
export const cloudScreenshotsAsked = () => cloudAt > 0;

async function readLocal() {
  const list: any[] = (await SteamClient?.Screenshots?.GetAllLocalScreenshots?.()) ?? [];
  local = list
    .filter((s) => s && typeof s.strUrl === "string")
    .map((s) => ({
      published: String(s.publishedFileID ?? ""),
      shot: {
        appid: Number(s.nAppID) || 0,
        id: `local:${s.nAppID}:${s.hHandle}`,
        url: HOST + s.strUrl,
        // (screenshots/<app>/screenshots/<file>.jpg: the thumbnail is in thumbnails/ beside it)
        thumb: HOST + s.strUrl.replace(/\/([^/]+)$/, "/thumbnails/$1"),
        width: Number(s.nWidth) || 0,
        height: Number(s.nHeight) || 0,
        created: Number(s.nCreated) || 0,
        caption: String(s.strCaption ?? ""),
        cloud: false,
      },
    }));
}

// Steam's PublishedFile service
const service = steamService("PublishedFile.GetUserFiles#1", (v) => typeof v?.GetUserFiles === "function");

/** Your uploaded screenshots, a page of 100 at a time. False if Steam isn't ready to be asked (signed-in connection not up yet). */
async function readCloud(): Promise<boolean> {
  const app = (globalThis as any).App;
  const transport = app?.m_cm?.m_ServiceTransport;
  const steamid = app?.m_CurrentUser?.strSteamID;
  if (!transport || !steamid) return false;
  if (!service()) return true; // (not in this Steam: nothing to ask for)
  const found: Shot[] = [];
  for (let page = 1; page <= 20; page++) {
    // type "myfiles" with filetype 4: your screenshots, of every game
    const body = await callService(service(), "GetUserFiles", { steamid, appid: 0, page, numperpage: 100, type: "myfiles", filetype: 4 }, WAIT_MS);
    if (!body) break;
    const files: any[] = body.publishedfiledetails ?? [];
    for (const f of files) {
      const url = f.file_url || f.preview_url;
      if (!url) continue;
      found.push({
        appid: Number(f.consumer_appid) || 0,
        id: `cloud:${f.publishedfileid}`,
        url,
        thumb: f.preview_url || url,
        width: Number(f.image_width) || 0,
        height: Number(f.image_height) || 0,
        created: Number(f.time_created) || 0,
        caption: String(f.title ?? ""),
        cloud: true,
      });
    }
    if (!files.length || found.length >= Number(body.total ?? 0)) break;
  }
  cloud = found;
  return true;
}

/** Read them again (on showing the home screen); notifies if any were taken, uploaded or deleted. */
export function refreshScreenshots(): Promise<void> {
  loading ??= (async () => {
    try {
      await timeout(readLocal(), WAIT_MS, "screenshots");
    } catch (e) {
      console.warn("[DeckyXMB] screenshots unavailable", e);
    }
    if (Date.now() - cloudAt > CLOUD_EVERY_MS) {
      try {
        // (Not ready yet, it's asked again on the next refresh; once asked, not again for a while, even if it failed.)
        const asked = await readCloud();
        if (asked) cloudAt = Date.now();
      } catch (e) {
        cloudAt = Date.now();
        console.warn("[DeckyXMB] Steam Cloud screenshots unavailable", e);
      }
    }
    // An uploaded screenshot that's also on this device is listed once, from the device.
    const here = new Set(local.map((l) => l.published).filter((p) => !NOT_UPLOADED.includes(p)));
    const next = [...local.map((l) => l.shot), ...cloud.filter((c) => !here.has(c.id.slice("cloud:".length)))].sort((a, b) => b.created - a.created);
    const key = (l: Shot[]) => l.map((s) => s.id).join();
    if (key(next) !== key(shots)) {
      shots = next;
      changes.notify();
    }
    loading = null;
  })();
  return loading;
}

export const useScreenshots = changes.use;
