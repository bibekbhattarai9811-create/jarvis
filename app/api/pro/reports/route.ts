import { authed, denied, json } from "@/lib/auth";
import { createReport, getSettings, listReports } from "@/lib/pro";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  return json(req, { reports: listReports(), settings: getSettings() });
}

export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const body = await req.json().catch(() => ({}));
  if (!String(body.property || "").trim()) return json(req, { error: "Enter the property address." }, 400);
  return json(req, createReport(body));
}
