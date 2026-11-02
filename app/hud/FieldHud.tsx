"use client";

// Glasses view of a Field Assist incident (/hud?field=<id>): the current checklist step, or the latest
// translated line in big text so the officer can read what the other person said. Pinch = next step.
// Black = see-through on the glasses.

import { useEffect, useState } from "react";
import { api } from "@/lib/proClient";
import type { Incident } from "@/lib/field";

type Data = { incident: Incident; checklists: { name: string; steps: string[] }[] };

export default function FieldHud({ id }: { id: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const x = await api<Data>(`/api/field/${id}`);
        if (!stop) {
          setD(x);
          setError("");
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) setTimeout(tick, 2000);
    };
    tick();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(clock);
    };
  }, [id]);

  // Pinch (tap / Space / Enter / message from the simulator) = checklist step done, go to the next.
  useEffect(() => {
    const next = async () => {
      if (!d?.incident.checklist) return;
      try {
        const x = await api<{ incident: Incident }>(`/api/field/${id}`, { method: "PATCH", body: JSON.stringify({ step: "next" }) });
        setD((old) => (old ? { ...old, incident: x.incident } : old));
      } catch {}
    };
    const onKey = (e: KeyboardEvent) => (e.code === "Space" || e.code === "Enter") && (e.preventDefault(), next());
    const onMsg = (e: MessageEvent) => e.origin === location.origin && e.data === "jarvis-pinch" && next();
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMsg);
    window.addEventListener("click", next);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMsg);
      window.removeEventListener("click", next);
    };
  }, [d, id]);

  const i = d?.incident;
  const list = i?.checklist && d?.checklists.find((c) => c.name === i.checklist!.name);
  const t = i?.lastTranslation;
  const freshT = t && now - new Date(t.at).getTime() < 45_000; // show a translation for 45 s

  return (
    <main className="fhud">
      <div className="fhud-screen">
        <div className="fhud-top">
          <span>{new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          <span className="fhud-mark">FIELD</span>
        </div>
        {error && <p className="fhud-msg">{error}</p>}
        {!d && !error && <p className="fhud-msg">Connecting…</p>}
        {i && <div className="fhud-title">{i.title}</div>}

        {i && freshT && t && (
          <div className="fhud-tr">
            <small>{t.speaker === "officer" ? `YOU → ${t.toLang.toUpperCase()}` : `${t.fromLang.toUpperCase()} → YOU`}</small>
            <div className={t.speaker === "other" ? "big" : "mid"}>{t.text}</div>
            {t.speaker === "other" && <div className="heard">“{t.heard}”</div>}
          </div>
        )}

        {i && !freshT && list && i.checklist && (
          <div className="fhud-step">
            {i.checklist.step >= list.steps.length ? (
              <div className="big done">✓ {list.name} complete</div>
            ) : (
              <>
                <small>
                  {list.name.toUpperCase()} · STEP {i.checklist.step + 1}/{list.steps.length}
                </small>
                <div className="big">{list.steps[i.checklist.step]}</div>
                {list.steps[i.checklist.step + 1] && <div className="next">Next: {list.steps[i.checklist.step + 1]}</div>}
                <div className="hint">Pinch when done</div>
              </>
            )}
          </div>
        )}
        {i && !freshT && !list && <p className="fhud-msg">Pick a checklist or start translating on your phone.</p>}

        {i && i.timeline.length > 0 && (
          <div className="fhud-last">
            {new Date(i.timeline[i.timeline.length - 1].at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {i.timeline[i.timeline.length - 1].text}
          </div>
        )}
        {i && (
          <div className="fhud-bottom">
            <span>📝 {i.notes.split(/\s+/).filter(Boolean).length} words</span>
            <span>📷 {i.photos.length}</span>
            <span>{i.draft ? "Draft ✓" : "No draft"}</span>
          </div>
        )}
      </div>
      <style>{`
        html, body { background: #000 !important; overflow: hidden; }
        .fhud { position: fixed; inset: 0; display: grid; place-items: center; background: #000; color: #9fe8ff;
          font-family: "Segoe UI", system-ui, sans-serif; user-select: none; cursor: pointer; }
        .fhud-screen { width: min(100vw, 100vh); aspect-ratio: 1; display: flex; flex-direction: column; gap: 2.6vmin; padding: 5%; overflow: hidden; }
        .fhud-top, .fhud-bottom { display: flex; justify-content: space-between; font-size: clamp(11px, 3.4vmin, 20px); opacity: .85; }
        .fhud-last { margin-top: auto; font-size: clamp(10px, 3.2vmin, 19px); color: #9fe8ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: .8; }
        .fhud-last + .fhud-bottom { margin-top: 0; }
        .fhud-bottom { margin-top: auto; }
        .fhud-mark { letter-spacing: .3em; font-weight: 600; color: #ffb547; }
        .fhud-title { font-size: clamp(12px, 4vmin, 24px); color: #e8fbff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fhud-msg { margin: auto 0; text-align: center; font-size: clamp(14px, 5vmin, 30px); color: #e8fbff; }
        .fhud-step, .fhud-tr { display: flex; flex-direction: column; gap: 2vmin; margin: auto 0; }
        .fhud small { font-size: clamp(10px, 3vmin, 18px); letter-spacing: .1em; color: #ffb547; }
        .fhud .big { font-size: clamp(18px, 7.5vmin, 46px); line-height: 1.2; color: #fff; text-shadow: 0 0 12px rgba(63,216,255,.6); }
        .fhud .mid { font-size: clamp(14px, 5.5vmin, 34px); line-height: 1.25; color: #e8fbff; }
        .fhud .big.done { color: #4dff9a; }
        .fhud .next, .fhud .heard { font-size: clamp(11px, 3.6vmin, 22px); color: #9fe8ff; opacity: .8; }
        .fhud .hint { font-size: clamp(10px, 3vmin, 18px); opacity: .55; }
      `}</style>
    </main>
  );
}
