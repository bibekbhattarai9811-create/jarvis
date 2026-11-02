"use client";

// Inspection log: every saved report, newest first. Open one to see it with its photo, print it or delete it.

import { useEffect, useState } from "react";
import ReportView, { type Report } from "../ReportView";

function pin(): string {
  try {
    return localStorage.getItem("jarvis-pin") || "";
  } catch {
    return "";
  }
}

export default function Inspections() {
  const [list, setList] = useState<Report[] | null>(null);
  const [open, setOpen] = useState<Report | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/inspections", { headers: { "x-jarvis-pin": pin() } })
      .then(async (r) => {
        if (r.status === 401) throw new Error("Open Jarvis once on this device and enter your passcode first.");
        setList(await r.json());
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const show = async (id: string) => {
    const r = await fetch(`/api/inspections?id=${encodeURIComponent(id)}`, { headers: { "x-jarvis-pin": pin() } });
    if (r.ok) setOpen(await r.json());
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this report?")) return;
    await fetch(`/api/inspections?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-jarvis-pin": pin() } });
    setOpen(null);
    load();
  };

  return (
    <main className="tool">
      <style>{`html, body { overflow: auto !important; }`}</style>
      <div className="tool-top no-print">
        {open ? (
          <button className="btn ghost" onClick={() => setOpen(null)}>
            ← All reports
          </button>
        ) : (
          <a href="/inspect">← Inspect</a>
        )}
        <span className="tool-title">REPORTS</span>
        <a href="/">Jarvis</a>
      </div>

      {error && <p className="tool-error">{error}</p>}

      {open ? (
        <>
          <ReportView report={open} />
          <div className="tool-row no-print">
            <button className="btn" onClick={() => window.print()}>
              Print / Save PDF
            </button>
            <button className="btn ghost" onClick={() => remove(open.id)}>
              Delete
            </button>
          </div>
        </>
      ) : list === null ? (
        !error && <p className="tool-empty">Loading…</p>
      ) : list.length === 0 ? (
        <p className="tool-empty">
          No inspections yet. <a href="/inspect">Inspect something</a>.
        </p>
      ) : (
        <div className="report-list">
          {list.map((r) => (
            <button key={r.id} onClick={() => show(r.id)}>
              <span className={`cond ${r.condition}`}>{r.score}/10</span>
              <span>
                <strong style={{ textTransform: "capitalize" }}>{r.object}</strong>
                <small>
                  {new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · {r.issues.length} finding
                  {r.issues.length === 1 ? "" : "s"}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
