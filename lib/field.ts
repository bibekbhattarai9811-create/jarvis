// Field Assist (demo): hands-free help for officers. Incidents live in data/field/<id>/incident.json with
// their photos, signatures and diagram. No face recognition or plate lookups, on purpose.
//
// Evidence integrity: every photo, signature and diagram gets a SHA-256 fingerprint the moment it arrives;
// /verify re-checks the files, and the PDF prints the fingerprints plus one for the whole report.
// Every change is recorded in a timeline (what happened on scene) and a history (who edited the report).

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { askText, parseJsonReply, readId, type IdFields } from "./brain";
import { FIELD_CHECKLISTS } from "./fieldChecklists";
import { dataDir } from "./paths";

const ROOT = path.join(dataDir(), "field");
const SETTINGS = path.join(ROOT, "_settings.json");

export type ReportDraft = {
  summary: string;
  narrative: string;
  people: { role: string; description: string }[];
  vehicles: { description: string; plate?: string }[];
  evidence: string[];
  followUps: string[];
  missing: string[]; // facts the officer should add or confirm
  sections?: { heading: string; text: string }[]; // department-specific sections, if the department set any
};
export type FieldPhoto = { id: string; at: string; caption: string; sha256: string; redacted?: { id: string; sha256: string; at: string; boxes: number } };
export type Translation = { at: string; fromLang: string; toLang: string; heard: string; text: string; speaker: "officer" | "other" };
export type TimelineEvent = { at: string; kind: string; text: string };
export type HistoryEntry = { at: string; by: string; action: string; detail?: string; before?: string };
export type Review = { status: "open" | "submitted" | "approved" | "returned"; by?: string; at?: string; comment?: string };
export type Statement = {
  id: string;
  at: string;
  name: string;
  contact: string;
  language: string;
  original: string;
  english: string;
  signature?: { id: string; sha256: string };
  readBack: boolean; // statement was read back to the witness before signing
};
export type DiagramEl = { id: string; kind: "car" | "truck" | "person" | "impact" | "label"; x: number; y: number; rot: number; text: string; color: string };
export type Diagram = { at: string; template: string; elements: DiagramEl[]; image?: { id: string; sha256: string } };
/** An ID card the person handed over, photographed and read by AI, then checked by the officer. */
export type IdScan = {
  id: string; // also the photo file name
  at: string;
  sha256: string;
  role: string; // "Driver of V1", "Witness", …
  fields: IdFields;
  confirmed: boolean; // officer compared the fields with the card
};
export type Conditions = { at: string; lat: number; lon: number; address?: string; weather?: string; tempF?: number; windMph?: number; daylight?: boolean };
export type Incident = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  location: string;
  officer: string;
  notes: string; // dictated / typed field notes, newest last
  draft?: { at: string; result: ReportDraft; edited?: boolean };
  photos: FieldPhoto[];
  checklist?: { name: string; step: number; done: number[] };
  lastTranslation?: Translation;
  timeline: TimelineEvent[];
  history: HistoryEntry[];
  review: Review;
  statements: Statement[];
  ids: IdScan[];
  diagram?: Diagram;
  conditions?: Conditions;
};
export type DeptSettings = { department: string; checklists: { name: string; steps: string[] }[]; reportSections: string[]; importedAt?: string };

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const okId = (id: string) => /^[a-z0-9]{6,20}$/.test(id);
const dir = (id: string) => path.join(ROOT, id);
const file = (id: string) => path.join(dir(id), "incident.json");
export const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/** Stored file for an incident: photos are .jpg, signatures and diagrams .png. */
export function evidenceFile(id: string, fileId: string, ext: "jpg" | "png" = "jpg"): string | null {
  return okId(id) && okId(fileId) ? path.join(dir(id), `${fileId}.${ext}`) : null;
}
export const photoFile = (id: string, photoId: string) => evidenceFile(id, photoId, "jpg");

