import { authed, denied, jpegFromDataUrl, json } from "@/lib/auth";
import { deleteId, getIncident, scanId, updateId } from "@/lib/field";

export const runtime = "nodejs";
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

/** Scan an ID: {image: "data:image/jpeg;base64,...", role?, by?}. Returns the fields read from it (unconfirmed). */
export async function POST(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  if (!getIncident(id)) return json(req, { error: "Incident not found." }, 404);
  const b = await req.json().catch(() => ({}));
  const jpeg = jpegFromDataUrl(b.image);
  if (!jpeg) return json(req, { error: "Send a JPEG photo of the ID." }, 400);
  try {
    return json(req, { scan: await scanId(id, jpeg, typeof b.role === "string" ? b.role : "", typeof b.by === "string" ? b.by : "") });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}

/** Correct / confirm: {scanId, role?, fields?, confirmed?, by?}. */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const b = await req.json().catch(() => ({}));
  try {
    const scan = await updateId((await params).id, String(b.scanId || ""), { role: b.role, fields: b.fields, confirmed: b.confirmed === true }, typeof b.by === "string" ? b.by : "");
    return json(req, { scan });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}

/** ?s=<scanId> */
export async function DELETE(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  try {
    await deleteId((await params).id, new URL(req.url).searchParams.get("s") || "", new URL(req.url).searchParams.get("by") || "");
    return json(req, { ok: true });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}
