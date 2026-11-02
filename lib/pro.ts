// Inspect Pro: room-by-room rental condition reports (move-in / move-out / general).
// Each report lives in data/pro/<id>/ with report.json and its photos; photos are analyzed in the background.

import fs from "fs";
import path from "path";
import { compareRoom, inspect, type Inspection, type RoomComparison } from "./brain";

const ROOT = path.join(process.cwd(), "data", "pro");

export type Photo = { id: string; at: string; status: "analyzing" | "done" | "error"; error?: string; result?: Inspection };
export type Room = {
  name: string;
  notes: string;
  photos: Photo[];
  checked?: string[]; // walkthrough checklist items done (lib/checklists.ts)
  compare?: { status: "running" | "done" | "error"; at: string; error?: string; result?: RoomComparison };
};
export type ReportKind = "move-in" | "move-out" | "general";
export type ProReport = {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: ReportKind;
  property: string;
  unit: string;
  inspector: string;
  tenant: string;
  date: string; // YYYY-MM-DD
  baseId?: string; // for move-out: the move-in report to compare against
  notes: string;
  rooms: Room[];
};
export type Settings = { business: string; contact: string };

export const DEFAULT_ROOMS = ["Entry", "Living room", "Kitchen", "Bathroom", "Bedroom 1"];

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const okId = (id: string) => /^[a-z0-9]{6,20}$/.test(id);
const dir = (id: string) => path.join(ROOT, id);
const file = (id: string) => path.join(dir(id), "report.json");

export function photoFile(reportId: string, photoId: string): string | null {
  return okId(reportId) && okId(photoId) ? path.join(dir(reportId), `${photoId}.jpg`) : null;
}

export function getReport(id: string): ProReport | null {
  if (!okId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(file(id), "utf8"));
  } catch {
    return null;
  }
}

