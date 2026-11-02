"use client";

// The record: what happened on scene (timeline), whether the evidence is untouched (fingerprints),
// supervisor review, and every edit made to the report (history).

import { useState } from "react";
import { api } from "@/lib/proClient";
import type { Incident } from "@/lib/field";

type Verify = { checkedAt: string; allOk: boolean; items: { label: string; sha256: string; ok: boolean }[] };

const STATUS: Record<string, string> = { open: "Being written", submitted: "Waiting for supervisor review", approved: "Approved", returned: "Returned for changes" };
const time = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export default function Record({ i, fingerprint, patch, me }: { i: Incident; fingerprint: string; patch: (b: object) => Promise<void>; me: string }) {
  const [verify, setVerify] = useState<Verify | null>(null);
  const [checking, setChecking] = useState(false);
  const [reviewer, setReviewer] = useState("");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const r = i.review;

  const check = async () => {
    setChecking(true);
    try {
      setVerify(await api<Verify>(`/api/field/${i.id}/extras`));
    } catch (e) {
      setErr((e as Error).message);
    }
    setChecking(false);
  };
  const review = (action: string, by = reviewer) => {
    setErr("");
    patch({ by, review: { action, comment } }).then(() => setComment(""));
  };

  return (
    <>
      <section className="card">
        <div className="row">
          <h3 style={{ flex: 1 }}>Supervisor review</h3>
          <span className={`status ${r.status}`}>{STATUS[r.status]}</span>
        </div>
        {r.by && r.at && (
          <p className="muted">
            {r.status === "submitted" ? "Submitted" : r.status === "approved" ? "Approved" : r.status === "returned" ? "Returned" : "Reopened"} by {r.by} ·{" "}
            {new Date(r.at).toLocaleString("en-US")}
            {r.comment ? ` · “${r.comment}”` : ""}
          </p>
        )}
        {(r.status === "open" || r.status === "returned") && (
          <div className="row">
            <button className="btn" onClick={() => review("submit", me)} disabled={!i.draft}>
              Submit for review
            </button>
            {!i.draft && <span className="muted">Draft the report first.</span>}
          </div>
        )}
        {r.status === "submitted" && (
          <>
            <div className="grid2">
              <label className="field">
                Supervisor name *
                <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Sgt. …" />
              </label>
              <label className="field">
                Comment (needed to return)
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What needs fixing?" />
              </label>
            </div>
            <div className="row">
              <button className="btn" onClick={() => review("approve")} disabled={!reviewer.trim()}>
                ✓ Approve
              </button>
              <button className="btn ghost" onClick={() => review("return")} disabled={!reviewer.trim() || !comment.trim()}>
                ↩ Return for changes
              </button>
            </div>
          </>
        )}
        {r.status === "approved" && (
          <div className="row">
            <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Reason to reopen" style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => review("reopen", me)} disabled={!comment.trim()}>
              Reopen
            </button>
          </div>
        )}
        <p className="muted">While a report is submitted or approved, notes, the draft and evidence are locked.</p>
        {err && <p className="tool-error">{err}</p>}
      </section>

      <section className="card">
        <div className="row">
          <h3 style={{ flex: 1 }}>🔒 Evidence integrity</h3>
          <button className="btn ghost" onClick={check} disabled={checking}>
            {checking ? "Checking…" : "Verify evidence"}
          </button>
        </div>
        <p className="muted">
          Every photo, signature and diagram got a SHA-256 fingerprint the moment it was saved. If a file is changed even slightly, its fingerprint no longer matches.
        </p>
        <p className="fp">
          Report fingerprint: <code>{fingerprint.slice(0, 16)}…</code>
        </p>
        {verify && (
          <>
            <p className={verify.allOk ? "ok-line" : "bad-line"}>
              {verify.items.length === 0 ? "No evidence files yet." : verify.allOk ? `✓ All ${verify.items.length} files are unchanged` : "⚠ Some files don't match their fingerprint"}
            </p>
            {verify.items.map((x, n) => (
              <div key={n} className="fp-row">
                <span>{x.ok ? "✓" : "✗"}</span>
                <span style={{ flex: 1 }}>{x.label}</span>
                <code>{x.sha256.slice(0, 12)}…</code>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="card">
        <h3>Timeline</h3>
        <div className="timeline">
          {i.timeline.map((t, n) => (
            <div key={n} className={`tl ${t.kind}`}>
              <span>{time(t.at)}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Edit history ({i.history.length})</h3>
        {i.history.length === 0 && <p className="muted">No edits yet.</p>}
        {[...i.history].reverse().map((h, n) => (
          <details key={n} className="hist">
            <summary>
              <b>{h.by}</b> {h.action}
              {h.detail ? `: ${h.detail}` : ""} · <span className="muted">{new Date(h.at).toLocaleString("en-US")}</span>
            </summary>
            {h.before && <pre className="notes">Before:{"\n"}{h.before.length > 3000 ? `${h.before.slice(0, 3000)}…` : h.before}</pre>}
          </details>
        ))}
      </section>
    </>
  );
}
