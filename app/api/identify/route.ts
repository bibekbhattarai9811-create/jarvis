import { roleOf, denied } from "@/lib/auth";
import { identify } from "@/lib/brain";
import { isDemo } from "@/lib/paths";

export const runtime = "nodejs";

/** Name a scanned object: { image: "data:image/jpeg;base64,..." } → { name: "red car" }. */
export async function POST(req: Request) {
  if (!roleOf(req)) return denied(req);
  if (isDemo()) return Response.json({ name: "" }); // live demo has no Claude: the scan still works, just unnamed
  const { image } = (await req.json()) as { image?: string };
  const m = image?.match(/^data:image\/jpeg;base64,(.+)$/);
  if (!m || m[1].length > 2_000_000) return Response.json({ error: "Send a JPEG data URL." }, { status: 400 });
  try {
    return Response.json({ name: await identify(Buffer.from(m[1], "base64")) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
