"use client";

// 📇 ID cards: photograph the license the person hands over, Jarvis reads it, the officer checks every field
// against the card and confirms. Only confirmed IDs go into the report; ID photos never go in the public version.

import { useState } from "react";
import { api, toJpeg } from "@/lib/proClient";
import type { IdScan, Incident } from "@/lib/field";
import type { IdFields } from "@/lib/brain";

const ROLES = ["Driver of V1", "Driver of V2", "Passenger", "Witness", "Owner", "Other"];
const LABELS: [keyof IdFields, string][] = [
  ["fullName", "Full name"],
  ["dob", "Date of birth"],
  ["address", "Address"],
  ["idNumber", "ID number"],
  ["issuer", "Issued by"],
  ["expires", "Expires"],
  ["docType", "Document"],
  ["sex", "Sex"],
];

const today = () => new Date().toISOString().slice(0, 10);
function age(dob: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

export default function IdCards({ i, me, reload, setError }: { i: Incident; me: string; reload: () => void; setError: (s: string) => void }) {
  const [role, setRole] = useState("Driver of V1");
  const [scanning, setScanning] = useState(false);
  const locked = i.review.status === "submitted" || i.review.status === "approved";

  const scan = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setScanning(true);
    setError("");
    try {
      await api(`/api/field/${i.id}/ids`, { method: "POST", body: JSON.stringify({ image: await toJpeg(f, 1800), role, by: me }) });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setScanning(false);
  };

  return (
    <section className="card">
      <h3>📇 ID cards ({i.ids.length})</h3>
      {!locked && (
        <>
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Whose ID?
              <input list="id-roles" value={role} onChange={(e) => setRole(e.target.value)} />
              <datalist id="id-roles">
                {ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="row">
            <label className="btn file-btn">
              📷 Scan ID
              <input type="file" accept="image/*" capture="environment" onChange={(e) => (scan(e.target.files), (e.target.value = ""))} disabled={scanning} />
            </label>
            <label className="btn ghost file-btn">
              🖼 Upload
              <input type="file" accept="image/*" onChange={(e) => (scan(e.target.files), (e.target.value = ""))} disabled={scanning} />
            </label>
            {scanning && <span className="analyzing">Reading the card…</span>}
          </div>
          <p className="muted">Lay the card flat, fill the frame, avoid glare. Only scan IDs people hand you.</p>
        </>
      )}
      {i.ids.map((d) => (
        <IdCard key={d.id} incidentId={i.id} d={d} me={me} locked={locked} reload={reload} setError={setError} />
      ))}
      <p className="muted">
        AI reads the card; you check each field against it and confirm. Only confirmed IDs go into the report. ID photos and numbers are never in the public version.
      </p>
    </section>
  );
}

function IdCard({ incidentId, d, me, locked, reload, setError }: { incidentId: string; d: IdScan; me: string; locked: boolean; reload: () => void; setError: (s: string) => void }) {
  const [f, setF] = useState<IdFields>(d.fields);
  const [role, setRole] = useState(d.role);
  const [saving, setSaving] = useState(false);
  const dirty = role !== d.role || LABELS.some(([k]) => f[k] !== d.fields[k]);
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(f.expires) && f.expires < today();
  const years = age(f.dob);
  const notId = /not an id/i.test(f.docType);

  const save = async (confirmed: boolean) => {
    setSaving(true);
    try {
      await api(`/api/field/${incidentId}/ids`, { method: "PATCH", body: JSON.stringify({ scanId: d.id, role, fields: f, confirmed, by: me }) });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
  };
  const remove = async () => {
    if (!confirm("Delete this ID scan? The deletion is recorded in the edit history.")) return;
    await api(`/api/field/${incidentId}/ids?s=${d.id}&by=${encodeURIComponent(me)}`, { method: "DELETE" }).catch((e) => setError(e.message));
    reload();
  };

  return (
    <div className={`idcard ${d.confirmed ? "ok" : ""}`}>
      <div className="row">
        <input type="text" value={role} onChange={(e) => setRole(e.target.value)} disabled={locked} style={{ flex: 1, fontWeight: 600 }} />
        {d.confirmed ? <span className="status approved">✓ confirmed</span> : <span className="status submitted">check fields</span>}
      </div>
      <div className="id-body">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/field/photo?i=${incidentId}&p=${d.id}`} alt="ID card" />
        <div className="id-fields">
          {notId && (
            <p className="tool-error" style={{ gridColumn: "1 / -1", margin: 0 }}>
              This doesn&apos;t look like an ID card. Rescan, or type the details.
            </p>
          )}
          {LABELS.map(([k, label]) => (
            <label key={k} className="field">
              {label}
              {k === "expires" && expired && <b className="warn"> EXPIRED</b>}
              {k === "dob" && years !== null && <b> · age {years}</b>}
              <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={locked} placeholder={k === "dob" || k === "expires" ? "YYYY-MM-DD" : ""} />
            </label>
          ))}
        </div>
      </div>
      <div className="row muted" style={{ fontSize: 11 }}>
        Scanned {new Date(d.at).toLocaleTimeString("en-US")} · 🔒 {d.sha256.slice(0, 12)}…
      </div>
      {!locked && (
        <div className="row">
          {!d.confirmed && (
            <button className="btn" onClick={() => save(true)} disabled={saving || !f.fullName.trim()}>
              ✓ Fields match the card
            </button>
          )}
          {dirty && (
            <button className="btn ghost" onClick={() => save(false)} disabled={saving}>
              Save changes
            </button>
          )}
          <button className="linkbtn" onClick={remove}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
