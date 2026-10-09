// Pieces shared by the XMB home and the trophy page.
import { footerClasses } from "@decky/ui";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { GlyphButton, glyphSrc } from "../glyphs";
import { useSettings } from "../settings";

/** Stop a gamepad event from reaching Steam's own handlers. */
export function consume(e: any) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
}

type Handler = (e: any) => void;

/**
 * Gamepad handlers as stable functions that always call the latest render's
 * version: Steam's Focusable can keep handlers from an earlier render (seen on
 * device in Spindeck), so the props must never change identity.
 */
export function useGamepadHandlers<K extends string>(handlers: Record<K, Handler>): Record<K, Handler> {
  const latest = useRef(handlers);
  latest.current = handlers;
  return useMemo(() => {
    const out = {} as Record<K, Handler>;
    for (const k of Object.keys(handlers) as K[]) out[k] = (e) => latest.current[k]?.(e);
    return out;
  }, []);
}

// Design stage: the Deck's 1280×800, scaled to fit whatever we're given.
export const STAGE_W = 1280;
export const STAGE_H = 800;

/** <img> that walks through candidate URLs until one loads. */
export function FallbackImg({ srcs, style, fallback, onLoad }: { srcs: string[]; style?: CSSProperties; fallback?: any; onLoad?: () => void }) {
  const [i, setI] = useState(0);
  const key = srcs.join("|");
  useEffect(() => setI(0), [key]);
  if (i >= srcs.length) return fallback ?? null;
  return <img src={srcs[i]} style={style} onError={() => setI(i + 1)} onLoad={onLoad} draggable={false} />;
}

export function useStageScale(ref: { current: HTMLDivElement | null }) {
  const [box, setBox] = useState({ w: STAGE_W, h: STAGE_H });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const win: any = el.ownerDocument.defaultView ?? window;
    const measure = () => setBox({ w: el.clientWidth || STAGE_W, h: el.clientHeight || STAGE_H });
    measure();
    const RO = win.ResizeObserver;
    const ro = RO ? new RO(measure) : null;
    ro?.observe(el);
    win.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      win.removeEventListener("resize", measure);
    };
  }, []);
  return { ...box, scale: Math.min(box.w / STAGE_W, box.h / STAGE_H) };
}

/** Whether an element is on show: its page displayed (not behind another of Steam's), and Steam's window not hidden (a game in front). */
export const onScreen = (el: HTMLElement | null | undefined) => !!el && el.offsetParent !== null && !el.ownerDocument.hidden;

/**
 * The time, every so often, while `on` (an element) is on screen: nothing is re-rendered for it while it's hidden (Steam
 * keeps the home mounted behind a game), and it's brought up to date as Steam's window is shown again.
 */
export function useNow(everyMs: number, on: { current: HTMLElement | null }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => onScreen(on.current) && setNow(new Date());
    const id = setInterval(tick, everyMs);
    const doc = on.current?.ownerDocument ?? document;
    doc.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      doc.removeEventListener("visibilitychange", tick);
    };
  }, [everyMs]);
  return now;
}

/**
 * The 1280×800 stage, centred and scaled inside its container. On screens wider
 * than 16:10 there's spare room beside it: --xmb-edge is that width (in stage px),
 * so things anchored to the screen's right edge (clock bar, side panels) can reach it.
 */
export function Stage({ box, children }: { box: { w: number; h: number; scale: number }; children: any }) {
  const edge = Math.max(0, (box.w / box.scale - STAGE_W) / 2);
  return (
    <div
      style={{
        ["--xmb-edge" as any]: `${edge}px`,
        position: "absolute",
        left: (box.w - STAGE_W * box.scale) / 2,
        top: (box.h - STAGE_H * box.scale) / 2,
        width: STAGE_W,
        height: STAGE_H,
        transform: `scale(${box.scale})`,
        transformOrigin: "0 0",
      }}
    >
      {children}
    </div>
  );
}

export const FONT = '"Rodin", "Motiva Sans", "Segoe UI", Arial, sans-serif';

// The dark shadow under all text: tight below it and a wider soft one round it, so it reads over busy, bright themes.
export const TEXT_SHADOW = "0 1px 3px rgba(0,0,0,.85), 0 0 10px rgba(0,0,0,.6)";

// The selected item's text flashes: a white glow round it swelling to bright and back, about every 1.6s.
export const BASE_CSS = `
.xmb-text { text-shadow: 0 0 6px rgba(255,255,255,.35), ${TEXT_SHADOW}; }
.xmb-glow { filter: drop-shadow(0 0 6px rgba(255,255,255,.75)); }
@keyframes xmbPulse {
  0%,100% { text-shadow: 0 0 6px rgba(255,255,255,.5), ${TEXT_SHADOW}; }
  50% { text-shadow: 0 0 3px #fff, 0 0 8px #fff, 0 0 14px rgba(255,255,255,.75), ${TEXT_SHADOW}; }
}
.xmb-pulse { animation: xmbPulse 1.6s ease-in-out infinite; }
@keyframes xmbFade { from { opacity: 0; } }
.xmb-enter { animation: xmbFade 220ms ease-out; }
`;

