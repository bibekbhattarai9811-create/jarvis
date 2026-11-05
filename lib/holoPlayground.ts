import { HOLO_COLORS } from "./quick";
// Holo playground: glowing 3D holograms you grab (pinch / mouse drag), throw, swat (open palm) and pull (fist).
// Two hands on one hologram stretch, shrink and turn it. Throw one hard enough and it shatters, then re-forms.

type Pt = { x: number; y: number };
type V3 = [number, number, number];

export type HoloKind = "reactor" | "cube" | "globe" | "gyro" | "diamond" | "helmet" | "pyramid" | "torus" | "helix" | "atom" | "star" | "heart" | "scan";

type Obj = {
  id: number;
  kind: HoloKind;
  name: string;
  rgb: string;
  base: number; // original size: it goes back to this after it blows up
  absorbed?: Obj[]; // holograms merged into this one; they pop back out when it blows up
  charge: number; // 0 → 1 while you hold it still (charge-up throw)
  charged: number; // seconds left of a charged throw: it detonates on impact
  x: number;
  y: number;
  vx: number;
  vy: number;
  R: number;
  rot: V3;
  spin: V3;
  broken: number; // seconds until it re-forms (0 = intact)
  form: number; // 0 → 1 materialize animation
  img?: HTMLCanvasElement; // scanned real-world object (holographic cutout)
};

export type HandInput = {
  id: string; // stable per hand ("Left" / "Right")
  aim: Pt; // between thumb and index tips: what the hand is reaching for
  pinch: Pt | null; // grab point while pinching
  palm: Pt;
  palmR: number;
  vel: Pt; // palm velocity, px/s
  fist: boolean;
  open: boolean;
};

/** Requests from voice commands ("Jarvis, add an Iron Man helmet"), drained by the running playground. */
export type HoloRequest =
  | { op: "add"; shape?: string }
  | { op: "reset" | "scan" }
  | { op: "color"; color: string }
  | { op: "scale"; factor: number }
  | { op: "explode"; all?: boolean }
  | { op: "learnface"; name?: string };
export const holoQueue: HoloRequest[] = [];

export const HOLO_SHAPES: Record<HoloKind, { name: string; rgb: string; size: number }> = {
  reactor: { name: "ARC REACTOR", rgb: "63,216,255", size: 1.15 },
  cube: { name: "TESSERACT", rgb: "120,200,255", size: 1 },
  globe: { name: "EARTH", rgb: "90,255,200", size: 1.2 },
  gyro: { name: "GYROSCOPE", rgb: "255,181,71", size: 1 },
  diamond: { name: "CRYSTAL", rgb: "255,90,180", size: 0.9 },
  helmet: { name: "MK-42 HELMET", rgb: "255,95,70", size: 1.3 },
  pyramid: { name: "PYRAMID", rgb: "255,220,90", size: 1 },
  torus: { name: "TORUS", rgb: "160,140,255", size: 1.1 },
  helix: { name: "DNA HELIX", rgb: "100,255,140", size: 1.2 },
  atom: { name: "ATOM", rgb: "80,220,255", size: 1.2 },
  star: { name: "STAR", rgb: "255,235,120", size: 1 },
  heart: { name: "HEART", rgb: "255,80,120", size: 1 },
  scan: { name: "SCANNED OBJECT", rgb: "63,216,255", size: 1 },
};
const STARTERS: HoloKind[] = ["reactor", "cube", "globe", "gyro", "diamond"];
const MAX_OBJECTS = 14;
const SMASH_SPEED = 1300; // px/s impact against a wall that shatters a hologram
const BLAST_SPEED = 650; // px/s closing speed at which two holograms blow each other up
const REFORM_SECONDS = 1.6;

// ---- Wireframes (unit size, lists of 3D polylines; negative z faces the viewer) ----
const circle = (f: (a: number) => V3, n = 32): V3[] => Array.from({ length: n + 1 }, (_, i) => f((i / n) * Math.PI * 2));
const scaleLines = (lines: V3[][], k: number) => lines.map((l) => l.map((p) => p.map((n) => n * k) as V3));

const CUBE: V3[][] = (() => {
  const s = 0.62;
  const v: V3[] = [[-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s], [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const half = (p: V3) => p.map((n) => n * 0.5) as V3;
  return [...e.map(([a, b]) => [v[a], v[b]]), ...e.map(([a, b]) => [half(v[a]), half(v[b])]), ...v.map((p) => [p, half(p)])];
})();

const DIAMOND: V3[][] = (() => {
  const v: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1.25, 0], [0, -1.25, 0], [0, 0, 1], [0, 0, -1]];
  const lines: V3[][] = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) if (Math.floor(a / 2) !== Math.floor(b / 2)) lines.push([v[a], v[b]]);
  return scaleLines(lines, 0.8);
})();

const GLOBE: V3[][] = [
  ...[-60, -30, 0, 30, 60].map((lat) => {
    const r = Math.cos((lat * Math.PI) / 180);
    const y = Math.sin((lat * Math.PI) / 180);
    return circle((a) => [Math.cos(a) * r, y, Math.sin(a) * r]);
  }),
  ...[0, 30, 60, 90, 120, 150].map((lon) => {
    const L = (lon * Math.PI) / 180;
    return circle((a) => [Math.cos(a) * Math.cos(L), Math.sin(a), Math.cos(a) * Math.sin(L)]);
  }),
];

const GYRO: V3[][] = [
  circle((a) => [Math.cos(a), Math.sin(a), 0]),
  circle((a) => [Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82]),
  circle((a) => [0, Math.cos(a) * 0.64, Math.sin(a) * 0.64]),
  [[0, -1.15, 0], [0, 1.15, 0]],
];

const HELMET: V3[][] = (() => {
  const A = 0.8, B = 1.0, C = 0.85;
  // Point on the front of the head shell (slightly proud of it, so the faceplate reads on top).
  const face = (x: number, y: number): V3 => [x, y, -C * Math.sqrt(Math.max(0, 1 - (x / A) ** 2 - (y / B) ** 2)) - 0.04];
  const poly = (pts: [number, number][], closed = true): V3[] => {
    const out: V3[] = [];
    const list = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i < list.length - 1; i++) {
      // subdivide so lines hug the curved face
      for (let k = 0; k < 4; k++) {
        const t = k / 4;
        out.push(face(list[i][0] + (list[i + 1][0] - list[i][0]) * t, list[i][1] + (list[i + 1][1] - list[i][1]) * t));
      }
    }
    out.push(face(list[list.length - 1][0], list[list.length - 1][1]));
    return out;
  };
  const shell: V3[][] = [];
  // Meridians around the sides and back (the face stays clean).
  for (const lon of [-110, -70, -35, 0, 35, 70, 110]) {
    const L = (lon * Math.PI) / 180;
    const line: V3[] = [];
    for (let i = 0; i <= 20; i++) {
      const lat = -Math.PI / 2 + (i / 20) * Math.PI * 0.92;
      line.push([A * Math.cos(lat) * Math.sin(L), B * Math.sin(lat), C * Math.cos(lat) * Math.cos(L)]);
    }
    shell.push(line);
  }
  // Brow ring and jaw ring
  shell.push(circle((a) => [A * 0.8 * Math.cos(a), -0.6, C * 0.8 * Math.sin(a)]));
  shell.push(circle((a) => [A * 0.62 * Math.cos(a), 0.78, C * 0.62 * Math.sin(a)]));
  const plate = poly([[-0.46, -0.5], [0, -0.62], [0.46, -0.5], [0.56, -0.08], [0.42, 0.36], [0.2, 0.7], [-0.2, 0.7], [-0.42, 0.36], [-0.56, -0.08]]);
  const eyeL = poly([[-0.44, -0.2], [-0.12, -0.13], [-0.13, -0.05], [-0.4, -0.1]]);
  const eyeR = poly([[0.44, -0.2], [0.12, -0.13], [0.13, -0.05], [0.4, -0.1]]);
  const mouth = poly([[-0.2, 0.46], [0.2, 0.46]], false);
  const cheekL = poly([[-0.42, 0.36], [-0.2, 0.46]], false);
  const cheekR = poly([[0.42, 0.36], [0.2, 0.46]], false);
  const ridge: V3[] = [];
  for (let i = 0; i <= 12; i++) {
    const lat = -0.62 - (i / 12) * 0.9;
    ridge.push([0, B * Math.sin(lat), -C * Math.cos(lat)]);
  }
  return [...shell, plate, eyeL, eyeR, mouth, cheekL, cheekR, ridge];
})();

