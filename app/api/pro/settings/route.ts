import { authed, denied, json } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/pro";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  return json(req, getSettings());
}

/** Business name and contact line printed on report PDFs. */
export async function PUT(req: Request) {
  if (!authed(req)) return denied(req);
  return json(req, saveSettings(await req.json().catch(() => ({}))));
}
