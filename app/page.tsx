"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { holoQueue, matchShape } from "@/lib/holoPlayground";
import GuestAccess from "./GuestAccess";
import KnownFaces from "./KnownFaces";

const Gestures = dynamic(() => import("./Gestures"), { ssr: false });

type Status = "idle" | "listening" | "thinking" | "speaking";
type ListenMode = "wake" | "command" | "followup";
type Turn = { role: "user" | "assistant"; text: string };
type Line = { who: "you" | "jarvis" | "system"; text: string; link?: string };
type DeviceAction =
  | { type: "open_url"; url: string }
  | { type: "timer"; seconds: number; label?: string }
  | { type: "holo_add"; shape: string }
  | { type: "holo_clear" }
  | { type: "holo_scan" }
  | { type: "holo_color"; color: string }
  | { type: "holo_scale"; factor: number }
  | { type: "holo_explode"; all?: boolean }
  | { type: "face_learn"; name?: string };

// Minimal typing for the Web Speech API (not in TS's DOM lib).
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const PREFERRED_VOICES = [/Google UK English Male/i, /Ryan.*United Kingdom/i, /George/i, /Daniel/i, /Thomas.*United Kingdom/i, /en-GB.*male/i];
// "Jarvis" plus common mishearings by speech recognition.
const WAKE = /\b(hey |hi |ok |okay )?(jarvis|jarvi|jervis|javis|jarvas|varvis|harvis|marvis|travis|service)\b[,.!?]?/i;

