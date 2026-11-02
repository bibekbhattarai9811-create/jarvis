"use client";

// Witness statements: the witness speaks in their language, Jarvis transcribes it, reads it back to them,
// they sign on the screen, and it's saved with an English translation and a fingerprinted signature.

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/proClient";
import type { IdScan, Incident } from "@/lib/field";
import { canListen, dictate, LANGUAGES, say } from "@/lib/speech";

const LANGS = [{ name: "English", code: "en-US" }, ...LANGUAGES];

export default function Statements({ i, reload, setError }: { i: Incident; reload: () => void; setError: (s: string) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="card">
      <div className="row">
        <h3 style={{ flex: 1 }}>Witness statements ({i.statements.length})</h3>
        {!adding && i.review.status !== "approved" && (
          <button className="btn" onClick={() => setAdding(true)}>
            + New statement
          </button>
        )}
      </div>
      {adding && (
        <NewStatement
          id={i.id}
          ids={i.ids.filter((d) => d.confirmed)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
          onCancel={() => setAdding(false)}
          setError={setError}
        />
      )}
      {!adding && i.statements.length === 0 && <p className="muted">The witness speaks in their own language; Jarvis writes it down, reads it back, and they sign on the screen.</p>}
      {i.statements.map((s, n) => (
        <div key={s.id} className="stmt">
          <div className="row">
            <b style={{ flex: 1 }}>
              Witness {n + 1}: {s.name || "unnamed"}
            </b>
            <span className="muted">{new Date(s.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
          </div>
          {s.contact && <div className="muted">{s.contact}</div>}
          {!/^english$/i.test(s.language) && (
            <p className="orig">
              <small>{s.language} (original)</small>
              {s.original}
            </p>
          )}
          <p style={{ margin: 0 }}>
            {!/^english$/i.test(s.language) && <small className="muted">English translation: </small>}
            {s.english}
          </p>
          <div className="row muted" style={{ fontSize: 12 }}>
            {s.readBack ? "✓ Read back to witness" : "Not read back"}
            {s.signature ? " · ✓ Signed" : " · Not signed"}
          </div>
          {s.signature && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="sig-img" src={`/api/field/photo?i=${i.id}&p=${s.signature.id}&t=png`} alt={`Signature of ${s.name}`} />
          )}
        </div>
      ))}
    </section>
  );
}

function NewStatement({ id, ids, onDone, onCancel, setError }: { id: string; ids: IdScan[]; onDone: () => void; onCancel: () => void; setError: (s: string) => void }) {
  const [lang, setLang] = useState("English");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [text, setText] = useState("");
  const [live, setLive] = useState("");
  const [rec, setRec] = useState<{ stop(): void } | null>(null);
  const [readBack, setReadBack] = useState(false);
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const pad = useRef<HTMLCanvasElement>(null);
  const code = LANGS.find((l) => l.name === lang)!.code;

  // Signature pad
  useEffect(() => {
    const c = pad.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const fit = () => {
      c.width = c.clientWidth * 2;
      c.height = c.clientHeight * 2;
      ctx.scale(2, 2);
      ctx.lineWidth = 2.5;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.strokeStyle = "#0a1a2a";
    };
    fit();
    let drawing = false;
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const down = (e: PointerEvent) => {
      drawing = true;
      c.setPointerCapture(e.pointerId);
      const [x, y] = at(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const [x, y] = at(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      setSigned(true);
    };
    const up = () => (drawing = false);
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
    };
  }, []);
  const clearSig = () => {
    const c = pad.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setSigned(false);
  };

  const record = () => {
    if (rec) return rec.stop();
    setLive("");
    setRec(
      dictate(code, true, setLive, (t, err) => {
        setRec(null);
        setLive("");
        if (err) setError(err);
        if (t) setText((old) => (old ? `${old} ${t}` : t));
        setReadBack(false);
      })
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/field/${id}/extras`, {
        method: "POST",
        body: JSON.stringify({ what: "statement", name, contact, language: lang, original: text, readBack, signature: signed ? pad.current!.toDataURL("image/png") : undefined }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="stmt new">
      {ids.length > 0 && (
        <label className="field">
          Fill from a scanned ID
          <select
            defaultValue=""
            onChange={(e) => {
              const d = ids.find((x) => x.id === e.target.value);
              if (d) {
                setName(d.fields.fullName);
                if (d.fields.address && !contact) setContact(d.fields.address);
              }
            }}
          >
            <option value="">—</option>
            {ids.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fields.fullName} ({d.role || "ID"})
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid2">
        <label className="field">
          Witness name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </label>
        <label className="field">
          Contact
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone or email" />
        </label>
        <label className="field">
          Language they speak
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l.name}>{l.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        {canListen() && code && (
          <button className={`btn ${rec ? "rec" : ""}`} onClick={record}>
            {rec ? "■ Stop" : `🎤 Record (${lang})`}
          </button>
        )}
        {text && code && (
          <button
            className="btn ghost"
            onClick={() => {
              say(text, code);
              setReadBack(true);
            }}
          >
            🔊 Read it back to them
          </button>
        )}
      </div>
      {rec && <p className="live">{live || "Listening… ask them: tell me what happened."}</p>}
      <textarea rows={5} value={text} onChange={(e) => (setText(e.target.value), setReadBack(false))} placeholder={`Statement in ${lang} (spoken or typed)`} />
      <label className="row" style={{ fontSize: 14 }}>
        <input type="checkbox" checked={readBack} onChange={(e) => setReadBack(e.target.checked)} /> The witness heard or read the statement and says it&apos;s correct
      </label>
      <div className="sig-label">
        <span>Witness signature</span>
        <button className="linkbtn" onClick={clearSig}>
          Clear
        </button>
      </div>
      <canvas ref={pad} className="sig-pad" />
      <div className="row">
        <button className="btn" onClick={save} disabled={saving || !text.trim()}>
          {saving ? (/^english$/i.test(lang) ? "Saving…" : "Translating & saving…") : "Save statement"}
        </button>
        <button className="btn ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
