import { authed, denied, json } from "@/lib/auth";
import type { Action } from "@/lib/brain";
import { getPcStats, runOnPc } from "@/lib/pc";
import { isDemo } from "@/lib/paths";

export const runtime = "nodejs";

const MEDIA_KEYS = ["play_pause", "next", "previous", "volume_up", "volume_down", "mute"];

/** Owner: live PC telemetry (CPU, RAM, uptime, battery). */
export async function GET(req: Request) {
  if (!authed(req) || isDemo()) return denied(req); // the demo has no PC to report on
  return json(req, await getPcStats());
}

/** Direct PC control without asking Claude (used by hand gestures). Only media keys. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const { key } = (await req.json()) as { key: string };
  if (!MEDIA_KEYS.includes(key)) return Response.json({ error: "Unknown key." }, { status: 400 });
  const err = await runOnPc({ type: "media", key } as Action);
  return err ? Response.json({ error: err }, { status: 500 }) : Response.json({ ok: true });
}
