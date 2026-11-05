// "Train my hand": cut-offs land between your pinch and your open hand; bad samples are rejected.
import { describe, expect, it } from "vitest";
import { pinchFromSamples, pinchProgress } from "@/lib/pinch";

const around = (v: number, n = 40) => Array.from({ length: n }, (_, i) => v + ((i % 5) - 2) * 0.01);

describe("pinch training", () => {
  it("puts the grab point near the pinch and the release point further out", () => {
    const cfg = pinchFromSamples(around(1.0), around(0.2))!;
    expect(cfg.on).toBeCloseTo(0.44, 2);
    expect(cfg.off).toBeCloseTo(0.68, 2);
    expect(cfg.off).toBeGreaterThan(cfg.on);
  });

  it("ignores a few bad frames (uses the median)", () => {
    const open = [...around(1.0), 0.05, 0.05, 3];
    expect(pinchFromSamples(open, around(0.2))!.on).toBeCloseTo(0.44, 1);
  });

  it("refuses when open and pinch look the same, or there are too few samples", () => {
    expect(pinchFromSamples(around(0.5), around(0.45))).toBeNull();
    expect(pinchFromSamples(around(1, 5), around(0.2, 5))).toBeNull();
  });

  it("meter goes from 0 (open) to 1 (grab point)", () => {
    const c = { on: 0.3, off: 0.6, trained: true };
    expect(pinchProgress(1, c)).toBe(0);
    expect(pinchProgress(0.45, c)).toBeCloseTo(0.5);
    expect(pinchProgress(0.1, c)).toBe(1);
  });
});
