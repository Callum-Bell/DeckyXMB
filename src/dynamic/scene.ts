// The runtime for a PS3 dynamic theme's scene (exported from its RAF by py_modules/raf.py):
// actors play skeletal animations, and the theme's own script (VSMX) directs them:
// moving, fading and rotating actors and lights, with timers and the real time of day.
import { Vsmx } from "./vsmx";

type Keys = Record<string, number[][]>; // joint → [[frame, ...values]]
const TIMER = Symbol("timer"); // a script timer object's own record (see Animated.timer)

export interface SceneData {
  camera: { yfov: number; ymag?: number; near: number; far: number; position: number[]; direction: number[]; up: number[] }; // ymag: orthographic, this high
  actors: {
    id: string;
    model: number | null;
    texture: number | null;
    lit?: boolean;
    depth?: boolean; // false: drawn without depth testing, in scene order (backgrounds, overlays)
    edgeLit?: boolean; // lit around its silhouette too (a rim light)
    blend?: "add"; // added to what's behind it (glows, fire), rather than drawn over it
    normalMap?: number;
    normalSpace?: "object" | "tangent";
    specularMap?: number;
    position: number[];
    rotation: number[];
    scale: number[];
    color: number[];
    uvScale: number[];
    uvOffset: number[];
    animSpeeds?: number[]; // per animation slot
    animTimes?: number[];
    animWeights?: number[];
    animSpeed?: number; // (scenes unpacked by earlier versions: slot 0 only)
    animTime?: number;
  }[];
  models: {
    id: string;
    geometry: { positions: number[]; normals?: number[]; uvs: number[]; colors?: number[]; joints: number[]; weights?: number[]; indexes: number[] }; // colors: RGBA per vertex
    invBind?: number[];
    skeleton?: { parents: number[]; pose: number[][] };
    animations?: Anim[]; // by slot: the script blends them (setAnimWeight)
    animation?: Anim; // (scenes unpacked by earlier versions: a single animation)
  }[];
  textures: { id: string; format: string; width: number; height: number; levels?: number }[];
  lights?: { id: string; type: number; color: number[]; position: number[]; direction: number[]; attenuation: number[] }[];
}

/** An easing curve: linear, or a cubic Bézier through (0,0), (x1,y1), (x2,y2), (1,1). */
function ease(t: number, curve?: number[]): number {
  if (!curve || curve.length < 4) return t;
  const [x1, y1, x2, y2] = curve;
  const bez = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}

type GlideKey = "color" | "rotation" | "position" | "scale" | "direction" | "uv_offset";

/** Turn unit vector a towards b by k (0–1) along the arc; half-way round, about the vertical. */
function turn(a: number[], b: number[], k: number): number[] {
  const u = PS3_MATH.normalize(a), v = PS3_MATH.normalize(b);
  const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const angle = Math.acos(dot);
  if (angle < 1e-4) return v;
  // (Opposite ways: any axis square to it will do; the vertical one keeps a figure upright.)
  const axis = PS3_MATH.normalize(dot < -0.9999 ? (Math.abs(u[1]) < 0.99 ? PS3_MATH.cross([0, 1, 0], u) : [1, 0, 0]) : PS3_MATH.cross(u, v));
  const ax = PS3_MATH.cross(axis, u); // (square to u, towards v)
  const c = Math.cos(angle * k), sn = Math.sin(angle * k);
  return [0, 1, 2].map((i) => u[i] * c + ax[i] * sn);
}

/**
 * What a script moves, turns or fades over time: setPosition(value, seconds, interpolation, curve) and the like
 * glide the target's value there (along a Bézier curve, if given); without a time, it's set at once.
 */
class Glides {
  private list: { key: GlideKey; from: number[]; to: number[]; t: number; duration: number; curve?: number[] }[] = [];
  constructor(private target: Partial<Record<GlideKey, number[]>>, private start: Partial<Record<GlideKey, () => number[] | undefined>> = {}) {}

