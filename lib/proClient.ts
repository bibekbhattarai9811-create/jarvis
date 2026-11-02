// Browser helpers for the Inspect Pro pages.

export function pin(): string {
  try {
    return localStorage.getItem("jarvis-pin") || "";
  } catch {
    return "";
  }
}

/** Call a Jarvis API with the passcode; throws with a readable message on failure. */
export async function api<T = unknown>(path: string, init: RequestInit & { body?: string } = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", "x-jarvis-pin": pin(), ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Open Jarvis once on this device and enter your passcode first.");
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status}).`);
  return data as T;
}

/** Shrink a photo to max 1600 px and return it as a JPEG data URL (keeps uploads fast, AI sees enough detail). */
export async function toJpeg(file: File, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.85);
}

export const photoUrl = (reportId: string, photoId: string) => `/api/pro/photo?r=${reportId}&p=${photoId}`;

export const KIND_LABEL: Record<string, string> = { "move-in": "Move-in", "move-out": "Move-out", general: "General" };
