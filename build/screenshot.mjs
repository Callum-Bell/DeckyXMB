// Takes a 1920x1080 screenshot of Big Picture into screenshots/, over Steam's remote debugging (Decky's Developer mode
// turns it on, at port 8081). It only watches: nothing on the device is changed.
//
//   npm run screenshot -- <device ip> [name = xmb-<date and time>]
//
// (The ip can be set in DECK_IP instead.)
import { mkdirSync, writeFileSync } from "fs";

const [ip = process.env.DECK_IP, name = `xmb-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`] = process.argv.slice(2);
if (!ip) {
  console.log("Usage: npm run screenshot -- <device ip> [name = xmb-<date and time>]");
  process.exit(1);
}

// Big Picture's page (its id changes each time Steam starts).
const pages = await (await fetch(`http://${ip}:8081/json`)).json();
const page = pages.find((p) => p.title === "Steam Big Picture Mode");
if (!page) {
  console.error("Big Picture wasn't found on the device. Is it on, with Decky's Developer mode?");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl.replace("localhost", ip));
let next = 0;
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++next;
    ws.addEventListener("message", function on(m) {
      const r = JSON.parse(m.data);
      if (r.id !== id) return;
      ws.removeEventListener("message", on);
      r.error ? reject(new Error(r.error.message)) : resolve(r.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onerror = () => {
  console.error("Couldn't connect to the device.");
  process.exit(1);
};
await new Promise((r) => (ws.onopen = r));

// The page in CSS pixels, drawn at whatever scale makes it 1920 wide (1080 high on a 16:9 screen).
// (The clip's scale is on top of the screen's own: Big Picture is drawn at 4K, 2.56x its 1500x844 CSS pixels.)
const { cssLayoutViewport: v, layoutViewport: px } = await send("Page.getLayoutMetrics");
const scale = 1920 / px.clientWidth;
const height = Math.round((1080 / 1920) * v.clientWidth);
const { data } = await send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 0, y: 0, width: v.clientWidth, height, scale },
});
ws.close();

mkdirSync("screenshots", { recursive: true });
const out = `screenshots/${name}.png`;
writeFileSync(out, Buffer.from(data, "base64"));
console.log(`Saved ${out}`);