/** Older incidents (before the timeline etc.) get the new fields filled in. */
function normalize(i: Incident): Incident {
  i.timeline ||= [{ at: i.createdAt, kind: "open", text: "Incident opened" }];
  i.history ||= [];
  i.review ||= { status: "open" };
  i.statements ||= [];
  i.ids ||= [];
  for (const p of i.photos) {
    if (!p.sha256) {
      const f = photoFile(i.id, p.id);
      p.sha256 = f && fs.existsSync(f) ? sha256(fs.readFileSync(f)) : "";
    }
  }
  return i;
}

export function getIncident(id: string): Incident | null {
  if (!okId(id)) return null;
  try {
    return normalize(JSON.parse(fs.readFileSync(file(id), "utf8")));
  } catch {
    return null;
  }
}

function save(i: Incident) {
  fs.mkdirSync(dir(i.id), { recursive: true });
  i.updatedAt = new Date().toISOString();
  const tmp = `${file(i.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(i, null, 2));
  fs.renameSync(tmp, file(i.id));
}

/** Add a line to the scene timeline. */
export const log = (i: Incident, kind: string, text: string) => i.timeline.push({ at: new Date().toISOString(), kind, text: text.slice(0, 200) });
/** Add an entry to the report's edit history. */
export const record = (i: Incident, by: string, action: string, detail?: string, before?: string) =>
  i.history.push({ at: new Date().toISOString(), by: by || i.officer || "Officer", action, detail, before });

// One write at a time per incident (photos, notes and the glasses can all update it at once).
const locks = new Map<string, Promise<unknown>>();
export function mutate<T>(id: string, fn: (i: Incident) => T): Promise<T> {
  const run = (locks.get(id) || Promise.resolve()).then(() => {
    const i = getIncident(id);
    if (!i) throw new Error("Incident not found.");
    const out = fn(i);
    save(i);
    return out;
  });
  locks.set(id, run.catch(() => {}));
  return run;
}

export function listIncidents() {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT)
    .filter((d) => okId(d))
    .map(getIncident)
    .filter((i): i is Incident => !!i)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((i) => ({
      id: i.id,
      createdAt: i.createdAt,
      title: i.title,
      location: i.location,
      officer: i.officer,
      photos: i.photos.length,
      statements: i.statements.length,
      hasDraft: !!i.draft,
      status: i.review.status,
      words: i.notes.split(/\s+/).filter(Boolean).length,
    }));
}

export function createIncident(input: Partial<Incident>): Incident {
  const now = new Date().toISOString();
  const i: Incident = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    title: String(input.title || "Untitled incident").slice(0, 120),
    location: String(input.location || "").slice(0, 200),
    officer: String(input.officer || "").slice(0, 80),
    notes: "",
    photos: [],
    timeline: [{ at: now, kind: "open", text: "Incident opened" }],
    history: [],
    review: { status: "open" },
    statements: [],
    ids: [],
  };
  save(i);
  return i;
}

export function deleteIncident(id: string) {
  if (okId(id)) fs.rmSync(dir(id), { recursive: true, force: true });
}

// ---------- Photos ----------
export async function addPhoto(id: string, jpeg: Buffer, caption: string, redactOf?: string): Promise<FieldPhoto> {
  const fid = newId();
  const hash = sha256(jpeg);
  fs.writeFileSync(photoFile(id, fid)!, jpeg);
  return mutate(id, (i) => {
    if (redactOf) {
      // A blurred public copy of an existing photo. The original stays untouched.
      const orig = i.photos.find((p) => p.id === redactOf);
      if (!orig) throw new Error("Photo not found.");
      const n = Number(caption) || 0;
      orig.redacted = { id: fid, sha256: hash, at: new Date().toISOString(), boxes: n };
      log(i, "redact", `Public copy of photo #${i.photos.indexOf(orig) + 1} made (${n} area${n === 1 ? "" : "s"} blurred)`);
      return orig;
    }
    const p: FieldPhoto = { id: fid, at: new Date().toISOString(), caption: caption.slice(0, 300), sha256: hash };
    i.photos.push(p);
    log(i, "photo", `Photo #${i.photos.length}${p.caption ? `: ${p.caption}` : ""}`);
    return p;
  });
}

