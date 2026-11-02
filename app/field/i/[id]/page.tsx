"use client";

// One incident: Notes & report · Photos · Statements · Diagram · Translate · Checklist · Record.
// Hands-free mode drives most of it by voice; the glasses (/hud?field=<id>) mirror the checklist and translations.
// Notes and photos queue on the phone when there's no signal and sync when it's back.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, toJpeg } from "@/lib/proClient";
import type { FieldPhoto, Incident, Translation } from "@/lib/field";
import { canListen, dictate, LANGUAGES, say } from "@/lib/speech";
import { onQueueChange, sendOrQueue, startAutoFlush } from "@/lib/fieldQueue";
import Statements from "./Statements";
import IdCards from "./IdCards";
import Diagram from "./Diagram";
import Record from "./Record";
import HandsFree from "./HandsFree";

type Data = { incident: Incident; checklists: { name: string; steps: string[] }[]; fingerprint: string; department: string };
type Tab = "notes" | "photos" | "ids" | "statements" | "diagram" | "translate" | "checklist" | "record";

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("notes");
  const [error, setError] = useState("");
  const [handsFree, setHandsFree] = useState(false);
  const [queued, setQueued] = useState(0);
  const [offline, setOffline] = useState(false);
  const [lang, setLang] = useState("Spanish");
  const [me, setMe] = useState("");
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>(`/api/field/${id}`);
      setData(d);
      setOffline(false);
      try {
        localStorage.setItem(`field-${id}`, JSON.stringify(d));
      } catch {}
    } catch (e) {
      // No signal: show the last copy we had.
      try {
        const cached = localStorage.getItem(`field-${id}`);
        if (cached) {
          setData(JSON.parse(cached));
          setOffline(true);
          return;
        }
      } catch {}
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
    try {
      setMe(localStorage.getItem("field-officer") || "");
      const l = localStorage.getItem("field-lang");
      if (l) setLang(l);
    } catch {}
    const offQ = onQueueChange(setQueued);
    const offF = startAutoFlush(() => load());
    return () => {
      offQ();
      offF();
    };
  }, [load]);

  const by = me || data?.incident.officer || "Officer";
  const patch = async (body: object) => {
    setError("");
    try {
      const d = await api<{ incident: Incident; fingerprint: string }>(`/api/field/${id}`, { method: "PATCH", body: JSON.stringify({ by, ...body }) });
      setData((old) => (old ? { ...old, incident: d.incident, fingerprint: d.fingerprint } : old));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // Notes and photos survive having no signal.
  const addNote = async (text: string) => {
    const r = await sendOrQueue("PATCH", `/api/field/${id}`, { by, addNote: text }, "note").catch((e) => (setError(e.message), null));
    if (r && !r.queued) setData((old) => (old ? { ...old, ...(r.data as Partial<Data>) } : old));
  };
  const addPhoto = async (image: string, caption: string) => {
    const r = await sendOrQueue("POST", `/api/field/${id}/photos`, { image, caption }, "photo").catch((e) => (setError(e.message), null));
    if (r && !r.queued) await load();
  };
  const draft = async () => {
    setError("");
    try {
      await api(`/api/field/${id}/draft`, { method: "POST", body: JSON.stringify({ by }) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const locate = () => {
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      async (p) => {
        try {
          const d = await api<{ incident: Incident }>(`/api/field/${id}/extras`, { method: "POST", body: JSON.stringify({ what: "conditions", lat: p.coords.latitude, lon: p.coords.longitude }) });
          setData((old) => (old ? { ...old, incident: d.incident } : old));
        } catch (e) {
          setError((e as Error).message);
        }
        setLocating(false);
      },
      () => {
        setError("Location is blocked for this site.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  if (!data) return <main className="pro">{error ? <p className="tool-error">{error}</p> : <p className="muted">Loading…</p>}</main>;
  const i = data.incident;
  const c = i.conditions;
  const locked = i.review.status === "submitted" || i.review.status === "approved";

  return (
    <main className="pro">
      <div className="pro-top">
        <a href="/field">← Incidents</a>
        <span className="pro-brand">FIELD ASSIST</span>
        <a className="btn ghost" href={`/glasses?field=${i.id}`} title="See this on the glasses">
          👓 Glasses
        </a>
      </div>
      {(offline || queued > 0) && (
        <p className="offline-bar">
          📴 {offline ? "No connection: showing the last saved copy. " : ""}
          {queued > 0 ? `${queued} item${queued === 1 ? "" : "s"} waiting to sync. They'll send automatically.` : ""}
        </p>
      )}
      <section className="card">
        <div className="row">
          <h2 style={{ flex: 1 }}>{i.title}</h2>
          <span className={`status ${i.review.status}`}>{i.review.status}</span>
        </div>
        <p className="muted">
          {data.department ? `${data.department} · ` : ""}
          {new Date(i.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          {i.location ? ` · ${i.location}` : ""}
          {i.officer ? ` · ${i.officer}` : ""}
        </p>
        <div className="row">
          {c ? (
            <span className="cond-line">
              📍 {c.address || `${c.lat}, ${c.lon}`}
              {c.weather && ` · ${c.weather}, ${c.tempF}°F, wind ${c.windMph} mph${c.daylight === false ? ", dark" : ""}`}
            </span>
          ) : (
            <span className="muted">No GPS conditions yet.</span>
          )}
          <button className="btn ghost" onClick={locate} disabled={locating || offline}>
            {locating ? "Locating…" : c ? "📍 Update" : "📍 Add location & weather"}
          </button>
        </div>
        {!handsFree && canListen() && (
          <button className="btn hf-start" onClick={() => setHandsFree(true)}>
            🎙 Hands-free mode
          </button>
        )}
      </section>

      {handsFree && (
        <HandsFree
          i={i}
          lists={data.checklists}
          onNote={addNote}
          onPhoto={addPhoto}
          onScanId={async (image, role) => {
            await api(`/api/field/${id}/ids`, { method: "POST", body: JSON.stringify({ image, role, by }) });
            setTab("ids");
            await load();
          }}
          onPatch={patch}
          onTranslate={(l) => {
            setLang(l);
            setTab("translate");
          }}
          onDraft={async () => {
            setTab("notes");
            await draft();
          }}
          onClose={() => setHandsFree(false)}
        />
      )}

      <nav className="tabs">
        {(
          [
            ["notes", "📝 Report"],
            ["photos", `📷 Photos (${i.photos.length})`],
            ["ids", `📇 IDs (${i.ids.length})`],
            ["statements", `🗣 Statements (${i.statements.length})`],
            ["diagram", "🗺 Diagram"],
            ["translate", "🌐 Translate"],
            ["checklist", "✅ Checklist"],
            ["record", "🔒 Record"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="tool-error">{error}</p>}
      {locked && tab !== "record" && <p className="muted">🔒 This report is {i.review.status}. Changes are locked; see the Record tab.</p>}
      {tab === "notes" && <Notes i={i} addNote={addNote} draft={draft} patch={patch} setError={setError} />}
      {tab === "photos" && <Photos i={i} addPhoto={addPhoto} reload={load} setError={setError} />}
      {tab === "ids" && <IdCards i={i} me={by} reload={load} setError={setError} />}
      {tab === "statements" && <Statements i={i} reload={load} setError={setError} />}
      {tab === "diagram" && <Diagram key={i.diagram?.at || "new"} i={i} reload={load} setError={setError} />}
      {tab === "translate" && (
        <Translate
          i={i}
          langName={lang}
          setLangName={(l) => {
            setLang(l);
            try {
              localStorage.setItem("field-lang", l);
            } catch {}
          }}
        />
      )}
      {tab === "checklist" && <Checklist i={i} lists={data.checklists} patch={patch} />}
      {tab === "record" && <Record i={i} fingerprint={data.fingerprint} patch={patch} me={by} />}
    </main>
  );
}

// ---------- Notes & report ----------
function Notes({
  i,
  addNote,
  draft,
  patch,
  setError,
}: {
  i: Incident;
  addNote: (t: string) => Promise<void>;
  draft: () => Promise<void>;
  patch: (b: object) => Promise<void>;
  setError: (s: string) => void;
}) {
  const [live, setLive] = useState("");
  const [rec, setRec] = useState<{ stop(): void } | null>(null);
  const [typed, setTyped] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ summary: "", narrative: "" });
  const d = i.draft?.result;
  const locked = i.review.status === "submitted" || i.review.status === "approved";

  const toggleMic = () => {
    if (rec) return rec.stop();
    setLive("");
    setRec(
      dictate("en-US", true, setLive, (text, err) => {
        setRec(null);
        setLive("");
        if (err) setError(err);
        if (text) addNote(text);
      })
    );
  };
  const runDraft = async () => {
    setDrafting(true);
    await draft();
    setDrafting(false);
  };

  return (
    <>
      <section className="card">
        <div className="row">
          <h3 style={{ flex: 1 }}>Field notes</h3>
          {canListen() && !locked && (
            <button className={`btn ${rec ? "rec" : ""}`} onClick={toggleMic}>
              {rec ? "■ Stop dictation" : "🎤 Dictate"}
            </button>
          )}
        </div>
        {rec && <p className="live">{live || "Listening… describe what you see and what happened."}</p>}
        <pre className="notes">{i.notes || "No notes yet. Tap Dictate and talk, or type below."}</pre>
        {!locked && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) addNote(typed).then(() => setTyped(""));
            }}
          >
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a note…" style={{ flex: 1 }} />
            <button className="btn ghost">Add</button>
          </form>
        )}
      </section>

      <section className="card">
        <div className="row">
          <h3 style={{ flex: 1 }}>
            Report draft{i.draft?.edited ? " (edited by officer)" : ""}
          </h3>
          {!locked && (
            <button className="btn" onClick={runDraft} disabled={drafting || (!i.notes.trim() && !i.statements.length)}>
              {drafting ? "Writing…" : d ? "Rewrite draft" : "✨ Draft report"}
            </button>
          )}
          {d && !locked && !editing && (
            <button
              className="btn ghost"
              onClick={() => {
                setEdit({ summary: d.summary, narrative: d.narrative });
                setEditing(true);
              }}
            >
              ✏️ Edit
            </button>
          )}
          {d && (
            <a className="btn ghost" href={`/field/i/${i.id}/print`}>
              📄 PDF
            </a>
          )}
        </div>
        {drafting && <span className="analyzing">Turning your notes, statements and timeline into a report…</span>}
        {!d && !drafting && <p className="muted">Jarvis writes a clean first-person draft from your notes, statements, photos and timeline, and lists what&apos;s missing. You review and edit it.</p>}
        {d && editing && (
          <>
            <label className="field">
              Summary
              <textarea rows={2} value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} />
            </label>
            <label className="field">
              Narrative
              <textarea rows={12} value={edit.narrative} onChange={(e) => setEdit({ ...edit, narrative: e.target.value })} />
            </label>
            <div className="row">
              <button className="btn" onClick={() => patch({ draftEdit: edit }).then(() => setEditing(false))}>
                Save edits
              </button>
              <button className="btn ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <span className="muted">Every edit is kept in the Record tab&apos;s history.</span>
            </div>
          </>
        )}
        {d && !editing && (
          <>
            {d.missing.length > 0 && (
              <div className="missing">
                <b>Missing or unclear — add these to your notes:</b>
                <ul>
                  {d.missing.map((m, n) => (
                    <li key={n}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              <b>Summary.</b> {d.summary}
            </p>
            {d.narrative.split(/\n\n+/).map((p, n) => (
              <p key={n} style={{ margin: 0 }}>
                {p}
              </p>
            ))}
            {d.sections?.map((s, n) => (
              <div key={n}>
                <b>{s.heading}</b>
                <p style={{ margin: "2px 0 0" }}>{s.text}</p>
              </div>
            ))}
            {d.people.length > 0 && <List title="People" items={d.people.map((p) => `${p.role}: ${p.description}`)} />}
            {d.vehicles.length > 0 && <List title="Vehicles" items={d.vehicles.map((v) => `${v.description}${v.plate ? ` (plate ${v.plate})` : ""}`)} />}
            {d.evidence.length > 0 && <List title="Evidence" items={d.evidence} />}
            {d.followUps.length > 0 && <List title="Follow-up" items={d.followUps} />}
            <p className="muted">AI-assisted draft. The officer must review, correct, and approve it.</p>
          </>
        )}
      </section>
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <b>{title}</b>
      <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
        {items.map((x, n) => (
          <li key={n}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Photos ----------
/** Pixelate each box (works in every browser) and return the blurred copy as a JPEG. */
async function blurCopy(src: string, boxes: { x: number; y: number; w: number; h: number }[]): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const tmp = document.createElement("canvas");
  const t = tmp.getContext("2d")!;
  for (const b of boxes) {
    // a bit bigger than the box, so edges are covered
    const x = Math.max(0, (b.x - b.w * 0.15) * c.width);
    const y = Math.max(0, (b.y - b.h * 0.15) * c.height);
    const w = Math.min(c.width - x, b.w * 1.3 * c.width);
    const h = Math.min(c.height - y, b.h * 1.3 * c.height);
    if (w < 2 || h < 2) continue;
    const cells = 7;
    tmp.width = cells;
    tmp.height = Math.max(1, Math.round((cells * h) / w));
    t.drawImage(c, x, y, w, h, 0, 0, tmp.width, tmp.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }
  return c.toDataURL("image/jpeg", 0.88);
}

function Photos({ i, addPhoto, reload, setError }: { i: Incident; addPhoto: (img: string, cap: string) => Promise<void>; reload: () => void; setError: (s: string) => void }) {
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(0);
  const [blurring, setBlurring] = useState<string | null>(null);
  const [showPublic, setShowPublic] = useState(false);
  const locked = i.review.status === "submitted" || i.review.status === "approved";
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading(list.length);
    for (const f of list) {
      await addPhoto(await toJpeg(f), caption);
      setUploading((u) => u - 1);
    }
    setCaption("");
  };
  const remove = async (p: string) => {
    if (!confirm("Delete this photo? The deletion is recorded in the edit history.")) return;
    await api(`/api/field/${i.id}/photos?p=${p}`, { method: "DELETE" }).catch((e) => setError(e.message));
    reload();
  };
  const blur = async (p: FieldPhoto) => {
    setBlurring(p.id);
    setError("");
    try {
      const { boxes } = await api<{ boxes: { x: number; y: number; w: number; h: number }[] }>(`/api/field/${i.id}/photos?p=${p.id}`);
      const image = await blurCopy(`/api/field/photo?i=${i.id}&p=${p.id}`, boxes);
      await api(`/api/field/${i.id}/photos`, { method: "POST", body: JSON.stringify({ image, redactOf: p.id, boxes: boxes.length }) });
      setShowPublic(true);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBlurring(null);
  };
  return (
    <section className="card">
      {!locked && (
        <>
          <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption for the next photo, e.g. 'Vehicle 1, front damage'" />
          <div className="row">
            <label className="btn file-btn">
              📷 Take photo
              <input type="file" accept="image/*" capture="environment" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
            </label>
            <label className="btn ghost file-btn">
              🖼 Upload
              <input type="file" accept="image/*" multiple onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
            </label>
            {uploading > 0 && <span className="analyzing">Saving {uploading}…</span>}
          </div>
        </>
      )}
      {i.photos.some((p) => p.redacted) && (
        <label className="row" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={showPublic} onChange={(e) => setShowPublic(e.target.checked)} /> Show public (blurred) copies
        </label>
      )}
      {i.photos.length === 0 && <p className="muted">Each photo is time-stamped and fingerprinted when it&apos;s saved, so any later change can be detected.</p>}
      <div className="field-photos">
        {i.photos.map((p, n) => {
          const pub = showPublic && p.redacted;
          return (
            <figure key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/field/photo?i=${i.id}&p=${pub ? p.redacted!.id : p.id}`} alt={p.caption || `Photo ${n + 1}`} loading="lazy" />
              <figcaption>
                <b>
                  #{n + 1} · {new Date(p.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                </b>{" "}
                {pub && <span className="chip cleaning">public copy</span>} {p.caption}
                <div className="fp">🔒 {(pub ? p.redacted!.sha256 : p.sha256).slice(0, 12)}…</div>
                <div className="row" style={{ gap: 10 }}>
                  <button className="linkbtn" onClick={() => blur(p)} disabled={!!blurring}>
                    {blurring === p.id ? "Blurring…" : p.redacted ? "Re-blur" : "🫥 Blur faces & plates"}
                  </button>
                  {!locked && (
                    <button className="linkbtn" onClick={() => remove(p.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <p className="muted">“Blur faces & plates” makes a separate public copy for sharing outside the department. The original evidence photo is never changed.</p>
    </section>
  );
}

// ---------- Translate ----------
function Translate({ i, langName, setLangName }: { i: Incident; langName: string; setLangName: (l: string) => void }) {
  const [log, setLog] = useState<Translation[]>(i.lastTranslation ? [i.lastTranslation] : []);
  const [live, setLive] = useState("");
  const [who, setWho] = useState<"officer" | "other" | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [rec, setRec] = useState<{ stop(): void } | null>(null);
  const lang = LANGUAGES.find((l) => l.name === langName) || LANGUAGES[0];

  const send = async (text: string, speaker: "officer" | "other") => {
    if (!text.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const t = await api<Translation>("/api/field/translate", {
        method: "POST",
        body: JSON.stringify({ text, speaker, fromLang: speaker === "officer" ? "English" : lang.name, toLang: speaker === "officer" ? lang.name : "English", incident: i.id }),
      });
      setLog((l) => [t, ...l].slice(0, 20));
      const code = speaker === "officer" ? lang.code : "en-US";
      if (code) say(t.text, code);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const talk = (speaker: "officer" | "other") => {
    if (rec) return rec.stop();
    const code = speaker === "officer" ? "en-US" : lang.code;
    setWho(speaker);
    setLive("");
    setRec(
      dictate(code, false, setLive, (text, e) => {
        setRec(null);
        setWho(null);
        setLive("");
        if (e) setErr(e);
        send(text, speaker);
      })
    );
  };

  return (
    <section className="card">
      <label className="field">
        Their language
        <select value={lang.name} onChange={(e) => setLangName(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.name}>{l.name}</option>
          ))}
        </select>
      </label>
      <div className="talk">
        <button className={`talk-btn ${who === "officer" ? "on" : ""}`} onClick={() => talk("officer")} disabled={busy || (!!who && who !== "officer") || !canListen()}>
          🎤 Officer
          <small>speak English</small>
        </button>
        <button className={`talk-btn other ${who === "other" ? "on" : ""}`} onClick={() => talk("other")} disabled={busy || (!!who && who !== "other") || !lang.code || !canListen()}>
          🎤 {lang.name}
          <small>{lang.code ? "they speak" : "type below"}</small>
        </button>
      </div>
      {who && <p className="live">{live || "Listening…"}</p>}
      {busy && <span className="analyzing">Translating…</span>}
      {err && <p className="tool-error">{err}</p>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          send(typed, "other");
          setTyped("");
        }}
      >
        <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Or type in ${lang.name}…`} style={{ flex: 1 }} />
        <button className="btn ghost" disabled={busy}>
          Translate
        </button>
      </form>
      <div className="tlog">
        {log.map((t, n) => (
          <div key={n} className={`tline ${t.speaker}`}>
            <small>
              {t.speaker === "officer" ? "Officer" : t.fromLang} · {new Date(t.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </small>
            <div className="heard">{t.heard}</div>
            <div className="said">
              → {t.text}{" "}
              {t.speaker === "officer" && lang.code && (
                <button className="linkbtn" onClick={() => say(t.text, lang.code)}>
                  🔊 again
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="muted">For simple conversations only. Use a certified interpreter for interviews, rights advisements, and anything legal.</p>
    </section>
  );
}

// ---------- Checklist ----------
function Checklist({ i, lists, patch }: { i: Incident; lists: { name: string; steps: string[] }[]; patch: (b: object) => Promise<void> }) {
  const c = i.checklist;
  const list = c && lists.find((l) => l.name === c.name);
  if (!c || !list)
    return (
      <section className="card">
        <h3>Pick a checklist</h3>
        <p className="muted">The current step shows on the glasses; a pinch (or “Jarvis, next step”) moves on.</p>
        <div className="row">
          {lists.map((l) => (
            <button key={l.name} className="btn ghost" onClick={() => patch({ checklist: l.name })}>
              {l.name} ({l.steps.length})
            </button>
          ))}
        </div>
        <a href="/field#department" className="muted">
          Add your department&apos;s own procedures →
        </a>
      </section>
    );
  const finished = c.step >= list.steps.length;
  return (
    <section className="card">
      <div className="row">
        <h3 style={{ flex: 1 }}>
          {list.name} · {c.done.length}/{list.steps.length}
        </h3>
        <button className="linkbtn" onClick={() => patch({ checklist: null })}>
          Change checklist
        </button>
      </div>
      {finished ? (
        <p className="step-now done">✓ Checklist complete</p>
      ) : (
        <p className="step-now">
          <small>
            Step {c.step + 1} of {list.steps.length}
          </small>
          {list.steps[c.step]}
        </p>
      )}
      <div className="row">
        <button className="btn ghost" onClick={() => patch({ step: "back" })} disabled={c.step === 0}>
          ← Back
        </button>
        <button className="btn" onClick={() => patch({ step: "next" })} disabled={finished}>
          Done, next →
        </button>
      </div>
      <ol className="steps">
        {list.steps.map((s, n) => (
          <li key={n} className={`${c.done.includes(n) ? "done" : ""} ${n === c.step ? "now" : ""}`} onClick={() => patch({ step: n })}>
            {c.done.includes(n) ? "✓ " : ""}
            {s}
          </li>
        ))}
      </ol>
    </section>
  );
}
