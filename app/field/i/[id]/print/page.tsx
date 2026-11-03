"use client";

// Printable incident report. Use the browser's Print → "Save as PDF".
// ?public=1 prints the public version: blurred photo copies, no names, contacts, signatures or notes.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/proClient";
import type { Incident } from "@/lib/field";
import { publicScrubber } from "@/lib/redact";

type Data = { incident: Incident; fingerprint: string; department: string };
const img = (i: string, p: string, png = false) => `/api/field/photo?i=${i}&p=${p}${png ? "&t=png" : ""}`;

export default function PrintIncident() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [pub, setPub] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setPub(new URLSearchParams(location.search).get("public") === "1");
    api<Data>(`/api/field/${id}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);

  if (!d) return <p style={{ padding: 20, color: "#111", background: "#fff" }}>{error || "Loading…"}</p>;
  const i = d.incident;
  // Public version: names, ID details and phone numbers in the AI-written text become roles or "[removed]".
  const publicScrub = publicScrubber(i);
  const scrub = (t: string) => (pub ? publicScrub(t) : t);
  const raw = i.draft?.result;
  const r = raw && {
    ...raw,
    summary: scrub(raw.summary),
    narrative: scrub(raw.narrative),
    sections: raw.sections?.map((s) => ({ ...s, text: scrub(s.text) })),
    vehicles: raw.vehicles.map((v) => ({ ...v, description: scrub(v.description) })),
  };
  const c = i.conditions;
  const rv = i.review;

  return (
    <div className="doc-root">
      <div className="doc-bar">
        <a className="btn" href={`/field/i/${i.id}`} style={{ color: "#111", background: "#fff", borderColor: "#999" }}>
          ← Back
        </a>
        <a className="btn" href={pub ? "?" : "?public=1"} style={{ color: "#111", background: "#fff", borderColor: "#999" }}>
          {pub ? "Full version" : "Public version"}
        </a>
        <button className="btn" onClick={() => window.print()} style={{ color: "#fff", background: "#111", borderColor: "#111" }}>
          Print / Save as PDF
        </button>
      </div>
      <article className="doc">
        {rv.status !== "approved" && <p className="flag">DRAFT — AI-assisted. Must be reviewed, corrected, and approved. Demo only.</p>}
        {pub && <p className="flag">PUBLIC VERSION — names, contacts, signatures and field notes removed; faces and plates blurred where marked.</p>}
        <div className="head">
          <div>
            <h1>Incident Report</h1>
            <div>{i.title}</div>
          </div>
          <div className="biz">
            {d.department && <b>{d.department}</b>}
            <div>Incident #{i.id.toUpperCase()}</div>
            {rv.status === "approved" && (
              <div style={{ color: "#0a7a3a", fontWeight: 700 }}>
                APPROVED by {rv.by} · {rv.at && new Date(rv.at).toLocaleDateString("en-US")}
              </div>
            )}
          </div>
        </div>
        <table>
          <tbody>
            <tr>
              <th style={{ width: "22%" }}>Date / time</th>
              <td>{new Date(i.createdAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}</td>
            </tr>
            <tr>
              <th>Location</th>
              <td>
                {i.location || c?.address || "—"}
                {c && ` (GPS ${c.lat}, ${c.lon})`}
              </td>
            </tr>
            {c?.weather && (
              <tr>
                <th>Conditions</th>
                <td>
                  {c.weather}, {c.tempF}°F, wind {c.windMph} mph{c.daylight === false ? ", dark" : ", daylight"} (recorded {new Date(c.at).toLocaleTimeString("en-US")})
                </td>
              </tr>
            )}
            {!pub && (
              <tr>
                <th>Reporting officer</th>
                <td>{i.officer || "—"}</td>
              </tr>
            )}
          </tbody>
        </table>

        {!r && <p>No report draft yet.</p>}
        {r && (
          <>
            <h2>Summary</h2>
            <p>{r.summary}</p>
            <h2>Narrative</h2>
            {r.narrative.split(/\n\n+/).map((p, n) => (
              <p key={n}>{p}</p>
            ))}
            {r.sections?.map((s, n) => (
              <div key={n}>
                <h2>{s.heading}</h2>
                <p>{s.text}</p>
              </div>
            ))}
            {r.people.length > 0 && (
              <>
                <h2>People involved</h2>
                <table>
                  <tbody>
                    {r.people.map((p, n) => (
                      <tr key={n}>
                        <th style={{ width: "30%" }}>{p.role}</th>
                        <td>{pub ? "—" : p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {r.vehicles.length > 0 && (
              <>
                <h2>Vehicles</h2>
                <ul>
                  {r.vehicles.map((v, n) => (
                    <li key={n}>
                      {v.description}
                      {v.plate && !pub ? ` — plate ${v.plate}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {r.followUps.length > 0 && !pub && (
              <>
                <h2>Follow-up</h2>
                <ul>
                  {r.followUps.map((x, n) => (
                    <li key={n}>{x}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {i.ids.some((x) => x.confirmed) && (
          <>
            <h2>People identified</h2>
            {pub ? (
              <p>{i.ids.filter((x) => x.confirmed).map((x) => x.role || "Person").join(", ")}: identified by ID card (details withheld in the public version).</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Name</th>
                    <th>DOB</th>
                    <th>Address</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {i.ids
                    .filter((x) => x.confirmed)
                    .map((x) => (
                      <tr key={x.id}>
                        <td>{x.role || "—"}</td>
                        <td>{x.fields.fullName}</td>
                        <td>{x.fields.dob || "—"}</td>
                        <td>{x.fields.address || "—"}</td>
                        <td>
                          {[x.fields.issuer, x.fields.docType].filter(Boolean).join(" ")} {x.fields.idNumber}
                          {x.fields.expires && ` · exp ${x.fields.expires}${x.fields.expires < new Date().toISOString().slice(0, 10) ? " (EXPIRED)" : ""}`}
                          <div style={{ fontSize: 9, color: "#666" }}>scan SHA-256 {x.sha256.slice(0, 16)}…</div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {i.statements.length > 0 && (
          <>
            <h2>Witness statements</h2>
            {i.statements.map((s, n) => (
              <div key={s.id} style={{ breakInside: "avoid", marginBottom: 10 }}>
                <b>
                  Witness {n + 1}
                  {pub ? "" : `: ${s.name || "unnamed"}${s.contact ? ` (${s.contact})` : ""}`}
                </b>{" "}
                · {new Date(s.at).toLocaleString("en-US")}
                {!/^english$/i.test(s.language) && ` · given in ${s.language}, translated by AI`}
                <p style={{ margin: "4px 0" }}>{scrub(s.english)}</p>
                {!/^english$/i.test(s.language) && !pub && <p style={{ margin: "4px 0", fontSize: 11, color: "#555" }}>Original ({s.language}): {s.original}</p>}
                <div style={{ fontSize: 11 }}>
                  {s.readBack ? "Read back to witness and confirmed." : "Not read back."} {s.signature ? `Signed · fingerprint ${s.signature.sha256.slice(0, 16)}…` : "Unsigned."}
                </div>
                {s.signature && !pub && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img(i.id, s.signature.id, true)} alt="signature" style={{ height: 50, border: "1px solid #ccc", marginTop: 4 }} />
                )}
              </div>
            ))}
          </>
        )}

        {i.diagram?.image && (
          <>
            <h2>Scene diagram (not to scale)</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img(i.id, i.diagram.image.id, true)} alt="Scene diagram" style={{ width: "70%", border: "1px solid #ccc" }} />
          </>
        )}

        {i.photos.length > 0 && (
          <>
            <h2>Scene photos</h2>
            <div className="pics">
              {i.photos
                .filter((p) => !pub || p.redacted)
                .map((p) => {
                  const n = i.photos.indexOf(p);
                  return (
                    <div key={p.id} className="pic">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img(i.id, pub ? p.redacted!.id : p.id)} alt={p.caption} />
                      <div style={{ fontSize: 10 }}>
                        #{n + 1} · {new Date(p.at).toLocaleString("en-US")} · {p.caption}
                        <br />
                        SHA-256 {(pub ? p.redacted!.sha256 : p.sha256).slice(0, 24)}…
                      </div>
                    </div>
                  );
                })}
            </div>
            {pub && i.photos.some((p) => !p.redacted) && <p className="fine">Photos without a blurred public copy are left out of this version.</p>}
          </>
        )}

        <h2>Sequence of events</h2>
        <table>
          <tbody>
            {i.timeline
              .filter((t) => !pub || !["note", "translate", "statement"].includes(t.kind))
              .map((t, n) => (
                <tr key={n}>
                  <td style={{ width: "18%", whiteSpace: "nowrap" }}>{new Date(t.at).toLocaleTimeString("en-US")}</td>
                  <td>{scrub(t.text)}</td>
                </tr>
              ))}
          </tbody>
        </table>

        {!pub && (
          <>
            <h2>Original field notes</h2>
            <p style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{i.notes || "—"}</p>
            {i.history.length > 0 && (
              <>
                <h2>Edit history</h2>
                <ul style={{ fontSize: 11 }}>
                  {i.history.map((h, n) => (
                    <li key={n}>
                      {new Date(h.at).toLocaleString("en-US")} · {h.by} {h.action}
                      {h.detail ? `: ${h.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        <p className="fine">
          Report fingerprint (SHA-256): {d.fingerprint}. Each photo, signature and the diagram were fingerprinted when saved; any change to a file or to this
          report produces a different fingerprint.
        </p>
        {!pub && (
          <div className="sig">
            <div>Reporting officer signature</div>
            <div>Supervisor review{rv.status === "approved" ? `: ${rv.by}` : ""}</div>
          </div>
        )}
      </article>
    </div>
  );
}
