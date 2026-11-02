import { authed, denied, json, logSecurity } from "@/lib/auth";
import { addFace, listFaces, removeFace } from "@/lib/faces";

export const runtime = "nodejs";

/** Owner: known faces (with their fingerprints, so the browser can match faces on the camera). */
export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  return json(req, { faces: listFaces() });
}

/** Owner: teach a face. Body: {name, descriptors: number[128][]}. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const b = (await req.json().catch(() => ({}))) as { name?: unknown; descriptors?: unknown };
  const face = typeof b.name === "string" && Array.isArray(b.descriptors) ? addFace(b.name, b.descriptors) : null;
  if (!face) return json(req, { error: "Couldn't learn that face. Try again facing the camera in good light." }, 400);
  logSecurity(`face learned: ${face.name}`);
  return json(req, { name: face.name, samples: face.descriptors.length });
}

/** Owner: forget a face (?name=...). */
export async function DELETE(req: Request) {
  if (!authed(req)) return denied(req);
  const name = new URL(req.url).searchParams.get("name") || "";
  removeFace(name);
  logSecurity(`face forgotten: ${name}`);
  return json(req, { faces: listFaces().map((f) => ({ name: f.name, samples: f.descriptors.length })) });
}
