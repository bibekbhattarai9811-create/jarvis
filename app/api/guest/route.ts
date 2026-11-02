import { authed, denied, getGuest, json, logSecurity, updateGuest } from "@/lib/auth";

export const runtime = "nodejs";

/** Owner: see guest access (on/off + code). */
export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  return json(req, getGuest());
}

/** Owner: {enabled?: boolean, newCode?: true}. A new code logs every guest out. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const b = (await req.json().catch(() => ({}))) as { enabled?: unknown; newCode?: unknown };
  const g = updateGuest({ enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, newCode: b.newCode === true });
  logSecurity(`guest access ${g.enabled ? "on" : "off"}${b.newCode === true ? ", new code" : ""}`);
  return json(req, g);
}
