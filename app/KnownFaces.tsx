"use client";

// ⚙ → Faces (owner only): who Jarvis recognizes, with a way to forget someone.

import { useEffect, useState } from "react";

type Face = { name: string; samples: number };

export default function KnownFaces({ pin }: { pin: string }) {
  const [faces, setFaces] = useState<Face[] | null>(null);
  useEffect(() => {
    fetch("/api/faces", { headers: { "x-jarvis-pin": pin } })
      .then((r) => (r.ok ? r.json() : { faces: [] }))
      .then((d: { faces: { name: string; descriptors: unknown[] }[] }) => setFaces(d.faces.map((f) => ({ name: f.name, samples: f.descriptors.length }))))
      .catch(() => setFaces([]));
  }, [pin]);
  if (!faces) return null;
  const forget = async (name: string) => {
    if (!window.confirm(`Forget ${name}'s face?`)) return;
    const r = await fetch(`/api/faces?name=${encodeURIComponent(name)}`, { method: "DELETE", headers: { "x-jarvis-pin": pin } });
    if (r.ok) setFaces((await r.json()).faces);
  };
  return (
    <div className="guest">
      <b>Faces Jarvis knows</b>
      {faces.length === 0 ? (
        <p className="muted">None yet. In HOLO, tap 👤 Learn face, or say “Jarvis, remember my face”.</p>
      ) : (
        <div className="guest-row">
          {faces.map((f) => (
            <button key={f.name} className="pill" onClick={() => forget(f.name)} title="Forget this face">
              {f.name} ✕
            </button>
          ))}
        </div>
      )}
      <p className="muted">Saved only on your PC as face measurements, not photos. Faces greet and label people; they never unlock Jarvis.</p>
    </div>
  );
}
