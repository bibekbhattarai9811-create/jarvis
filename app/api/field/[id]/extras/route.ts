import { authed, denied, json } from "@/lib/auth";
import { addStatement, getIncident, log, lookupConditions, mutate, saveDiagram, verifyEvidence, type DiagramEl } from "@/lib/field";

export const runtime = "nodejs";
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

const pngFromDataUrl = (v: unknown): Buffer | null => {
  const m = typeof v === "string" ? v.match(/^data:image\/png;base64,(.+)$/) : null;
  if (!m || m[1].length >= 4_000_000) return null;
  const b = Buffer.from(m[1], "base64");
  return b.length > 50 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? b : null; // real PNG only
};

/** ?what=verify → re-check every evidence file against its fingerprint. */
export async function GET(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  try {
    return json(req, verifyEvidence((await params).id));
  } catch (e) {
    return json(req, { error: (e as Error).message }, 404);
  }
}

/**
 * {what: "conditions", lat, lon}                        → address + weather from GPS
 * {what: "statement", name, contact, language, original, readBack, signature: "data:image/png;base64,..."}
 * {what: "diagram", template, elements, image: "data:image/png;base64,..."}
 */
export async function POST(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  const i = getIncident(id);
  if (!i) return json(req, { error: "Incident not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.what === "conditions") {
      const lat = Number(b.lat);
      const lon = Number(b.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json(req, { error: "Bad location." }, 400);
      const c = await lookupConditions(lat, lon);
      const incident = await mutate(id, (x) => {
        x.conditions = c;
        if (!x.location && c.address) x.location = c.address;
        log(x, "conditions", `Location ${c.address || `${c.lat}, ${c.lon}`}${c.weather ? ` · ${c.weather}, ${c.tempF}°F, wind ${c.windMph} mph` : ""}`);
        return x;
      });
      return json(req, { incident });
    }
    if (b.what === "statement") {
      if (i.review.status === "approved") return json(req, { error: "This report is approved." }, 400);
      const original = typeof b.original === "string" ? b.original.trim() : "";
      if (!original) return json(req, { error: "Record or type the statement first." }, 400);
      const language = typeof b.language === "string" && /^[A-Za-z ()-]{2,30}$/.test(b.language) ? b.language : "English";
      const st = await addStatement(id, {
        name: String(b.name || ""),
        contact: String(b.contact || ""),
        language,
        original,
        readBack: !!b.readBack,
        signature: pngFromDataUrl(b.signature) || undefined,
      });
      return json(req, { statement: st });
    }
    if (b.what === "diagram") {
      if (i.review.status === "approved") return json(req, { error: "This report is approved." }, 400);
      const kinds = ["car", "truck", "person", "impact", "label"];
      const elements: DiagramEl[] = (Array.isArray(b.elements) ? b.elements : [])
        .filter((e: DiagramEl) => e && kinds.includes(e.kind))
        .map((e: DiagramEl) => ({
          id: String(e.id).slice(0, 20),
          kind: e.kind,
          x: Number(e.x) || 0,
          y: Number(e.y) || 0,
          rot: Number(e.rot) || 0,
          text: String(e.text || "").slice(0, 40),
          color: /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : "#3fd8ff",
        }));
      return json(req, { diagram: await saveDiagram(id, String(b.template || "cross"), elements, pngFromDataUrl(b.image) || undefined) });
    }
    return json(req, { error: "Unknown request." }, 400);
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}
