import { authed, denied, json } from "@/lib/auth";
import { checklistFor } from "@/lib/checklists";
import { deleteReport, getReport, getSettings, mutate, summarize } from "@/lib/pro";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Full report, its summary, business settings, and (for move-outs) the linked move-in report. */
export async function GET(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  const r = getReport(id);
  if (!r) return json(req, { error: "Report not found." }, 404);
  const base = r.baseId ? getReport(r.baseId) : null;
  return json(req, { report: r, summary: summarize(r), settings: getSettings(), base });
}

/** Edit details and rooms. Body: any of {property, unit, inspector, tenant, date, notes, addRoom, removeRoom, roomNotes:{room, notes}, check:{room, item, done}, addNote:{room, text}}. */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    const r = await mutate(id, (r) => {
      for (const k of ["property", "unit", "inspector", "tenant", "notes"] as const) if (typeof b[k] === "string") r[k] = b[k].slice(0, k === "notes" ? 2000 : 200);
      if (typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) r.date = b.date;
      const name = typeof b.addRoom === "string" ? b.addRoom.trim().slice(0, 40) : "";
      if (name && !r.rooms.some((x) => x.name.toLowerCase() === name.toLowerCase())) r.rooms.push({ name, notes: "", photos: [] });
      if (typeof b.removeRoom === "string") {
        const rm = r.rooms.find((x) => x.name === b.removeRoom);
        if (rm?.photos.length) throw new Error("Delete the room's photos first.");
        r.rooms = r.rooms.filter((x) => x.name !== b.removeRoom);
      }
      if (b.roomNotes && typeof b.roomNotes.room === "string") {
        const rm = r.rooms.find((x) => x.name === b.roomNotes.room);
        if (rm) rm.notes = String(b.roomNotes.notes || "").slice(0, 1000);
      }
      // Walkthrough checklist: {check: {room, item, done}}
      if (b.check && typeof b.check.room === "string" && typeof b.check.item === "string") {
        const rm = r.rooms.find((x) => x.name === b.check.room);
        if (rm && checklistFor(rm.name).includes(b.check.item)) {
          const set = new Set(rm.checked || []);
          if (b.check.done) set.add(b.check.item);
          else set.delete(b.check.item);
          rm.checked = [...set];
        }
      }
      // Voice note: {addNote: {room, text}} appends a line to the room's notes.
      if (b.addNote && typeof b.addNote.room === "string" && typeof b.addNote.text === "string" && b.addNote.text.trim()) {
        const rm = r.rooms.find((x) => x.name === b.addNote.room);
        const text = b.addNote.text.trim().replace(/^(note|jarvis,? note)[:,]?\s*/i, "");
        if (rm && text) rm.notes = `${rm.notes ? `${rm.notes}\n` : ""}• ${text[0].toUpperCase()}${text.slice(1)}`.slice(-1000);
      }
      return r;
    });
    return json(req, { report: r, summary: summarize(r) });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const { id } = await params;
  deleteReport(id);
  return json(req, { ok: true });
}
