"use client";

// Printable condition report. Use the browser's Print → "Save as PDF".

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, KIND_LABEL, photoUrl } from "@/lib/proClient";
import type { ProReport, Settings, summarize } from "@/lib/pro";
import { checklistFor } from "@/lib/checklists";

type Data = { report: ProReport; summary: ReturnType<typeof summarize>; settings: Settings; base: ProReport | null };

const TITLE: Record<string, string> = {
  "move-in": "Move-in Condition Report",
  "move-out": "Move-out Condition Report",
  general: "Property Condition Report",
};

export default function PrintReport() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Data>(`/api/pro/reports/${id}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);

  if (!d) return <p style={{ padding: 20, color: "#111", background: "#fff" }}>{error || "Loading…"}</p>;
  const { report: r, summary: s, settings } = d;
  const pending = r.rooms.some((x) => x.photos.some((p) => p.status === "analyzing"));
  let n = 0; // running finding number across the whole report

  return (
    <div className="doc-root">
      <div className="doc-bar">
        <a className="btn" href={`/pro/r/${r.id}`} style={{ color: "#111", background: "#fff", borderColor: "#999" }}>
          ← Back to report
        </a>
        <button className="btn" onClick={() => window.print()} style={{ color: "#fff", background: "#111", borderColor: "#111" }}>
          Print / Save as PDF
        </button>
      </div>
      <article className="doc">
        {pending && <p className="flag">Some photos are still being analyzed. Wait for them to finish before printing.</p>}
        <div className="head">
          <div>
            <h1>{TITLE[r.kind]}</h1>
            <div>
              {r.property}
              {r.unit ? `, Unit ${r.unit}` : ""}
            </div>
          </div>
          <div className="biz">
            {settings.business && <b>{settings.business}</b>}
            {settings.contact && <div>{settings.contact}</div>}
            <div>Report #{r.id.toUpperCase()}</div>
          </div>
        </div>

        <table>
          <tbody>
            <tr>
              <th style={{ width: "22%" }}>Inspection type</th>
              <td>{KIND_LABEL[r.kind]}</td>
              <th style={{ width: "18%" }}>Date</th>
              <td>{r.date}</td>
            </tr>
            <tr>
              <th>Tenant</th>
              <td>{r.tenant || "—"}</td>
              <th>Inspector</th>
              <td>{r.inspector || "—"}</td>
            </tr>
            {d.base && (
              <tr>
                <th>Compared with</th>
                <td colSpan={3}>
                  Move-in report #{d.base.id.toUpperCase()} dated {d.base.date}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h2>Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Room</th>
              <th>Photos</th>
              <th>Avg condition</th>
              <th>High</th>
              <th>Medium</th>
              <th>Low</th>
              {d.base && <th>Changes since move-in</th>}
            </tr>
          </thead>
          <tbody>
            {r.rooms.map((room) => {
              const res = room.photos.map((p) => p.result).filter((x): x is NonNullable<typeof x> => !!x);
              const iss = res.flatMap((x) => x.issues);
              const avg = res.length ? (res.reduce((a, x) => a + x.score, 0) / res.length).toFixed(1) : "—";
              const ch = room.compare?.result?.changes;
              return (
                <tr key={room.name}>
                  <td>{room.name}</td>
                  <td>{room.photos.length}</td>
                  <td>{avg === "—" ? avg : `${avg}/10`}</td>
                  <td>{iss.filter((i) => i.severity === "high").length}</td>
                  <td>{iss.filter((i) => i.severity === "medium").length}</td>
                  <td>{iss.filter((i) => i.severity === "low").length}</td>
                  {d.base && <td>{ch ? `${ch.length} (${ch.filter((c) => c.beyondWear).length} flagged)` : "not compared"}</td>}
                </tr>
              );
            })}
            <tr>
              <th>Total</th>
              <th>{s.photos}</th>
              <th>{s.avgScore ?? "—"}/10</th>
              <th>{s.bySeverity.high}</th>
              <th>{s.bySeverity.medium}</th>
              <th>{s.bySeverity.low}</th>
              {d.base && <th />}
            </tr>
          </tbody>
        </table>
        <p style={{ margin: "4px 0" }}>
          Findings by type: {s.byType.filter((t) => t.count).map((t) => `${t.type} ${t.count}`).join(" · ") || "none"}
        </p>

        {r.rooms
          .filter((room) => room.photos.length || room.notes || room.checked?.length)
          .map((room) => (
            <section key={room.name} className="room">
              <h2>{room.name}</h2>
              {!!room.checked?.length && (
                <p>
                  <b>Checked ({room.checked.length}/{checklistFor(room.name).length}):</b> {checklistFor(room.name).filter((i) => room.checked!.includes(i)).join(" · ")}
                </p>
              )}
              {room.notes && (
                <p style={{ whiteSpace: "pre-line" }}>
                  <b>Notes:</b> {room.notes}
                </p>
              )}
              {room.photos.map((p) => {
                const start = n;
                n += p.result?.issues.length || 0;
                return (
                  <div key={p.id} style={{ breakInside: "avoid", marginBottom: 12 }}>
                    <div className="pics" style={{ gridTemplateColumns: "1fr 1.2fr" }}>
                      <div className="pic">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoUrl(r.id, p.id)} alt={room.name} />
                        {p.result?.issues.map((i, k) => (
                          <span key={k} className={`marker ${i.severity}`} style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%` }}>
                            {start + k + 1}
                          </span>
                        ))}
                      </div>
                      <div style={{ lineHeight: 1.45 }}>
                        <div style={{ color: "#555", fontSize: 11 }}>Photo taken {new Date(p.at).toLocaleString()}</div>
                        {p.result ? (
                          <>
                            <div>
                              <b>{p.result.object}</b> — condition <b>{p.result.condition}</b> ({p.result.score}/10)
                            </div>
                            <div>{p.result.summary}</div>
                            {p.result.safety && <div className="flag">Safety: {p.result.safety}</div>}
                          </>
                        ) : (
                          <div className="flag">{p.status === "error" ? `Not analyzed: ${p.error}` : "Analysis pending"}</div>
                        )}
                      </div>
                    </div>
                    {!!p.result?.issues.length && (
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: 28 }}>#</th>
                            <th>Finding</th>
                            <th style={{ width: 70 }}>Type</th>
                            <th style={{ width: 64 }}>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.result.issues.map((i, k) => (
                            <tr key={k}>
                              <td>{start + k + 1}</td>
                              <td>
                                <b>{i.label}</b> — {i.detail}
                              </td>
                              <td>{i.type || "other"}</td>
                              <td className={`sev-${i.severity}`}>{i.severity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
              {room.compare?.result && (
                <>
                  <h3>Changes since move-in</h3>
                  <p style={{ margin: "0 0 4px" }}>{room.compare.result.summary}</p>
                  {room.compare.result.changes.length > 0 && (
                    <table>
                      <thead>
                        <tr>
                          <th>Change</th>
                          <th style={{ width: 70 }}>Type</th>
                          <th style={{ width: 64 }}>Severity</th>
                          <th style={{ width: 110 }}>Beyond normal wear?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {room.compare.result.changes.map((c, k) => (
                          <tr key={k}>
                            <td>
                              <b>{c.label}</b> — {c.detail}
                            </td>
                            <td>{c.type}</td>
                            <td className={`sev-${c.severity}`}>{c.severity}</td>
                            <td className={c.beyondWear ? "flag" : ""}>{c.beyondWear ? "Possibly" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </section>
          ))}

        {r.notes && (
          <>
            <h2>Notes</h2>
            <p>{r.notes}</p>
          </>
        )}

        <h2>Signatures</h2>
        <p style={{ margin: 0 }}>By signing, both parties agree this report reflects the condition of the property on the date above.</p>
        <div className="sig">
          <div>Tenant signature · {r.tenant || "Name"} · Date</div>
          <div>Landlord / Inspector signature · {r.inspector || "Name"} · Date</div>
        </div>

        <p className="fine">
          Findings were drafted with AI from the photos above and reviewed by the inspector. Marker positions are approximate. This is a condition record, not a
          licensed home, structural, electrical or pest inspection, and the "beyond normal wear" column is an opinion to support discussion, not a legal
          determination. Generated with Inspect Pro.
        </p>
      </article>
    </div>
  );
}