const PYRAMID: V3[][] = (() => {
  const b = 0.8, y = 0.6;
  const base: V3[] = [[-b, y, -b], [b, y, -b], [b, y, b], [-b, y, b]];
  const apex: V3 = [0, -1, 0];
  return [[...base, base[0]], ...base.map((p) => [p, apex]), [[-b * 0.5, y * 0.2 - 0.2, -b * 0.5], [b * 0.5, y * 0.2 - 0.2, -b * 0.5], [b * 0.5, y * 0.2 - 0.2, b * 0.5], [-b * 0.5, y * 0.2 - 0.2, b * 0.5], [-b * 0.5, y * 0.2 - 0.2, -b * 0.5]]];
})();

const TORUS: V3[][] = (() => {
  const Rm = 0.68, r = 0.3;
  const lines: V3[][] = [];
  for (let i = 0; i < 14; i++) {
    const u = (i / 14) * Math.PI * 2;
    lines.push(circle((v) => [(Rm + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (Rm + r * Math.cos(v)) * Math.sin(u)], 16));
  }
  for (const v of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) lines.push(circle((u) => [(Rm + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (Rm + r * Math.cos(v)) * Math.sin(u)]));
  return lines;
})();

const HELIX: V3[][] = (() => {
  const n = 60;
  const strand = (off: number): V3[] => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = t * Math.PI * 4 + off;
    return [Math.cos(a) * 0.45, -1.1 + t * 2.2, Math.sin(a) * 0.45];
  });
  const s1 = strand(0);
  const s2 = strand(Math.PI);
  const rungs = Array.from({ length: 13 }, (_, k) => {
    const i = Math.round((k / 12) * n);
    return [s1[i], s2[i]];
  });
  return [s1, s2, ...rungs];
})();

const ATOM: V3[][] = (() => {
  const orbits = [0, 1, 2].map((k) => circle((a) => rotate([Math.cos(a), Math.sin(a) * 0.34, 0], [1.1, 0, (k * Math.PI) / 3]), 40));
  const nucleus = [circle((a) => [Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0], 12), circle((a) => [0, Math.cos(a) * 0.16, Math.sin(a) * 0.16], 12), circle((a) => [Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16], 12)];
  return [...orbits, ...nucleus];
})();

const extrude = (outline: [number, number][], depth: number): V3[][] => {
  const front = outline.map(([x, y]) => [x, y, -depth] as V3);
  const back = outline.map(([x, y]) => [x, y, depth] as V3);
  const step = Math.max(1, Math.floor(outline.length / 10));
  const links = outline.filter((_, i) => i % step === 0).map(([x, y]) => [[x, y, -depth], [x, y, depth]] as V3[]);
  return [[...front, front[0]], [...back, back[0]], ...links];
};

const STAR: V3[][] = extrude(
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.42 : 1;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  }),
  0.16
);

const HEART: V3[][] = extrude(
  Array.from({ length: 40 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    return [x / 17, y / 17 + 0.1] as [number, number];
  }),
  0.16
);

const SHAPES: Partial<Record<HoloKind, V3[][]>> = {
  cube: CUBE,
  diamond: DIAMOND,
  globe: GLOBE,
  gyro: GYRO,
  helmet: HELMET,
  pyramid: PYRAMID,
  torus: TORUS,
  helix: HELIX,
  atom: ATOM,
  star: STAR,
  heart: HEART,
};

function rotate([x, y, z]: V3, [ax, ay, az]: V3): V3 {
  let c = Math.cos(ax), s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ay);
  s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(az);
  s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

/** Turn a spoken shape name into a kind ("Iron Man helmet" → helmet). */
export function matchShape(name: string): HoloKind | null {
  const n = name.toLowerCase();
  // Order matters: "heart" contains "earth", so it's checked before the globe.
  const table: [RegExp, HoloKind][] = [
    [/heart|love/, "heart"],
    [/helmet|iron ?man|mask|mark/, "helmet"],
    [/reactor|arc/, "reactor"],
    [/cube|tesseract|box/, "cube"],
    [/globe|earth|world|planet|sphere|ball/, "globe"],
    [/gyro|ring/, "gyro"],
    [/crystal|diamond|gem/, "diamond"],
    [/pyramid|triangle/, "pyramid"],
    [/torus|donut|doughnut/, "torus"],
    [/dna|helix/, "helix"],
    [/atom/, "atom"],
    [/star/, "star"],
  ];
  return table.find(([re]) => re.test(n))?.[1] ?? null;
}

type Wave = { x: number; y: number; r: number; life: number; rgb: string };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; rgb: string };
type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: Pt;
  b: Pt;
  ang: number;
  va: number;
  life: number;
  rgb: string;
  tile?: { img: HTMLCanvasElement; sx: number; sy: number; sw: number; sh: number; w: number; h: number }; // piece of a scanned picture
};
type ScanFx = { box: { x: number; y: number; w: number; h: number }; t: number; img: HTMLCanvasElement; name: string; id: number };

