import { useEffect, useRef, useState } from "react";
import { ThemeKey, useSettings } from "../settings";
import { DynamicBackground } from "../dynamic/DynamicBackground";
import { activeTheme, Assets, sceneDrawn, stagedTheme, useThemes } from "../themes";
import { brightnessOf, rgb, themeColor } from "./theme";

/**
 * The background of every XMB screen: the wave in the user's theme colour, or an installed theme's.
 * `dim` darkens it (the trophy page); `theme` and `brightness` override the saved ones (live preview while picking);
 * `blur` softens it, as behind the PS3's Trophy Collection (an animated theme drawn at a low resolution meanwhile: the
 * blur hides it, and there's far less to draw).
 */
export function ThemedWave({
  now,
  dim = 1,
  hidden = false,
  blur = false,
  theme,
  brightness,
}: {
  now: Date;
  dim?: number;
  hidden?: boolean;
  blur?: boolean;
  theme?: ThemeKey;
  brightness?: string;
}) {
  const [s] = useSettings();
  useThemes();
  // An installed PS3 theme shows its own background instead of the wave: a dynamic
  // theme's animated scene, or its still image. While switching to a dynamic theme its
  // scene is built underneath, hidden, and carries on as the background once shown.
  const active = activeTheme();
  const incoming = stagedTheme();
  // Hidden, it carries on until it has faded out (stopped at once, it would be seen to freeze as it fades).
  const [stopped, setStopped] = useState(hidden);
  useEffect(() => {
    if (!hidden) return setStopped(false);
    const t = setTimeout(() => setStopped(true), FADE_MS);
    return () => clearTimeout(t);
  }, [hidden]);
  const layer = (t: Assets | null, shown: boolean) => {
    const off = hidden || !shown;
    const still = (hidden && stopped) || !shown; // (no longer seen)
    // Deep Blacks: video levels (16 → black, 235 → white: (v − 16) × 255 / 219), as two filters the GPU applies.
    const filter = t && s.deepBlacks === "on" ? DEEP_BLACKS : undefined;
    const style = { position: "absolute", inset: 0, opacity: off ? 0 : 1, transition: shown ? `opacity ${FADE_MS}ms ease-out` : "none", filter } as const;
    if (t?.scene) {
      return (
        <div key={t.key} style={style}>
          <DynamicBackground
            id={t.id}
            data={t.scene.data}
            script={t.scene.script}
            still={t.background}
            light={dim}
            maxHeight={blur ? BLUR_HEIGHT : s.themeResolution === "1080p" ? 1080 : undefined}
            animate={s.wave && !still}
            idle={still}
            onDrawn={shown ? undefined : () => sceneDrawn(t.id)}
          />
        </div>
      );
    }
    if (t?.background) {
      return (
        <div key={t.key} style={{ ...style, background: "#000" }}>
          <img src={t.background} style={{ width: "100%", height: "100%", objectFit: "cover", filter: `brightness(${dim})` }} />
        </div>
      );
    }
    return (
      <div key="wave" style={style}>
        {/* Hidden (e.g. under game art): stop animating once it has faded out. */}
        <Wave color={themeColor(theme ?? s.theme, now)} light={dim} animate={s.wave && !still} />
      </div>
    );
  };
  // One keyed list, so the incoming scene keeps its instance (and what it's drawn) when it's shown.
  const layers = [layer(active, true)];
  if (incoming?.scene && incoming.key !== active?.key) layers.unshift(layer(incoming, false));
  // Brightness (or the one being chosen): a veil of black over the background, fading between steps.
  const veil = 1 - brightnessOf(brightness ?? s.brightness);
  return (
    <>
      {/* (a little larger while blurred, so the blur's soft edges are off screen) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          filter: blur ? "blur(14px)" : "none",
          transform: blur ? "scale(1.04)" : "none",
          transition: "filter 300ms ease-out, transform 300ms ease-out",
        }}
      >
        {layers}
      </div>
      <div style={{ position: "absolute", inset: 0, background: "#000", opacity: veil, transition: "opacity 450ms ease-out", pointerEvents: "none" }} />
    </>
  );
}

const BLUR_HEIGHT = 360; // an animated theme's height in pixels while blurred
const FADE_MS = 900; // (hidden or shown again)
const DEEP_BLACKS = "contrast(1.1435) brightness(1.01826)";

type RGB = [number, number, number];

/**
 * The PS3's wave flows from the left: ripples travel left → right, it swings gently
 * at the left edge and more and more towards the right (which reads as 3D, as if it
 * comes towards you), and its sheets start bunched together at the left and fan out
 * as they go. Heights are fractions of the screen height; speeds are radians/second.
 * The ripples are sin(k·x − w·t), so their crests move rightwards. On top of that the
 * whole wave rocks and flexes in place (sin(k·x)·sin(w·t)): it tilts from sloping down
 * to sloping up and back every ~18 s, so it waves as it flows rather than just gliding.
 */
const SPINE = {
  base: 0.66,
  a1: 0.065,
  k1: 2.3,
  w1: 0.32,
  a2: 0.025,
  k2: 4.6,
  w2: 0.45,
  p2: 1.7,
  tilt: 0.04,
  wTilt: 0.34, // rocking about a point near the left
  bend: 0.02,
  kb: 3.4,
  pb: 0.6,
  wb: 0.24,
  qb: 1.1, // flexing in place
};

/** How much the wave swings at x (0 at the left edge → 1 at the right). */
const swing = (x: number) => 0.55 + 0.45 * x;
/** How far apart (and how thick) the sheets are at x: bunched at the left, fanned out at the right. */
const fan = (x: number) => 0.5 + 0.5 * x;

/** The wave's spine: the shared centre line every sheet (and the sparkles) follow. */
function spine(x: number, t: number) {
  const p = SPINE;
  return (
    p.base +
    swing(x) * (p.a1 * Math.sin(x * p.k1 - t * p.w1) + p.a2 * Math.sin(x * p.k2 - t * p.w2 + p.p2)) +
    p.tilt * (x - 0.2) * Math.sin(t * p.wTilt) +
    p.bend * Math.sin(x * p.kb + p.pb) * Math.sin(t * p.wb + p.qb)
  );
}

/**
 * One translucent sheet: it rides the spine at its own offset, with a ripple of its own,
 * and pinches and swells along its length; where it pinches it looks folded and its
 * edges meet and glow.
 */
interface Sheet {
  spread: number; // offset from the spine at the right edge
  a: number;
  k: number;
  w: number;
  p: number; // its own ripple
  b: number;
  kb: number;
  pb: number;
  wb: number;
  qb: number; // its own flex in place, so the sheets cross over each other
  thick: number;
  kt: number;
  wt: number;
  pt: number; // thickness / folds (also flowing right)
  fill: number; // sheet opacity
}

// Tuned against PS3 (RPCS3) recordings: a broad sheet, up to ~1/5 of the screen tall,
// swinging slowly over one long hump that can cross the screen diagonally.
const SHEETS: Sheet[] = [
  { spread: 0, a: 0.02, k: 3.0, w: 0.4, p: 0.0, b: 0.02, kb: 2.8, pb: 0.3, wb: 0.28, qb: 0.0, thick: 0.19, kt: 1.8, wt: 0.28, pt: 0.4, fill: 0.045 }, // the broad main sheet
  { spread: 0.035, a: 0.025, k: 2.6, w: 0.35, p: 2.0, b: 0.04, kb: 3.3, pb: 1.9, wb: 0.2, qb: 2.3, thick: 0.13, kt: 2.4, wt: 0.33, pt: 2.2, fill: 0.032 }, // one behind, for depth
  { spread: -0.03, a: 0.02, k: 3.6, w: 0.5, p: 4.0, b: 0.045, kb: 4.1, pb: 4.4, wb: 0.25, qb: 4.0, thick: 0.06, kt: 2.0, wt: 0.4, pt: 1.1, fill: 0.02 }, // a thin ribbon in front
];
const STEPS = 64;
const SPARK_LEVELS = 32; // sparkle brightness steps (each step drawn in one go)
const TAU = Math.PI * 2;

/** The sheet's top and bottom edges at STEPS+1 points across the screen (in pixels). */
function sheetEdges(s: Sheet, t: number, H: number) {
  const top = new Float32Array(STEPS + 1);
  const bot = new Float32Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) {
    const x = i / STEPS;
    const f = fan(x);
    const centre = spine(x, t) + f * (s.spread + s.a * Math.sin(x * s.k - t * s.w + s.p) + s.b * Math.sin(x * s.kb + s.pb) * Math.sin(t * s.wb + s.qb));
    const half = (s.thick / 2) * Math.pow(f, 0.8) * (0.4 + 0.6 * Math.abs(Math.sin(x * s.kt - t * s.wt + s.pt)));
    top[i] = (centre - half) * H;
    bot[i] = (centre + half) * H;
  }
  return { top, bot };
}

function tracePath(ctx: CanvasRenderingContext2D, ys: Float32Array, W: number, sx = 1, sy = 1) {
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) ctx.lineTo((i / STEPS) * W * sx, ys[i] * sy);
}

/**
 * The XMB background: the PS3's colour layout, a wave of translucent folding sheets
 * with glowing edges and a soft bloom, and drifting sparkles. Drawn on a 2D canvas at
 * ~30 fps; nothing is drawn while it isn't displayed (Steam can keep the home mounted
 * behind other pages).
 */
export function Wave({ color, light, animate }: { color: RGB; light: number; animate: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ color, light, animate });
  props.current = { color, light, animate };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const win: any = canvas.ownerDocument.defaultView ?? window;
    // The bloom is drawn at quarter size and scaled up: a cheap, soft blur.
    const bloom = canvas.ownerDocument.createElement("canvas");
    const bctx = bloom.getContext("2d")!;
    // The background only changes with the colour, light and size: drawn once, then copied each frame.
    const back = canvas.ownerDocument.createElement("canvas");
    const backCtx = back.getContext("2d")!;
    let backKey = "";
    // The lens dots: one soft disc per colour, drawn once and stamped at each dot's size and strength.
    const dotSprite = (col: string) => {
      const d = canvas.ownerDocument.createElement("canvas");
      d.width = d.height = 64;
      const g2 = d.getContext("2d")!;
      const g = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${col},1)`);
      g.addColorStop(0.65, `rgba(${col},0.8)`);
      g.addColorStop(1, `rgba(${col},0)`);
      g2.fillStyle = g;
      g2.fillRect(0, 0, 64, 64);
      return d;
    };
    const lavDot = dotSprite("205,185,255");
    let tintDot = { key: "", sprite: lavDot };
    let raf = 0;
    let last = 0;
    let due = 0; // when the next frame is due
    let t = 0; // wave time, in seconds
    let drawnKey = "";
    // The colour on screen, easing towards the wanted one (~0.6 s) so colour changes fade.
    const shown = [...props.current.color] as RGB;
    const COLOUR_TAU_MS = 200;

    // Sparkles: lots of tiny, near-white specks flowing in from the left with the wave.
    // Most are faint; each one flashes bright only briefly, so the bright ones keep moving
    // around (as on the PS3). About half sit inside the sheet; the rest are a wide cloud
    // well above and below it, mostly below.
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const sparks = Array.from({ length: 460 }, () => ({
      x: Math.random(),
      off: Math.random() < 0.5 ? -0.09 + Math.random() * 0.15 : 0.04 + gauss() * 0.32, // from the spine, in screen heights (scaled by fan)
      size: 0.5 + Math.random() ** 3 * 0.5, // radius at 1080p: all tiny
      speed: 0.012 + Math.random() * 0.023, // screen widths per second
      tw: 3 + Math.random() * 5, // twinkle rate: quick flashes
      p: Math.random() * TAU,
    }));
    // Where the wave comes in: a faint "dirty lens" of soft, out-of-focus dots, bunched at
    // the left edge and thinning out a little way to the right, some lavender, drifting slowly with the wave.
    // They wander about a little and brighten and dim, each at its own pace.
    // A smaller, fainter cluster sits where the wave leaves at the right edge.
    const ENTRY = 0.12; // how far in (screen widths) each cluster reaches
    const LEAD = 0.02; // they start just off-screen, so they slide in rather than pop in
    const lens = Array.from({ length: 40 }, (_, i) => ({
      end: i >= 30, // in the right-hand cluster
      x: Math.random() * (ENTRY + LEAD),
      off: gauss() * 0.12, // from the spine, in screen heights
      r: 0.004 + Math.random() ** 1.5 * 0.013, // radius, in screen heights
      a: 0.15 + Math.random() * 0.17,
      lav: Math.random() < 0.35,
      speed: 0.003 + Math.random() * 0.004, // drift right, screen widths per second
      wx: 0.3 + Math.random() * 0.5, // wander rates
      wy: 0.25 + Math.random() * 0.45,
      fr: 0.7 + Math.random() * 1.3, // flash rate
      p: Math.random() * TAU,
      q: Math.random() * TAU,
    }));

    // Layout size, not getBoundingClientRect: Steam scales its UI, and the
    // scaled size would make the canvas lower-resolution than it's shown.
    const resize = () => {
      canvas.width = Math.max(1, canvas.offsetWidth);
      canvas.height = Math.max(1, canvas.offsetHeight);
      bloom.width = Math.max(1, Math.round(canvas.width / 4));
      bloom.height = Math.max(1, Math.round(canvas.height / 4));
      back.width = canvas.width;
      back.height = canvas.height;
      backKey = "";
    };
    resize();
    const ro = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const draw = (now: number) => {
      raf = win.requestAnimationFrame(draw);
      const { color: want, light: l, animate: anim } = props.current;
      // ~30 fps is plenty: on a schedule, so a display frame landing a hair early doesn't drop it to 20.
      if (now < due - 3) return;
      due = Math.max(due + 1000 / 30, now);
      if (!canvas.offsetParent) return; // not displayed (display: none somewhere above)
      const ease = 1 - Math.exp(-Math.min(100, now - (last || now)) / COLOUR_TAU_MS);
      for (let i = 0; i < 3; i++) shown[i] = Math.abs(want[i] - shown[i]) < 0.5 ? want[i] : shown[i] + (want[i] - shown[i]) * ease;
      const c = shown;
      // A static wave redraws only while something changes (including a colour still fading).
      const key = `${c.map(Math.round).join()}|${l}|${canvas.width}x${canvas.height}`;
      if (!anim && key === drawnKey) return; // static wave: draw once
      drawnKey = key;
      t += anim ? Math.min(0.1, (now - (last || now)) / 1000) : 0;
      last = now;
      const W = canvas.width;
      const H = canvas.height;

      // Background, laid out like the PS3's (fitted to an RPCS3 recording): the colour at
      // ~78% overall, a deep shade pooling in a tall band down the left edge, a slightly darker
      // middle band, and a soft greyish haze low down.
      const bk = `${c.join()}|${l}|${W}x${H}`;
      if (bk !== backKey) {
        backKey = bk;
        const deep = c.map((v) => (v * 0.55 + (v * v) / 255) / 2) as RGB;
        const haze = c.map((v) => v * 0.85 + (128 - v * 0.85) * 0.25) as RGB;
        backCtx.fillStyle = rgb(c, 0.78 * l);
        backCtx.fillRect(0, 0, W, H);
        const band = backCtx.createLinearGradient(0, 0, 0, H);
        band.addColorStop(0.1, "rgba(0,0,0,0)");
        band.addColorStop(0.45, "rgba(0,0,0,0.13)");
        band.addColorStop(0.8, "rgba(0,0,0,0)");
        backCtx.fillStyle = band;
        backCtx.fillRect(0, 0, W, H);
        backCtx.save();
        backCtx.translate(W * 0.05, H * 0.5);
        backCtx.scale((W * 0.35) / (H * 0.8), 1); // an ellipse ~0.35W wide, ~0.8H tall
        const pool = backCtx.createRadialGradient(0, 0, 0, 0, 0, H * 0.8);
        pool.addColorStop(0, rgb(deep, l, 1));
        pool.addColorStop(0.5, rgb(deep, l, 0.75));
        pool.addColorStop(1, rgb(deep, l, 0));
        backCtx.fillStyle = pool;
        backCtx.fillRect(-W, -H, W * 4, H * 3);
        backCtx.restore();
        const low = backCtx.createLinearGradient(0, H * 0.65, 0, H);
        low.addColorStop(0, rgb(haze, l, 0));
        low.addColorStop(1, rgb(haze, l, 0.55));
        backCtx.fillStyle = low;
        backCtx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(back, 0, 0);

      // The wave
      const edges = SHEETS.map((s) => sheetEdges(s, t, H));
      // Bright light in a lighter tint of the theme colour (the PS3's wave isn't pure white).
      const tint = c.map((v) => Math.round(v + (255 - v) * 0.75)) as RGB;
      const tintStr = (a: number) => `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`;
      // Sparkles are nearly white; some lens dots have a lavender cast.
      const spark = tint.map((v) => Math.round(v + (255 - v) * 0.6));
      const sparkStr = (a: number) => `rgba(${spark[0]},${spark[1]},${spark[2]},${a})`;
      const tintKey = tint.join();
      if (tintDot.key !== tintKey) tintDot = { key: tintKey, sprite: dotSprite(tintKey) };
      const px = H / 1080;

      // Bloom: the sheets and their edges drawn soft and wide at quarter size, then scaled up.
      bctx.clearRect(0, 0, bloom.width, bloom.height);
      bctx.globalCompositeOperation = "lighter";
      const bs = bloom.width / W;
      edges.forEach(({ top, bot }, i) => {
        bctx.fillStyle = tintStr(SHEETS[i].fill * 2.2);
        bctx.beginPath();
        for (let k = 0; k <= STEPS; k++) bctx.lineTo((k / STEPS) * bloom.width, top[k] * bs);
        for (let k = STEPS; k >= 0; k--) bctx.lineTo((k / STEPS) * bloom.width, bot[k] * bs);
        bctx.closePath();
        bctx.fill();
        bctx.strokeStyle = tintStr(0.18);
        bctx.lineWidth = 3.5;
        tracePath(bctx, top, W, bs, bs);
        bctx.stroke();
        tracePath(bctx, bot, W, bs, bs);
        bctx.stroke();
      });
      ctx.globalCompositeOperation = "lighter";
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.32;
      ctx.drawImage(bloom, 0, 0, W, H);
      ctx.globalAlpha = 1;

      // The sheets, shaded as if lit from above (the PS3's 3D look): a translucent body, a
      // brighter upper surface just under the crest, a lit crest edge and a faint underside.
      const fillBetween = (a: Float32Array, b: Float32Array) => {
        ctx.beginPath();
        for (let k = 0; k <= STEPS; k++) ctx.lineTo((k / STEPS) * W, a[k]);
        for (let k = STEPS; k >= 0; k--) ctx.lineTo((k / STEPS) * W, b[k]);
        ctx.closePath();
        ctx.fill();
      };
      edges.forEach(({ top, bot }, i) => {
        const s = SHEETS[i];
        ctx.fillStyle = tintStr(s.fill * 0.8);
        fillBetween(top, bot);
        const upper = top.map((y, k) => y + (bot[k] - y) * 0.35);
        ctx.fillStyle = tintStr(s.fill * 1.3);
        fillBetween(top, upper);
        // Edges: the crest gets a glow and a bright line; the underside just a faint line.
        // Where a sheet pinches its edges overlap, so its folds glow brightest.
        for (const [ys, width, alpha] of [
          [top, 8, 0.02],
          [top, 1.4, 0.12],
          [bot, 6, 0.01],
          [bot, 1, 0.035],
        ] as const) {
          ctx.strokeStyle = tintStr(alpha);
          ctx.lineWidth = width;
          tracePath(ctx, ys, W);
          ctx.stroke();
        }
      });

      // The lens dots at the wave's entry: soft discs, strongest at the left edge and fading
      // as they drift right, wandering a little and flashing.
      for (const d of lens) {
        // Distance in from its screen edge; the right-hand ones drift out past the right edge.
        const run = (d.x + t * d.speed) % (ENTRY + LEAD);
        const edge = (d.end ? ENTRY - run : run - LEAD) + 0.006 * Math.sin(t * d.wx + d.p);
        const xf = d.end ? 1 - edge : edge;
        const fade = Math.pow(Math.max(0, 1 - Math.max(0, edge) / ENTRY), 1.1); // strongest at the edge
        const flash = Math.pow(0.5 + 0.5 * Math.sin(t * d.fr + d.q), 2);
        const a = d.a * (d.end ? 0.7 : 1) * fade * (0.25 + 0.75 * flash);
        if (a <= 0.01) continue;
        const x = xf * W;
        const sx = Math.min(1, Math.max(0, xf));
        const y = (spine(sx, t) + d.off * (d.end ? fan(sx) * 1.5 : 1) + 0.02 * Math.sin(t * d.wy + d.q)) * H;
        const r = d.r * H;
        ctx.globalAlpha = a;
        ctx.drawImage(d.lav ? lavDot : tintDot.sprite, x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;

      // Sparkles, tinted like the wave: each blinks on and off (mostly dim, briefly bright),
      // flowing with the sheet, a little denser where the wave comes in from the left.
      // Drawn in batches of equal brightness (SPARK_LEVELS steps): one fill per batch, not per sparkle.
      const batches: number[][] = Array.from({ length: SPARK_LEVELS + 1 }, () => []);
      for (const s of sparks) {
        const xf = (s.x + t * s.speed) % 1;
        const blink = Math.pow(0.5 + 0.5 * Math.sin(t * s.tw + s.p), 8);
        const a = (0.14 + 0.86 * blink) * Math.min(1, xf / 0.03) * (1 - 0.45 * xf);
        if (a <= 0.02) continue;
        batches[Math.round(a * SPARK_LEVELS)].push(xf * W, (spine(xf, t) + s.off * fan(xf)) * H, s.size * px * (1 + 0.2 * blink));
      }
      batches.forEach((b, level) => {
        if (!b.length) return;
        ctx.fillStyle = sparkStr(level / SPARK_LEVELS);
        ctx.beginPath();
        for (let i = 0; i < b.length; i += 3) {
          ctx.moveTo(b[i] + b[i + 2], b[i + 1]);
          ctx.arc(b[i], b[i + 1], b[i + 2], 0, TAU);
        }
        ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";
    };
    raf = win.requestAnimationFrame(draw);
    return () => {
      win.cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}
