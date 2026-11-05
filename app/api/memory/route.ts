import { authed, denied, json } from "@/lib/auth";
import { forget, listMemory, remember } from "@/lib/memory";

export const runtime = "nodejs";

/** Owner: everything Jarvis remembers about you. */
export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  return json(req, { memory: listMemory() });
}

/** Owner: add a remembered note. Body: {note: string}. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const b = (await req.json().catch(() => ({}))) as { note?: unknown };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 400) : "";
  if (!note) return json(req, { error: "Type something to remember." }, 400);
  remember(note);
  return json(req, { memory: listMemory() });
}

/** Owner: forget notes matching ?match=... */
export async function DELETE(req: Request) {
  if (!authed(req)) return denied(req);
  const match = new URL(req.url).searchParams.get("match") || "";
  if (match) forget(match);
  return json(req, { memory: listMemory() });
}