const MARQUEE_PX_PER_S = 30; // how fast it scrolls
const MARQUEE_MIN_S = 1.2; // (a short way, no quicker than this)
const MARQUEE_START_S = 0.15; // before it first moves
const MARQUEE_HOLD_S = 2; // held at either end
const GLOW_ROOM = 16; // room above and below the text for the selected one's glow (xmbPulse), which the clipping would cut square

/**
 * Text cut off with an ellipsis; while it's selected, if it doesn't fit, it scrolls left to show the rest, holds there,
 * scrolls back and holds, over and over. (Measured once the selection has settled: the text may grow as it's selected.)
 * The holds are a set time whatever the length, so the animation is built for each (on the GPU: a transform).
 * Selected text that fits isn't clipped at all, so its glow spreads round it freely.
 */
export function Marquee({ text, on, className, style }: { text: string; on: boolean; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const span = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState<number | null>(null); // how far it overflows; null until measured
  useEffect(() => {
    if (!on) return setOver(null);
    const t = setTimeout(() => {
      const el = ref.current;
      setOver(el ? Math.max(0, el.scrollWidth - el.clientWidth) : 0);
    }, 250);
    return () => clearTimeout(t);
  }, [on, text, style?.maxWidth]);
  useEffect(() => {
    if (!over || !span.current?.animate) return;
    const move = Math.max(MARQUEE_MIN_S, over / MARQUEE_PX_PER_S);
    const total = MARQUEE_START_S + 2 * (move + MARQUEE_HOLD_S);
    const at = (s: number) => s / total; // (a time in the loop, as the fraction of it the keyframes take)
    const home = "translateX(0)";
    const end = `translateX(${-over}px)`;
    const ease = "ease-in-out";
    const anim = span.current.animate(
      [
        { offset: 0, transform: home },
        { offset: at(MARQUEE_START_S), transform: home, easing: ease },
        { offset: at(MARQUEE_START_S + move), transform: end },
        { offset: at(MARQUEE_START_S + move + MARQUEE_HOLD_S), transform: end, easing: ease },
        { offset: at(MARQUEE_START_S + 2 * move + MARQUEE_HOLD_S), transform: home },
        { offset: 1, transform: home },
      ],
      { duration: total * 1000, iterations: Infinity },
    );
    return () => anim.cancel();
  }, [over]);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        minWidth: 0,
        overflow: on && over === 0 ? "visible" : "hidden",
        whiteSpace: "nowrap",
        textOverflow: over ? "clip" : "ellipsis",
        padding: `${GLOW_ROOM}px 0`,
        margin: `-${GLOW_ROOM}px 0`,
      }}
    >
      {over ? (
        <span ref={span} className="xmb-marquee">
          {text}
        </span>
      ) : (
        text
      )}
    </div>
  );
}

/** A button's symbol in a hint ("○ Back"), from the chosen Controller Symbols (DualShock 3 by default). */
export function Glyph({ b, size = 24 }: { b: GlyphButton; size?: number }) {
  useSettings();
  return <img src={glyphSrc(b)} draggable={false} style={{ width: size, height: size, objectFit: "contain", verticalAlign: "middle", flex: "none" }} />;
}

/** A button hint: its symbol, then what it does. */
export const Hint = ({ b, children }: { b: GlyphButton; children: any }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <Glyph b={b} />
    {children}
  </span>
);

let footersHidden = 0;

/**
 * Hide the footer bar of the frame `el` is in (the nearest ancestor with one); returns what puts it back.
 * (The XMB's home and the trophy page.) Steam can add the footer after the page has mounted (at boot) or re-create the frame, so it's looked for again
 * each second until (and while) it's hidden.
 */
export function hideFooter(el: HTMLElement | null) {
  const footer = footerClasses?.BasicFooter;
  if (!el || !footer) return;
  const doc = el.ownerDocument;
  const mark = `data-xmb-nofooter-${++footersHidden}`;
  const style = doc.createElement("style");
  style.textContent = `[${mark}] > .${footer} { display: none !important; }`;
  doc.head.appendChild(style);
  let frame: HTMLElement | null = null;
  const find = () => {
    if (frame?.isConnected && frame.hasAttribute(mark) && frame.contains(el)) return;
    frame?.removeAttribute(mark);
    frame = el.parentElement;
    while (frame && ![...frame.children].some((c) => c.classList.contains(footer))) frame = frame.parentElement;
    frame?.setAttribute(mark, "");
  };
  find();
  const timer = setInterval(find, 1000);
  return () => {
    clearInterval(timer);
    frame?.removeAttribute(mark);
    style.remove();
  };
}
