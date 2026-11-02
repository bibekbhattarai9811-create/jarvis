import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "memory.json");

export function listMemory(): string[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(notes: string[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(notes, null, 2));
}

export function remember(note: string) {
  const notes = listMemory();
  if (!notes.includes(note)) save([...notes, note].slice(-100));
}

export function forget(match: string): number {
  const notes = listMemory();
  const keep = notes.filter((n) => !n.toLowerCase().includes(match.toLowerCase()));
  save(keep);
  return notes.length - keep.length;
}