/** Turn a cutout into a hologram: blue tint and scanlines, keeping its transparent outline. */
function holoImage(cutout: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = cutout.width;
  c.height = cutout.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(cutout, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(63,216,255,0.32)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "rgba(0,18,32,0.35)";
  for (let y = 0; y < c.height; y += 3) ctx.fillRect(0, y, c.width, 1);
  return c;
}
type Stretch = { obj: Obj; ids: [string, string]; d0: number; R0: number; a0: number; rz0: number };

const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

export class HoloPlayground {
  private objs: Obj[] = [];
  private holds = new Map<string, { obj: Obj; off: Pt }>(); // hand id → held hologram
  private last: Obj | null = null; // hologram you touched last (voice commands act on it)
  private hover = new Map<string, Obj>(); // hand id → hologram it's locked onto (grabbed on pinch)
  private stretch: Stretch | null = null;
  private sparks: Spark[] = [];
  private waves: Wave[] = [];
  private flash = 0; // white-out after a blast, fades fast
  private shake = 0; // seconds of screen shake left
  private shards: Shard[] = [];
  private audio: AudioContext | null = null;
  private nextId = 1;
  private scans: ScanFx[] = [];
  private vortex: Pt | null = null;
  private clock = 0;
  private W = 0;
  private H = 0;

  get grabbedName(): string | null {
    const first = this.holds.values().next().value;
    return first ? first.obj.name : null;
  }

  get count() {
    return this.objs.length;
  }

  private make(kind: HoloKind, x: number, y: number, form = 1): Obj {
    const sp = HOLO_SHAPES[kind];
    const base = Math.min(this.W, this.H) * 0.075;
    return {
      id: this.nextId++,
      kind,
      name: sp.name,
      rgb: sp.rgb,
      x,
      y,
      vx: 0,
      vy: 0,
      R: Math.max(30, base * sp.size),
      base: Math.max(30, base * sp.size),
      charge: 0,
      charged: 0,
      rot: [Math.random() * 0.6 - 0.3, Math.random() * 6, 0],
      spin: [0.3, 0.6, 0.1],
      broken: 0,
      form,
    };
  }

  private init(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.holds.clear();
    this.hover.clear();
    this.stretch = null;
    this.objs = STARTERS.map((k, i) => {
      const a = (i / STARTERS.length) * Math.PI * 2 - Math.PI / 2;
      return this.make(k, W / 2 + Math.cos(a) * W * 0.28, H * 0.48 + Math.sin(a) * H * 0.26, 0.4 + i * 0.12);
    });
  }

  /** Mouse wheel / touchpad: grow or shrink the hologram under the pointer (or the one the mouse holds). */
  resizeAt(pt: Pt, factor: number): boolean {
    const held = this.holds.get("mouse")?.obj;
    let o = held || null;
    if (!o) {
      let best = Infinity;
      for (const x of this.objs) {
        if (x.broken) continue;
        const d = Math.hypot(x.x - pt.x, x.y - pt.y) - x.R;
        if (d < 40 && d < best) {
          best = d;
          o = x;
        }
      }
    }
    if (!o) return false;
    o.R = Math.max(18, Math.min(Math.min(this.W, this.H) * 0.42, o.R * factor));
    return true;
  }

  /** Add a hologram (voice command). Returns false for unknown shapes. */
  add(shape: string): boolean {
    const kind = matchShape(shape);
    if (!kind || !this.W) return false;
    const o = this.make(kind, this.W * (0.3 + Math.random() * 0.4), this.H * 0.4, 0);
    if (kind === "helmet") o.rot = [0, 0, 0]; // face the viewer so you can see it's a helmet
    o.vy = 120;
    this.objs.push(o);
    while (this.objs.length > MAX_OBJECTS) {
      const old = this.objs.shift()!;
      for (const [id, h] of this.holds) if (h.obj === old) this.holds.delete(id);
    }
    this.sound("reform");
    return true;
  }

  /** A real object was scanned at this screen box: play the scan sweep, then lift a hologram off it. Returns its id. */
  addScan(cutout: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }, name = "SCANNED OBJECT"): number {
    const id = this.nextId++;
    this.scans.push({ box, t: 0, img: holoImage(cutout), name, id });
    this.sound("scan");
    return id;
  }

  /** Name a scanned hologram once Claude has identified it. */
  rename(id: number, name: string) {
    const o = this.objs.find((x) => x.id === id);
    if (o) o.name = name;
    const sc = this.scans.find((x) => x.id === id);
    if (sc) sc.name = name;
  }

  update(dt: number, W: number, H: number, hands: HandInput[], mouse: { at: Pt | null; down: boolean }) {
    dt = Math.max(0, Math.min(dt, 0.05)); // rAF timestamps can run slightly behind performance.now()
    if (!this.objs.length || Math.abs(W - this.W) > 200 || Math.abs(H - this.H) > 200) this.init(W, H);
    this.W = W;
    this.H = H;

    // Voice requests
    const later: HoloRequest[] = []; // requests for the camera view (scan, learn face): leave them queued
    while (holoQueue.length) {
      const q = holoQueue.shift()!;
      if (q.op === "reset") this.init(W, H);
      else if (q.op === "add") {
        if (q.shape) this.add(q.shape);
      } else if (q.op === "color" || q.op === "scale" || q.op === "explode") this.command(q);
      else later.push(q);
    }
    holoQueue.push(...later);

    this.updateEffects(dt);

    // Finished scan sweeps become holograms where the real object was.
    for (const sc of this.scans) sc.t += dt / 0.9;
    for (const sc of this.scans.filter((x) => x.t >= 1)) {
      const o = this.make("scan", sc.box.x + sc.box.w / 2, sc.box.y + sc.box.h / 2, 0.5);
      o.id = sc.id;
      o.img = sc.img;
      o.name = sc.name;
      o.R = o.base = Math.max(40, Math.min(Math.min(W, H) * 0.3, Math.max(sc.box.w, sc.box.h) / 2));
      o.rot = [0, 0, 0];
      o.vy = -60; // lifts off
      this.objs.push(o);
      while (this.objs.length > MAX_OBJECTS) {
        const old = this.objs.shift()!;
        for (const [hid, h] of this.holds) if (h.obj === old) this.holds.delete(hid);
      }
      this.sound("reform");
    }
    this.scans = this.scans.filter((x) => x.t < 1);

    // ---- Grabbing: every pinching hand (and the mouse) can hold one hologram ----
    const pinchers = new Map<string, Pt>();
    for (const h of hands) if (h.pinch) pinchers.set(h.id, h.pinch);
    if (mouse.down && mouse.at) pinchers.set("mouse", mouse.at);

    // Releases: a real flick throws; letting go gently just sets it down where it is.
    for (const [id, h] of [...this.holds]) {
      if (pinchers.has(id) && h.obj.broken === 0) continue;
      this.holds.delete(id);
      const stillHeld = [...this.holds.values()].some((x) => x.obj === h.obj);
      if (!stillHeld && h.obj.broken === 0) {
        const o = h.obj;
        const sp = Math.hypot(o.vx, o.vy);
        const cap = 2600;
        if (sp > cap) {
          o.vx *= cap / sp;
          o.vy *= cap / sp;
        }
        if (sp > 450) {
          this.sound("throw");
          if (o.charge >= 1) o.charged = 4; // charged throw: detonates on whatever it hits
        } else {
          o.vx *= 0.15;
          o.vy *= 0.15;
        }
        o.charge = 0;
      }
    }

    // Lock-on: each free hand targets the hologram nearest its fingertips (generous reach, sticky so it
    // doesn't flicker between two). The locked one waits for you, and a pinch grabs it.
    const aims = new Map<string, Pt>();
    for (const h of hands) aims.set(h.id, h.aim);
    if (mouse.at) aims.set("mouse", mouse.at);
    for (const id of [...this.hover.keys()]) if (!aims.has(id) || this.holds.has(id)) this.hover.delete(id);
    for (const [id, pt] of aims) {
      if (this.holds.has(id)) continue;
      const reach = (o: Obj) => o.R + Math.max(70, o.R * 0.9);
      const prev = this.hover.get(id);
      let best: Obj | null = null;
      let bestD = Infinity;
      for (const o of this.objs) {
        if (o.broken > 0 || o.form < 0.5) continue;
        const d = Math.hypot(o.x - pt.x, o.y - pt.y);
        // Edge distance, so a big hologram isn't harder to pick than a small one; the current lock gets a bonus.
        const score = d - o.R - (o === prev ? 40 : 0);
        if (d < reach(o) * (o === prev ? 1.3 : 1) && score < bestD) {
          best = o;
          bestD = score;
        }
      }
      if (best) this.hover.set(id, best);
      else this.hover.delete(id);
    }

    // New grabs: pinch while locked on (also works if you pinch first and sweep into it).
    for (const [id, pt] of pinchers) {
      if (this.holds.has(id)) continue;
      let o = this.hover.get(id);
      // Pinch your other hand anywhere while one hand holds a hologram → you've got it in both hands (resize).
      if (!o && id !== "mouse") {
        const other = [...this.holds].find(([hid, h]) => hid !== "mouse" && hid !== id && h.obj.broken === 0);
        if (other && [...this.holds.values()].filter((h) => h.obj === other[1].obj).length === 1) o = other[1].obj;
      }
      if (!o || o.broken > 0) continue;
      this.holds.set(id, { obj: o, off: { x: o.x - pt.x, y: o.y - pt.y } });
      this.hover.delete(id);
      o.vx = o.vy = 0;
      this.last = o;
      this.sound("grab");
    }

    // ---- Move held holograms ----
    const byObj = new Map<Obj, string[]>();
    for (const [id, h] of this.holds) byObj.set(h.obj, [...(byObj.get(h.obj) || []), id]);
    if (this.stretch && (byObj.get(this.stretch.obj)?.length ?? 0) < 2) this.stretch = null;
    for (const [o, ids] of byObj) {
      if (ids.length >= 2) {
        // Two hands: stretch / shrink / turn, centered between them.
        const [i1, i2] = ids;
        const p1 = pinchers.get(i1)!;
        const p2 = pinchers.get(i2)!;
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        if (!this.stretch || this.stretch.obj !== o) {
          this.stretch = { obj: o, ids: [i1, i2], d0: d, R0: o.R, a0: ang, rz0: o.rot[2] };
          this.sound("grab");
        }
        const s = this.stretch;
        o.R = Math.max(18, Math.min(Math.min(W, H) * 0.42, (s.R0 * d) / s.d0));
        o.rot[2] = s.rz0 + (ang - s.a0);
        o.spin = [0.15, 0.3, 0];
        this.moveTo(o, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, dt);
      } else {
        const h = this.holds.get(ids[0])!;
        const pt = pinchers.get(ids[0])!;
        h.off.x *= 0.9; // ease the offset away so it snaps under your fingers
        h.off.y *= 0.9;
        this.moveTo(o, pt.x + h.off.x, pt.y + h.off.y, dt);
        o.spin = [o.vy * 0.006, -o.vx * 0.006, o.spin[2]]; // moving it turns it in your hand
        // Hold it still to charge it up (about 1.2s), then throw it.
        if (o.charge < 1 && Math.hypot(o.vx, o.vy) < 160) {
          o.charge = Math.min(1, o.charge + dt / 1.2);
          if (o.charge >= 1) this.sound("charged");
        }
      }
    }

    const held = new Set(byObj.keys());
    const fists = hands.filter((h) => h.fist);
    const fistHand = fists[0];
    this.vortex = fists.length >= 2 ? { x: (fists[0].palm.x + fists[1].palm.x) / 2, y: (fists[0].palm.y + fists[1].palm.y) / 2 } : null;
    for (const o of this.objs) {
      if (o.broken > 0) {
        o.broken -= dt;
        if (o.broken <= 0) {
          o.broken = 0;
          o.form = 0;
          o.R = o.base; // re-forms at its original size
          o.vx = o.vy = 0;
          this.sound("reform");
        }
        continue;
      }
      o.form = Math.min(1, o.form + dt / 0.6);
      if (o.charged > 0) {
        o.charged = Math.max(0, o.charged - dt);
        for (let i = 0; i < 2; i++)
          this.sparks.push({ x: o.x + (Math.random() - 0.5) * o.R, y: o.y + (Math.random() - 0.5) * o.R, vx: -o.vx * 0.1 + (Math.random() - 0.5) * 80, vy: -o.vy * 0.1 + (Math.random() - 0.5) * 80, life: 0.4, max: 0.4, rgb: Math.random() < 0.5 ? "255,220,120" : o.rgb });
      }
      if (held.has(o)) continue;
      if ([...this.hover.values()].includes(o)) {
        const k = Math.pow(0.02, dt);
        o.vx *= k;
        o.vy *= k;
      }
      // Two fists (✊✊) create a gravity singularity that orbits and slingshots holograms; one fist (✊) pulls them in.
      if (this.vortex) {
        const dx = this.vortex.x - o.x;
        const dy = this.vortex.y - o.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = dx / d;
        const ny = dy / d;
        // Pull inward + strong tangential swirl so they orbit the singularity
        const pull = d > 110 ? 2400 : -600;
        const swirl = 2100;
        o.vx += (nx * pull - ny * swirl) * dt;
        o.vy += (ny * pull + nx * swirl) * dt;
        o.spin = [o.spin[0] + 4 * dt, o.spin[1] + 6 * dt, o.spin[2] + 3 * dt];
      } else if (fistHand) {
        const dx = fistHand.palm.x - o.x;
        const dy = fistHand.palm.y - o.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d > o.R + fistHand.palmR * 0.6) {
          o.vx += (dx / d) * 2200 * dt;
          o.vy += (dy / d) * 2200 * dt;
        }
        o.vx *= Math.pow(0.15, dt);
        o.vy *= Math.pow(0.15, dt);
      }
      // Open palms swat.
      for (const h of hands) {
        if (!h.open || h.pinch) continue;
        const dx = o.x - h.palm.x;
        const dy = o.y - h.palm.y;
        const d = Math.hypot(dx, dy) || 1;
        const reach = o.R + h.palmR;
        if (d >= reach) continue;
        o.x += (dx / d) * (reach - d);
        o.y += (dy / d) * (reach - d);
        const hv = Math.hypot(h.vel.x, h.vel.y);
        o.vx = (dx / d) * (250 + hv * 0.4) + h.vel.x * 0.8;
        o.vy = (dy / d) * (250 + hv * 0.4) + h.vel.y * 0.8;
        o.spin = [o.vy * 0.008, -o.vx * 0.008, (Math.random() - 0.5) * 6];
        if (hv > 300) this.sound("hit", Math.min(1, hv / 1500));
      }
      // Float: glide with air drag.
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      const drag = Math.pow(0.55, dt);
      o.vx *= drag;
      o.vy *= drag;
      // Bounce off screen edges — or shatter on a hard hit.
      const wall = (speed: number, flip: () => void) => {
        if (o.charged > 0 && speed > 200) return this.detonate(o);
        if (speed > SMASH_SPEED) return this.smash(o);
        if (speed > 150) this.sound("bounce", Math.min(1, speed / 1800));
        o.spin = [o.spin[0] + (Math.random() - 0.5) * 4, o.spin[1] + (Math.random() - 0.5) * 4, o.spin[2] + (Math.random() - 0.5) * 3];
        flip();
      };
      const r = o.R * 0.85;
      if (o.x < r) {
        o.x = r;
        wall(Math.abs(o.vx), () => (o.vx = Math.abs(o.vx) * 0.85));
      } else if (o.x > W - r) {
        o.x = W - r;
        wall(Math.abs(o.vx), () => (o.vx = -Math.abs(o.vx) * 0.85));
      }
      if (o.broken) continue;
      if (o.y < r + 60) {
        o.y = r + 60;
        wall(Math.abs(o.vy), () => (o.vy = Math.abs(o.vy) * 0.85));
      } else if (o.y > H - r) {
        o.y = H - r;
        wall(Math.abs(o.vy), () => (o.vy = -Math.abs(o.vy) * 0.85));
      }
    }

    // Holograms knock into each other (equal mass); a hard enough crash shatters the faster one.
    const live = this.objs.filter((o) => o.broken === 0 && o.form > 0.5);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (a.broken || b.broken || !this.objs.includes(a) || !this.objs.includes(b)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = (a.R + b.R) * 0.85;
        if (d >= min) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        const aHeld = held.has(a);
        const bHeld = held.has(b);
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if ((a.charged > 0 || b.charged > 0) && rel > 150) {
          this.blast(a, b, 2600, true);
          continue;
        }
        if (rel > BLAST_SPEED) {
          this.blast(a, b, rel);
          continue;
        }
        // Both in your hands and pushed together gently → they merge into one bigger hologram.
        if (aHeld && bHeld && d < (a.R + b.R) * 0.6) {
          this.merge(a, b);
          continue;
        }
        if (!aHeld) {
          a.x -= nx * push * (bHeld ? 2 : 1);
          a.y -= ny * push * (bHeld ? 2 : 1);
        }
        if (!bHeld) {
          b.x += nx * push * (aHeld ? 2 : 1);
          b.y += ny * push * (aHeld ? 2 : 1);
        }
        if (rel > 0) {
          if (!aHeld) {
            a.vx -= rel * nx * (bHeld ? 2 : 1) * 0.9;
            a.vy -= rel * ny * (bHeld ? 2 : 1) * 0.9;
          }
          if (!bHeld) {
            b.vx += rel * nx * (aHeld ? 2 : 1) * 0.9;
            b.vy += rel * ny * (aHeld ? 2 : 1) * 0.9;
          }
          if (rel > 200) this.sound("bounce", Math.min(1, rel / 1500));
        }
      }
    }

    // Spin slows back down to a calm idle turn.
    for (const o of this.objs) {
      const k = Math.pow(0.6, dt);
      if (o.kind === "helmet" || o.kind === "scan") {
        // The helmet faces you: it sways, and swings back to the front after you spin it.
        const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
        o.rot = [wrap(o.rot[0]), wrap(o.rot[1]), o.rot[2]];
        const free = !held.has(o);
        const kd = Math.pow(0.12, dt); // heavier damping so it settles instead of wobbling
        o.spin = [
          o.spin[0] * kd + (free ? -o.rot[0] * 4 * dt : 0),
          o.spin[1] * kd + (free ? (-o.rot[1] + Math.sin(this.clock * 0.8) * 0.3) * 4 * dt : 0),
          o.spin[2] * k,
        ];
      } else {
        o.spin = [o.spin[0] * k + 0.25 * (1 - k), o.spin[1] * k + 0.5 * (1 - k), o.spin[2] * k];
      }
      o.rot = [o.rot[0] + o.spin[0] * dt, o.rot[1] + o.spin[1] * dt, o.rot[2] + o.spin[2] * dt];
    }
    this.clock += dt;
  }

  private moveTo(o: Obj, x: number, y: number, dt: number) {
    const tx = o.x + (x - o.x) * 0.6;
    const ty = o.y + (y - o.y) * 0.6;
    if (dt > 0) {
      o.vx = o.vx * 0.5 + ((tx - o.x) / dt) * 0.5;
      o.vy = o.vy * 0.5 + ((ty - o.y) / dt) * 0.5;
    }
    o.x = tx;
    o.y = ty;
  }

  /** Two holograms crashed into each other: both shatter in a big explosion that shoves everything nearby. */
  private blast(a: Obj, b: Obj, rel: number, mega = false) {
    const x = (a.x * b.R + b.x * a.R) / (a.R + b.R); // contact point
    const y = (a.y * b.R + b.y * a.R) / (a.R + b.R);
    const size = a.R + b.R;
    const rgbA = a.rgb;
    const rgbB = b.rgb;
    this.smash(a);
    this.smash(b);
    this.boom(x, y, size, Math.min(1, rel / 2000), rgbA, rgbB, mega, [a, b]);
  }

  /** A charged throw hit a wall (or "explode it"): it goes off on its own. */
  private detonate(o: Obj) {
    const { x, y, R, rgb } = o;
    this.smash(o);
    this.boom(x, y, R * 2, 1, rgb, "255,220,120", true, [o]);
  }

  /** Explosion effects: sparks, shockwave rings, flash, shake, and knockback on everything nearby. */
  private boom(x: number, y: number, size: number, power: number, rgbA: string, rgbB: string, mega: boolean, skip: Obj[]) {
    const a = { rgb: rgbA };
    const b = { rgb: rgbB };
    const n = mega ? 200 : 110;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = 300 + Math.random() * 1300 * (0.6 + power) * (mega ? 1.4 : 1);
      const life = 0.6 + Math.random() * 0.9;
      const rgb = Math.random() < 0.3 ? "255,255,255" : Math.random() < 0.5 ? "255,190,90" : Math.random() < 0.5 ? a.rgb : b.rgb;
      this.sparks.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life, max: life, rgb });
    }
    this.waves.push({ x, y, r: size * 0.3, life: 1, rgb: "255,255,255" }, { x, y, r: size * 0.15, life: 1.3, rgb: a.rgb }, { x, y, r: 0, life: 1.6, rgb: b.rgb });
    if (mega) this.waves.push({ x, y, r: size * 0.5, life: 1.9, rgb: "255,200,90" });
    this.flash = mega ? 1 : 0.5 + 0.4 * power;
    this.shake = mega ? 0.9 : 0.35 + 0.3 * power;
    // Shockwave knocks the other holograms away.
    const reach = size * (mega ? 5 : 3.5);
    for (const o of this.objs) {
      if (skip.includes(o) || o.broken) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > reach) continue;
      const k = (1 - d / reach) * (900 + 900 * power);
      o.vx += (dx / d) * k;
      o.vy += (dy / d) * k;
      o.spin = [o.spin[0] + (Math.random() - 0.5) * 8, o.spin[1] + (Math.random() - 0.5) * 8, o.spin[2]];
    }
    this.sound("blast", mega ? 1.4 : power);
    navigator.vibrate?.([80, 40, 120]);
  }

  /** Two held holograms pushed together slowly become one bigger one (they split apart again if it blows up). */
  private merge(a: Obj, b: Obj) {
    const keep = a.R >= b.R ? a : b;
    const gone = keep === a ? b : a;
    keep.R = Math.min(Math.min(this.W, this.H) * 0.42, Math.hypot(keep.R, gone.R) * 1.05);
    keep.absorbed = [...(keep.absorbed || []), gone, ...(gone.absorbed || [])];
    gone.absorbed = [];
    keep.charge = 0;
    this.objs = this.objs.filter((o) => o !== gone);
    for (const h of this.holds.values()) if (h.obj === gone) h.obj = keep;
    for (const [id, o] of this.hover) if (o === gone) this.hover.delete(id);
    if (this.stretch && (this.stretch.obj === gone || this.stretch.obj === keep)) this.stretch = null;
    if (this.last === gone) this.last = keep;
    this.waves.push({ x: keep.x, y: keep.y, r: keep.R * 0.5, life: 0.8, rgb: gone.rgb });
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = 100 + Math.random() * 300;
      this.sparks.push({ x: keep.x, y: keep.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: 0.6, max: 0.6, rgb: Math.random() < 0.5 ? gone.rgb : keep.rgb });
    }
    this.sound("merge");
  }

  /** Voice: "make it red", "bigger", "blow it up", "explode everything". Acts on the held / last-touched hologram. */
  private command(q: HoloRequest) {
    if (q.op === "explode" && q.all) {
      for (const o of [...this.objs]) if (!o.broken) this.detonate(o);
      return;
    }
    const held = this.holds.values().next().value?.obj;
    const o =
      held ||
      (this.last && this.objs.includes(this.last) && !this.last.broken ? this.last : null) ||
      [...this.objs].filter((x) => !x.broken).sort((p, r) => Math.hypot(p.x - this.W / 2, p.y - this.H / 2) - Math.hypot(r.x - this.W / 2, r.y - this.H / 2))[0];
    if (!o) return;
    this.last = o;
    if (q.op === "color") {
      const rgb = HOLO_COLORS[q.color.toLowerCase()];
      if (rgb) {
        o.rgb = rgb;
        this.waves.push({ x: o.x, y: o.y, r: o.R * 0.6, life: 0.7, rgb });
        this.sound("reform");
      }
    } else if (q.op === "scale") {
      o.R = Math.max(18, Math.min(Math.min(this.W, this.H) * 0.42, o.R * q.factor));
      this.sound("grab");
    } else if (q.op === "explode") this.detonate(o);
  }

  /** Shatter into sparks and wireframe shards; it re-forms after REFORM_SECONDS. */
  private smash(o: Obj) {
    if (o.broken) return;
    const speed = Math.hypot(o.vx, o.vy);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 150 + Math.random() * 750;
      const life = 0.5 + Math.random() * 0.7;
      this.sparks.push({ x: o.x, y: o.y, vx: Math.cos(a) * v + o.vx * 0.2, vy: Math.sin(a) * v + o.vy * 0.2, life, max: life, rgb: Math.random() < 0.25 ? "255,255,255" : o.rgb });
    }
    if (o.img) {
      // A scanned object breaks into pieces of its own picture.
      const n = 4;
      const { w, h } = this.scanSize(o);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const cx = o.x - w / 2 + ((i + 0.5) * w) / n;
          const cy = o.y - h / 2 + ((j + 0.5) * h) / n;
          const dx = cx - o.x;
          const dy = cy - o.y;
          const d = Math.hypot(dx, dy) || 1;
          const v = 200 + Math.random() * 450;
          this.shards.push({
            x: cx,
            y: cy,
            vx: (dx / d) * v + o.vx * 0.25,
            vy: (dy / d) * v + o.vy * 0.25,
            a: { x: 0, y: 0 },
            b: { x: 0, y: 0 },
            ang: 0,
            va: (Math.random() - 0.5) * 10,
            life: 1 + Math.random() * 0.4,
            rgb: o.rgb,
            tile: { img: o.img, sx: (i * o.img.width) / n, sy: (j * o.img.height) / n, sw: o.img.width / n, sh: o.img.height / n, w: w / n, h: h / n },
          });
        }
    }
    // Shards: pieces of the actual wireframe flying apart.
    const segs = this.segments(o).filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 26)) === 0);
    for (const [p, q] of segs) {
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const dx = mx - o.x;
      const dy = my - o.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = 200 + Math.random() * 500;
      this.shards.push({
        x: mx,
        y: my,
        vx: (dx / d) * v + o.vx * 0.25,
        vy: (dy / d) * v + o.vy * 0.25,
        a: { x: p.x - mx, y: p.y - my },
        b: { x: q.x - mx, y: q.y - my },
        ang: 0,
        va: (Math.random() - 0.5) * 14,
        life: 0.9 + Math.random() * 0.4,
        rgb: o.rgb,
      });
    }
    o.broken = REFORM_SECONDS;
    o.vx = o.vy = 0;
    // Re-form a little inside the screen.
    o.x = Math.max(o.R + 20, Math.min(this.W - o.R - 20, o.x));
    o.y = Math.max(o.R + 80, Math.min(this.H - o.R - 20, o.y));
    for (const [id, h] of this.holds) if (h.obj === o) this.holds.delete(id);
    if (this.stretch?.obj === o) this.stretch = null;
    o.charge = 0;
    o.charged = 0;
    // A merged hologram splits back into the ones it swallowed; they re-form around it at their own size.
    for (const g of o.absorbed || []) {
      const ang = Math.random() * Math.PI * 2;
      g.x = Math.max(g.base + 20, Math.min(this.W - g.base - 20, o.x + Math.cos(ang) * o.base * 1.8));
      g.y = Math.max(g.base + 80, Math.min(this.H - g.base - 20, o.y + Math.sin(ang) * o.base * 1.8));
      g.R = g.base;
      g.vx = g.vy = 0;
      g.charge = g.charged = 0;
      g.broken = REFORM_SECONDS;
      g.form = 0;
      this.objs.push(g);
    }
    o.absorbed = [];
    this.sound("smash", Math.min(1, speed / 2600));
    navigator.vibrate?.(60);
  }

  private updateEffects(dt: number) {
    for (const w of this.waves) {
      w.r += (900 + w.r * 2) * dt;
      w.life -= dt * 1.4;
    }
    this.waves = this.waves.filter((w) => w.life > 0);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt);
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.3, dt);
      s.vy *= Math.pow(0.3, dt);
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const s of this.shards) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.4, dt);
      s.vy *= Math.pow(0.4, dt);
      s.ang += s.va * dt;
      s.life -= dt;
    }
    this.shards = this.shards.filter((s) => s.life > 0);
  }

  /** On-screen size of a scanned picture (fits a 2R box, keeps its shape). */
  private scanSize(o: Obj) {
    const a = o.img ? o.img.width / o.img.height : 1;
    return a >= 1 ? { w: o.R * 2, h: (o.R * 2) / a } : { w: o.R * 2 * a, h: o.R * 2 };
  }

  /** Projected 2D line segments of a hologram, with depth. */
  private segments(o: Obj, scale = 1): [Pt & { z: number }, Pt & { z: number }][] {
    const lines = SHAPES[o.kind];
    if (o.img) {
      // Scanned picture: its outline frame (used for wireframe shards).
      const { w, h } = this.scanSize(o);
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([sx, sy]) => ({ x: o.x + (sx * w) / 2, y: o.y + (sy * h) / 2, z: 0 }));
      return c.slice(1).map((p, i) => [c[i], p] as [Pt & { z: number }, Pt & { z: number }]);
    }
    if (!lines) {
      // Reactor: a few rings' worth of arcs for shards.
      const out: [Pt & { z: number }, Pt & { z: number }][] = [];
      for (const rr of [1, 0.74, 0.5])
        for (let i = 0; i < 10; i++) {
          const a1 = (i / 10) * Math.PI * 2;
          const a2 = a1 + 0.5;
          out.push([
            { x: o.x + Math.cos(a1) * o.R * rr, y: o.y + Math.sin(a1) * o.R * rr, z: 0 },
            { x: o.x + Math.cos(a2) * o.R * rr, y: o.y + Math.sin(a2) * o.R * rr, z: 0 },
          ]);
        }
      return out;
    }
    const out: [Pt & { z: number }, Pt & { z: number }][] = [];
    const R = o.R * scale;
    for (const line of lines) {
      const pts = line.map((p) => {
        const [x, y, z] = rotate(p, o.rot);
        const k = 3 / (3 + z);
        return { x: o.x + x * R * k, y: o.y + y * R * k, z };
      });
      for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]]);
    }
    return out;
  }

  draw(ctx: CanvasRenderingContext2D, t: number, status: string) {
    ctx.save();
    if (this.shake > 0) {
      const m = 18 * this.shake;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    this.drawScene(ctx, t, status);
    // Blast shockwaves + flash
    for (const w of this.waves) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, w.life);
      ctx.strokeStyle = `rgba(${w.rgb},1)`;
      ctx.shadowColor = `rgba(${w.rgb},1)`;
      ctx.shadowBlur = 30;
      ctx.lineWidth = 2 + 10 * w.life;
      ctx.beginPath();
      ctx.arc(w.x, w.y, Math.max(1, w.r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    if (this.flash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255,240,220,${this.flash * 0.55})`;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    }
  }

  private drawScene(ctx: CanvasRenderingContext2D, t: number, status: string) {
    for (const o of this.objs) {
      if (o.broken > 0) {
        // Faint ghost outline where it will re-form, pulsing faster as it gets close.
        const k = 1 - o.broken / REFORM_SECONDS;
        ctx.save();
        ctx.strokeStyle = `rgba(${o.rgb},${0.1 + 0.25 * k * (0.5 + 0.5 * Math.sin(t * (6 + k * 20)))})`;
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.base * (0.4 + 0.6 * k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const isHeld = [...this.holds.values()].some((h) => h.obj === o);
      const stretching = this.stretch?.obj === o;
      const c = (a: number) => `rgba(${o.rgb},${a})`;
      const grow = o.form < 1 ? Math.max(0.01, easeOutBack(o.form)) : 1;
      ctx.save();
      ctx.shadowColor = c(1);
      ctx.shadowBlur = isHeld ? 30 : 16;
      ctx.lineCap = "round";
      if (o.img) {
        const { w, h } = this.scanSize(o);
        ctx.translate(o.x, o.y);
        ctx.rotate(o.rot[2]);
        // Turning it in your hand flips it like a card in 3D.
        const flip = Math.cos(o.rot[1]);
        ctx.scale(Math.sign(flip || 1) * Math.max(0.12, Math.abs(flip)) * grow, Math.max(0.12, Math.abs(Math.cos(o.rot[0]))) * grow);
        ctx.globalAlpha = isHeld ? 1 : 0.92;
        ctx.drawImage(o.img, -w / 2, -h / 2, w, h); // the glow follows the object's outline
      } else if (o.kind === "reactor") {
        ctx.translate(o.x, o.y);
        ctx.rotate(o.rot[2] + o.rot[1] * 0.3);
        ctx.scale((0.55 + 0.45 * Math.abs(Math.cos(o.rot[1]))) * grow, grow);
        drawReactor(ctx, 0, 0, o.R, t, status, c, isHeld ? 1 : 0);
      } else {
        const front = new Path2D();
        const back = new Path2D();
        for (const [p, q] of this.segments(o, grow)) {
          const path = (p.z + q.z) / 2 > 0.15 ? back : front;
          path.moveTo(p.x, p.y);
          path.lineTo(q.x, q.y);
        }
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = c(isHeld ? 0.45 : 0.28);
        ctx.stroke(back);
        ctx.lineWidth = isHeld ? 2.6 : 2;
        ctx.strokeStyle = c(isHeld ? 1 : 0.9);
        ctx.stroke(front);
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.R * grow);
        g.addColorStop(0, c(isHeld ? 0.28 : 0.14));
        g.addColorStop(1, c(0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.R * grow, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Materialize ring while forming
      if (o.form < 1) {
        ctx.save();
        ctx.strokeStyle = c(1 - o.form);
        ctx.lineWidth = 3;
        ctx.shadowColor = c(1);
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(o.x, o.y, Math.max(1, o.R * (0.3 + o.form * 1.4)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Charge-up ring while you hold it still; a charged hologram crackles gold.
      const chargedNow = (isHeld && o.charge >= 1) || o.charged > 0;
      if ((isHeld && o.charge > 0.05) || o.charged > 0) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(255,210,110,1)";
        ctx.shadowBlur = chargedNow ? 30 : 14;
        ctx.strokeStyle = chargedNow ? `rgba(255,225,140,${0.7 + 0.3 * Math.sin(t * 25)})` : "rgba(255,210,110,0.9)";
        ctx.lineWidth = chargedNow ? 5 : 3;
        ctx.beginPath();
        const rr = o.R * 1.18;
        if (chargedNow) ctx.arc(o.x, o.y, rr + Math.sin(t * 30) * 3, 0, Math.PI * 2);
        else ctx.arc(o.x, o.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o.charge);
        ctx.stroke();
        if (chargedNow && isHeld) {
          ctx.font = "bold 11px Consolas, 'Courier New', monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffe08a";
          ctx.fillText("CHARGED — THROW IT", o.x, o.y - o.R * 1.18 - 12);
        }
        ctx.restore();
      }

      // Lock-on ring: shows what a pinch will grab.
      const locked = !isHeld && [...this.hover.values()].includes(o);
      if (locked) {
        ctx.save();
        ctx.strokeStyle = c(0.95);
        ctx.shadowColor = c(1);
        ctx.shadowBlur = 14;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.lineDashOffset = -t * 40;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.R * 1.35 + Math.sin(t * 6) * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "bold 10px Consolas, 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("PINCH TO GRAB", o.x, o.y - o.R * 1.35 - 10);
        ctx.restore();
      }

      // Label + grab brackets
      ctx.save();
      ctx.font = `${isHeld ? "bold " : ""}10px Consolas, 'Courier New', monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = c(isHeld ? 1 : 0.6);
      const merged = o.absorbed?.length ? ` ×${o.absorbed.length + 1}` : "";
      const tag = stretching ? `${o.name}${merged} // SCALE ${Math.round((o.R / (this.stretch!.R0 || o.R)) * 100)}%` : isHeld ? `${o.name}${merged} // ${o.charge > 0.05 && o.charge < 1 ? "CHARGING…" : "PINCH OTHER HAND TO RESIZE"}` : o.name + merged;
      ctx.fillText(tag, o.x, o.y + o.R * 1.25 + 12);
      if (isHeld) {
        const r = o.R * 1.3;
        const L = r * 0.35;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath();
          ctx.moveTo(o.x + sx * r, o.y + sy * (r - L));
          ctx.lineTo(o.x + sx * r, o.y + sy * r);
          ctx.lineTo(o.x + sx * (r - L), o.y + sy * r);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Stretch beam between the two hands
    if (this.stretch) {
      const ids = this.stretch.ids;
      const o = this.stretch.obj;
      ctx.save();
      ctx.strokeStyle = `rgba(${o.rgb},0.6)`;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      const r = o.R * 1.3;
      ctx.beginPath();
      ctx.moveTo(o.x - r, o.y);
      ctx.lineTo(o.x + r, o.y);
      ctx.stroke();
      ctx.restore();
      void ids;
    }

    // Two-fist Gravity Vortex singularity
    if (this.vortex) {
      const { x, y } = this.vortex;
      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = "rgba(170,110,255,1)";
      ctx.shadowBlur = 28;
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = i === 0 ? "rgba(63,216,255,0.9)" : "rgba(180,120,255,0.75)";
        ctx.lineWidth = 2.5 - i * 0.5;
        ctx.setLineDash([12, 8]);
        ctx.lineDashOffset = (i % 2 ? 1 : -1) * t * 90;
        ctx.beginPath();
        ctx.arc(0, 0, 28 + i * 22, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(0, 0, 7 + Math.sin(t * 20) * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "bold 11px Consolas, 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#e0c8ff";
      ctx.fillText("GRAVITY SINGULARITY · RELEASE TO SLINGSHOT", 0, -86);
      ctx.restore();
    }

    // Smash effects
    ctx.save();
    ctx.lineCap = "round";
    for (const s of this.shards) {
      const k = Math.min(1, s.life * 1.5);
      if (s.tile) {
        const tl = s.tile;
        ctx.save();
        ctx.globalAlpha = k;
        ctx.translate(s.x, s.y);
        ctx.rotate(s.ang);
        ctx.shadowColor = `rgba(${s.rgb},1)`;
        ctx.shadowBlur = 12;
        ctx.drawImage(tl.img, tl.sx, tl.sy, tl.sw, tl.sh, -tl.w / 2, -tl.h / 2, tl.w, tl.h);
        ctx.restore();
        continue;
      }
      const cs = Math.cos(s.ang);
      const sn = Math.sin(s.ang);
      ctx.strokeStyle = `rgba(${s.rgb},${k})`;
      ctx.shadowColor = `rgba(${s.rgb},1)`;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x + s.a.x * cs - s.a.y * sn, s.y + s.a.x * sn + s.a.y * cs);
      ctx.lineTo(s.x + s.b.x * cs - s.b.y * sn, s.y + s.b.x * sn + s.b.y * cs);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (const s of this.sparks) {
      ctx.fillStyle = `rgba(${s.rgb},${s.life / s.max})`;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    ctx.restore();

    // Scan sweeps: brackets lock on, a bright line sweeps down, the picture builds up behind it.
    for (const sc of this.scans) {
      const { x, y, w, h } = sc.box;
      const p = Math.min(1, sc.t);
      ctx.save();
      ctx.shadowColor = "rgba(63,216,255,1)";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = "rgba(160,240,255,0.95)";
      ctx.lineWidth = 2;
      const L = Math.min(w, h) * 0.22;
      for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + dy * L);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + dx * L, cy);
        ctx.stroke();
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h * p);
      ctx.clip();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sc.img, x, y, w, h);
      ctx.restore();
      ctx.fillStyle = "rgba(220,250,255,0.9)";
      ctx.fillRect(x, y + h * p - 1.5, w, 3);
      ctx.font = "bold 11px Consolas, 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(160,240,255,1)";
      ctx.fillText(`SCANNING ${Math.round(p * 100)}%`, x, y - 8);
      ctx.restore();
    }
  }

  private sound(kind: "grab" | "throw" | "bounce" | "hit" | "smash" | "blast" | "reform" | "scan" | "charged" | "merge", vol = 1) {
    try {
      this.audio ||= new AudioContext();
      const ac = this.audio;
      if (ac.state === "suspended") ac.resume();
      const now = ac.currentTime;
      const tone = (type: OscillatorType, f1: number, f2: number, dur: number, v: number, delay = 0) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f1, now + delay);
        o.frequency.exponentialRampToValueAtTime(f2, now + delay + dur);
        g.gain.setValueAtTime(v, now + delay);
        g.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
        o.connect(g).connect(ac.destination);
        o.start(now + delay);
        o.stop(now + delay + dur);
      };
      if (kind === "grab") tone("sine", 500, 1100, 0.12, 0.08);
      if (kind === "throw") tone("sine", 900, 250, 0.25, 0.06);
      if (kind === "bounce") tone("triangle", 420 + Math.random() * 120, 300, 0.1, 0.06 * vol + 0.01);
      if (kind === "hit") tone("square", 260, 120, 0.12, 0.05 * vol + 0.01);
      if (kind === "smash") {
        const buf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
        const src = ac.createBufferSource();
        const g = ac.createGain();
        src.buffer = buf;
        g.gain.value = 0.2 + 0.2 * vol;
        src.connect(g).connect(ac.destination);
        src.start();
        tone("square", 1800, 200, 0.3, 0.05);
      }
      if (kind === "blast") {
        // Deep boom + crackle
        const len = ac.sampleRate * 1.2;
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
        const src = ac.createBufferSource();
        const lp = ac.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(1800, now);
        lp.frequency.exponentialRampToValueAtTime(120, now + 1);
        const g = ac.createGain();
        g.gain.value = 0.5 + 0.3 * vol;
        src.buffer = buf;
        src.connect(lp).connect(g).connect(ac.destination);
        src.start();
        tone("sine", 140, 35, 0.9, 0.35);
        tone("square", 2200, 300, 0.25, 0.04);
      }
      if (kind === "charged") {
        tone("sawtooth", 200, 1600, 0.35, 0.04);
        tone("sine", 1600, 1650, 0.4, 0.06, 0.3);
      }
      if (kind === "merge") [330, 495, 660].forEach((f, i) => tone("sine", f, f * 1.5, 0.25, 0.06, i * 0.05));
      if (kind === "scan") tone("sawtooth", 300, 1400, 0.8, 0.03);
      if (kind === "reform") [520, 780, 1040].forEach((f, i) => tone("sine", f, f * 1.01, 0.18, 0.05, i * 0.07));
    } catch {}
  }
}

