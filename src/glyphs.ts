// Controller Symbols: the button images Steam shows (its prompts, the Quick Access menu, the XMB's own ✕ / ○), swapped
// for another controller's, as the Button Prompts Galore theme does in CSS Loader: Steam's own glyph images are
// replaced where they're shown, in each of its windows.
import { getSettings, subscribeSettings } from "./settings";
import { GLYPH_SETS, STEAM_GLYPHS } from "./glyphs.data";

export { GLYPH_SETS };

/** A button by where it is on the Deck: the bottom face button (✕), the right one (○), and so on. */
export type GlyphButton = "face-dn" | "face-rt" | "face-lf" | "face-up" | "menu-srt" | "menu-slc";

const STYLE_ID = "xmb-controller-glyphs";

// Each set's images as data URIs, and the CSS swapping them in: made once, the first time the set is used.
const built = new Map<string, { uris: Record<string, string>; css: string }>();
function setOf(id: string) {
  let b = built.get(id);
  const set = GLYPH_SETS.find((s) => s.id === id);
  if (!b && set) {
    const uris: Record<string, string> = {};
    for (const [button, svg] of Object.entries(set.images)) uris[button] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const css = Object.entries(uris)
      .map(([button, uri]) => `${STEAM_GLYPHS[button].map((f) => `img[src="/steaminputglyphs/${f}.svg"]`).join(",")}{content:url("${uri}")}`)
      .join("\n");
    built.set(id, (b = { uris, css }));
  }
  return b;
}

/** The image for a button in the chosen set (Steam's own when it hasn't one). */
export function glyphSrc(button: GlyphButton): string {
  return setOf(getSettings().controllerGlyphs)?.uris[button] ?? `/steaminputglyphs/${STEAM_GLYPHS[button][0]}.svg`;
}

const css = (id: string) => setOf(id)?.css ?? "";

/** Steam's windows: Big Picture itself, the Quick Access and main menus (each a window of its own). */
function steamWindows(): Window[] {
  const wins = new Set<Window>([window]);
  try {
    const nav = (globalThis as any).SteamUIStore?.m_GamepadNavigationManager;
    for (const c of nav?.m_rgAllContexts ?? [nav?.m_ActiveContext]) {
      if (c?.m_rootWindow) wins.add(c.m_rootWindow);
      for (const t of c?.m_rgGamepadNavigationTrees ?? []) if (t?.m_window) wins.add(t.m_window);
    }
  } catch {}
  return [...wins].filter((w) => !w.closed && w.document?.head);
}

function apply() {
  const text = css(getSettings().controllerGlyphs);
  for (const w of steamWindows()) {
    try {
      const doc = w.document;
      let el = doc.getElementById(STYLE_ID);
      if (!text) {
        el?.remove();
        continue;
      }
      if (!el) {
        el = doc.createElement("style");
        el.id = STYLE_ID;
        doc.head.appendChild(el);
      }
      if (el.textContent !== text) el.textContent = text;
    } catch {}
  }
}

/** Keeps Steam's windows showing the chosen set (they're made again when Steam restarts its UI); returns a stop. */
export function startControllerGlyphs(): () => void {
  apply();
  let last = getSettings().controllerGlyphs;
  const unsub = subscribeSettings(() => {
    if (getSettings().controllerGlyphs !== last) {
      last = getSettings().controllerGlyphs;
      apply();
    }
  });
  // (a window opened since, or made again, gets the set on the next look; with Steam's own there's nothing to put in)
  const timer = setInterval(() => setOf(getSettings().controllerGlyphs) && apply(), 3000);
  return () => {
    unsub();
    clearInterval(timer);
    for (const w of steamWindows()) w.document.getElementById(STYLE_ID)?.remove();
  };
}
