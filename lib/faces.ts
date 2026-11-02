// Known faces for recognition. Stored only on this PC (data/faces.json) as face "fingerprints":
// 128 numbers per sample that describe a face's shape. No photos are kept, and they can't be turned back into one.

import fs from "fs";
import path from "path";

export type KnownFace = { name: string; descriptors: number[][]; addedAt: string };

const FILE = path.join(process.cwd(), "data", "faces.json");
const MAX_SAMPLES = 20;

export function listFaces(): KnownFace[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(faces: KnownFace[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(faces));
}

const valid = (d: unknown): d is number[] => Array.isArray(d) && d.length === 128 && d.every((x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 2);

/** Add samples for a person (new name, or more samples for an existing one). */
export function addFace(rawName: string, descriptors: unknown[]): KnownFace | null {
  const name = rawName.trim().replace(/[^\p{L}\p{N} .'-]/gu, "").slice(0, 30);
  const good = descriptors.filter(valid).slice(0, MAX_SAMPLES);
  if (!name || !good.length) return null;
  const faces = listFaces();
  const existing = faces.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.descriptors = [...existing.descriptors, ...good].slice(-MAX_SAMPLES);
  else faces.push({ name, descriptors: good, addedAt: new Date().toISOString() });
  save(faces);
  return existing || faces[faces.length - 1];
}

export function removeFace(name: string) {
  save(listFaces().filter((f) => f.name.toLowerCase() !== name.toLowerCase()));
}
