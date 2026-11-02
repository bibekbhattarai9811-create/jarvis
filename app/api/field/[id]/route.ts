import { authed, denied, json } from "@/lib/auth";
import { allChecklists, deleteIncident, getIncident, getSettings, log, mutate, record, reportFingerprint } from "@/lib/field";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const i = getIncident((await params).id);
  if (!i) return json(req, { error: "Incident not found." }, 404);
  return json(req, { incident: i, checklists: allChecklists(), fingerprint: reportFingerprint(i), department: getSettings().department });
}

/**
 * Edit. Body: any of {by, title, location, officer, notes (replace all), addNote (append a line),
 * checklist: "name" | null, step: "next" | "back" | number, toggle: stepIndex,
 * draftEdit: {summary?, narrative?}, review: {action: "submit"|"approve"|"return"|"reopen", comment?}}.
 * `by` is who is making the change (shown in the edit history).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const b = await req.json().catch(() => ({}));
  const by = typeof b.by === "string" ? b.by.trim().slice(0, 80) : "";
  try {
    const incident = await mutate((await params).id, (i) => {
      const locked = i.review.status === "approved" || i.review.status === "submitted";
      const needOpen = () => {
        if (locked) throw new Error(i.review.status === "approved" ? "This report is approved. Reopen it to make changes." : "This report is waiting for review. It can be changed after it's returned.");
      };
      for (const k of ["title", "location", "officer"] as const)
        if (typeof b[k] === "string" && b[k] !== i[k]) {
          needOpen();
          record(i, by, `changed ${k}`, b[k].slice(0, 200), i[k]);
          i[k] = b[k].slice(0, k === "title" ? 120 : 200);
        }
      if (typeof b.notes === "string" && b.notes !== i.notes) {
        needOpen();
        record(i, by, "edited field notes", undefined, i.notes);
        i.notes = b.notes.slice(0, 20000);
      }
      if (typeof b.addNote === "string" && b.addNote.trim()) {
        needOpen();
        const t = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        i.notes = `${i.notes ? `${i.notes}\n` : ""}[${t}] ${b.addNote.trim()}`.slice(-20000);
        log(i, "note", `Note: ${b.addNote.trim()}`);
      }
      const lists = allChecklists();
      if (b.checklist === null) delete i.checklist;
      else if (typeof b.checklist === "string" && lists.some((c) => c.name === b.checklist)) {
        i.checklist = { name: b.checklist, step: 0, done: [] };
        log(i, "checklist", `Started checklist: ${b.checklist}`);
      }
      const list = i.checklist && lists.find((c) => c.name === i.checklist!.name);
      if (i.checklist && list) {
        const c = i.checklist;
        if (b.step === "next" && c.step < list.steps.length) {
          if (!c.done.includes(c.step)) c.done.push(c.step);
          log(i, "checklist", `✓ ${list.steps[c.step]}`);
          c.step++; // == length means finished
          if (c.step === list.steps.length) log(i, "checklist", `Checklist complete: ${list.name}`);
        } else if (b.step === "back") c.step = Math.max(0, c.step - 1);
        else if (Number.isInteger(b.step) && b.step >= 0 && b.step < list.steps.length) c.step = b.step;
        if (Number.isInteger(b.toggle) && b.toggle >= 0 && b.toggle < list.steps.length)
          c.done = c.done.includes(b.toggle) ? c.done.filter((d) => d !== b.toggle) : [...c.done, b.toggle];
      }
      // Officer edits the AI draft by hand (kept in history with the previous text).
      if (b.draftEdit && i.draft) {
        needOpen();
        for (const k of ["summary", "narrative"] as const)
          if (typeof b.draftEdit[k] === "string" && b.draftEdit[k] !== i.draft.result[k]) {
            record(i, by, `edited report ${k}`, undefined, i.draft.result[k]);
            i.draft.result[k] = b.draftEdit[k].slice(0, 20000);
            i.draft.edited = true;
          }
      }
      // Supervisor review flow: open → submitted → approved / returned → (reopen) …
      if (b.review && typeof b.review.action === "string") {
        const comment = typeof b.review.comment === "string" ? b.review.comment.trim().slice(0, 1000) : "";
        const now = new Date().toISOString();
        const a = b.review.action;
        if (a === "submit") {
          if (!i.draft) throw new Error("Draft the report before submitting it.");
          if (i.review.status !== "open" && i.review.status !== "returned") throw new Error("Already submitted.");
          i.review = { status: "submitted", by, at: now };
        } else if (a === "approve" || a === "return") {
          if (i.review.status !== "submitted") throw new Error("Only a submitted report can be reviewed.");
          if (!by) throw new Error("Enter the reviewing supervisor's name.");
          if (a === "return" && !comment) throw new Error("Say what needs fixing.");
          i.review = { status: a === "approve" ? "approved" : "returned", by, at: now, comment };
        } else if (a === "reopen") {
          if (i.review.status !== "approved") throw new Error("Only an approved report can be reopened.");
          if (!comment) throw new Error("Give a reason for reopening.");
          i.review = { status: "open", by, at: now, comment };
        } else throw new Error("Unknown review action.");
        const verb = { submit: "submitted the report for review", approve: "approved the report", return: "returned the report for changes", reopen: "reopened the report" }[a as "submit"];
        const done = { submit: "submitted for review", approve: "approved", return: "returned for changes", reopen: "reopened" }[a as "submit"];
        record(i, by, verb, comment || undefined);
        log(i, "review", `Report ${done}${by ? ` by ${by}` : ""}`);
      }
      return i;
    });
    return json(req, { incident, fingerprint: reportFingerprint(incident) });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  if (!authed(req)) return denied(req);
  const id = (await params).id;
  const i = getIncident(id);
  if (i?.review.status === "approved") return json(req, { error: "Approved reports can't be deleted." }, 400);
  deleteIncident(id);
  return json(req, { ok: true });
}
