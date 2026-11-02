import fs from "fs";
import path from "path";
import type { Inspection } from "./brain";

const DIR = path.join(process.cwd(), "data", "inspections");
const INDEX = path.join(DIR, "index.json");

export type Saved = Inspection & { id: string; at: string; note: string };

export function listInspections(): Saved[] {
  try {
    return JSON.parse(fs.readFileSync(INDEX, "utf8"));
  } catch {
    return [];
  }
}

export function saveInspection(report: Inspection, note: string, jpeg: Buffer): Saved {
  fs.mkdirSync(DIR, { recursive: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(path.join(DIR, `${id}.jpg`), jpeg);
  const saved: Saved = { ...report, id, at: new Date().toISOString(), note };
  fs.writeFileSync(INDEX, JSON.stringify([saved, ...listInspections()].slice(0, 500), null, 2));
  return saved;
}

export function inspectionImage(id: string): string | null {
  if (!/^[a-z0-9]+$/.test(id)) return null;
  try {
    return `data:image/jpeg;base64,${fs.readFileSync(path.join(DIR, `${id}.jpg`)).toString("base64")}`;
  } catch {
    return null;
  }
}

export function deleteInspection(id: string) {
  if (!/^[a-z0-9]+$/.test(id)) return;
  fs.writeFileSync(INDEX, JSON.stringify(listInspections().filter((r) => r.id !== id), null, 2));
  fs.rmSync(path.join(DIR, `${id}.jpg`), { force: true });
}