  to(key: GlideKey, value: number[], duration: number, curve?: number[]) {
    this.stop(key);
    const to = (value ?? []).map(Number);
    const from = this.target[key] ?? this.start[key]?.();
    if (!(duration > 0) || !from) {
      this.target[key] = to;
      return;
    }
    this.list.push({ key, from: [...from], to, t: 0, duration, curve: Array.isArray(curve) ? curve : undefined });
  }
  /** Stop gliding (the value was set outright). */
  stop(key: GlideKey) {
    this.list = this.list.filter((g) => g.key !== key);
  }
  step(dt: number) {
    for (const g of this.list) {
      g.t = Math.min(g.duration, g.t + dt);
      const k = ease(g.t / g.duration, g.curve);
      this.target[g.key] = g.key === "direction" ? turn(g.from, g.to, k) : g.to.map((v, i) => (g.from[i] ?? v) + (v - (g.from[i] ?? v)) * k);
    }
    this.list = this.list.filter((g) => g.t < g.duration);
  }
}

/** Something the script can fade, move or turn over time (actors and lights). */
class Animated {
  private rgba: number[] = [1, 1, 1, 1];
  /** Always red, green, blue and alpha: a colour set as just red, green and blue keeps its alpha. */
  get color(): number[] {
    return this.rgba;
  }
  set color(c: number[]) {
    const v = Array.isArray(c) ? c.map(Number) : [1, 1, 1];
    this.rgba = v.length >= 4 ? v : [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1, this.rgba?.[3] ?? 1];
  }
  position: number[] = [0, 0, 0];
  rotation: number[] = [0, 0, 0];
  scale: number[] = [1, 1, 1];
  // Its timers (obj.timer[n] = new OneShotTimer(…)): a timer kept here runs with this object as 'this'
  // (PixelJunk Shooter 2's particles switch themselves off so).
  timer: any[] = new Proxy([] as any[], {
    set: (list, k, v) => {
      if (v?.[TIMER]) v[TIMER].self = this;
      (list as any)[k] = v;
      return true;
    },
  });
  // (Unset, an actor faces along its z axis, as its rotation turns it: a first turn starts from there.)
  protected glides = new Glides(this as Partial<Record<GlideKey, number[]>>, { direction: () => (this.rotation.every((r) => !r) ? [0, 0, 1] : undefined) });

  // Script API: setColor/setPosition/setRotation/setScale(value, seconds, interpolation, curve)
  setColor(c: number[], d = 0, _i?: number, curve?: number[]) {
    this.glides.to("color", c, d, curve);
  }
  setPosition(p: number[], d = 0, _i?: number, curve?: number[]) {
    this.glides.to("position", p, d, curve);
  }
  setRotation(r: number[], d = 0, _i?: number, curve?: number[]) {
    this.glides.to("rotation", r, d, curve);
  }
  setScale(s: number[], d = 0, _i?: number, curve?: number[]) {
    this.glides.to("scale", s, d, curve);
  }

  step(dt: number) {
    this.glides.step(dt);
  }
}

type Anim = { id?: string; duration: number; fps: number; frames: number; rotation?: Keys; translation?: Keys; scale?: Keys };

/** A model's animations, by slot. */
export const animsOf = (m: SceneData["models"][number] | undefined): Anim[] => m?.animations ?? (m?.animation ? [m.animation] : []);

