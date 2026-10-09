// Tiny static server for the browser preview: http://localhost:5178 (this machine only)
import { createServer } from "http";
import { readFile } from "fs/promises";
import { dirname, extname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "preview");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const port = Number(process.env.PORT) || 5178;

createServer(async (req, res) => {
  // (only files in preview/: an encoded "../" is decoded after the URL's own dot segments are, so it's checked here)
  const asked = resolve(dir, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
  const path = asked === dir ? join(dir, "index.html") : asked;
  try {
    if (!path.startsWith(dir + sep)) throw new Error("outside preview/");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`preview on http://localhost:${port}`));
