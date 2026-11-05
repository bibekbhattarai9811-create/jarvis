import fs from "fs";
import path from "path";
import { dataDir } from "./paths";

const FILE = path.join(dataDir(), "memory.json");

export function listMemory(): string[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(notes: string[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(notes, null, 2));
  fs.renameSync(tmp, FILE);
}

export function remember(note: string) {
  const clean = note.trim().slice(0, 400);
  if (!clean) return;
  const notes = listMemory();
  if (!notes.includes(clean)) save([...notes, clean].slice(-100));
}

export function forget(match: string): number {
  const notes = listMemory();
  const keep = notes.filter((n) => !n.toLowerCase().includes(match.toLowerCase()));
  save(keep);
  return notes.length - keep.length;
}