/** One actor as the script sees it (and as the renderer draws it). */
export class Actor extends Animated {
  // Per animation slot: playback time, speed and blend weight (slot 0 plays at first).
  animTimes: number[];
  animSpeeds: number[];
  animWeights: number[];
  private weightTweens: { slot: number; from: number; to: number; t: number; duration: number; curve?: number[] }[] = [];
  enable = true;
  uv_offset: number[]; // the texture's offset (scripts scroll it, e.g. a film-grain layer)
  // Facing, as scripts can set it instead of a rotation (to turn a card to the camera): where the
  // actor's z axis points, and its y axis (world up if only the direction is set: WipEout turns its far
  // side of the tunnel round that way). Unset, the rotation applies.
  direction?: number[];
  up?: number[];
  setDirection(d: number[], t = 0, _i?: number, curve?: number[]) {
    this.glides.to("direction", d, t, curve);
  }
  // (PixelJunk Shooter 2 steps its particles' frames and scrolls its smoke so.)
  setUVOffset(o: number[], t = 0, _i?: number, curve?: number[]) {
    this.glides.to("uv_offset", o, t, curve);
  }
  constructor(public data: SceneData["actors"][number]) {
    super();
    this.position = [...data.position];
    this.rotation = [...data.rotation];
    this.scale = [...data.scale];
    this.color = [...data.color];
    this.uv_offset = [...(data.uvOffset ?? [0, 0])];
    this.animTimes = [...(data.animTimes ?? [data.animTime ?? 0])];
    this.animSpeeds = [...(data.animSpeeds ?? [data.animSpeed ?? 1])];
    this.animWeights = [...(data.animWeights ?? [1])];
  }
  /** What the pose depends on, besides the transform (the renderer reuses unchanged poses). */
  animState(): string {
    return this.animTimes.join() + "/" + this.animWeights.join();
  }
  // Script API: the first argument is the animation slot.
  setAnimSpeed(slot: number, speed: number) {
    this.animSpeeds[slot | 0] = Number(speed) || 0;
  }
  animIds: string[] = []; // the model's animations' names, by slot
  getAnimIndex(id: string) {
    return Math.max(0, this.animIds.indexOf(String(id)));
  }
  getAnimTime(slot = 0) {
    return this.animTimes[slot | 0] ?? 0;
  }
  setAnimTime(slot: number, t: number) {
    this.animTimes[slot | 0] = Number(t) || 0;
  }
  /** Fade an animation slot's weight to w over d seconds (along a Bézier curve, if given). */
  setAnimWeight(slot: number, w: number, d = 0, _i?: number, curve?: number[]) {
    const i = slot | 0;
    const to = Math.max(0, Number(w) || 0);
    this.weightTweens = this.weightTweens.filter((t) => t.slot !== i);
    if (!(d > 0)) this.animWeights[i] = to;
    else this.weightTweens.push({ slot: i, from: this.animWeights[i] ?? 0, to, t: 0, duration: d, curve: Array.isArray(curve) ? curve : undefined });
  }
  step(dt: number) {
    super.step(dt);
    for (const tw of this.weightTweens) {
      tw.t = Math.min(tw.duration, tw.t + dt);
      this.animWeights[tw.slot] = tw.from + (tw.to - tw.from) * ease(tw.t / tw.duration, tw.curve);
    }
    this.weightTweens = this.weightTweens.filter((t) => t.t < t.duration);
  }
}

export class Light extends Animated {
  constructor(public data: NonNullable<SceneData["lights"]>[number]) {
    super();
    this.color = [...data.color];
    this.position = [...data.position];
  }
}

/** In single precision, as scripts' sums are (vsmx.ts): numbers, and vectors of them. */
const f32 = (v: any): any => (typeof v === "number" ? Math.fround(v) : Array.isArray(v) ? v.map(f32) : v);

/** Math, with the PS3's vector helpers: in single precision, like the scripts' own sums (in double, MotorStorm's
 *  camera eased in by cos(π + 0 × π) never quite set off from 0, the moment it takes its starting point, and lost it). */
const PS3_MATH = Object.fromEntries(
  Object.entries({
    ...Object.fromEntries(Object.getOwnPropertyNames(Math).map((k) => [k, (Math as any)[k]])),
    dot: (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0),
    cross: (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a: number[] | number) => (Array.isArray(a) ? Math.hypot(...a.map(Number)) : Math.abs(Number(a))),
    normalize: (a: number[]) => {
      const l = Math.hypot(...a) || 1;
      return a.map((v) => v / l);
    },
  }).map(([k, v]) => [k, typeof v === "function" ? (...a: any[]) => f32((v as (...a: any[]) => any)(...a)) : f32(v)]),
);

