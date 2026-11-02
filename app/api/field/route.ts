import { authed, denied, json } from "@/lib/auth";
import { createIncident, listIncidents } from "@/lib/field";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  return json(req, { incidents: listIncidents() });
}

/** New incident: {title, location?, officer?}. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const b = await req.json().catch(() => ({}));
  if (typeof b.title !== "string" || !b.title.trim()) return json(req, { error: "Give the incident a title." }, 400);
  return json(req, createIncident(b));
}
