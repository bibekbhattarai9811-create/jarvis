import { authed, denied } from "@/lib/auth";
import { deleteInspection, inspectionImage, listInspections } from "@/lib/inspections";

export const runtime = "nodejs";

/** List saved inspections, or one with its photo (?id=...). */
export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json(listInspections());
  const report = listInspections().find((r) => r.id === id);
  if (!report) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ...report, image: inspectionImage(id) });
}

export async function DELETE(req: Request) {
  if (!authed(req)) return denied(req);
  const id = new URL(req.url).searchParams.get("id");
  if (id) deleteInspection(id);
  return Response.json({ ok: true });
}