/** Timers this fast or faster run once per frame. */
const PER_FRAME = 0.05;

/** A timer faster than this asks for 60 frames a second (scripts count frames at the rate they were made for). */
const SIXTY = 1 / 40;

type Mat = Float32Array; // 3×4, row-major (as the PS3 stores them)

const IDENTITY: Mat = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

function compose(q: number[], t: number[], s: number[]): Mat {
  const [x, y, z, w] = q;
  const m = new Float32Array(12);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0];
  m[1] = 2 * (x * y - z * w) * s[1];
  m[2] = 2 * (x * z + y * w) * s[2];
  m[4] = 2 * (x * y + z * w) * s[0];
  m[5] = (1 - 2 * (x * x + z * z)) * s[1];
  m[6] = 2 * (y * z - x * w) * s[2];
  m[8] = 2 * (x * z - y * w) * s[0];
  m[9] = 2 * (y * z + x * w) * s[1];
  m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[3] = t[0];
  m[7] = t[1];
  m[11] = t[2];
  return m;
}

export function mul34(a: Mat, b: Mat): Mat {
  const m = new Float32Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      m[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0);
    }
  }
  return m;
}

/** A track's value at a frame: interpolated between keys (rotations: normalised lerp), held at the ends. */
function sample(keys: number[][], frame: number, rotation = false): number[] {
  if (frame <= keys[0][0]) return keys[0].slice(1);
  const last = keys[keys.length - 1];
  if (frame >= last[0]) return last.slice(1);
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid][0] <= frame) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const f = (frame - a[0]) / (b[0] - a[0]);
  if (!rotation) return a.slice(1).map((v, i) => v + (b[i + 1] - v) * f);
  const dot = a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4];
  const s = dot < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => a[i + 1] + (s * b[i + 1] - a[i + 1]) * f);
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
}

export class Scene {
  actors: Actor[];
  lights: Light[];
  aspect = 16 / 9;
  resolution = [1920, 1080]; // the screen's, as the PS3 gives it: width and height (scripts compare them for 16:9)
  private timers: { interval: number; fn: any; due: number; once: boolean; self?: any }[] = [];
  camera: SceneData["camera"]; // where the script has put it (it may turn it, or widen it, for the screen)
  private cameraGlides: Glides; // its pans and turns
  frameTime = 1 / 30; // the last frame's length (System.interval)
  private invBinds: (Mat[] | null)[]; // per model, per joint (made once, used every frame)
  private vm: Vsmx | null = null;
  private clock = 0;
  private broken = false;