export async function deletePhoto(id: string, photoId: string) {
  await mutate(id, (i) => {
    const n = i.photos.findIndex((p) => p.id === photoId);
    if (n < 0) return;
    if (i.review.status === "approved") throw new Error("This report is approved; evidence can't be removed.");
    record(i, "", "deleted photo", `#${n + 1} ${i.photos[n].caption}`, i.photos[n].sha256);
    log(i, "photo", `Photo #${n + 1} removed`);
    const red = i.photos[n].redacted;
    if (red) fs.rmSync(photoFile(id, red.id)!, { force: true });
    i.photos.splice(n, 1);
  });
  const f = photoFile(id, photoId);
  if (f) fs.rmSync(f, { force: true });
}

/** Re-hash every stored file and compare with the fingerprints taken on arrival. */
export function verifyEvidence(id: string) {
  const i = getIncident(id);
  if (!i) throw new Error("Incident not found.");
  const check = (label: string, fileId: string, ext: "jpg" | "png", want: string) => {
    const f = evidenceFile(id, fileId, ext);
    const ok = !!f && fs.existsSync(f) && sha256(fs.readFileSync(f)) === want;
    return { label, sha256: want, ok };
  };
  const items = [
    ...i.photos.map((p, n) => check(`Photo #${n + 1}`, p.id, "jpg", p.sha256)),
    ...i.photos.filter((p) => p.redacted).map((p) => check(`Public copy of photo #${i.photos.indexOf(p) + 1}`, p.redacted!.id, "jpg", p.redacted!.sha256)),
    ...i.statements.filter((s) => s.signature).map((s) => check(`Signature: ${s.name}`, s.signature!.id, "png", s.signature!.sha256)),
    ...i.ids.map((d) => check(`ID card: ${d.role || d.fields.fullName || "unnamed"}`, d.id, "jpg", d.sha256)),
    ...(i.diagram?.image ? [check("Scene diagram", i.diagram.image.id, "png", i.diagram.image.sha256)] : []),
  ];
  return { checkedAt: new Date().toISOString(), allOk: items.every((x) => x.ok), items };
}

/** One fingerprint for the whole report: notes, draft, statements, and every evidence file's fingerprint. */
export function reportFingerprint(i: Incident): string {
  const canon = JSON.stringify({
    id: i.id,
    title: i.title,
    location: i.location,
    officer: i.officer,
    notes: i.notes,
    draft: i.draft?.result,
    photos: i.photos.map((p) => [p.at, p.caption, p.sha256]),
    statements: i.statements.map((s) => [s.at, s.name, s.original, s.english, s.signature?.sha256]),
    diagram: i.diagram?.image?.sha256,
    ids: i.ids.map((d) => [d.at, d.role, d.fields, d.confirmed, d.sha256]),
    review: i.review,
  });
  return sha256(Buffer.from(canon));
}

// ---------- Statements ----------
export async function addStatement(id: string, s: { name: string; contact: string; language: string; original: string; readBack: boolean; signature?: Buffer }): Promise<Statement> {
  const english = /^english$/i.test(s.language) ? s.original : await translate(s.original, s.language, "English");
  const st: Statement = {
    id: newId(),
    at: new Date().toISOString(),
    name: s.name.slice(0, 80),
    contact: s.contact.slice(0, 120),
    language: s.language,
    original: s.original.slice(0, 8000),
    english: english.slice(0, 8000),
    readBack: s.readBack,
  };
  if (s.signature) {
    const sid = newId();
    fs.writeFileSync(evidenceFile(id, sid, "png")!, s.signature);
    st.signature = { id: sid, sha256: sha256(s.signature) };
  }
  return mutate(id, (i) => {
    i.statements.push(st);
    log(i, "statement", `Statement from ${st.name || "witness"}${/^english$/i.test(st.language) ? "" : ` (${st.language}, translated)`}${st.signature ? ", signed" : ""}`);
    return st;
  });
}