/** The arc reactor hologram. */
export function drawReactor(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, t: number, status: string, c: (a: number) => string, glow: number) {
  const pulse = status === "speaking" ? 0.9 + 0.15 * Math.sin(t * 18) : status === "listening" ? 0.92 + 0.08 * Math.sin(t * 6) : 0.95 + 0.05 * Math.sin(t * 1.6);
  const spin = status === "thinking" ? 4 : 1;
  ctx.save();
  ctx.shadowColor = c(1);
  ctx.shadowBlur = 20 + glow * 25;

  ctx.strokeStyle = c(0.55 + glow * 0.4);
  ctx.lineWidth = 2;
  ctx.setLineDash([R * 0.12, R * 0.08]);
  ctx.beginPath();
  ctx.arc(x, y, R, t * 0.3 * spin, t * 0.3 * spin + Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth = R * 0.09;
  for (let k = 0; k < 10; k++) {
    const a = -t * 0.8 * spin + (k * Math.PI * 2) / 10;
    ctx.strokeStyle = c(k % 2 ? 0.35 : 0.85);
    ctx.beginPath();
    ctx.arc(x, y, R * 0.74, a, a + 0.45);
    ctx.stroke();
  }

  ctx.lineWidth = 1;
  ctx.strokeStyle = c(0.8);
  ctx.beginPath();
  ctx.arc(x, y, R * 0.52, t * 1.2 * spin, t * 1.2 * spin + Math.PI * 1.5);
  ctx.stroke();

  const core = ctx.createRadialGradient(x, y, 0, x, y, R * 0.42 * pulse);
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.35, c(1));
  core.addColorStop(1, c(0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, R * 0.42 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