  /** aspect: the PS3 mode's (16:9 or 4:3) for the screen, before the script runs (scripts lay things out for it once). */
  constructor(public data: SceneData, script?: Uint8Array, aspect?: number) {
    if (aspect) this.aspect = aspect;
    this.camera = { ...data.camera, position: [...data.camera.position], direction: [...data.camera.direction], up: [...data.camera.up] };
    this.cameraGlides = new Glides(this.camera);
    this.invBinds = data.models.map((m) => {
      const inv = m.invBind;
      const n = inv ? Math.floor(inv.length / 12) : 0;
      return n ? Array.from({ length: n }, (_, j) => new Float32Array(inv!.slice(12 * j, 12 * j + 12))) : null;
    });
    this.actors = data.actors.map((a) => {
      const actor = new Actor(a);
      actor.animIds = animsOf(a.model != null ? data.models[a.model] : undefined).map((anim) => anim.id ?? "");
      return actor;
    });
    this.lights = (data.lights ?? []).map((l) => new Light(l));
    if (!script?.length) return;
    const scene = this;
    const timer = (once: boolean) =>
      function (this: any, interval: number, fn: any) {
        // (A timer runs at most once per frame; one for 0 seconds on the next. Without a number, every second.)
        const t = Math.max(0.001, Number.isFinite(Number(interval)) ? Number(interval) : 1);
        const rec = { interval: t, fn, due: scene.clock + t, once, self: undefined };
        scene.timers.push(rec);
        Object.defineProperty(this, TIMER, { value: rec }); // (so the object it's kept on becomes its 'this')
      };
    const globals: Record<string, any> = {
      Camera: function (this: any) {
        const cam = scene.camera;
        Object.defineProperty(this, "aspect", { get: () => scene.aspect });
        for (const k of ["yfov", "position", "direction", "up"] as const)
          Object.defineProperty(this, k, {
            get: () => cam[k],
            set: (v: any) => {
              if (k === "position" || k === "direction") scene.cameraGlides.stop(k);
              (cam as any)[k] = Array.isArray(v) ? v.map(Number) : Number(v) || cam[k];
            },
          });
        // (Trash Panic's pans from corner to corner of its room over a minute.)
        this.setPosition = (p: number[], d = 0, _i?: number, curve?: number[]) => scene.cameraGlides.to("position", p, d, curve);
        this.setDirection = (p: number[], d = 0, _i?: number, curve?: number[]) => scene.cameraGlides.to("direction", p, d, curve);
      },
      Actor: function (name: string) {
        return scene.actors.find((a) => a.data.id === name) ?? new Actor({ ...data.actors[0], id: name, model: null });
      },
      Light: function (name: string) {
        return scene.lights.find((l) => l.data.id === name) ?? new Light({ id: name, type: 0, color: [0, 0, 0], position: [0, 0, 0], direction: [0, 0, -1], attenuation: [1, 0, 0] });
      },
      Date: function (this: any) {
        const d = new Date();
        Object.assign(this, { hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds(), day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() });
      },
      IntervalTimer: timer(false),
      OneShotTimer: timer(true),
      System: {
        timer: [],
        get resolution() {
          return scene.resolution;
        },
        /** Seconds per frame: scripts run per-frame timers at this interval and scale motion by it. */
        get interval() {
          return scene.frameTime;
        },
        printPerf() {},
      },
      Array,
      String,
      Object,
      Math: PS3_MATH,
      Error: function (this: any, message: unknown) {
        this.name = "Error";
        this.message = String(message ?? "");
      },
      writeln: () => {},
      INTERPOLATION_LINEAR: 0,
      INTERPOLATION_STEP: 1,
      INTERPOLATION_BEZIER: 2,
    };
    try {
      this.vm = new Vsmx(script, globals);
      this.vm.run();
    } catch (e) {
      console.warn("DeckyXMB: theme script stopped", e);
      this.broken = true;
    }
  }

  /** Frames a second the script was made for: 60 if it has a timer that fast, else 30. */
  get fps(): 30 | 60 {
    return this.timers.some((t) => !t.once && t.interval < SIXTY) ? 60 : 30;
  }

  /**
   * Advance time: any timers that are due, then animations and fades. (Timers first, so an animation started
   * by one and stopped by another as long after plays exactly that long: PixelJunk Shooter 2 flies its ship
   * across by playing an animation for its length, and a frame more wrapped it back to its start, off the edge.)
   */
  update(dt: number) {
    this.clock += dt;
    if (dt > 0) this.frameTime = dt;
    if (this.vm && !this.broken)
      for (const t of [...this.timers]) {
        // A per-frame timer (made with System.interval, or anything as fast) runs every frame, as the
        // script scales its motion by System.interval; others run when due.
        if (t.interval > PER_FRAME && this.clock < t.due) continue;
        t.due = Math.max(t.due + t.interval, this.clock);
        if (t.once) this.timers.splice(this.timers.indexOf(t), 1);
        try {
          this.vm.call(t.fn, t.self, []);
        } catch (e) {
          console.warn("DeckyXMB: theme script stopped", e);
          this.broken = true;
          break;
        }
      }
    for (const a of this.actors) {
      a.step(dt);
      animsOf(a.data.model != null ? this.data.models[a.data.model] : undefined).forEach((anim, i) => {
        const t = (a.animTimes[i] ?? 0) + dt * (a.animSpeeds[i] ?? a.animSpeeds[0] ?? 1);
        // (Within a millisecond of its end it's at its end: its length is stored rounded down.)
        a.animTimes[i] = t > anim.duration + 0.001 && anim.duration > 0 ? t % anim.duration : t;
      });
    }
    for (const l of this.lights) l.step(dt);
    this.cameraGlides.step(dt);
  }

