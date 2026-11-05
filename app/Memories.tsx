"use client";

// ⚙ → Memory (owner only): what Jarvis remembers about you, with a way to add or forget notes.

import { useEffect, useState } from "react";

export default function Memories({ pin }: { pin: string }) {
  const [notes, setNotes] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    fetch("/api/memory", { headers: { "x-jarvis-pin": pin } })
      .then((r) => (r.ok ? r.json() : { memory: [] }))
      .then((d: { memory?: string[] }) => setNotes(d.memory || []))
      .catch(() => setNotes([]));
  }, [pin]);

  if (!notes) return null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const r = await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json", "x-jarvis-pin": pin },
      body: JSON.stringify({ note: draft.trim() }),
    });
    if (r.ok) {
      setNotes((await r.json()).memory || []);
      setDraft("");
    }
  };

  const remove = async (note: string) => {
    const r = await fetch(`/api/memory?match=${encodeURIComponent(note)}`, {
      method: "DELETE",
      headers: { "x-jarvis-pin": pin },
    });
    if (r.ok) setNotes((await r.json()).memory || []);
  };

  return (
    <div className="guest">
      <b>What Jarvis remembers</b>
      {notes.length === 0 ? (
        <p className="muted">Nothing yet. Say “Jarvis, remember my exam is on Friday” or add a note below.</p>
      ) : (
        <div className="guest-row">
          {notes.map((n) => (
            <button key={n} className="pill" onClick={() => remove(n)} title="Forget this note">
              {n} ✕
            </button>
          ))}
        </div>
      )}
      <form className="guest-row" onSubmit={add}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note for Jarvis to remember…"
          style={{ flex: 1, minWidth: 160, background: "#071420", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 13 }}
        />
        <button className="pill" disabled={!draft.trim()}>
          + Add
        </button>
      </form>
    </div>
  );
}
