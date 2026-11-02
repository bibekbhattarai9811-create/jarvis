import fs from "fs";
import { authed, denied, jpegFromDataUrl, json } from "@/lib/auth";
import { locateSensitive } from "@/lib/brain";
import { addPhoto, deletePhoto, getIncident, photoFile } from "@/lib/field";

export const runtime = "nodejs";
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

/**
 * Add a scene photo: {image: "data:image/jpeg;base64,...", caption?}. Time-stamped and fingerprinted on arrival.
 * {image, redactOf: photoId, boxes: n} saves a blurred public copy of that photo instead (the original is kept).
 */
export async function POST(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  if (!getIncident(id)) return json(req, { error: "Incident not found." }, 404);
  const b = await req.json().catch(() => ({}));
  const jpeg = jpegFromDataUrl(b.image);
  if (!jpeg) return json(req, { error: "Send a JPEG photo." }, 400);
  try {
    const redactOf = typeof b.redactOf === "string" ? b.redactOf : undefined;
    return json(req, { photo: await addPhoto(id, jpeg, redactOf ? String(Number(b.boxes) || 0) : typeof b.caption === "string" ? b.caption : "", redactOf) });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}

/** ?p=<photoId>&find=1 → where the faces and plates are (for the privacy blur). */
export async function GET(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const f = photoFile((await params).id, new URL(req.url).searchParams.get("p") || "");
  if (!f || !fs.existsSync(f)) return json(req, { error: "Photo not found." }, 404);
  try {
    return json(req, { boxes: await locateSensitive(fs.readFileSync(f)) });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 500);
  }
}

/** ?p=<photoId> */
export async function DELETE(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  try {
    await deletePhoto((await params).id, new URL(req.url).searchParams.get("p") || "");
    return json(req, { ok: true });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}