  /** The skinning matrices (joint world × inverse bind) for an actor's model right now. */
  skin(a: Actor): Mat[] {
    const m = a.data.model != null ? this.data.models[a.data.model] : undefined;
    const sk = m?.skeleton;
    if (!m || !sk || !sk.pose.length) return [IDENTITY];
    // The animation slots playing, blended by weight (joints a slot doesn't animate keep their rest pose in it).
    const playing = animsOf(m)
      .map((anim, i) => ({ anim, w: a.animWeights[i] ?? 0, frame: (a.animTimes[i] ?? 0) * anim.fps }))
      .filter((p) => p.w > 1e-3);
    const world: Mat[] = [];
    for (let j = 0; j < sk.pose.length; j++) {
      const p = sk.pose[j];
      const key = String(j);
      let local: Mat;
      if (!playing.length) local = compose(p.slice(0, 4), p.slice(4, 7), p.slice(8, 11));
      else {
        const q = [0, 0, 0, 0], t = [0, 0, 0], s = [0, 0, 0];
        let total = 0;
        for (const { anim, w, frame } of playing) {
          const r = anim.rotation?.[key], tr = anim.translation?.[key], sc = anim.scale?.[key];
          const rq = r?.length ? sample(r, frame, true) : p.slice(0, 4);
          const sign = q[0] * rq[0] + q[1] * rq[1] + q[2] * rq[2] + q[3] * rq[3] < 0 ? -1 : 1; // same hemisphere
          const tv = tr?.length ? sample(tr, frame) : p.slice(4, 7);
          const sv = sc?.length ? sample(sc, frame) : p.slice(8, 11);
          for (let k = 0; k < 4; k++) q[k] += sign * w * rq[k];
          for (let k = 0; k < 3; k++) {
            t[k] += w * tv[k];
            s[k] += w * sv[k];
          }
          total += w;
        }
        const ql = Math.hypot(...q) || 1;
        local = compose(q.map((v) => v / ql), t.map((v) => v / total), s.map((v) => v / total));
      }
      world.push(sk.parents[j] >= 0 && sk.parents[j] < j ? mul34(world[sk.parents[j]], local) : local);
    }
    const inv = this.invBinds[a.data.model!];
    return world.map((w, j) => (inv?.[j] ? mul34(w, inv[j]) : w));
  }
}

/** The actor's own placement (script-controlled position, rotation in radians, scale). */
export function actorMatrix(a: Actor): Mat {
  let r: number[];
  if (Array.isArray(a.direction)) {
    // Its axes: z the direction, x across it from up, y square to both.
    const z = PS3_MATH.normalize(a.direction.map(Number));
    const x = PS3_MATH.normalize(PS3_MATH.cross(Array.isArray(a.up) ? a.up.map(Number) : [0, 1, 0], z));
    const y = PS3_MATH.cross(z, x);
    r = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  } else {
    const [rx, ry, rz] = a.rotation;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Rz · Ry · Rx
    r = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
  }
  const [kx, ky, kz] = a.scale;
  const [px, py, pz] = a.position;
  return new Float32Array([r[0] * kx, r[1] * ky, r[2] * kz, px, r[3] * kx, r[4] * ky, r[5] * kz, py, r[6] * kx, r[7] * ky, r[8] * kz, pz]);
}
