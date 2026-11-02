import fs from "fs";
import { authed } from "@/lib/auth";
import { photoFile } from "@/lib/pro";

export const runtime = "nodejs";

/** A report photo: /api/pro/photo?r=<reportId>&p=<photoId> (uses the auth cookie, since <img> can't send headers). */
export async function GET(req: Request) {
  if (!authed(req)) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const f = photoFile(u.searchParams.get("r") || "", u.searchParams.get("p") || "");
  if (!f || !fs.existsSync(f)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(f)), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
  });
}