function save(r: ProReport) {
  fs.mkdirSync(dir(r.id), { recursive: true });
  r.updatedAt = new Date().toISOString();
  const tmp = `${file(r.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(r, null, 2));
  fs.renameSync(tmp, file(r.id));
}

// One change at a time per report (background analysis and the UI both edit report.json).
const locks = ((globalThis as { __proLocks?: Map<string, Promise<unknown>> }).__proLocks ||= new Map());
export function mutate<T>(id: string, fn: (r: ProReport) => T): Promise<T> {
  const run = (locks.get(id) || Promise.resolve()).then(() => {
    const r = getReport(id);
    if (!r) throw new Error("Report not found.");
    const out = fn(r);
    save(r);
    return out;
  });
  locks.set(id, run.catch(() => {}));
  return run;
}

export function listReports(): (Omit<ProReport, "rooms"> & { photos: number; issues: number; analyzing: number })[] {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(ROOT).filter(okId);
  } catch {}
  return ids
    .map(getReport)
    .filter((r): r is ProReport => !!r)
    .map(({ rooms, ...r }) => {
      const photos = rooms.flatMap((x) => x.photos);
      return {
        ...r,
        photos: photos.length,
        issues: photos.reduce((n, p) => n + (p.result?.issues.length || 0), 0),
        analyzing: photos.filter((p) => p.status === "analyzing").length,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createReport(input: Partial<ProReport>): ProReport {
  const now = new Date().toISOString();
  const kind: ReportKind = input.kind === "move-in" || input.kind === "move-out" ? input.kind : "general";
  const base = input.baseId ? getReport(input.baseId) : null;
  const r: ProReport = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    kind,
    property: String(input.property || "").slice(0, 200),
    unit: String(input.unit || "").slice(0, 60),
    inspector: String(input.inspector || "").slice(0, 100),
    tenant: String(input.tenant || "").slice(0, 100),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.date)) ? String(input.date) : now.slice(0, 10),
    baseId: kind === "move-out" && base ? base.id : undefined,
    notes: "",
    // A move-out starts with the same rooms as its move-in, so they line up for comparison.
    rooms: (base ? base.rooms.map((x) => x.name) : DEFAULT_ROOMS).map((name) => ({ name, notes: "", photos: [] })),
  };
  save(r);
  return r;
}

export function deleteReport(id: string) {
  if (okId(id)) fs.rmSync(dir(id), { recursive: true, force: true });
}

// ---- Background photo analysis (2 at a time; each one is a Claude call of ~20-40 s) ----
type Job = { reportId: string; room: string; photoId: string };
const q = ((globalThis as { __proQueue?: { jobs: Job[]; running: number } }).__proQueue ||= { jobs: [], running: 0 });
const MAX_PARALLEL = 2;

function pump() {
  while (q.running < MAX_PARALLEL && q.jobs.length) {
    const job = q.jobs.shift()!;
    q.running++;
    analyze(job).finally(() => {
      q.running--;
      pump();
    });
  }
}

async function analyze({ reportId, room, photoId }: Job) {
  const f = photoFile(reportId, photoId);
  try {
    if (!f) throw new Error("Bad photo id.");
    const result = await inspect(fs.readFileSync(f), "", room);
    await mutate(reportId, (r) => {
      const p = r.rooms.find((x) => x.name === room)?.photos.find((x) => x.id === photoId);
      if (p) Object.assign(p, { status: "done", result, error: undefined });
    });
  } catch (e) {
    const msg = (e as Error).message;
    await mutate(reportId, (r) => {
      const p = r.rooms.find((x) => x.name === room)?.photos.find((x) => x.id === photoId);
      if (p) Object.assign(p, { status: "error", error: /JSON/.test(msg) ? "Couldn't read the AI result." : msg.slice(0, 200) });
    }).catch(() => {});
  }
}

export async function addPhoto(reportId: string, room: string, jpeg: Buffer): Promise<Photo> {
  const photo: Photo = { id: newId(), at: new Date().toISOString(), status: "analyzing" };
  const f = photoFile(reportId, photo.id);
  if (!f) throw new Error("Bad report id.");
  await mutate(reportId, (r) => {
    let rm = r.rooms.find((x) => x.name === room);
    if (!rm) r.rooms.push((rm = { name: room, notes: "", photos: [] }));
    fs.writeFileSync(f, jpeg);
    rm.photos.push(photo);
  });
  q.jobs.push({ reportId, room, photoId: photo.id });
  pump();
  return photo;
}

export async function retryPhoto(reportId: string, room: string, photoId: string) {
  await mutate(reportId, (r) => {
    const p = r.rooms.find((x) => x.name === room)?.photos.find((x) => x.id === photoId);
    if (!p) throw new Error("Photo not found.");
    p.status = "analyzing";
    p.error = undefined;
  });
  q.jobs.push({ reportId, room, photoId });
  pump();
}

export async function deletePhoto(reportId: string, room: string, photoId: string) {
  await mutate(reportId, (r) => {
    const rm = r.rooms.find((x) => x.name === room);
    if (rm) rm.photos = rm.photos.filter((p) => p.id !== photoId);
  });
  const f = photoFile(reportId, photoId);
  if (f) fs.rmSync(f, { force: true });
}

/** Compare one room of a move-out report with the same room in its move-in report (runs in the background). */
export async function startCompare(reportId: string, room: string) {
  const r = getReport(reportId);
  if (!r?.baseId) throw new Error("This report isn't linked to a move-in report.");
  const base = getReport(r.baseId);
  const read = (rep: ProReport | null) =>
    (rep?.rooms.find((x) => x.name === room)?.photos || [])
      .map((p) => photoFile(rep!.id, p.id))
      .filter((f): f is string => !!f && fs.existsSync(f))
      .map((f) => fs.readFileSync(f));
  const before = read(base);
  const after = read(r);
  if (!before.length) throw new Error(`The move-in report has no photos of "${room}".`);
  if (!after.length) throw new Error(`Add move-out photos of "${room}" first.`);
  await mutate(reportId, (x) => {
    const rm = x.rooms.find((y) => y.name === room);
    if (rm) rm.compare = { status: "running", at: new Date().toISOString() };
  });
  compareRoom(before, after, room)
    .then((result) =>
      mutate(reportId, (x) => {
        const rm = x.rooms.find((y) => y.name === room);
        if (rm) rm.compare = { status: "done", at: new Date().toISOString(), result };
      })
    )
    .catch((e) =>
      mutate(reportId, (x) => {
        const rm = x.rooms.find((y) => y.name === room);
        if (rm) rm.compare = { status: "error", at: new Date().toISOString(), error: (e as Error).message.slice(0, 200) };
      }).catch(() => {})
    );
}

// ---- Business settings (shown on the PDF) ----
const SETTINGS = path.join(ROOT, "settings.json");
export function getSettings(): Settings {
  try {
    return { business: "", contact: "", ...JSON.parse(fs.readFileSync(SETTINGS, "utf8")) };
  } catch {
    return { business: "", contact: "" };
  }
}
export function saveSettings(s: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...s };
  next.business = String(next.business).slice(0, 100);
  next.contact = String(next.contact).slice(0, 150);
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2));
  return next;
}

/** Overall picture for a report: worst condition, average score, counts by severity and type. */
export function summarize(r: ProReport) {
  const results = r.rooms.flatMap((x) => x.photos).map((p) => p.result).filter((x): x is Inspection => !!x);
  const issues = results.flatMap((x) => x.issues);
  const order = ["good", "fair", "poor", "critical"];
  const worst = results.reduce((w, x) => (order.indexOf(x.condition) > order.indexOf(w) ? x.condition : w), "good" as string);
  return {
    photos: results.length,
    avgScore: results.length ? Math.round((results.reduce((n, x) => n + x.score, 0) / results.length) * 10) / 10 : null,
    worst: results.length ? worst : null,
    bySeverity: { high: issues.filter((i) => i.severity === "high").length, medium: issues.filter((i) => i.severity === "medium").length, low: issues.filter((i) => i.severity === "low").length },
    byType: ["damage", "wear", "cleaning", "safety", "other"].map((t) => ({ type: t, count: issues.filter((i) => (i.type || "other") === t).length })),
  };
}
