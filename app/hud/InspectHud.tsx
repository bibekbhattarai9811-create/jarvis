"use client";

// Glasses view of a live Inspect Pro report (/hud?report=<id>): shows the latest photo you took, its findings,
// and changes since move-in, and speaks each new result. Black = see-through on the glasses.

import { useEffect, useRef, useState } from "react";
import { api, photoUrl } from "@/lib/proClient";
import type { Photo, ProReport, Room } from "@/lib/pro";
import { checkProgress, nextCheck } from "@/lib/checklists";

const SEV_COLOR = { high: "#ff5a6e", medium: "#ff9a4d", low: "#ffd34d" } as const;

function speak(text: string) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices();
    u.voice = v.find((x) => /Google UK English Male|Ryan.*United Kingdom|George|Daniel/i.test(x.name)) || v.find((x) => x.lang === "en-GB") || null;
    u.rate = 1.05;
    u.pitch = 0.9;
    speechSynthesis.speak(u);
  } catch {}
}

/** What Jarvis says about one analyzed photo, plus what to check next. */
function describe(room: string, p: Photo, next?: { room: string; item: string } | null): string {
  const r = p.result!;
  const high = r.issues.filter((i) => i.severity === "high");
  const parts = [`${room}: ${r.condition}, ${r.score} out of 10.`];
  if (!r.issues.length) parts.push("No issues found.");
  else {
    parts.push(`${r.issues.length} issue${r.issues.length === 1 ? "" : "s"}${high.length ? `, ${high.length} high` : ""}.`);
    parts.push(`Top: ${(high[0] || r.issues[0]).label}.`);
  }
  if (r.safety) parts.push(`Safety: ${r.safety.split(/(?<=[.!?])\s/)[0]}`);
  if (next) parts.push(`Next: ${next.room === room ? "" : `${next.room}, `}${next.item}.`);
  return parts.join(" ");
}