// ---------- ID cards ----------
/** Save the ID photo (fingerprinted), read its fields with AI, and add it as "not yet confirmed". */
export async function scanId(id: string, jpeg: Buffer, role: string, by = ""): Promise<IdScan> {
  const fid = newId();
  fs.writeFileSync(photoFile(id, fid)!, jpeg);
  let fields: IdFields;
  try {
    fields = await readId(jpeg);
  } catch {
    fields = { docType: "", fullName: "", dob: "", address: "", idNumber: "", issuer: "", expires: "", sex: "" }; // officer types them in
  }
  const scan: IdScan = { id: fid, at: new Date().toISOString(), sha256: sha256(jpeg), role: role.slice(0, 60), fields, confirmed: false };
  return mutate(id, (i) => {
    if (i.review.status === "approved" || i.review.status === "submitted") throw new Error("This report is locked for review.");
    i.ids.push(scan);
    log(i, "id", `ID scanned${scan.role ? ` (${scan.role})` : ""}${fields.fullName ? `: ${fields.fullName}` : ""}`);
    record(i, by, "scanned an ID card", scan.role || undefined);
    return scan;
  });
}

const ID_KEYS = ["docType", "fullName", "dob", "address", "idNumber", "issuer", "expires", "sex"] as const;

/** Officer corrects fields and/or confirms they match the card. Changes after confirming are recorded. */
export async function updateId(id: string, scanId: string, change: { role?: string; fields?: Partial<IdFields>; confirmed?: boolean }, by = ""): Promise<IdScan> {
  return mutate(id, (i) => {
    if (i.review.status === "approved" || i.review.status === "submitted") throw new Error("This report is locked for review.");
    const d = i.ids.find((x) => x.id === scanId);
    if (!d) throw new Error("ID not found.");
    const before = JSON.stringify({ role: d.role, ...d.fields });
    if (typeof change.role === "string") d.role = change.role.slice(0, 60);
    for (const k of ID_KEYS) if (typeof change.fields?.[k] === "string") d.fields[k] = change.fields[k]!.slice(0, k === "address" ? 160 : 80);
    const after = JSON.stringify({ role: d.role, ...d.fields });
    if (after !== before) record(i, by, "edited ID details", d.fields.fullName, before);
    if (change.confirmed === true && !d.confirmed) {
      d.confirmed = true;
      log(i, "id", `ID confirmed by officer: ${d.fields.fullName || "unnamed"}${d.role ? ` (${d.role})` : ""}`);
    }
    return d;
  });
}

export async function deleteId(id: string, scanId: string, by = "") {
  await mutate(id, (i) => {
    if (i.review.status === "approved" || i.review.status === "submitted") throw new Error("This report is locked for review.");
    const d = i.ids.find((x) => x.id === scanId);
    if (!d) return;
    record(i, by, "deleted an ID scan", d.fields.fullName, d.sha256);
    log(i, "id", `ID scan removed${d.fields.fullName ? `: ${d.fields.fullName}` : ""}`);
    i.ids = i.ids.filter((x) => x !== d);
  });
  const f = photoFile(id, scanId);
  if (f) fs.rmSync(f, { force: true });
}

// ---------- Diagram ----------
export async function saveDiagram(id: string, template: string, elements: DiagramEl[], png?: Buffer): Promise<Diagram> {
  return mutate(id, (i) => {
    const old = i.diagram?.image;
    const d: Diagram = { at: new Date().toISOString(), template: template.slice(0, 20), elements: elements.slice(0, 40) };
    if (png) {
      const did = newId();
      fs.writeFileSync(evidenceFile(id, did, "png")!, png);
      d.image = { id: did, sha256: sha256(png) };
      if (old) fs.rmSync(evidenceFile(id, old.id, "png")!, { force: true });
    }
    log(i, "diagram", i.diagram ? "Scene diagram updated" : "Scene diagram drawn");
    i.diagram = d;
    return d;
  });
}

// ---------- Conditions (GPS → address + weather) ----------
const WEATHER: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "rain showers", 81: "rain showers", 82: "violent rain showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

