import { authed, denied, json } from "@/lib/auth";
import { draftReport } from "@/lib/field";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Write (or rewrite) the AI report draft from the notes and photo captions. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authed(req)) return denied(req);
  try {
    const b = await req.json().catch(() => ({}));
    return json(req, { draft: await draftReport((await params).id, typeof b.by === "string" ? b.by.slice(0, 80) : "") });
  } catch (e) {
    const msg = (e as Error).message;
    return json(req, { error: /JSON/.test(msg) ? "Couldn't read the draft. Try again." : msg }, 400);
  }
}
