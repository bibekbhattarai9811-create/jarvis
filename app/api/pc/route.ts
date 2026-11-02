import { authed, denied } from "@/lib/auth";
import type { Action } from "@/lib/brain";
import { runOnPc } from "@/lib/pc";

export const runtime = "nodejs";

const MEDIA_KEYS = ["play_pause", "next", "previous", "volume_up", "volume_down", "mute"];

/** Direct PC control without asking Claude (used by hand gestures). Only media keys. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const { key } = (await req.json()) as { key: string };
  if (!MEDIA_KEYS.includes(key)) return Response.json({ error: "Unknown key." }, { status: 400 });
  const err = await runOnPc({ type: "media", key } as Action);
  return err ? Response.json({ error: err }, { status: 500 }) : Response.json({ ok: true });
}