/** Look up the street address (OpenStreetMap) and current weather (Open-Meteo) for a GPS point. Both free, no key. */
export async function lookupConditions(lat: number, lon: number): Promise<Conditions> {
  const c: Conditions = { at: new Date().toISOString(), lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
  const timeout = () => AbortSignal.timeout(8000);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${c.lat}&lon=${c.lon}`, {
      headers: { "user-agent": "JarvisFieldAssistDemo/1.0 (personal project)", "accept-language": "en" },
      signal: timeout(),
    });
    const d = await r.json();
    const a = d.address || {};
    c.address = [[a.house_number, a.road].filter(Boolean).join(" "), a.city || a.town || a.village, a.state].filter(Boolean).join(", ") || d.display_name;
  } catch {}
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code,wind_speed_10m,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph`,
      { signal: timeout() }
    );
    const cur = (await r.json()).current;
    if (cur) {
      c.weather = WEATHER[cur.weather_code] ?? `code ${cur.weather_code}`;
      c.tempF = Math.round(cur.temperature_2m);
      c.windMph = Math.round(cur.wind_speed_10m);
      c.daylight = cur.is_day === 1;
    }
  } catch {}
  return c;
}

// ---------- Department settings (their own checklists and report sections) ----------
export function getSettings(): DeptSettings {
  try {
    return { department: "", checklists: [], reportSections: [], ...JSON.parse(fs.readFileSync(SETTINGS, "utf8")) };
  } catch {
    return { department: "", checklists: [], reportSections: [] };
  }
}
export function saveSettings(s: DeptSettings) {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
  return s;
}
/** Department checklists first, then the built-in samples. */
export const allChecklists = () => [...getSettings().checklists, ...FIELD_CHECKLISTS.filter((b) => !getSettings().checklists.some((c) => c.name === b.name))];

const IMPORT_PROMPT = `Below is a police department's policy, procedure, or report-writing guide.
Turn it into tools for officers on scene. Reply with ONLY JSON:
{"department": "department name if stated, else empty",
 "checklists": [{"name": "short name", "steps": ["one action per step, imperative, under 12 words"]}],
 "reportSections": ["section headings their reports must contain, in order, if the document says; else empty"]}
Use only what the document says. 1-6 checklists, 3-15 steps each.`;

export async function importPolicy(text: string): Promise<DeptSettings> {
  const raw = parseJsonReply(await askText(`${IMPORT_PROMPT}\n\n---\n${text.slice(0, 60_000)}`, "medium"));
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const checklists = arr(raw.checklists)
    .map((c) => ({ name: String(c?.name || "").slice(0, 60), steps: arr(c?.steps).map((s) => String(s).slice(0, 160)).filter(Boolean).slice(0, 20) }))
    .filter((c) => c.name && c.steps.length)
    .slice(0, 8);
  const s: DeptSettings = {
    department: String(raw.department || getSettings().department || "").slice(0, 100),
    checklists,
    reportSections: arr(raw.reportSections).map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 12),
    importedAt: new Date().toISOString(),
  };
  return saveSettings(s);
}

// ---------- AI: report draft + translation ----------
const DRAFT_PROMPT = `You help a police officer turn rough field notes into a clean incident report draft.
Rules:
- Use ONLY facts in the notes, timeline, statements, and photo captions. Never invent names, times, plates, injuries, or statements.
- Write the narrative in first person ("I observed..."), past tense, plain objective language, in time order.
- Describe people by role and what the notes say (e.g. "Driver of vehicle 1"); no guesses about race, ethnicity, or guilt.
- Witness statements: summarize what each witness said, attributed to them ("Witness 1 stated...").
- Put anything unclear or missing (times, names, statements, exact location) in "missing" as short questions.
Reply with ONLY JSON:
{"summary": "1-2 sentences", "narrative": "paragraphs separated by \\n\\n", "people": [{"role": "", "description": ""}],
 "vehicles": [{"description": "", "plate": "only if stated in notes"}], "evidence": ["photos, statements, items collected"], "followUps": ["next steps"], "missing": ["questions"]SECTIONS}`;

