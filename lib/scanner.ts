// Scan a real object out of the camera picture: you point at it, MediaPipe's interactive segmenter
// ("magic touch") finds the object under that point, and we cut it out with a soft transparent edge.

import type { InteractiveSegmenter } from "@mediapipe/tasks-vision";

let segmenter: Promise<InteractiveSegmenter> | null = null;

function load(): Promise<InteractiveSegmenter> {
  segmenter ||= (async () => {
    const { FilesetResolver, InteractiveSegmenter } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks("/mediapipe");
    const make = (delegate: "GPU" | "CPU") =>
      InteractiveSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/mediapipe/magic_touch.tflite", delegate },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    return make("GPU").catch(() => make("CPU"));
  })();
  segmenter.catch(() => (segmenter = null)); // allow a retry after a failed load
  return segmenter;
}

export type Scan = {
  cutout: HTMLCanvasElement; // the object only, transparent around it
  box: { x: number; y: number; w: number; h: number }; // where it was, in video pixels (unmirrored)
};

/**
 * Cut out the object at (vx, vy) — normalized 0..1 coordinates in the unmirrored video frame.
 * Returns null when nothing sensible was found (too tiny, or basically the whole picture).
 */
export async function scanAt(video: HTMLVideoElement | HTMLCanvasElement, vx: number, vy: number, mirror: boolean): Promise<Scan | null> {
  const seg = await load();
  const vw = video instanceof HTMLVideoElement ? video.videoWidth : video.width;
  const vh = video instanceof HTMLVideoElement ? video.videoHeight : video.height;
  if (!vw || !vh) return null;

  // Freeze the frame
  const frame = document.createElement("canvas");
  frame.width = vw;
  frame.height = vh;
  const fctx = frame.getContext("2d", { willReadFrequently: true })!;
  fctx.drawImage(video, 0, 0, vw, vh);

  const res = seg.segment(frame, { keypoint: { x: Math.min(0.999, Math.max(0, vx)), y: Math.min(0.999, Math.max(0, vy)) } });
  try {
    const mask = res.confidenceMasks?.[0];
    if (!mask) return null;
    const conf = mask.getAsFloat32Array();
    const mw = mask.width;
    const mh = mask.height;

    // Bounding box of the object
    let x0 = mw, y0 = mh, x1 = -1, y1 = -1, area = 0;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (conf[y * mw + x] > 0.5) {
          area++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const frac = area / (mw * mh);
    if (x1 < 0 || frac < 0.004 || frac > 0.75) return null;

    // Mask coords → video pixels, with a little padding
    const sx = vw / mw;
    const sy = vh / mh;
    const pad = 6;
    const bx = Math.max(0, Math.floor(x0 * sx) - pad);
    const by = Math.max(0, Math.floor(y0 * sy) - pad);
    const bw = Math.min(vw - bx, Math.ceil((x1 - x0 + 1) * sx) + pad * 2);
    const bh = Math.min(vh - by, Math.ceil((y1 - y0 + 1) * sy) + pad * 2);

    // Copy the pixels and make everything outside the object transparent (soft edge).
    const img = fctx.getImageData(bx, by, bw, bh);
    const d = img.data;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const mx = Math.min(mw - 1, Math.floor((bx + x) / sx));
        const my = Math.min(mh - 1, Math.floor((by + y) / sy));
        const c = conf[my * mw + mx];
        d[(y * bw + x) * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (c - 0.35) / 0.3)));
      }
    }
    const cut = document.createElement("canvas");
    cut.width = bw;
    cut.height = bh;
    const cctx = cut.getContext("2d")!;
    cctx.putImageData(img, 0, 0);
    if (mirror) {
      // Match what you saw on the mirrored (selfie) screen.
      const flipped = document.createElement("canvas");
      flipped.width = bw;
      flipped.height = bh;
      const f = flipped.getContext("2d")!;
      f.translate(bw, 0);
      f.scale(-1, 1);
      f.drawImage(cut, 0, 0);
      return { cutout: flipped, box: { x: bx, y: by, w: bw, h: bh } };
    }
    return { cutout: cut, box: { x: bx, y: by, w: bw, h: bh } };
  } finally {
    res.close();
  }
}

/** Small JPEG of a cutout on black, for asking Claude what it is. */
export function thumbnail(cutout: HTMLCanvasElement, max = 384): string {
  const k = Math.min(1, max / Math.max(cutout.width, cutout.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(cutout.width * k));
  c.height = Math.max(1, Math.round(cutout.height * k));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(cutout, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
