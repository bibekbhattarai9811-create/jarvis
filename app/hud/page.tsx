"use client";

// The glasses display app: a 600×600 screen like the Meta Ray-Ban Display's.
// Black = see-through on the glasses (additive display), so only the glowing parts float in your view.
// Tap / click, or press Space or Enter (stand-ins for a Neural Band pinch), to talk.

import { useEffect, useRef, useState } from "react";
import { holoQueue } from "@/lib/holoPlayground";
import InspectHud from "./InspectHud";
import FieldHud from "./FieldHud";

type Status = "idle" | "listening" | "thinking" | "speaking";
type Turn = { role: "user" | "assistant"; text: string };
type Timer = { id: number; label: string; endsAt: number };
type Recognizer = {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const PREFERRED_VOICES = [/Google UK English Male/i, /Ryan.*United Kingdom/i, /George/i, /Daniel/i, /en-GB/i];

/** /hud = voice assistant; /hud?report=<id> = live Inspect Pro view; /hud?field=<id> = Field Assist view. */
export default function HudPage() {
  const [view, setView] = useState<{ report?: string; field?: string } | undefined>(undefined);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const ok = (v: string | null) => (v && /^[a-z0-9]{6,20}$/.test(v) ? v : undefined);
    setView({ report: ok(q.get("report")), field: ok(q.get("field")) });
  }, []);
  if (!view) return null;
  if (view.field) return <FieldHud id={view.field} />;
  return view.report ? <InspectHud reportId={view.report} /> : <VoiceHud />;
}

