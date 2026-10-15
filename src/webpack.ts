// Steam's UI modules aren't exported, so they are found inside its webpack
// bundle by *content* (minified names change between client updates).
// Adapted from Spindeck (BSD-3-Clause).
import { timeout } from "./async";

let req: any;

function getRequire(): any {
  if (req) return req;
  try {
    (globalThis as any).webpackChunksteamui?.push([[Math.random()], {}, (r: any) => (req = r)]);
  } catch {
    /* bundle layout changed */
  }
  return req;
}

/** Exports of every module whose source contains all of `needles`, lazily. */
function* modulesWith(needles: string[]): Generator<Record<string, any>> {
  const r = getRequire();
  if (!r?.m) return;
  for (const id of Object.keys(r.m)) {
    let exports: any;
    try {
      const src = String(r.m[id]);
      if (!needles.every((n) => src.includes(n))) continue;
      exports = r(id);
    } catch {
      continue; // unreadable / failed to load
    }
    if (exports) yield exports;
  }
}

/** Exports of the first module whose source contains every one of `needles`. */
export function findModuleExports(...needles: string[]): Record<string, any> | null {
  for (const exports of modulesWith(needles)) return exports;
  return null;
}

/** First export (of any module whose source contains `needle`) that passes `test`. */
export function findExport(needle: string, test: (v: any) => boolean): any {
  for (const exports of modulesWith([needle])) {
    for (const v of Object.values(exports)) {
      try {
        if (v && test(v)) return v;
      } catch {
        /* getter threw */
      }
    }
  }
  return null;
}

/**
 * First export of a module Steam has already loaded that passes `test`. Far cheaper than findExport (no module's source is
 * read, none is loaded), for something common to much of its code, wanted while the XMB is first drawn.
 */
export function findLoadedExport(test: (v: any) => boolean): any {
  const cache = getRequire()?.c;
  if (!cache) return null;
  for (const id of Object.keys(cache)) {
    try {
      const exports = cache[id]?.exports;
      if (!exports || typeof exports !== "object") continue;
      for (const v of Object.values(exports)) if (v && test(v)) return v;
    } catch {
      /* getter threw */
    }
  }
  return null;
}

/** Something of Steam's, found in its code the first time it's wanted (a search of all of it): a miss is remembered too. */
export function lookup<T>(find: () => T | null | undefined): () => T | null {
  let looked = false;
  let found: T | null = null;
  return () => {
    if (!looked) {
      looked = true;
      found = find() ?? null;
    }
    return found;
  };
}

/** One of Steam's services (found by one of its method's names, "Player.GetOwnedGames#1"), looked for once. */
export const steamService = (needle: string, has: (v: any) => boolean) => lookup<any>(() => Object.values(findModuleExports(needle) ?? {}).find((v) => has(v)));

/**
 * Calls a Steam service's method over Steam's signed-in connection, as Steam's own pages do: the reply's body (snake_case
 * fields), or null if it isn't OK (a private profile, say). Throws if Steam isn't connected or doesn't answer in time.
 */
export async function callService(service: any, method: string, body: Record<string, unknown>, ms = 15000): Promise<any> {
  const transport = (globalThis as any).App?.m_cm?.m_ServiceTransport;
  if (!transport || typeof service?.[method] !== "function") throw new Error(`${method} not available`);
  const r: any = await timeout(Promise.resolve(service[method](transport, body)), ms, method);
  return r?.GetEResult?.() === 1 ? r.Body().toObject() : null;
}
