"use client";

import { useState } from "react";
import type { Inspection } from "@/lib/brain";

export type Report = Inspection & { id: string; at: string; note: string; image?: string | null };

const CONDITION_LABEL: Record<Inspection["condition"], string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  critical: "Critical",
  unknown: "Unclear photo",
};

/** One inspection report: photo with numbered issue markers, condition, issues, next steps, safety. */
export default function ReportView({ report }: { report: Report }) {
  const r = report;
  const [active, setActive] = useState<number | null>(null);
  return (
    <article className="report">
      <header className="report-head">
        <div>
          <h2>{r.object}</h2>
          <p className="report-meta">
            {r.category} · {new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <div className={`cond ${r.condition}`}>
          <strong>{CONDITION_LABEL[r.condition]}</strong>
          <span>{r.score}/10</span>
        </div>
      </header>

      {r.image && (
        <div className="report-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.image} alt={r.object} />
          {r.issues.map((i, n) => (
            <span
              key={n}
              className={`marker ${i.severity} ${active === n ? "active" : ""}`}
              style={{
                left: `${i.x * 100}%`,
                top: `${i.y * 100}%`,
                cursor: "pointer",
                transform: active === n ? "translate(-50%, -50%) scale(1.35)" : "translate(-50%, -50%)",
                zIndex: active === n ? 3 : 1,
                transition: "transform 0.15s",
              }}
              onClick={() => setActive(active === n ? null : n)}
              title={`${n + 1}. ${i.label}`}
            >
              {n + 1}
            </span>
          ))}
        </div>
      )}

      {r.note && <p className="report-note">You asked: “{r.note}”</p>}
      {r.summary && <p className="report-summary">{r.summary}</p>}

      {r.safety && <p className="report-safety">⚠ {r.safety}</p>}

      {r.issues.length > 0 ? (
        <section>
          <h3>Findings {r.issues.length > 1 && <small style={{ fontWeight: 400, opacity: 0.7 }}>(tap a pin or item to highlight)</small>}</h3>
          <ol className="report-issues">
            {r.issues.map((i, n) => (
              <li
                key={n}
                onClick={() => setActive(active === n ? null : n)}
                style={{
                  cursor: "pointer",
                  padding: "6px 8px",
                  borderRadius: 10,
                  background: active === n ? "rgba(63, 216, 255, 0.14)" : "transparent",
                  border: active === n ? "1px solid rgba(63, 216, 255, 0.45)" : "1px solid transparent",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <span className={`sev ${i.severity}`}>{i.severity}</span>
                <div>
                  <strong>
                    {n + 1}. {i.label}
                  </strong>
                  <p>{i.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="report-summary">No visible issues found.</p>
      )}

      {r.actions.length > 0 && (
        <section>
          <h3>Next steps</h3>
          <ul className="report-actions">
            {r.actions.map((a, n) => (
              <li key={n}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="report-disclaimer">
        AI visual check from one photo; marker positions are approximate. Not a substitute for a licensed inspector, especially for structural, gas,
        electrical or brake problems.
      </p>
    </article>
  );
}