function VoiceHud() {
  const [status, setStatus] = useState<Status>("idle");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("Good evening, sir. Pinch to talk.");
  const [timers, setTimers] = useState<Timer[]>([]);
  const [now, setNow] = useState(Date.now());
  const history = useRef<Turn[]>([]);
  const rec = useRef<Recognizer | null>(null);
  const statusRef = useRef<Status>("idle");

  const set = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Timers ring when done
  useEffect(() => {
    const done = timers.filter((t) => t.endsAt <= now);
    if (!done.length) return;
    setTimers((ts) => ts.filter((t) => t.endsAt > now));
    for (const t of done) say(`Sir, your ${t.label} is done.`, `⏱ ${t.label} done`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const say = (text: string, shown = text) =>
    new Promise<void>((resolve) => {
      setReply(shown);
      speechSynthesis.cancel();
      const voices = speechSynthesis.getVoices();
      const voice = PREFERRED_VOICES.map((re) => voices.find((v) => re.test(`${v.name} ${v.lang}`))).find(Boolean);
      const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
      let left = parts.length;
      set("speaking");
      for (const p of parts) {
        const u = new SpeechSynthesisUtterance(p.trim());
        if (voice) u.voice = voice;
        u.rate = 1.03;
        u.pitch = 0.9;
        u.onend = u.onerror = () => {
          if (--left === 0) {
            set("idle");
            resolve();
          }
        };
        speechSynthesis.speak(u);
      }
    });

  const ask = async (message: string) => {
    set("thinking");
    setHeard(message);
    try {
      let pin = "";
      try {
        pin = localStorage.getItem("jarvis-pin") || "";
      } catch {}
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", "x-jarvis-pin": pin },
        body: JSON.stringify({ message, history: history.current, device: "phone" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Open Jarvis once on this device and enter your passcode.");
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      history.current = [...history.current, { role: "user" as const, text: message }, { role: "assistant" as const, text: data.say }].slice(-12);
      for (const a of data.actions || []) {
        if (a.type === "timer" && a.seconds > 0) setTimers((ts) => [...ts, { id: Date.now() + Math.random(), label: a.label ? `${a.label} timer` : "timer", endsAt: Date.now() + a.seconds * 1000 }]);
        if (a.type === "holo_add") holoQueue.push({ op: "add", shape: a.shape });
      }
      await say(data.say);
    } catch (e) {
      await say((e as Error).message);
    }
  };

  const listen = () => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Rec) {
      setReply("Voice isn't supported in this browser.");
      return;
    }
    const r = new Rec();
    r.lang = "en-US";
    r.interimResults = true;
    let finalText = "";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else live += e.results[i][0].transcript;
      }
      setHeard(finalText + live);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setReply("Microphone is blocked.");
    };
    r.onend = () => {
      rec.current = null;
      if (finalText.trim()) ask(finalText.trim());
      else set("idle");
    };
    rec.current = r;
    setHeard("");
    set("listening");
    r.start();
  };

  // "Pinch": tap anywhere, or Space / Enter (what a ring/band click would send).
  const pinch = () => {
    const s = statusRef.current;
    if (s === "speaking") {
      speechSynthesis.cancel();
      set("idle");
    } else if (s === "listening") rec.current?.stop();
    else if (s === "idle") listen();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        pinch();
      }
    };
    // The simulator forwards pinches from outside the lens.
    const onMsg = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data === "jarvis-pinch") pinch();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMsg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clock = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const long = reply.length > 120;

  return (
    <main className={`hud ${status}`} onClick={pinch}>
      <div className="hud-screen">
        <div className="hud-top">
          <span>{clock}</span>
          <span className="hud-mark">J.A.R.V.I.S.</span>
        </div>

        <div className="hud-reactor">
          <span className="ring a" />
          <span className="ring b" />
          <span className="core" />
        </div>

        <p className={`hud-reply ${long ? "long" : ""}`}>{reply}</p>

        {timers.length > 0 && (
          <div className="hud-timers">
            {timers.map((t) => {
              const left = Math.max(0, Math.ceil((t.endsAt - now) / 1000));
              return (
                <span key={t.id}>
                  ⏱ {t.label} {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                </span>
              );
            })}
          </div>
        )}

        <div className="hud-bottom">
          {status === "listening" && <span className="hud-live">“{heard || "Listening…"}”</span>}
          {status === "thinking" && <span>Thinking…</span>}
          {status === "speaking" && <span>Pinch to interrupt</span>}
          {status === "idle" && <span>Pinch to talk</span>}
        </div>
      </div>
      <style>{`
        html, body { background: #000 !important; overflow: hidden; }
        .hud { position: fixed; inset: 0; display: grid; place-items: center; background: #000; cursor: pointer;
          --g: 63,216,255; font-family: "Segoe UI", system-ui, sans-serif; user-select: none; }
        .hud.thinking { --g: 255,181,71; }
        .hud.listening { --g: 160,245,255; }
        .hud-screen { width: min(100vw, 100vh); aspect-ratio: 1; position: relative; display: flex; flex-direction: column;
          align-items: center; padding: 6%; color: rgb(var(--g)); }
        .hud-top { width: 100%; display: flex; justify-content: space-between; font-size: clamp(12px, 3.6vmin, 22px); opacity: .85; }
        .hud-mark { letter-spacing: .3em; font-weight: 600; }
        .hud-reactor { position: relative; width: 22%; aspect-ratio: 1; margin: 5% 0 4%; }
        .hud-reactor .ring, .hud-reactor .core { position: absolute; border-radius: 50%; }
        .hud-reactor .a { inset: 0; border: 2px dashed rgba(var(--g), .8); animation: hspin 10s linear infinite; }
        .hud-reactor .b { inset: 16%; border: 5px solid rgba(var(--g), .35); border-top-color: rgb(var(--g)); border-bottom-color: rgb(var(--g));
          animation: hspin 4s linear infinite reverse; }
        .hud-reactor .core { inset: 34%; background: radial-gradient(circle, #fff 0%, rgb(var(--g)) 45%, transparent 72%);
          box-shadow: 0 0 30px rgba(var(--g), .9); animation: hbreathe 3s ease-in-out infinite; }
        .thinking .hud-reactor .b { animation-duration: .9s; }
        .listening .hud-reactor .core { animation-duration: .9s; }
        .speaking .hud-reactor .core { animation: htalk .3s ease-in-out infinite alternate; }
        .hud-reply { margin: 0; flex: 1; display: flex; align-items: center; text-align: center; color: #e8fbff;
          font-size: clamp(16px, 6.2vmin, 38px); line-height: 1.3; text-shadow: 0 0 12px rgba(var(--g), .6); overflow: hidden; }
        .hud-reply.long { font-size: clamp(13px, 4.4vmin, 27px); }
        .hud-timers { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; font-size: clamp(12px, 3.6vmin, 22px); margin-bottom: 3%; }
        .hud-timers span { border: 1px solid rgba(var(--g), .6); border-radius: 99px; padding: 2px 12px; }
        .hud-bottom { font-size: clamp(12px, 3.8vmin, 23px); opacity: .9; min-height: 1.4em; text-align: center; max-width: 100%; }
        .hud-live { color: #fff; }
        @keyframes hspin { to { transform: rotate(360deg); } }
        @keyframes hbreathe { 50% { transform: scale(.85); opacity: .8; } }
        @keyframes htalk { from { transform: scale(.85); } to { transform: scale(1.1); } }
      `}</style>
    </main>
  );
}
