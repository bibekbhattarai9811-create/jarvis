import { authed, denied, json } from "@/lib/auth";
import { startCompare } from "@/lib/pro";

export const runtime = "nodejs";

/** Compare one room with the linked move-in report: { room }. Runs in the background; poll the report. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  const { room } = await req.json().catch(() => ({}));
  try {
    await startCompare(id, String(room || ""));
    return json(req, { ok: true });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}
