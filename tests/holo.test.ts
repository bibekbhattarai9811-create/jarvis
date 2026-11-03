// HOLO playground physics with simulated hands: grab, resize, merge, blast, charge-up throw.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { HandInput, HoloPlayground as PG } from "@/lib/holoPlayground";

/* eslint-disable @typescript-eslint/no-explicit-any */
let HoloPlayground: typeof PG;
let p: any;
const W = 1200;
const H = 800;
const dt = 1 / 30;
const none = { at: null, down: false };
const step = (hands: HandInput[] = [], n = 1) => {
  for (let k = 0; k < n; k++) p.update(dt, W, H, hands, none);
};
const hand = (id: string, at: { x: number; y: number }, pinch: boolean): HandInput => ({ id, aim: at, pinch: pinch ? at : null, palm: at, palmR: 60, vel: { x: 0, y: 0 }, fist: false, open: false });

beforeAll(async () => {
  (globalThis as any).navigator ??= {};
  ({ HoloPlayground } = await import("@/lib/holoPlayground"));
});
beforeEach(() => {
  p = new HoloPlayground();
  step([], 40); // let the starting holograms appear
});

describe("HOLO playground", () => {
  it("locks on from outside the old grab zone and grabs with a pinch", () => {
    const o = p.objs[0];
    const at = { x: o.x + o.R + 50, y: o.y };
    step([hand("R", at, false)]);
    expect(p.hover.get("R")).toBe(o);
    step([hand("R", at, true)]);
    expect(p.grabbedName).toBe(o.name);
  });

  it("resizes with a second hand pinching anywhere", () => {
    const o = p.objs[0];
    let r = { x: o.x, y: o.y };
    let l = { x: r.x - 120, y: r.y + 250 };
    step([hand("R", r, false)]);
    step([hand("R", r, true)]);
    const R0 = o.R;
    step([hand("R", r, true), hand("L", l, true)], 3);
    for (let k = 0; k < 20; k++) {
      l = { x: l.x - 12, y: l.y };
      r = { x: r.x + 12, y: r.y };
      step([hand("R", r, true), hand("L", l, true)]);
    }
    expect(o.R).toBeGreaterThan(R0 * 1.5);
  });

  it("blows up two orbs that crash hard, then re-forms them at their original size", () => {
    const [a, b] = [p.objs[0], p.objs[1]];
    a.R *= 2;
    a.x = 400;
    b.x = 400 + a.R + b.R - 5;
    a.y = b.y = 400;
    a.vx = 900;
    b.vx = -900;
    step();
    expect(a.broken).toBeGreaterThan(0);
    expect(b.broken).toBeGreaterThan(0);
    step([], 70);
    expect(Math.round(a.R)).toBe(Math.round(a.base));
  });

  it("merges two held orbs pushed together slowly, and splits them again on a blast", () => {
    const [a, b] = [p.objs[1], p.objs[3]];
    a.x = 450;
    b.x = 750;
    a.y = b.y = 400;
    a.vx = a.vy = b.vx = b.vy = 0;
    let ha = { x: a.x, y: a.y };
    let hb = { x: b.x, y: b.y };
    step([hand("L", ha, false), hand("R", hb, false)]);
    step([hand("L", ha, true), hand("R", hb, true)]);
    const count = p.objs.length;
    for (let k = 0; k < 60 && p.objs.length === count; k++) {
      ha = { x: ha.x + 4, y: ha.y };
      hb = { x: hb.x - 4, y: hb.y };
      step([hand("L", ha, true), hand("R", hb, true)]);
    }
    expect(p.objs.length).toBe(count - 1);
    const keep = p.objs.includes(a) ? a : b;
    expect(keep.absorbed).toHaveLength(1);
    p.detonate(keep);
    expect(p.objs.includes(a) && p.objs.includes(b)).toBe(true);
  });

  it("charges an orb held still, and a charged throw detonates on impact", () => {
    const c = p.objs[0];
    c.x = 900;
    c.y = 450;
    p.objs.filter((o: any) => o !== c).forEach((o: any, k: number) => Object.assign(o, { x: 100 + k * 90, y: 150, vx: 0, vy: 0 }));
    let h = { x: c.x, y: c.y };
    step([hand("R", h, false)]);
    step([hand("R", h, true)], 45);
    expect(c.charge).toBe(1);
    for (let k = 0; k < 4; k++) {
      h = { x: h.x - 40, y: h.y };
      step([hand("R", h, true)]);
    }
    step([hand("R", h, false)]);
    expect(c.charged).toBeGreaterThan(0);
    for (let k = 0; k < 90 && !c.broken; k++) step();
    expect(c.broken).toBeGreaterThan(0);
  });
});
