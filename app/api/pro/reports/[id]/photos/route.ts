import { authed, denied, jpegFromDataUrl, json } from "@/lib/auth";
import { addPhoto, deletePhoto, retryPhoto } from "@/lib/pro";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Add a photo to a room: { room, image: "data:image/jpeg;base64,..." }. It's analyzed in the background. */
export async function POST(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  const { room, image } = await req.json().catch(() => ({}));
  const jpeg = jpegFromDataUrl(image);
  if (!jpeg || typeof room !== "string" || !room.trim()) return json(req, { error: "Send a room and a JPEG photo." }, 400);
  try {
    return json(req, await addPhoto(id, room.trim().slice(0, 40), jpeg));
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}

/** Retry a failed analysis: { room, photo }. */
export async function PUT(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  const { room, photo } = await req.json().catch(() => ({}));
  try {
    await retryPhoto(id, String(room), String(photo));
    return json(req, { ok: true });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  const u = new URL(req.url);
  await deletePhoto(id, u.searchParams.get("room") || "", u.searchParams.get("photo") || "").catch(() => {});
  return json(req, { ok: true });
}
