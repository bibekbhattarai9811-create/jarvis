"use client";

// Report editor: details, then room by room — take photos, see AI findings, and (for move-outs) compare with move-in.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, KIND_LABEL, photoUrl, toJpeg } from "@/lib/proClient";
import type { ProReport, Room, summarize } from "@/lib/pro";
import { checklistFor, checkProgress } from "@/lib/checklists";

type Recognizer = {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const recognizerClass = () => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

/** 🎤 Speak a note ("scratch on the counter by the stove") and it's added to the room's notes. */
function VoiceNote({ onNote }: { onNote: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "listening">("idle");
  const [heard, setHeard] = useState("");
  const rec = useRef<Recognizer | null>(null);
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(!!recognizerClass()), []);
  if (!supported) return null;
  const start = () => {
    if (state === "listening") return rec.current?.stop();
    const Rec = recognizerClass()!;
    const r = new Rec();
    r.lang = "en-US";
    r.interimResults = true;
    let text = "";
    r.onresult = (e) => {
      text = Array.from(e.results).map((x) => x[0].transcript).join(" ");
      setHeard(text);
    };
    r.onerror = () => {};
    r.onend = () => {
      setState("idle");
      setHeard("");
      if (text.trim()) onNote(text.trim());
    };
    rec.current = r;
    setState("listening");
    r.start();
  };
  return (
    <button className={`btn ${state === "listening" ? "" : "ghost"}`} onClick={start} title="Say a note for this room">
      {state === "listening" ? `🎤 ${heard || "Listening… tap to stop"}` : "🎤 Voice note"}
    </button>
  );
}

type Data = { report: ProReport; summary: ReturnType<typeof summarize>; base: ProReport | null };

export default function ReportEditor() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [newRoom, setNewRoom] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/pro/reports/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // While anything is being analyzed or compared, refresh every 3 s.
  useEffect(() => {
    const busy = data?.report.rooms.some((r) => r.photos.some((p) => p.status === "analyzing") || r.compare?.status === "running");
    if (timer.current) clearTimeout(timer.current);
    if (busy) timer.current = setTimeout(load, 3000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [data, load]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      const d = await api<Pick<Data, "report" | "summary">>(`/api/pro/reports/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setData((old) => (old ? { ...old, ...d } : old));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addPhotos = async (room: string, files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const list = Array.from(files);
    setUploading((u) => ({ ...u, [room]: (u[room] || 0) + list.length }));
    for (const f of list) {
      try {
        const image = await toJpeg(f);
        await api(`/api/pro/reports/${id}/photos`, { method: "POST", body: JSON.stringify({ room, image }) });
        await load();
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading((u) => ({ ...u, [room]: Math.max(0, (u[room] || 1) - 1) }));
      }
    }
  };

  const removePhoto = async (room: string, photo: string) => {
    if (!confirm("Delete this photo?")) return;
    await api(`/api/pro/reports/${id}/photos?room=${encodeURIComponent(room)}&photo=${photo}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  const retry = async (room: string, photo: string) => {
    await api(`/api/pro/reports/${id}/photos`, { method: "PUT", body: JSON.stringify({ room, photo }) }).catch((e) => setError(e.message));
    load();
  };

  const compare = async (room: string) => {
    setError("");
    try {
      await api(`/api/pro/reports/${id}/compare`, { method: "POST", body: JSON.stringify({ room }) });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeReport = async () => {
    if (!confirm("Delete this whole report and its photos?")) return;
    await api(`/api/pro/reports/${id}`, { method: "DELETE" });
    location.href = "/pro";
  };

  if (!data)
    return (
      <main className="pro">
        <a href="/pro">← Reports</a>
        <p className={error ? "tool-error" : "muted"}>{error || "Loading…"}</p>
      </main>
    );

  const { report: r, summary: s, base } = data;
  const detail = (k: "property" | "unit" | "tenant" | "inspector" | "date", label: string, type = "text") => (
    <label className="field">
      {label}
      <input type={type} defaultValue={r[k]} onBlur={(e) => e.target.value !== r[k] && patch({ [k]: e.target.value })} />
    </label>
  );

  return (
    <main className="pro">
      <div className="pro-top">
        <a href="/pro">← Reports</a>
        <span className="pro-brand">INSPECT PRO</span>
        <span className="row">
          <a className="btn ghost" href={`/glasses?report=${r.id}`} target="_blank" rel="noreferrer" title="See findings on your glasses (opens the glasses view)">
            👓 Glasses
          </a>
          <a className="btn" href={`/pro/r/${r.id}/print`}>
            📄 PDF report
          </a>
        </span>
      </div>

      <section className="card">
        <div className="row">
          <span className={`kind ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
          <h2 style={{ flex: 1, minWidth: 0 }}>
            {r.property}
            {r.unit ? ` #${r.unit}` : ""}
          </h2>
        </div>
        {base && (
          <p className="muted">
            Compared with the move-in report from {base.date} (<a href={`/pro/r/${base.id}`}>open</a>).
          </p>
        )}
        <div className="grid2">
          {detail("property", "Property")}
          {detail("unit", "Unit")}
          {detail("tenant", "Tenant")}
          {detail("inspector", "Inspector")}
          {detail("date", "Date", "date")}
        </div>
        <div className="stats">
          <div className="stat">
            <b>{s.photos}</b>
            <span>photos analyzed</span>
          </div>
          <div className="stat">
            <b>{s.avgScore ?? "–"}</b>
            <span>avg condition /10</span>
          </div>
          <div className="stat">
            <b style={{ color: "#ff8a99" }}>{s.bySeverity.high}</b>
            <span>high</span>
          </div>
          <div className="stat">
            <b style={{ color: "#ffb27a" }}>{s.bySeverity.medium}</b>
            <span>medium</span>
          </div>
          <div className="stat">
            <b style={{ color: "#ffd34d" }}>{s.bySeverity.low}</b>
            <span>low</span>
          </div>
        </div>
      </section>

      {error && <p className="tool-error">{error}</p>}

      {r.rooms.map((room) => (
        <RoomCard
          key={room.name}
          reportId={r.id}
          room={room}
          baseRoom={base?.rooms.find((x) => x.name === room.name)}
          baseId={base?.id}
          uploading={uploading[room.name] || 0}
          onPhotos={(f) => addPhotos(room.name, f)}
          onRemovePhoto={(p) => removePhoto(room.name, p)}
          onRetry={(p) => retry(room.name, p)}
          onNotes={(notes) => notes !== room.notes && patch({ roomNotes: { room: room.name, notes } })}
          onVoiceNote={(text) => patch({ addNote: { room: room.name, text } })}
          onCheck={(item, done) => patch({ check: { room: room.name, item, done } })}
          onRemoveRoom={() => patch({ removeRoom: room.name })}
          onCompare={() => compare(room.name)}
        />
      ))}

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (newRoom.trim()) patch({ addRoom: newRoom.trim() }).then(() => setNewRoom(""));
        }}
      >
        <div className="row">
          <input type="text" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder="Add a room: Bedroom 2, Laundry, Garage, Exterior…" style={{ flex: 1 }} />
          <button className="btn">+ Add room</button>
        </div>
      </form>

      <section className="card">
        <h3>Report notes</h3>
        <textarea rows={3} defaultValue={r.notes} placeholder="Keys handed over, meter readings, anything else…" onBlur={(e) => e.target.value !== r.notes && patch({ notes: e.target.value })} />
        <div className="row">
          <a className="btn" href={`/pro/r/${r.id}/print`}>
            📄 PDF report
          </a>
          <button className="btn ghost" onClick={removeReport}>
            Delete report
          </button>
        </div>
      </section>
    </main>
  );
}

function RoomCard(props: {
  reportId: string;
  room: Room;
  baseRoom?: Room;
  baseId?: string;
  uploading: number;
  onPhotos: (f: FileList | null) => void;
  onRemovePhoto: (id: string) => void;
  onRetry: (id: string) => void;
  onNotes: (notes: string) => void;
  onVoiceNote: (text: string) => void;
  onCheck: (item: string, done: boolean) => void;
  onRemoveRoom: () => void;
  onCompare: () => void;
}) {
  const { room, reportId, baseRoom, baseId } = props;
  const cmp = room.compare;
  const checks = checklistFor(room.name);
  const { done } = checkProgress([room]);
  return (
    <section className="card">
      <div className="row">
        <h2 style={{ flex: 1 }}>{room.name}</h2>
        <label className="btn file-btn">
          📷 Take photo
          <input type="file" accept="image/*" capture="environment" onChange={(e) => (props.onPhotos(e.target.files), (e.target.value = ""))} />
        </label>
        <label className="btn ghost file-btn">
          🖼 Upload
          <input type="file" accept="image/*" multiple onChange={(e) => (props.onPhotos(e.target.files), (e.target.value = ""))} />
        </label>
      </div>

      {room.photos.length === 0 && !props.uploading && (
        <p className="muted">
          No photos yet. Take 2–4 per room: wide shots of each wall, plus close-ups of anything damaged.{" "}
          {!baseRoom && (
            <button className="linkbtn" onClick={props.onRemoveRoom}>
              Remove room
            </button>
          )}
        </p>
      )}
      {props.uploading > 0 && <p className="analyzing">Uploading {props.uploading}…</p>}

      {room.photos.length > 0 && (
        <div className="photos">
          {room.photos.map((p) => (
            <div key={p.id} className="photo">
              <div className="pic">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(reportId, p.id)} alt={room.name} loading="lazy" />
                {p.result?.issues.map((i, n) => (
                  <span key={n} className={`marker ${i.severity}`} style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%` }}>
                    {n + 1}
                  </span>
                ))}
              </div>
              <div className="body">
                {p.status === "analyzing" && <span className="analyzing">AI is inspecting…</span>}
                {p.status === "error" && (
                  <p className="tool-error">
                    {p.error}{" "}
                    <button className="linkbtn" onClick={() => props.onRetry(p.id)}>
                      Retry
                    </button>
                  </p>
                )}
                {p.result && (
                  <>
                    <div className="row">
                      <span className={`cond ${p.result.condition}`} style={{ minWidth: 0, padding: "2px 10px", flexDirection: "row", gap: 6 }}>
                        <strong>{p.result.condition}</strong> {p.result.score}/10
                      </span>
                    </div>
                    <p>{p.result.summary}</p>
                    {p.result.issues.map((i, n) => (
                      <div key={n} className="finding">
                        <span className={`sev ${i.severity}`}>
                          {n + 1}·{i.severity}
                        </span>
                        <span className={`chip ${i.type || "other"}`}>{i.type || "other"}</span>
                        <span>
                          <b>{i.label}</b> — {i.detail}
                        </span>
                      </div>
                    ))}
                    {p.result.safety && <p className="report-safety">⚠ {p.result.safety}</p>}
                  </>
                )}
                <button className="linkbtn" onClick={() => props.onRemovePhoto(p.id)} style={{ alignSelf: "flex-start" }}>
                  Delete photo
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="walk">
        <div className="row">
          <h3 style={{ flex: 1 }}>
            Walkthrough {done}/{checks.length}
          </h3>
          <VoiceNote onNote={props.onVoiceNote} />
        </div>
        <div className="checks">
          {checks.map((item) => {
            const on = !!room.checked?.includes(item);
            return (
              <button key={item} className={`check ${on ? "on" : ""}`} onClick={() => props.onCheck(item, !on)} aria-pressed={on}>
                {on ? "✓" : "○"} {item}
              </button>
            );
          })}
        </div>
      </div>

      {/* key: re-mount when a voice note is added so the box shows it */}
      <textarea key={room.notes} rows={2} defaultValue={room.notes} placeholder={`Notes for ${room.name}`} onBlur={(e) => props.onNotes(e.target.value)} />

      {baseId && (
        <div className="compare">
          <div className="row">
            <h3 style={{ flex: 1 }}>Changes since move-in</h3>
            <button className="btn" onClick={props.onCompare} disabled={cmp?.status === "running" || !room.photos.length || !baseRoom?.photos.length}>
              {cmp?.status === "done" ? "Compare again" : "Compare with move-in"}
            </button>
          </div>
          {baseRoom?.photos.length ? (
            <div className="thumbs" title="Move-in photos">
              {baseRoom.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={photoUrl(baseId, p.id)} alt="Move-in" loading="lazy" />
              ))}
            </div>
          ) : (
            <p className="muted">The move-in report has no photos of this room.</p>
          )}
          {cmp?.status === "running" && <span className="analyzing">Comparing move-in and move-out photos…</span>}
          {cmp?.status === "error" && <p className="tool-error">{cmp.error}</p>}
          {cmp?.result && (
            <>
              <p style={{ margin: 0 }}>{cmp.result.summary}</p>
              {cmp.result.changes.length === 0 && <p className="muted">No changes found.</p>}
              {cmp.result.changes.map((c, n) => (
                <div key={n} className="finding">
                  {c.beyondWear && <span className="chip beyond">beyond normal wear?</span>}
                  <span className={`sev ${c.severity}`}>{c.severity}</span>
                  <span className={`chip ${c.type}`}>{c.type}</span>
                  <span>
                    <b>{c.label}</b> — {c.detail}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
