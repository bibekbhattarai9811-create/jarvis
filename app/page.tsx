"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { holoQueue, matchShape } from "@/lib/holoPlayground";
import { getRecognizerClass, speakEnglish, type Recognizer } from "@/lib/speech";
import GuestAccess from "./GuestAccess";
import KnownFaces from "./KnownFaces";
import Memories from "./Memories";

const Gestures = dynamic(() => import("./Gestures"), { ssr: false });

type Status = "idle" | "listening" | "thinking" | "speaking";
type ListenMode = "wake" | "command" | "followup";
type Turn = { role: "user" | "assistant"; text: string };
type Line = { who: "you" | "jarvis" | "system"; text: string; link?: string };
type ActiveTimer = { id: number; label: string; endsAt: number };
type DeviceAction =
  | { type: "open_url"; url: string }
  | { type: "timer"; seconds: number; label?: string }
  | { type: "timer_cancel"; label?: string }
  | { type: "holo_add"; shape: string }
  | { type: "holo_clear" }
  | { type: "holo_scan" }
  | { type: "holo_color"; color: string }
  | { type: "holo_scale"; factor: number }
  | { type: "holo_explode"; all?: boolean }
  | { type: "face_learn"; name?: string };

// "Jarvis" plus common mishearings by speech recognition.
const WAKE = /\b(hey |hi |ok |okay )?(jarvis|jarvi|jervis|javis|jarvas|varvis|harvis|marvis|travis|service)\b[,.!?]?/i;

