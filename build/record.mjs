// Records the Deck's screen into docs/ as <name>_preview.mp4 and .webp (the README's clips), over Steam's remote
// debugging (Decky's Developer mode turns it on, at port 8081). It only watches: nothing on the Deck is changed.
//
//   npm run record -- <deck ip> [name = xmb] [seconds = 30] [countdown = 10]
//
// Needs ffmpeg (on PATH, or its path in FFMPEG): winget install Gyan.FFmpeg
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const [ip, name = "xmb", secs = "30", countdown = "10"] = process.argv.slice(2);
const out = `docs/${name}_preview`;
if (!ip) {
  console.log("Usage: npm run record -- <deck ip> [name = xmb] [seconds = 30] [countdown = 10]");
  process.exit(1);
}
const ffmpeg = process.env.FFMPEG || "ffmpeg";
try {
  execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
} catch {
  console.error("ffmpeg wasn't found. Install it (winget install Gyan.FFmpeg), or set FFMPEG to its path.");
  process.exit(1);
}

// Big Picture's page (its id changes each time Steam starts).
const pages = await (await fetch(`http://${ip}:8081/json`)).json();
const page = pages.find((p) => p.title === "Steam Big Picture Mode");
if (!page) {
  console.error("Big Picture wasn't found on the Deck. Is it on, with Decky's Developer mode?");
  process.exit(1);
}

for (let n = +countdown; n > 0; n--) {
  process.stdout.write(`\rRecording in ${n}... `);
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`\rRecording for ${secs} s...   `);

// Frames as Steam draws them (up to the display's rate), each with when it was drawn.
const dir = mkdtempSync(join(tmpdir(), "deckyxmb-rec-"));
const frames = [];
await new Promise((done) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl.replace("localhost", ip));
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: 1, method: "Page.startScreencast", params: { format: "jpeg", quality: 90, maxWidth: 1280, maxHeight: 800 } }));
    setTimeout(() => {
      ws.send(JSON.stringify({ id: 2, method: "Page.stopScreencast" }));
      setTimeout(() => (ws.close(), done()), 300);
    }, +secs * 1000);
  };
  ws.onmessage = (m) => {
    const r = JSON.parse(m.data);
    if (r.method !== "Page.screencastFrame") return;
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(r.params.data, "base64"));
    frames.push({ file, at: r.params.metadata.timestamp });
    ws.send(JSON.stringify({ id: 3, method: "Page.screencastFrameAck", params: { sessionId: r.params.sessionId } }));
  };
  ws.onerror = () => {
    console.error("Couldn't connect to the Deck.");
    process.exit(1);
  };
});
console.log(`${frames.length} frames. Encoding...`);

// Each frame shown for as long as it was on screen, then made a steady 30 fps.
const list = join(dir, "frames.txt");
writeFileSync(
  list,
  "ffconcat version 1.0\n" +
    frames.map((f, i) => `file '${f.file.replace(/\\/g, "/")}'\nduration ${((frames[i + 1]?.at ?? f.at + 1 / 30) - f.at).toFixed(4)}\n`).join(""),
);
const run = (args) => execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const mp4 = `-vf fps=30,scale=1280:-2,format=yuv420p -c:v libx264 -crf 22 -preset slow -movflags +faststart ${out}.mp4`;
run(["-f", "concat", "-safe", "0", "-i", list, ...mp4.split(" ")]);
// (GitHub plays this one in the README: kept under 5 MB)
run(`-i ${out}.mp4 -vf fps=15,scale=854:-2 -c:v libwebp -q:v 55 -compression_level 6 -loop 0 -an ${out}.webp`.split(" "));
rmSync(dir, { recursive: true, force: true });
console.log(`Saved ${out}.mp4 and ${out}.webp`);
