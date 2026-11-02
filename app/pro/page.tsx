"use client";

import { useEffect, useState } from "react";
import { api, KIND_LABEL } from "@/lib/proClient";
import type { ProReport, Settings } from "@/lib/pro";

type Row = Omit<ProReport, "rooms"> & { photos: number; issues: number; analyzing: number };

export default function ProHome() {
  const [reports, setReports] = useState<Row[] | null>(null);
  const [settings, setSettings] = useState<Settings>({ business: "", contact: "" });
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    kind: "move-in",
    property: "",
    unit: "",
    tenant: "",
    inspector: "",
    date: new Date().toISOString().slice(0, 10),
    baseId: "",
  });

  useEffect(() => {
    api<{ reports: Row[]; settings: Settings }>("/api/pro/reports")
      .then((d) => {
        setReports(d.reports);
        setSettings(d.settings);
        setForm((f) => ({ ...f, inspector: f.inspector || d.settings.business }));
      })
      .catch((e) => setError(e.message));
  }, []);

  const moveIns = (reports || []).filter((r) => r.kind === "move-in");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Picking a move-in report fills in the same property, unit and tenant.
      if (k === "baseId") {
        const b = moveIns.find((r) => r.id === v);
        if (b) Object.assign(next, { property: b.property, unit: b.unit, tenant: b.tenant });
      }
      return next;
    });
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api<ProReport>("/api/pro/reports", { method: "POST", body: JSON.stringify(form) });
      location.href = `/pro/r/${r.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    try {
      setSettings(await api<Settings>("/api/pro/settings", { method: "PUT", body: JSON.stringify(settings) }));
      setShowSettings(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="pro">
      <div className="pro-top">
        <a href="/">← Jarvis</a>
        <span className="pro-brand">INSPECT PRO</span>
        <button className="btn ghost" onClick={() => setShowSettings((s) => !s)}>
          ⚙ Business
        </button>
      </div>

      {error && <p className="tool-error">{error}</p>}

      {showSettings && (
        <section className="card">
          <h2>Your business (printed on reports)</h2>
          <div className="grid2">
            <label className="field">
              Business or your name
              <input value={settings.business} onChange={(e) => setSettings({ ...settings, business: e.target.value })} placeholder="e.g. Bhattarai Property Inspections" />
            </label>
            <label className="field">
              Contact line
              <input value={settings.contact} onChange={(e) => setSettings({ ...settings, contact: e.target.value })} placeholder="phone · email" />
            </label>
          </div>
          <div className="row">
            <button className="btn" onClick={saveSettings}>
              Save
            </button>
          </div>
        </section>
      )}

      <form className="card" onSubmit={create}>
        <h2>New condition report</h2>
        <div className="grid2">
          <label className="field">
            Type
            <select value={form.kind} onChange={set("kind")}>
              <option value="move-in">Move-in</option>
              <option value="move-out">Move-out</option>
              <option value="general">General inspection</option>
            </select>
          </label>
          {form.kind === "move-out" && (
            <label className="field">
              Compare with move-in report
              <select value={form.baseId} onChange={set("baseId")}>
                <option value="">— none —</option>
                {moveIns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.property}
                    {r.unit ? ` #${r.unit}` : ""} · {r.date}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Property address *
            <input value={form.property} onChange={set("property")} placeholder="123 Main St, Jonesboro, AR" required />
          </label>
          <label className="field">
            Unit
            <input value={form.unit} onChange={set("unit")} placeholder="2B" />
          </label>
          <label className="field">
            Tenant
            <input value={form.tenant} onChange={set("tenant")} placeholder="Tenant name" />
          </label>
          <label className="field">
            Inspector
            <input value={form.inspector} onChange={set("inspector")} placeholder="Your name" />
          </label>
          <label className="field">
            Date
            <input type="date" value={form.date} onChange={set("date")} />
          </label>
        </div>
        <div className="row">
          <button className="btn" disabled={busy}>
            {busy ? "Creating…" : "Start report →"}
          </button>
          <span className="muted">Rooms: Entry, Living room, Kitchen, Bathroom, Bedroom 1 (you can add more)</span>
        </div>
      </form>

      <section className="card">
        <h2>Reports</h2>
        {reports === null ? (
          !error && <p className="muted">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="muted">No reports yet. Start one above.</p>
        ) : (
          reports.map((r) => (
            <a key={r.id} className="report-row" href={`/pro/r/${r.id}`}>
              <span className={`kind ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
              <span className="grow">
                <strong>
                  {r.property}
                  {r.unit ? ` #${r.unit}` : ""}
                </strong>
                <span className="muted">
                  {r.date}
                  {r.tenant ? ` · ${r.tenant}` : ""} · {r.photos} photo{r.photos === 1 ? "" : "s"} · {r.issues} finding{r.issues === 1 ? "" : "s"}
                  {r.analyzing ? ` · analyzing ${r.analyzing}…` : ""}
                </span>
              </span>
              <span aria-hidden>›</span>
            </a>
          ))
        )}
      </section>
    </main>
  );
}
