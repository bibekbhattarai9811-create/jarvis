"use client";

// Field Assist home: incidents list + start a new one.

import { useEffect, useState } from "react";
import { api } from "@/lib/proClient";

type Row = { id: string; createdAt: string; title: string; location: string; officer: string; photos: number; statements: number; hasDraft: boolean; status: string; words: number };
type Dept = { department: string; checklists: { name: string; steps: string[] }[]; reportSections: string[]; importedAt?: string };

/** Department setup: paste a policy / procedure, and Jarvis turns it into that department's checklists + report sections. */
function Department() {
  const [s, setS] = useState<Dept | null>(null);
  const [policy, setPolicy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api<{ settings: Dept }>("/api/field/settings")
      .then((d) => setS(d.settings))
      .catch(() => {});
    setOpen(location.hash === "#department");
  }, []);
  const post = async (body: object) => {
    setBusy(true);
    setErr("");
    try {
      setS((await api<{ settings: Dept }>("/api/field/settings", { method: "POST", body: JSON.stringify(body) })).settings);
      setPolicy("");
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(txt|md|text)$/i.test(f.name) && !f.type.startsWith("text/")) return setErr("Upload a .txt file, or copy the text out of the PDF and paste it here.");
    setPolicy((await f.text()).slice(0, 60000));
  };
  if (!s) return null;
  return (
    <section className="card" id="department">
      <div className="row">
        <h2 style={{ flex: 1 }}>🏛 Department {s.department ? `· ${s.department}` : ""}</h2>
        <button className="btn ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : s.checklists.length ? `${s.checklists.length} custom checklists` : "Set up"}
        </button>
      </div>
      {open && (
        <>
          <label className="field">
            Department name (printed on reports)
            <input defaultValue={s.department} onBlur={(e) => e.target.value !== s.department && post({ department: e.target.value })} placeholder="e.g. Jonesboro Police Department" />
          </label>
          <label className="field">
            Paste a policy, SOP, or report-writing guide
            <textarea rows={6} value={policy} onChange={(e) => setPolicy(e.target.value)} placeholder="Paste procedure text here… Jarvis turns it into step-by-step checklists and the report sections the department requires." />
          </label>
          <div className="row">
            <button className="btn" onClick={() => post({ policy })} disabled={busy || policy.trim().length < 80}>
              {busy ? "Reading policy…" : "✨ Build checklists from policy"}
            </button>
            <label className="btn ghost file-btn">
              📄 Load .txt
              <input type="file" accept=".txt,.md,text/plain" onChange={(e) => (readFile(e.target.files?.[0]), (e.target.value = ""))} />
            </label>
            {s.checklists.length > 0 && (
              <button className="linkbtn" onClick={() => confirm("Remove the department's checklists and sections?") && post({ reset: true })}>
                Reset to samples
              </button>
            )}
          </div>
          {err && <p className="tool-error">{err}</p>}
          {s.checklists.length > 0 && (
            <>
              <p className="muted">From the policy{s.importedAt ? ` (${new Date(s.importedAt).toLocaleDateString("en-US")})` : ""}: these show first in every incident.</p>
              {s.checklists.map((c) => (
                <details key={c.name}>
                  <summary>
                    <b>{c.name}</b> · {c.steps.length} steps
                  </summary>
                  <ol className="steps">
                    {c.steps.map((x, n) => (
                      <li key={n}>{x}</li>
                    ))}
                  </ol>
                </details>
              ))}
            </>
          )}
          {s.reportSections.length > 0 && <p className="muted">Report sections: {s.reportSections.join(" · ")}</p>}
        </>
      )}
    </section>
  );
}

export default function FieldHome() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", location: "", officer: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setForm((f) => ({ ...f, officer: localStorage.getItem("field-officer") || "" }));
    } catch {}
    api<{ incidents: Row[] }>("/api/field")
      .then((d) => setRows(d.incidents))
      .catch((e) => setError(e.message));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      try {
        localStorage.setItem("field-officer", form.officer);
      } catch {}
      const i = await api<{ id: string }>("/api/field", { method: "POST", body: JSON.stringify(form) });
      location.href = `/field/i/${i.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const useLocation = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => setForm((f) => ({ ...f, location: `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}` })),
      () => setError("Location is blocked for this site.")
    );

  return (
    <main className="pro">
      <div className="pro-top">
        <a href="/">← Jarvis</a>
        <span className="pro-brand">FIELD ASSIST</span>
        <span className="demo-tag">DEMO</span>
      </div>
      <p className="muted">
        Hands-free help on scene: dictate notes and get a report draft, log scene photos, talk across languages, and follow checklists step by step on the glasses.
        No face recognition or plate lookups.
      </p>

      {error && <p className="tool-error">{error}</p>}

      <form className="card" onSubmit={create}>
        <h2>New incident</h2>
        <div className="grid2">
          <label className="field">
            What happened *
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Two-car crash, Caraway Rd" required />
          </label>
          <label className="field">
            Location
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Address or intersection" />
              <button type="button" className="btn ghost" onClick={useLocation} title="Use this device's GPS">
                📍
              </button>
            </div>
          </label>
          <label className="field">
            Officer
            <input value={form.officer} onChange={(e) => setForm({ ...form, officer: e.target.value })} placeholder="Name / badge" />
          </label>
        </div>
        <div className="row">
          <button className="btn" disabled={busy}>
            {busy ? "Starting…" : "Start incident"}
          </button>
        </div>
      </form>

      <Department />

      <section className="card">
        <h2>Incidents</h2>
        {!rows && !error && <p className="muted">Loading…</p>}
        {rows?.length === 0 && <p className="muted">None yet.</p>}
        {rows?.map((r) => (
          <a key={r.id} className="report-row" href={`/field/i/${r.id}`}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{r.title}</b>
              <div className="muted">
                {new Date(r.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                {r.location ? ` · ${r.location}` : ""}
              </div>
            </div>
            <span className="muted">
              {r.words} words · {r.photos} photos{r.statements ? ` · ${r.statements} statements` : ""}
              {r.hasDraft ? " · draft ✓" : ""}
            </span>
            <span className={`status ${r.status}`}>{r.status}</span>
          </a>
        ))}
      </section>
    </main>
  );
}
