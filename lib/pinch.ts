// Pinch cut-offs for hand tracking, measured as (thumb tip ↔ index tip) ÷ palm length.
// "Train my hand" measures your relaxed open hand and your pinch, and sets the cut-offs between them.

export type PinchCfg = { on: number; off: number; trained: boolean };

const KEY = "holo-pinch-v2";
export const DEFAULT_PINCH: PinchCfg = { on: 0.35, off: 0.55, trained: false };

export function loadPinch(): PinchCfg {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && c.on > 0.05 && c.off > c.on && c.off < 2) return { on: c.on, off: c.off, trained: true };
  } catch {}
  return { ...DEFAULT_PINCH };
}

export function savePinch(c: PinchCfg | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify({ on: c.on, off: c.off }));
    else localStorage.removeItem(KEY);
  } catch {}
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Cut-offs from your samples: grab 30% of the way up from your pinch toward your open hand, let go at 60%.
 * Medians ignore the odd bad frame. Returns null if open and pinch weren't clearly different (try again).
 */
export function pinchFromSamples(open: number[], pinch: number[]): PinchCfg | null {
  if (open.length < 6 || pinch.length < 6) return null;
  const o = median(open);
  const p = median(pinch);
  if (o - p < 0.15) return null;
  return { on: p + (o - p) * 0.3, off: p + (o - p) * 0.6, trained: true };
}

/** 0 = hand open, 1 = at the grab point: drives the little meter at your fingertips. */
export const pinchProgress = (gap: number, c: PinchCfg) => Math.max(0, Math.min(1, (c.off - gap) / (c.off - c.on)));
