import fs from "fs";
import { authed, denied } from "@/lib/auth";
import { evidenceFile } from "@/lib/field";

export const runtime = "nodejs";

/**
 * Evidence file bytes: photos (?i=<incident>&p=<photo>), or signatures / the diagram with &t=png.
 * Uses the login cookie, since <img> can't send the passcode.
 */
export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  const u = new URL(req.url);
  const png = u.searchParams.get("t") === "png";
  const f = evidenceFile(u.searchParams.get("i") || "", u.searchParams.get("p") || "", png ? "png" : "jpg");
  if (!f || !fs.existsSync(f)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(f)), { headers: { "content-type": png ? "image/png" : "image/jpeg", "cache-control": "private, max-age=3600" } });
}
