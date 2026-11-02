import { authed, denied } from "@/lib/auth";
import { inspect } from "@/lib/brain";
import { saveInspection } from "@/lib/inspections";

export const runtime = "nodejs";

/** Inspect a photo: { image: "data:image/jpeg;base64,...", note?: "is this crack serious?" } → saved report. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const { image, note = "" } = (await req.json()) as { image?: string; note?: string };
  const m = image?.match(/^data:image\/jpeg;base64,(.+)$/);
  if (!m || m[1].length > 6_000_000) return Response.json({ error: "Send a JPEG data URL." }, { status: 400 });
  const jpeg = Buffer.from(m[1], "base64");
  try {
    const report = await inspect(jpeg, String(note).slice(0, 300));
    return Response.json(saveInspection(report, String(note).slice(0, 300), jpeg));
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: /JSON/.test(msg) ? "Couldn't read the inspection result. Try again." : msg }, { status: 500 });
  }
}
