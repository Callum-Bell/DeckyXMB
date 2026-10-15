// Data kept across restarts by the plugin's backend (a file for each entry, in its data folder): shown at once, while
// it's read again behind it. Too much for the Steam UI's localStorage, which Steam's own pages share.
import { call } from "@decky/api";

const read = new Map<string, Promise<any>>(); // (each entry asked for once a session)

/** A saved entry, or undefined (none, or it can't be read). */
export function saved<T>(kind: string, key: string | number): Promise<T | undefined> {
  const k = `${kind}/${key}`;
  let p = read.get(k);
  if (!p) {
    p = call<[string, string], T | null>("cache_get", kind, String(key))
      .then((v) => v ?? undefined)
      .catch(() => undefined);
    read.set(k, p);
  }
  return p;
}

/** Saves an entry. */
export function save<T>(kind: string, key: string | number, value: T) {
  read.set(`${kind}/${key}`, Promise.resolve(value));
  call("cache_put", kind, String(key), value).catch(() => {});
}