function store(key: string, value?: string): string {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key) || "";
  } catch {
    return value || "";
  }
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [text, setText] = useState("");
  const [pin, setPin] = useState("");
  const [needPin, setNeedPin] = useState(false);
  const [pinError, setPinError] = useState("");
  const [role, setRole] = useState<"owner" | "guest" | "demo" | "">(process.env.NEXT_PUBLIC_DEMO === "1" ? "demo" : "");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [engine, setEngine] = useState("");
  const [canListen, setCanListen] = useState(true);
  const [handsFree, setHandsFree] = useState(process.env.NEXT_PUBLIC_DEMO !== "1");
  const [followUp, setFollowUp] = useState(false);
  const [holo, setHolo] = useState(false);
  const [game, setGame] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [timers, setTimers] = useState<ActiveTimer[]>([]);
  const [now, setNow] = useState(Date.now());
  const [pcStats, setPcStats] = useState<{ cpu: number; memPct: number; battery: number | null } | null>(null);
  const [statHist, setStatHist] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });
  const [showLog, setShowLog] = useState(false);

  const history = useRef<Turn[]>([]);
  const rec = useRef<Recognizer | null>(null);
  const statusRef = useRef<Status>("idle");
  // Always listening for "Jarvis" (off if the mic is blocked). The public demo waits for a tap instead of asking
  // every visitor for the microphone the moment the page opens.
  const wakeOn = useRef(process.env.NEXT_PUBLIC_DEMO !== "1");
  const armed = useRef(false); // heard "Jarvis" alone: next sentence is the command
  const logEnd = useRef<HTMLDivElement>(null);

  const setStat = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };
  const addLine = (l: Line) => setLines((prev) => [...prev.slice(-40), l]);

  useEffect(() => {
    setCanListen(!!getRecognizerClass());
    setPin(store("jarvis-pin"));
    setVoiceName(store("jarvis-voice"));
    try {
      const saved = JSON.parse(store("jarvis-timers") || "[]") as ActiveTimer[];
      if (Array.isArray(saved)) setTimers(saved.filter((t) => t && t.endsAt > Date.now()));
    } catch {}
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en")));
    load();
    speechSynthesis.onvoiceschanged = load;
    fetch("/api/ask", { headers: { "x-jarvis-pin": store("jarvis-pin") } }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      setEngine(d.engine || "");
      setRole(d.role || "");
      if (r.status === 401 || r.status === 429) setNeedPin(true);
    });
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, interim]);

  useEffect(() => {
    if (role !== "owner") return;
    const poll = () =>
      fetch("/api/pc", { headers: { "x-jarvis-pin": pin } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setPcStats(d);
          setStatHist((h) => ({ cpu: [...h.cpu, d.cpu].slice(-20), mem: [...h.mem, d.memPct].slice(-20) }));
        })
        .catch(() => {});
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, [role, pin]);

  /** Speak text; resolves when done. Split into sentences because Chrome cuts off long utterances. */
  const speak = useCallback(
    (say: string) => speakEnglish(say, voiceName, () => setStat("speaking")),
    [voiceName]
  );

  // Tick active countdown timers and persist them across reloads.
  useEffect(() => {
    store("jarvis-timers", JSON.stringify(timers));
    if (!timers.length) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [timers]);

  useEffect(() => {
    const done = timers.filter((t) => t.endsAt <= now);
    if (!done.length) return;
    setTimers((ts) => ts.filter((t) => t.endsAt > now));
    navigator.vibrate?.([300, 150, 300, 150, 300]);
    for (const d of done) {
      addLine({ who: "jarvis", text: `Your ${d.label} is done, sir.` });
      speak(`Sir, your ${d.label} is done.`).then(() => afterReply());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const runDeviceAction = useCallback(
    (a: DeviceAction) => {
      if (a.type === "holo_scan") {
        holoQueue.push({ op: "scan" });
        setGame(false);
        setHolo(true);
      } else if (a.type === "holo_add" || a.type === "holo_clear") {
        if (a.type === "holo_add" && !matchShape(a.shape)) {
          addLine({ who: "system", text: `No hologram for "${a.shape}" yet.` });
          return;
        }
        holoQueue.push(a.type === "holo_add" ? { op: "add", shape: a.shape } : { op: "reset" });
        // Open the playground so the new hologram is visible (the queue waits until it's running).
        setGame(false);
        setHolo(true);
      } else if (a.type === "holo_color" || a.type === "holo_scale" || a.type === "holo_explode") {
        // Acts on the hologram you're holding (or touched last); opens HOLO if it isn't open.
        holoQueue.push(
          a.type === "holo_color" ? { op: "color", color: a.color } : a.type === "holo_scale" ? { op: "scale", factor: a.factor } : { op: "explode", all: !!a.all }
        );
        setGame(false);
        setHolo(true);
      } else if (a.type === "face_learn") {
        // Opens HOLO (camera) and learns the next face it sees.
        holoQueue.push({ op: "learnface", name: a.name });
        setGame(false);
        setHolo(true);
      } else if (a.type === "open_url") {
        const win = window.open(a.url, "_blank");
        if (!win) addLine({ who: "system", text: "Tap to open:", link: a.url });
      } else if (a.type === "timer" && a.seconds > 0) {
        const label = a.label ? `${a.label} timer` : "timer";
        setNow(Date.now());
        setTimers((ts) => [...ts, { id: Date.now() + Math.random(), label, endsAt: Date.now() + a.seconds * 1000 }]);
      } else if (a.type === "timer_cancel") {
        const q = a.label?.toLowerCase();
        setTimers((ts) => (q ? ts.filter((t) => !t.label.toLowerCase().includes(q)) : []));
      }
    },
    []
  );

  // Declared below; refs let the recognizer callbacks reach the latest versions.
  const askRef = useRef<(msg: string, viaVoice?: boolean) => void>(() => {});
  const listenRef = useRef<(mode: ListenMode) => void>(() => {});
  const lastWasVoice = useRef(false);

  const stopListening = () => {
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.abort();
    }
    setInterim("");
  };

  const afterReply = useCallback((followUp = false) => {
    setStat("idle");
    // After a spoken answer, keep listening a few seconds so you can reply without saying "Jarvis" again.
    if (followUp && lastWasVoice.current && getRecognizerClass()) listenRef.current("followup");
    else if (wakeOn.current) listenRef.current("wake");
  }, []);

  const ask = useCallback(
    async (message: string, viaVoice = false) => {
      stopListening();
      armed.current = false;
      lastWasVoice.current = viaVoice;
      addLine({ who: "you", text: message });
      setStat("thinking");
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json", "x-jarvis-pin": pin },
          body: JSON.stringify({
            message,
            history: history.current,
            device: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "phone" : "computer",
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setNeedPin(true);
          throw new Error("I need your passcode first, sir.");
        }
        if (!res.ok) throw new Error(data.error || "Something went wrong.");
        if (data.engine && data.engine !== "instant") setEngine(data.engine);
        history.current = [...history.current, { role: "user" as const, text: message }, { role: "assistant" as const, text: data.say }].slice(-12);
        addLine({ who: "jarvis", text: data.say });
        for (const a of data.actions || []) runDeviceAction(a);
        await speak(data.say);
      } catch (e) {
        const msg = (e as Error).message;
        addLine({ who: "system", text: msg });
        await speak(msg.length < 120 ? msg : "Something went wrong, sir. Details are on screen.");
      }
      afterReply(true);
    },
    [pin, speak, runDeviceAction, afterReply]
  );
  askRef.current = ask;

  const listen = useCallback((mode: ListenMode) => {
    const Rec = getRecognizerClass();
    if (!Rec) return;
    stopListening();
    setFollowUp(mode === "followup");
    const r = new Rec();
    r.lang = "en-US";
    r.continuous = mode === "wake";
    r.interimResults = true;
    let finalText = "";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (!e.results[i].isFinal) {
          live += t;
          continue;
        }
        if (mode !== "wake") {
          finalText += t;
          continue;
        }
        // Wake mode: act only on sentences that mention Jarvis (or the one right after "Jarvis?").
        const m = t.match(WAKE);
        if (armed.current && t.trim()) {
          askRef.current(t.trim(), true);
          return;
        }
        if (m) {
          const cmd = t.slice((m.index || 0) + m[0].length).trim();
          if (cmd.length > 1) askRef.current(cmd, true);
          else {
            armed.current = true;
            setStat("listening");
            speak("Yes, sir?").then(() => {
              setStat("listening");
              listenRef.current("command");
            });
          }
          return;
        }
      }
      if (mode !== "wake" || armed.current || WAKE.test(live)) setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wakeOn.current = false;
        setHandsFree(false);
        addLine({ who: "system", text: "Microphone is blocked. Allow mic access for this site (it also needs https on phones), then tap Talk." });
      }
    };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null;
      setInterim("");
      setFollowUp(false);
      if (mode !== "wake") {
        armed.current = false;
        if (finalText.trim()) askRef.current(finalText.trim(), true);
        else afterReply(); // nothing said: back to waiting for "Jarvis"
      } else if (wakeOn.current && statusRef.current === "idle") {
        // Browsers stop continuous listening after a while: restart (short pause so errors can't spin).
        setTimeout(() => {
          if (wakeOn.current && statusRef.current === "idle" && !rec.current) listenRef.current("wake");
        }, 300);
      }
    };
    rec.current = r;
    if (mode !== "wake") setStat("listening");
    try {
      r.start();
    } catch {}
  }, [speak, afterReply]);
  listenRef.current = listen;

  // Start listening for "Jarvis" / "Hey Jarvis" as soon as the page opens.
  useEffect(() => {
    if (getRecognizerClass() && wakeOn.current) listenRef.current("wake");
    return () => {
      wakeOn.current = false;
      stopListening();
    };
  }, []);

  const onOrb = () => {
    if (status === "speaking") {
      speechSynthesis.cancel();
      afterReply();
      return;
    }
    if (status === "thinking") return;
    if (status === "listening" && rec.current && !rec.current.continuous) {
      rec.current.stop(); // finish now and send
      return;
    }
    if (!canListen) return;
    wakeOn.current = true; // tapping also retries the mic after it was blocked
    setHandsFree(true);
    listen("command");
  };

  const toggleHandsFree = () => {
    if (!canListen) return;
    const next = !handsFree;
    wakeOn.current = next;
    setHandsFree(next);
    if (next && statusRef.current === "idle") listen("wake");
    else if (!next && statusRef.current === "idle") stopListening();
  };

  const submitText = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() && status !== "thinking") {
      ask(text.trim());
      setText("");
    }
  };

  const savePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch("/api/ask", { headers: { "x-jarvis-pin": pin.trim() } });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      store("jarvis-pin", pin.trim());
      setRole(d.role || "");
      setNeedPin(false);
    } else setPinError(r.status === 429 ? d.error : "Wrong passcode.");
  };

  const hint = {
    idle: !canListen ? "Type a command below" : handsFree ? 'Say "Hey Jarvis" or tap the orb' : "Tap the orb to speak",
    listening: interim || "Listening…",
    thinking: "Thinking…",
    speaking: "Tap orb to stop",
  }[status];

  const quickChips =
    role === "demo"
      ? [
          { icon: "✨", label: "What can you do?", ask: "What can you do?" },
          { icon: "▶", label: "Play Music", ask: "Play lofi on YouTube" },
          { icon: "⏱", label: "1 Min Timer", ask: "Set a 1 minute timer" },
          { icon: "🦾", label: "3D Helmet", ask: "Add a helmet hologram" },
        ]
      : [
          { icon: "🌅", label: "Daily Briefing", ask: "Good morning, Jarvis" },
          { icon: "▶", label: "Play Music", ask: "Play lofi on YouTube" },
          { icon: "🌤", label: "Weather", ask: "What's the weather?" },
          { icon: "⏱", label: "5 Min Timer", ask: "Set a 5 minute timer" },
          ...(role === "owner" ? [{ icon: "💻", label: "PC Status", ask: "System status" }] : []),
        ];

  const hour = new Date().getHours();
  const greeting = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}${role === "owner" ? ", Bibek" : ""}.`;
  const lastJarvis = [...lines].reverse().find((l) => l.who !== "you");
  const lastYou = [...lines].reverse().find((l) => l.who === "you");
  const statusWord = { idle: "ONLINE", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING" }[status];
  const goHome = () => {
    setHolo(false);
    setGame(false);
    setShowTools(false);
  };

  return (
    <main className={`app dash ${status} ${holo ? "holo" : ""} ${game ? "game" : ""}`}>
      {/* ---------- Left column: brand, navigation, system ---------- */}
      <aside className="side side-left">
        <button type="button" className="hpanel brand-panel" onClick={goHome} title="Jarvis Home">
          <span className="brand-name">JARVIS</span>
          <span className="brand-status">
            {statusWord} <i className="status-dot" />
          </span>
        </button>

        <nav className="hpanel nav-panel" aria-label="Main navigation">
          <button type="button" className={`nav-item ${!holo && !game && !showTools && !showSettings ? "on" : ""}`} onClick={goHome}>
            <span className="nav-ico">⌂</span> Home
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={() => {
              setHolo(true);
              setGame(false);
            }}
          >
            <span className="nav-ico">✦</span> Holograms
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={() => {
              setGame(true);
              setHolo(false);
            }}
          >
            <span className="nav-ico">🎮</span> Game
          </button>
          <button type="button" className={`nav-item ${showTools ? "on" : ""}`} onClick={() => setShowTools((t) => !t)}>
            <span className="nav-ico">🧰</span> Tools <span className="nav-caret">{showTools ? "▾" : "▸"}</span>
          </button>
          {showTools && (
            <div className="nav-sub">
              {role === "owner" && <a href="/inspect">🔍 Photo Inspect</a>}
              {(role === "owner" || role === "demo") && (
                <>
                  <a href="/pro">📋 Inspect Pro</a>
                  <a href="/field">🚓 Field Assist</a>
                </>
              )}
              <a href="/glasses">👓 Smart Glasses</a>
            </div>
          )}
          <button type="button" className={`nav-item ${showSettings ? "on" : ""}`} onClick={() => setShowSettings(true)}>
            <span className="nav-ico">⚙</span> Settings
          </button>
        </nav>

        <div className="hpanel stats-panel">
          {pcStats ? (
            <>
              <StatRow label="CPU Usage" value={`${pcStats.cpu}%`} data={statHist.cpu} />
              <StatRow label="Memory Usage" value={`${pcStats.memPct}%`} data={statHist.mem} />
              {pcStats.battery !== null && <StatRow label="Battery" value={`${pcStats.battery}%`} data={[]} pct={pcStats.battery} />}
            </>
          ) : (
            <>
              <StatRow label="Voice" value={canListen ? (handsFree ? "Wake word" : "Tap to talk") : "Text only"} data={[]} />
              <StatRow label="AI Engine" value={engine === "demo" ? "Demo" : engine === "api" ? "API" : engine ? "Claude" : "…"} data={[]} />
            </>
          )}
        </div>
      </aside>

      {showSettings && (
        <div className="modal" onClick={() => setShowSettings(false)}>
          <section className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <strong>⚙ Settings</strong>
              <button type="button" className="pill" onClick={() => setShowSettings(false)}>
                ✕ Close
              </button>
            </div>

            <div className="settings-group">
              <label className="settings-field">
                <span>Voice</span>
                <select
                  value={voiceName}
                  onChange={(e) => {
                    setVoiceName(store("jarvis-voice", e.target.value));
                  }}
                >
                  <option value="">Auto (British male)</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-actions">
                <button type="button" className="pill" onClick={() => speak("Good evening, sir. All systems are online.")}>
                  🔊 Test Voice
                </button>
                {canListen && (
                  <button type="button" className={`pill ${handsFree ? "on" : ""}`} onClick={toggleHandsFree}>
                    <span className="dot" /> &ldquo;Hey Jarvis&rdquo;: {handsFree ? "ON" : "OFF"}
                  </button>
                )}
                <button
                  type="button"
                  className="pill"
                  onClick={() => {
                    history.current = [];
                    setLines([]);
                  }}
                >
                  🗑 Clear Chat
                </button>
                <button type="button" className="pill" onClick={() => setNeedPin(true)}>
                  🔑 Passcode
                </button>
                {pcStats && (
                  <button type="button" className="pill" onClick={() => { setShowSettings(false); ask("System status"); }}>
                    💻 CPU {pcStats.cpu}% · RAM {pcStats.memPct}%{pcStats.battery !== null ? ` · 🔋${pcStats.battery}%` : ""}
                  </button>
                )}
              </div>
            </div>

            {role === "owner" && <Memories pin={pin} />}
            {role === "owner" && <KnownFaces pin={pin} />}
            {role === "owner" && <GuestAccess pin={pin} />}
          </section>
        </div>
      )}

      {/* ---------- Center: hologram on its projector + conversation ---------- */}
      <section className="center">
        <div className="stage">
          <div className="holo-beam" aria-hidden="true" />
          <button className="orb" onClick={onOrb} aria-label={hint}>
            <svg className="orb-ticks" viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 8" opacity="0.55" />
              <circle cx="100" cy="100" r="82" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="28 14 8 14" opacity="0.45" />
              <circle cx="100" cy="100" r="64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.6" />
            </svg>
            <span className="ring r1" />
            <span className="ring r2" />
            <span className="ring r3" />
            <span className="core" />
          </button>

          <div className={`hpanel msg-box ${showLog ? "expanded" : ""}`}>
            <button type="button" className="msg-reactor" onClick={onOrb} aria-label={hint} title={hint}>
              <span />
            </button>
            <div className="msg-body">
              {showLog && lines.length > 0 ? (
                <div className="msg-log">
                  {lines.map((l, i) => (
                    <p key={i} className={`msg-line ${l.who}`}>
                      <b>{l.who === "you" ? "You" : l.who === "jarvis" ? "Jarvis" : "•"}</b> {l.text}{" "}
                      {l.link && (
                        <a href={l.link} target="_blank" rel="noreferrer">
                          open ↗
                        </a>
                      )}
                    </p>
                  ))}
                  <div ref={logEnd} />
                </div>
              ) : status === "listening" ? (
                <p className="msg-main">{interim || "Listening…"}</p>
              ) : status === "thinking" ? (
                <>
                  {lastYou && <p className="msg-you">“{lastYou.text}”</p>}
                  <p className="msg-main thinking-dots">Thinking</p>
                </>
              ) : lastJarvis ? (
                <>
                  {lastYou && <p className="msg-you">“{lastYou.text}”</p>}
                  <p className="msg-main">
                    {lastJarvis.text}{" "}
                    {lastJarvis.link && (
                      <a href={lastJarvis.link} target="_blank" rel="noreferrer">
                        open ↗
                      </a>
                    )}
                  </p>
                </>
              ) : (
                <p className="msg-main">
                  {greeting}
                  <br />
                  How can I assist you today?
                </p>
              )}
            </div>
            {lines.length > 0 && (
              <button type="button" className="msg-history" onClick={() => setShowLog((s) => !s)} title="Conversation history">
                {showLog ? "✕" : "☰"}
              </button>
            )}
          </div>

          <div className="projector" aria-hidden="true">
            <span className="pj pj1" />
            <span className="pj pj2" />
            <span className="pj pj3" />
          </div>
        </div>

        <p className="hint">{hint}</p>

        {timers.length > 0 && (
          <div className="timers">
            {timers.map((t) => {
              const left = Math.max(0, Math.ceil((t.endsAt - now) / 1000));
              return (
                <button
                  key={t.id}
                  className="pill timer-pill"
                  onClick={() => setTimers((ts) => ts.filter((x) => x.id !== t.id))}
                  title="Click to cancel timer"
                >
                  ⏱ {t.label} · <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b> ✕
                </button>
              );
            })}
          </div>
        )}

        <div className="mobile-quick">
          {quickChips.slice(0, 4).map((c) => (
            <button key={c.label} className="chip" disabled={status === "thinking"} onClick={() => ask(c.ask)}>
              <span>{c.icon}</span> {c.label}
            </button>
          ))}
        </div>

        <form className="typebar" onSubmit={submitText}>
          {canListen && (
            <button
              type="button"
              className={`mic-btn ${status === "listening" ? "on" : ""}`}
              onClick={onOrb}
              title={status === "listening" ? "Finish listening" : "Speak a command"}
              aria-label="Voice input"
            >
              🎙
            </button>
          )}
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Jarvis anything…" enterKeyHint="send" />
          <button type="submit" disabled={!text.trim() || status === "thinking"}>
            Send
          </button>
        </form>
      </section>

      {/* ---------- Right column: clock, globe, quick actions ---------- */}
      <aside className="side side-right">
        <Clock />
        <div className="hpanel globe-panel">
          <Globe />
          <span className="globe-label">GLOBAL NETWORK · ONLINE</span>
        </div>
        <div className="hpanel quick-panel">
          <h4>Quick Actions</h4>
          {quickChips.map((c) => (
            <button key={c.label} type="button" className="qa-item" disabled={status === "thinking"} onClick={() => ask(c.ask)}>
              <span className="qa-ico">{c.icon}</span> {c.label}
            </button>
          ))}
        </div>
      </aside>

      {(holo || game) && (
        <Gestures
          onFace={(name) => {
            // Greet each known person once per visit, if Jarvis isn't busy.
            if (statusRef.current !== "idle") return;
            const line = name.toLowerCase() === "bibek" ? "Welcome back, sir." : `Hello, ${name}.`;
            addLine({ who: "jarvis", text: line });
            speak(line).then(() => afterReply());
          }}
          holo={holo}
          game={game}
          status={status}
          onExit={() => {
            setHolo(false);
            setGame(false);
          }}
          onError={(msg) => {
            setHolo(false);
            setGame(false);
            addLine({ who: "system", text: msg });
          }}
        />
      )}

      {needPin && (
        <div className="modal">
          <form onSubmit={savePin}>
            <h2>Passcode</h2>
            <p>Enter your passcode, or the guest code you were given. You only need to do this once per device.</p>
            <input
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setPinError("");
              }}
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Passcode"
            />
            {pinError && <p className="pin-error">{pinError}</p>}
            <button className="pill on">Unlock</button>
          </form>
        </div>
      )}
    </main>
  );
}

/** Live clock panel (own component so only it re-renders every second). */
function Clock() {
  const [d, setD] = useState<Date | null>(null);
  useEffect(() => {
    setD(new Date());
    const id = setInterval(() => setD(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="hpanel clock-panel">
      <span className="clock-time">{d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "--:--"}</span>
      <span className="clock-date">{d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : ""}</span>
    </div>
  );
}

/** Spinning wireframe globe with blinking network nodes. */
function Globe() {
  const nodes = [
    [70, 62], [88, 48], [112, 58], [128, 74], [96, 92], [140, 52], [62, 84], [118, 100], [150, 86], [80, 110],
  ];
  return (
    <svg className="globe" viewBox="0 0 200 150" aria-hidden="true">
      <defs>
        <radialGradient id="globeFill" cx="45%" cy="40%" r="60%">
          <stop offset="0%" stopColor="rgba(63,216,255,0.28)" />
          <stop offset="100%" stopColor="rgba(63,216,255,0.02)" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="75" r="62" fill="url(#globeFill)" stroke="rgba(63,216,255,0.7)" strokeWidth="1.2" />
      {[-40, -20, 0, 20, 40].map((y) => {
        const rx = Math.sqrt(62 * 62 - y * y);
        return <ellipse key={y} cx="100" cy={75 + y} rx={rx} ry={rx * 0.12} fill="none" stroke="rgba(63,216,255,0.28)" strokeWidth="0.8" />;
      })}
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx="100" cy="75" rx="62" ry="62" fill="none" stroke="rgba(63,216,255,0.35)" strokeWidth="0.8">
          <animate attributeName="rx" values="62;0;62" dur="8s" begin={`${-i * 2}s`} repeatCount="indefinite" />
        </ellipse>
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.8" fill="#bff4ff">
          <animate attributeName="opacity" values="0.2;1;0.2" dur={`${1.6 + (i % 4) * 0.5}s`} repeatCount="indefinite" />
        </circle>
      ))}
      <path d="M70 62 Q90 30 112 58 M112 58 Q135 40 150 86 M62 84 Q85 120 118 100" fill="none" stroke="rgba(191,244,255,0.5)" strokeWidth="0.8" strokeDasharray="3 3">
        <animate attributeName="stroke-dashoffset" values="0;-12" dur="1.2s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

/** One system stat line with a mini sparkline (or a progress bar when `pct` is given). */
function StatRow({ label, value, data, pct }: { label: string; value: string; data: number[]; pct?: number }) {
  const pts = data.length > 1 ? data.map((v, i) => `${(i / (data.length - 1)) * 100},${22 - (Math.min(100, v) / 100) * 20}`).join(" ") : "";
  return (
    <div className="stat-row">
      <div className="stat-top">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      {pts ? (
        <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : pct !== undefined ? (
        <div className="stat-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <div className="stat-bar idle">
          <span />
        </div>
      )}
    </div>
  );
}
