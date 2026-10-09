import { useEffect, useRef, useState } from "react";
import { loadSceneTexture } from "../themes";
import { Renderer } from "./render";
import { Scene, SceneData } from "./scene";

// The theme's scene, kept as it plays: another page's background (a game's trophies, and back) carries on where it had
// got to rather than starting the theme over. (at: when it was last moved on, so two shown at once don't move it twice;
// owed: the time since, less the frames it has been moved on by)
let kept: { data: SceneData; script: Uint8Array; scene: Scene; at: number; owed: number } | null = null;
function sceneFor(data: SceneData, script: Uint8Array, aspect: number | undefined) {
  if (kept?.data !== data || kept.script !== script) kept = { data, script, scene: new Scene(data, script, aspect), at: 0, owed: 0 };
  return kept;
}

const CATCH_UP = 3; // frames made up for after a stall (beyond that, the time is let go)

/**
 * A PS3 dynamic theme's animated background: its scene, directed by its own script.
 * 30 or 60 fps, whichever its script was made for, at the screen's resolution or at most maxHeight; nothing runs while it isn't displayed, and once drawn nothing is redrawn while
 * it's hidden (idle). Its textures were loaded with the theme (themes.ts): here they're just uploaded.
 * Until the first page can be drawn (or if WebGL fails) the theme's still shows instead;
 * onDrawn says when it's drawn (switching theme waits for that behind "Please wait...").
 */
export function DynamicBackground({
  id,
  data,
  script,
  still,
  light,
  animate,
  idle = false,
  maxHeight,
  onDrawn,
}: {
  id: string; // the theme's, to fetch its textures
  data: SceneData;
  script: Uint8Array;
  still: string | null;
  light: number;
  animate: boolean;
  idle?: boolean; // hidden (under game art, or waiting to be switched to): stop drawing once it has drawn
  maxHeight?: number; // draw at most this many pixels high (scaled up to fill the screen); unset, the screen's own
  onDrawn?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ light, animate, idle, maxHeight, onDrawn });
  props.current = { light, animate, idle, maxHeight, onDrawn };
  const resizeRef = useRef<() => void>();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const win: any = canvas.ownerDocument.defaultView ?? window;
    let playing: NonNullable<typeof kept>;
    let scene: Scene;
    let renderer: Renderer;
    try {
      playing = sceneFor(data, script, canvas.offsetWidth / Math.max(1, canvas.offsetHeight) || undefined);
      scene = playing.scene;
      renderer = new Renderer(canvas, scene);
    } catch (e) {
      console.warn("DeckyXMB: dynamic theme unavailable", e);
      setFailed(true);
      props.current.onDrawn?.();
      return;
    }
    let raf = 0;
    let due = 0; // when the next frame is due (on a schedule, so it averages the theme's rate whatever the display's)
    let alive = true;
    let shown = false;
    let complete = false; // every texture uploaded: nothing left to wait for
    let cleared = false; // resized (which clears it) and not drawn since
    data.textures.forEach((_, i) => {
      loadSceneTexture(i, id).then(
        (t) => alive && t && !renderer.hasTexture(i) && renderer.setTexture(i, t),
        () => {},
      );
    });

    // Full resolution: layout size (Steam scales its UI) × the screen's pixel density; at most maxHeight high.
    const resize = () => {
      const dpr = Math.min(3, Math.max(1, win.devicePixelRatio || 1));
      const k = Math.min(1, (props.current.maxHeight ?? Infinity) / Math.max(1, canvas.offsetHeight * dpr));
      canvas.width = Math.max(1, Math.min(3840, Math.round(canvas.offsetWidth * dpr * k)));
      canvas.height = Math.max(1, Math.min(2160, Math.round(canvas.offsetHeight * dpr * k)));
      // Scripts see the PS3's mode for a screen this shape: it had only 16:9 and 4:3, and they test for them
      // exactly (or "under 1.7"). The Deck's 16:10 is widescreen: as 4:3, PixelJunk Shooter 2 moves its camera past
      // the edge of its scene, and inFamous 2 and Jak and Daxter lay themselves out for a narrow screen.
      const wide = canvas.width / canvas.height >= (16 / 9 + 4 / 3) / 2;
      scene.aspect = wide ? 16 / 9 : 4 / 3;
      scene.resolution = wide ? [1920, 1080] : [canvas.width, canvas.height];
      cleared = true;
    };
    resize();
    resizeRef.current = resize;
    const ro = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
    ro?.observe(canvas);

    // Drawn again as it is, at once: resized (blurred, say), it's redrawn in the display's next frame rather than
    // shown cleared until the theme's next is due (or, idle, black from then on).
    const redraw = () => {
      cleared = false;
      if (shown)
        renderer.draw(
          props.current.light,
          renderer.visible().map((v) => v.actor),
        );
    };
    const frame = (now: number) => {
      raf = win.requestAnimationFrame(frame);
      if (now < due - 3) return void (cleared && redraw()); // (a little early is fine: the display's frames don't land exactly on it)
      due = Math.max(due + 1000 / scene.fps, now); // (after a pause, from now)
      if (!canvas.offsetParent) return; // not displayed
      if (shown && props.current.idle) return void (cleared && redraw()); // hidden, and what it last drew is still there
      // It moves on in whole frames of the theme's rate, as on the PS3: scripts time what they direct by counting frames
      // while animations play by time, so moved on by the time between draws (never exactly a frame) the two drifted
      // apart (MotorStorm's snowmobile, driven for so many frames and then held, came to be held part-way along).
      const step = 1 / scene.fps;
      playing.owed = playing.at ? Math.min(CATCH_UP * step, playing.owed + Math.max(0, now - playing.at) / 1000) : step;
      playing.at = now;
      const frames = Math.round(playing.owed / step); // (the draws land either side of when each frame is due)
      playing.owed -= frames * step;
      if (props.current.animate) for (let i = 0; i < frames; i++) scene.update(step);
      const seen = renderer.visible();
      const inView = seen.map((v) => v.actor);
      complete ||= data.textures.every((_, i) => renderer.hasTexture(i));
      if (!shown) {
        // Show it once what's mostly in view can be drawn (later, a missing texture just waits).
        const solid = seen.filter((v) => v.share > 0.3 && v.actor.color[3] >= 1).map((v) => v.actor);
        if (!complete && !(solid.length > 0 && solid.every((a) => a.data.texture == null || renderer.hasTexture(a.data.texture)))) return;
        shown = true;
        setReady(true);
        props.current.onDrawn?.();
      }
      cleared = false;
      renderer.draw(props.current.light, inView);
    };
    raf = win.requestAnimationFrame(frame);
    return () => {
      alive = false;
      win.cancelAnimationFrame(raf);
      ro?.disconnect();
      renderer.dispose();
    };
  }, [id, data, script]);
  useEffect(() => resizeRef.current?.(), [maxHeight]); // (the canvas is cleared: the next frame redraws it)

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {still && (
        <img
          src={still}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: `brightness(${light})`,
            opacity: ready && !failed ? 0 : 1,
            transition: "opacity 600ms",
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: ready && !failed ? 1 : 0, transition: "opacity 600ms" }}
      />
    </div>
  );
}
