export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** p, or an error if it hasn't settled within ms (a call Steam never answers is given up on). */
export const timeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`${what} timed out`)))]);

/**
 * Base64 from the backend, as a response to read (its blob, its bytes): the browser's own decoder, via a data: URL, is
 * far faster than a JS loop for a track's or a texture's MBs.
 */
export const fromBase64 = (b64: string, mime = "application/octet-stream") => fetch(`data:${mime};base64,${b64}`);