export default function InspectHud({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<ProReport | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const spoken = useRef<Set<string>>(new Set());
  const first = useRef(true);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const d = await api<{ report: ProReport }>(`/api/pro/reports/${reportId}`);
        if (stop) return;
        setReport(d.report);
        setError("");
        // Speak results that finished since we started watching (not the old ones on first load).
        for (const room of d.report.rooms) {
          for (const p of room.photos) {
            if (p.status !== "done" || spoken.current.has(p.id)) continue;
            spoken.current.add(p.id);
            if (!first.current) speak(describe(room.name, p, nextCheck(d.report.rooms, room.name)));
          }
          const c = room.compare;
          const key = `cmp:${room.name}:${c?.at}`;
          if (c?.status === "done" && c.result && !spoken.current.has(key)) {
            spoken.current.add(key);
            const flagged = c.result.changes.filter((x) => x.beyondWear).length;
            if (!first.current)
              speak(`${room.name}: ${c.result.changes.length} change${c.result.changes.length === 1 ? "" : "s"} since move-in${flagged ? `, ${flagged} possibly beyond normal wear` : ""}.`);
          }
        }
        first.current = false;
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) setTimeout(tick, 2500);
    };
    tick();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(clock);
    };
  }, [reportId]);

  // The photo you took most recently is "what you're looking at".
  const latest = report?.rooms
    .flatMap((room) => room.photos.map((p) => ({ room, p })))
    .sort((a, b) => b.p.at.localeCompare(a.p.at))[0];

  // Pinch (tap / Space / Enter / message from the simulator) repeats the latest result.
  useEffect(() => {
    const again = () => latest?.p.result && report && speak(describe(latest.room.name, latest.p, nextCheck(report.rooms, latest.room.name)));
    const onKey = (e: KeyboardEvent) => (e.code === "Space" || e.code === "Enter") && (e.preventDefault(), again());
    const onMsg = (e: MessageEvent) => e.origin === location.origin && e.data === "jarvis-pinch" && again();
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMsg);
    window.addEventListener("click", again);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMsg);
      window.removeEventListener("click", again);
    };
  }, [latest, report]);

  const all = report?.rooms.flatMap((r) => r.photos) || [];
  const next = report ? nextCheck(report.rooms, latest?.room.name) : null;
  const progress = report ? checkProgress(report.rooms) : null;
  const highCount = all.reduce((n, p) => n + (p.result?.issues.filter((i) => i.severity === "high").length || 0), 0);
  const roomsDone = report?.rooms.filter((r) => r.photos.length).length || 0;

  return (
    <main className="ihud">
      <div className="ihud-screen">
        <div className="ihud-top">
          <span>{new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          <span className="ihud-mark">INSPECT</span>
        </div>

        {error && <p className="ihud-msg">{error}</p>}
        {!report && !error && <p className="ihud-msg">Connecting…</p>}
        {report && !latest && <p className="ihud-msg">Take a photo with your phone. The findings will appear here.</p>}

        {latest && <Latest room={latest.room} p={latest.p} reportId={reportId} />}

        {next && (
          <div className="ihud-next">
            NEXT ▸ {next.room !== latest?.room.name && <b>{next.room} · </b>}
            {next.item}
          </div>
        )}
        {report && !next && progress && progress.total > 0 && <div className="ihud-next done">✓ Walkthrough complete</div>}

        {report && (
          <div className="ihud-bottom">
            <span>
              {roomsDone}/{report.rooms.length} rooms
            </span>
            {progress && (
              <span>
                ✓ {progress.done}/{progress.total}
              </span>
            )}
            <span>{all.length} photos</span>
            <span style={{ color: highCount ? SEV_COLOR.high : undefined }}>{highCount} high</span>
          </div>
        )}
      </div>
      <style>{`
        html, body { background: #000 !important; overflow: hidden; }
        .ihud { position: fixed; inset: 0; display: grid; place-items: center; background: #000; color: #9fe8ff;
          font-family: "Segoe UI", system-ui, sans-serif; user-select: none; cursor: pointer; }
        .ihud-screen { width: min(100vw, 100vh); aspect-ratio: 1; display: flex; flex-direction: column; gap: 2.4vmin; padding: 5%; overflow: hidden; }
        .ihud-screen > * { flex-shrink: 0; }
        .ihud-alert, .ihud-cmp { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ihud-top, .ihud-bottom { display: flex; justify-content: space-between; font-size: clamp(11px, 3.4vmin, 20px); opacity: .85; }
        .ihud-mark { letter-spacing: .3em; font-weight: 600; }
        .ihud-msg { margin: auto 0; text-align: center; font-size: clamp(14px, 5vmin, 30px); color: #e8fbff; }
        .ihud-room { display: flex; justify-content: space-between; align-items: baseline; gap: 2vmin; }
        .ihud-room b { font-size: clamp(16px, 6vmin, 36px); color: #fff; text-shadow: 0 0 10px rgba(63,216,255,.7); }
        .ihud-score { font-size: clamp(13px, 4.6vmin, 28px); font-weight: 600; }
        .ihud-screen > .ihud-main { display: flex; gap: 3vmin; min-height: 0; flex: 1 1 auto; flex-shrink: 1; overflow: hidden; }
        .ihud-pic { position: relative; width: 40%; align-self: flex-start; line-height: 0; border: 1px solid rgba(63,216,255,.6); border-radius: 1.5vmin; overflow: hidden; }
        .ihud-pic img { width: 100%; height: auto; display: block; opacity: .9; }
        .ihud-pic span { position: absolute; transform: translate(-50%,-50%); width: 4.6vmin; height: 4.6vmin; border-radius: 50%; display: grid; place-items: center;
          font: bold clamp(9px, 2.6vmin, 14px)/1 system-ui; color: #000; border: 2px solid #fff; }
        .ihud-list { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1.6vmin; font-size: clamp(11px, 3.6vmin, 21px); line-height: 1.25; color: #e8fbff; overflow: hidden; }
        .ihud-list .n { display: inline-grid; place-items: center; width: 3.8vmin; height: 3.8vmin; border-radius: 50%; color: #000; font-weight: 700;
          font-size: clamp(9px, 2.4vmin, 13px); margin-right: 1vmin; vertical-align: middle; }
        .ihud-alert { color: #ff8a99; font-size: clamp(11px, 3.6vmin, 21px); animation: blink 1.2s ease-in-out infinite; }
        .ihud-cmp { color: #ffc46b; font-size: clamp(11px, 3.6vmin, 21px); }
        .ihud-next { color: #e8fbff; font-size: clamp(11px, 3.8vmin, 22px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          border-left: .8vmin solid #3fd8ff; padding-left: 2vmin; }
        .ihud-next b { color: #3fd8ff; font-weight: 600; }
        .ihud-next.done { color: #4dff9a; border-color: #4dff9a; }
        .ihud-wait { display: flex; align-items: center; gap: 2vmin; font-size: clamp(13px, 4.4vmin, 26px); color: #e8fbff; margin: auto 0; }
        .ihud-wait::before { content: ""; width: 5vmin; height: 5vmin; border-radius: 50%; border: .8vmin solid rgba(63,216,255,.3); border-top-color: #3fd8ff; animation: spin .8s linear infinite; }
        @keyframes blink { 50% { opacity: .45; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}

function Latest({ room, p, reportId }: { room: Room; p: Photo; reportId: string }) {
  const r = p.result;
  const cmp = room.compare?.status === "done" ? room.compare.result : null;
  return (
    <>
      <div className="ihud-room">
        <b>{room.name}</b>
        {r && (
          <span className="ihud-score" style={{ color: r.score >= 8 ? "#4dff9a" : r.score >= 5 ? "#ffd34d" : "#ff5a6e" }}>
            {r.condition.toUpperCase()} {r.score}/10
          </span>
        )}
      </div>
      {p.status === "analyzing" && <div className="ihud-wait">Inspecting photo…</div>}
      {p.status === "error" && <p className="ihud-msg">Couldn&apos;t analyze that photo. Take another.</p>}
      {r && (
        <div className="ihud-main">
          <div className="ihud-pic">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(reportId, p.id)} alt={room.name} />
            {r.issues.slice(0, 4).map((i, n) => (
              <span key={n} style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%`, background: SEV_COLOR[i.severity] }}>
                {n + 1}
              </span>
            ))}
          </div>
          <div className="ihud-list">
            {r.issues.length === 0 && <div>No issues found.</div>}
            {r.issues.slice(0, 4).map((i, n) => (
              <div key={n}>
                <span className="n" style={{ background: SEV_COLOR[i.severity] }}>
                  {n + 1}
                </span>
                {i.label}
                {i.type && i.type !== "other" ? ` · ${i.type}` : ""}
              </div>
            ))}
            {r.issues.length > 4 && <div style={{ opacity: 0.7 }}>+{r.issues.length - 4} more on phone</div>}
          </div>
        </div>
      )}
      {r?.safety && <div className="ihud-alert">⚠ {r.safety.split(/(?<=[.!?])\s/)[0]}</div>}
      {cmp && (
        <div className="ihud-cmp">
          Δ {cmp.changes.length} change{cmp.changes.length === 1 ? "" : "s"} since move-in
          {cmp.changes.filter((c) => c.beyondWear).length ? ` · ${cmp.changes.filter((c) => c.beyondWear).length} beyond wear?` : ""}
        </div>
      )}
    </>
  );
}