function getRecognizerClass(): (new () => Recognizer) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

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
  const [role, setRole] = useState<"owner" | "guest" | "">("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [engine, setEngine] = useState("");
  const [canListen, setCanListen] = useState(true);
  const [followUp, setFollowUp] = useState(false);
  const [holo, setHolo] = useState(false);
  const [game, setGame] = useState(false);

  const history = useRef<Turn[]>([]);
  const rec = useRef<Recognizer | null>(null);
  const statusRef = useRef<Status>("idle");
  const wakeOn = useRef(true); // always listening for "Jarvis" (off only if the mic is blocked)
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

  const pickVoice = useCallback((): SpeechSynthesisVoice | undefined => {
    const all = speechSynthesis.getVoices();
    if (voiceName) {
      const v = all.find((x) => x.name === voiceName);
      if (v) return v;
    }
    for (const re of PREFERRED_VOICES) {
      const v = all.find((x) => re.test(`${x.name} ${x.lang}`));
      if (v) return v;
    }
    return all.find((x) => x.lang === "en-GB") || all.find((x) => x.lang.startsWith("en"));
  }, [voiceName]);

  /** Speak text; resolves when done. Split into sentences because Chrome cuts off long utterances. */
  const speak = useCallback(
    (say: string) =>
      new Promise<void>((resolve) => {
        speechSynthesis.cancel();
        const parts = say.match(/[^.!?]+[.!?]*/g) || [say];
        const voice = pickVoice();
        let left = parts.length;
        setStat("speaking");
        for (const p of parts) {
          const u = new SpeechSynthesisUtterance(p.trim());
          if (voice) u.voice = voice;
          u.rate = 1.03;
          u.pitch = 0.9;
          u.onend = u.onerror = () => {
            if (--left === 0) resolve();
          };
          speechSynthesis.speak(u);
        }
      }),
    [pickVoice]
  );

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
        addLine({ who: "system", text: `⏱ ${label} set for ${Math.round(a.seconds / 60) || a.seconds + "s"}${a.seconds >= 60 ? " min" : ""}` });
        setTimeout(() => {
          navigator.vibrate?.([300, 150, 300, 150, 300]);
          addLine({ who: "jarvis", text: `Your ${label} is done, sir.` });
          speak(`Sir, your ${label} is done.`);
        }, a.seconds * 1000);
      }
    },
    [speak]
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
        addLine({ who: "system", text: "Microphone is blocked. Allow mic access for this site (it also needs https on phones), then tap the orb." });
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
    if (getRecognizerClass()) listenRef.current("wake");
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
    listen("command");
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
    idle: canListen ? 'Say "Hey Jarvis…" or tap the orb' : "Voice isn't supported in this browser. Type below.",
    listening: interim || (followUp ? "Anything else? Just speak…" : "Listening…"),
    thinking: "Thinking…",
    speaking: "Tap to interrupt",
  }[status];

  return (
    <main className={`app ${status} ${holo ? "holo" : ""} ${game ? "game" : ""}`}>
      <header>
        <div className="brand">
          J.A.R.V.I.S.
          {engine && <span className="engine" title={engine === "api" ? "Anthropic API" : "Your Claude app login"}>{engine === "api" ? "API" : "Claude"}</span>}
        </div>
        <div className="controls">
          <button
            className={`pill ${holo ? "on" : ""}`}
            onClick={() => {
              setHolo(!holo);
              setGame(false);
            }}
            aria-pressed={holo}
            title="Iron Man hologram view"
          >
            <span className="dot" /> HOLO
          </button>
          <button
            className={`pill ${game ? "on" : ""}`}
            onClick={() => {
              setGame(!game);
              setHolo(false);
            }}
            aria-pressed={game}
            title="Drone Blaster game"
          >
            <span className="dot" /> 🎮
          </button>
          {role === "owner" && (
            <>
              <a className="pill" href="/inspect" title="Inspect something">
                🔍
              </a>
              <a className="pill" href="/pro" title="Inspect Pro: rental condition reports">
                📋
              </a>
              <a className="pill" href="/field" title="Field Assist (demo): reports, scene photos, translation, checklists">
                🚓
              </a>
            </>
          )}
          <a className="pill" href="/glasses" title="Smart glasses view">
            👓
          </a>
          <button className="icon" onClick={() => setShowSettings((s) => !s)} aria-label="Settings">
            ⚙
          </button>
        </div>
      </header>

      {showSettings && (
        <section className="settings">
          <label>
            Voice
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
          <button className="pill" onClick={() => speak("Good evening, sir. All systems are online.")}>
            Test voice
          </button>
          <button
            className="pill"
            onClick={() => {
              history.current = [];
              setLines([]);
            }}
          >
            Clear chat
          </button>
          <button className="pill" onClick={() => setNeedPin(true)}>
            {role === "guest" ? "Guest mode · change code" : "Change passcode"}
          </button>
          {role === "owner" && <GuestAccess pin={pin} />}
          {role === "owner" && <KnownFaces pin={pin} />}
        </section>
      )}

      <button className="orb" onClick={onOrb} aria-label={hint}>
        <span className="ring r1" />
        <span className="ring r2" />
        <span className="ring r3" />
        <span className="core" />
      </button>
      <p className="hint">{hint}</p>

      <section className="log">
        {lines.length === 0 && (
          <p className="empty">
            {role === "guest"
              ? "Guest mode · Try: “What's the weather?” · “Play lofi on YouTube” · “Set a 5 minute timer” · or tap HOLO"
              : "Try: “What's the weather?” · “Open YouTube and play lofi” · “Open Spotify on my PC” · “Set a 5 minute timer” · “Remember my exam is on Friday”"}
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.who}`}>
            {l.text}{" "}
            {l.link && (
              <a href={l.link} target="_blank" rel="noreferrer">
                {l.link.replace(/^https?:\/\//, "").slice(0, 40)}
              </a>
            )}
          </div>
        ))}
        <div ref={logEnd} />
      </section>

      {(holo || game) && (
        <>
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
            onError={(msg) => {
              setHolo(false);
              setGame(false);
              addLine({ who: "system", text: msg });
            }}
          />
          <p className="gesture-help">
            {holo
              ? "🤏 grab · 🤏🤏 2nd hand = resize · crash = 💥 · slow push = merge · hold still = ⚡ charge · ✋ swat · ✊ pull · say “Jarvis, add a helmet”"
              : "☝️ aim with your finger · 🤏 pinch to fire"}
          </p>
        </>
      )}

      <form className="typebar" onSubmit={submitText}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type a command…" enterKeyHint="send" />
        <button disabled={!text.trim() || status === "thinking"}>Send</button>
      </form>

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