/** Draft the report from everything collected on scene. */
export async function draftReport(id: string, by = ""): Promise<ReportDraft> {
  const i = getIncident(id);
  if (!i) throw new Error("Incident not found.");
  if (!i.notes.trim() && !i.statements.length) throw new Error("Add some field notes first (speak or type what happened).");
  const dept = getSettings();
  const c = i.conditions;
  const facts = [
    `Incident: ${i.title}`,
    i.location && `Location: ${i.location}`,
    i.officer && `Reporting officer: ${i.officer}`,
    `Opened: ${new Date(i.createdAt).toLocaleString("en-US")}`,
    c && `Conditions (automatic, ${new Date(c.at).toLocaleTimeString("en-US")}): ${[c.address, c.weather, c.tempF != null && `${c.tempF}°F`, c.windMph != null && `wind ${c.windMph} mph`, c.daylight === false && "dark"].filter(Boolean).join(", ")}`,
    `Field notes:\n${i.notes || "(none)"}`,
    `Timeline:\n${i.timeline.map((t) => `${new Date(t.at).toLocaleTimeString("en-US")} ${t.text}`).join("\n")}`,
    i.ids.some((d) => d.confirmed) &&
      `People identified from ID cards (confirmed by officer):\n${i.ids
        .filter((d) => d.confirmed)
        .map((d) => `${d.role || "Person"}: ${d.fields.fullName}${d.fields.dob ? `, DOB ${d.fields.dob}` : ""}${d.fields.docType ? ` (${d.fields.issuer} ${d.fields.docType})` : ""}`)
        .join("\n")}`,
    i.statements.length && `Witness statements (in English):\n${i.statements.map((s, n) => `Witness ${n + 1} (${s.name || "unnamed"}${/^english$/i.test(s.language) ? "" : `, translated from ${s.language}`}): ${s.english}`).join("\n")}`,
    i.photos.length && `Scene photos:\n${i.photos.map((p, n) => `${n + 1}. ${new Date(p.at).toLocaleTimeString("en-US")} ${p.caption || "(no caption)"}`).join("\n")}`,
    i.diagram && `A scene diagram was drawn with: ${i.diagram.elements.map((e) => e.text || e.kind).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  const sections = dept.reportSections.length
    ? `,\n "sections": [${dept.reportSections.map((h) => `{"heading": ${JSON.stringify(h)}, "text": "..."}`).join(", ")}]  (this department's required sections; fill each from the facts, or "Not recorded")`
    : "";
  const raw = parseJsonReply(await askText(`${DRAFT_PROMPT.replace("SECTIONS", sections)}\n\n---\n${facts}`, "medium"));
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const result: ReportDraft = {
    summary: String(raw.summary || ""),
    narrative: String(raw.narrative || ""),
    people: arr(raw.people).map((p) => ({ role: String(p?.role || ""), description: String(p?.description || "") })),
    vehicles: arr(raw.vehicles).map((v) => ({ description: String(v?.description || ""), plate: v?.plate ? String(v.plate) : undefined })),
    evidence: arr(raw.evidence).map(String),
    followUps: arr(raw.followUps).map(String),
    missing: arr(raw.missing).map(String),
    sections: arr(raw.sections).map((s) => ({ heading: String(s?.heading || ""), text: String(s?.text || "") })).filter((s) => s.heading),
  };
  await mutate(id, (x) => {
    if (x.review.status === "approved") throw new Error("This report is approved. Reopen it before changing the draft.");
    record(x, by, x.draft ? "redrafted report with AI" : "drafted report with AI", undefined, x.draft ? JSON.stringify(x.draft.result) : undefined);
    log(x, "draft", x.draft ? "Report re-drafted" : "Report drafted");
    x.draft = { at: new Date().toISOString(), result };
  });
  return result;
}

/** Translate one spoken line. */
export async function translate(text: string, fromLang: string, toLang: string): Promise<string> {
  const out = await askText(
    `Translate this spoken text from ${fromLang} to ${toLang} for a face-to-face conversation with a police officer. Keep the meaning exact and the tone polite and plain. Reply with ONLY the translation.\n\n${text}`
  );
  return out.trim().replace(/^["“]|["”]$/g, "");
}
