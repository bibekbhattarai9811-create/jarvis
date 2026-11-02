"use client";

// Hands-free mode: Jarvis listens all the time and acts on "Jarvis, …" commands, with a live camera so
// "take a photo" works without touching the phone. Commands are matched on the phone (instant, no AI):
//   "Jarvis, note: driver says he had a green arrow"   "Jarvis, take a photo of the front bumper"
//   "Jarvis, next step" / "go back" / "read the step"   "Jarvis, start the traffic crash checklist"
//   "Jarvis, translate Spanish"   "Jarvis, draft the report"   "Jarvis, stop listening"

import { useEffect, useRef, useState } from "react";
import type { Incident } from "@/lib/field";
import { LANGUAGES, say } from "@/lib/speech";

type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const WAKE = /\b(?:hey |ok )?(?:jarvis|jervis|javis|jarvas|travis|service)\b[,.!]?\s*/i;

type Props = {
  i: Incident;
  lists: { name: string; steps: string[] }[];
  onNote: (text: string) => Promise<void>;
  onPhoto: (jpeg: string, caption: string) => Promise<void>;
  onScanId: (jpeg: string, role: string) => Promise<void>;
  onPatch: (body: object) => Promise<void>;
  onTranslate: (language: string) => void;
  onDraft: () => Promise<void>;
  onClose: () => void;
};

export default function HandsFree(p: Props) {
  const [heard, setHeard] = useState("");
  const [last, setLast] = useState("Say “Jarvis, …”");
  const [cam, setCam] = useState<"off" | "on" | "blocked">("off");
  const video = useRef<HTMLVideoElement>(null);
  const props = useRef(p);
  props.current = p;
  const speaking = useRef(false);

  // Live camera for voice photos.
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: 1600, height: 1200 }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
        setCam("on");
      })
      .catch(() => setCam("blocked"));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Rec) {
      setLast("Voice isn't supported in this browser.");
      return;
    }
    let alive = true;
    let rec: Recognizer | null = null;

    const reply = (text: string) => {
      setLast(text);
      speaking.current = true;
      rec?.abort(); // don't let Jarvis hear itself
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = 1.05;
        u.onend = u.onerror = () => {
          speaking.current = false;
          if (alive) start();
        };
        speechSynthesis.speak(u);
      } catch {
        speaking.current = false;
      }
    };

    const snap = (): string | null => {
      const v = video.current;
      if (!v || v.readyState < 2) return null;
      const c = document.createElement("canvas");
      const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.85);
    };

    const run = async (cmd: string) => {
      const P = props.current;
      const c = cmd.trim().replace(/[.!?]+$/, "");
      const lc = c.toLowerCase();
      const list = P.i.checklist && P.lists.find((l) => l.name === P.i.checklist!.name);
      let m: RegExpMatchArray | null;
      if ((m = c.match(/^(?:add (?:a )?)?note[:,]?\s+(.+)/i))) {
        await P.onNote(m[1]);
        return reply("Noted.");
      }
      if ((m = lc.match(/^(?:take|snap|grab) (?:a |another )?(?:photo|picture|pic)(?: of (.+))?$/))) {
        const jpeg = snap();
        if (!jpeg) return reply("The camera isn't ready.");
        navigator.vibrate?.(60);
        await P.onPhoto(jpeg, m[1] ? m[1][0].toUpperCase() + m[1].slice(1) : "");
        return reply(m[1] ? `Photo of ${m[1]} saved.` : "Photo saved.");
      }
      // "scan ID", "scan the license for driver one", "scan ID witness"
      if ((m = lc.match(/^scan (?:the |an |their |this )?(?:id|i\.?d\.?|license|licence|driver'?s license)(?: card)?(?: (?:for|of) )?(?:the )?(.*)$/))) {
        const jpeg = snap();
        if (!jpeg) return reply("The camera isn't ready.");
        navigator.vibrate?.(60);
        const who = (m[1] || "").replace(/\bone\b/, "1").replace(/\btwo\b/, "2").replace(/^driver (\d)$/, "driver of V$1").trim();
        reply("Reading the ID. Check the details on screen.");
        await P.onScanId(jpeg, who ? who[0].toUpperCase() + who.slice(1) : "");
        return;
      }
      if (/^(next( step)?|done|step done|got it|check)$/.test(lc)) {
        if (!list || !P.i.checklist) return reply("No checklist is running.");
        await P.onPatch({ step: "next" });
        const nxt = list.steps[P.i.checklist.step + 1];
        return reply(nxt ? `Next: ${nxt}.` : "Checklist complete.");
      }
      if (/^(go back|back|previous( step)?)$/.test(lc)) {
        await P.onPatch({ step: "back" });
        return reply("Going back.");
      }
      if (/^(read|repeat|what'?s) (the |this |next )?(step|next)$|^what('?s| is) next$/.test(lc)) {
        if (!list || !P.i.checklist) return reply("No checklist is running.");
        return reply(list.steps[P.i.checklist.step] || "Checklist complete.");
      }
      if ((m = lc.match(/^(?:start|open|run) (?:the )?(.+?)(?: checklist)?$|^checklist (.+)$/))) {
        const want = (m[1] || m[2]).replace(/ checklist$/, "");
        const hit = P.lists.find((l) => l.name.toLowerCase().includes(want) || want.includes(l.name.toLowerCase()));
        if (hit) {
          await P.onPatch({ checklist: hit.name });
          return reply(`${hit.name}. Step one: ${hit.steps[0]}.`);
        }
      }
      if ((m = lc.match(/^translate(?: to| into| for)? (\w+)/))) {
        const lang = LANGUAGES.find((l) => l.name.toLowerCase().startsWith(m![1]));
        if (!lang) return reply(`I don't have ${m[1]} yet.`);
        P.onTranslate(lang.name);
        return reply(`Translating ${lang.name}. Use the buttons to talk.`);
      }
      if (/^(draft|write|make) (the |a )?report$/.test(lc)) {
        reply("Drafting the report.");
        await P.onDraft();
        return;
      }
      if (/^(stop|stop listening|hands[- ]free off|goodbye)$/.test(lc)) {
        reply("Hands-free off.");
        setTimeout(() => P.onClose(), 900);
        return;
      }
      reply("Sorry, I didn't catch a command.");
    };

    const start = () => {
      if (!alive || speaking.current) return;
      const r = new Rec();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let live = "";
        for (let k = e.resultIndex; k < e.results.length; k++) {
          const t = e.results[k][0].transcript;
          if (!e.results[k].isFinal) {
            live += t;
            continue;
          }
          const w = t.match(WAKE);
          if (w) {
            const cmd = t.slice((w.index || 0) + w[0].length);
            if (cmd.trim().length > 1) run(cmd).catch((err) => reply((err as Error).message));
            else reply("Yes?");
          }
        }
        setHeard(WAKE.test(live) ? live : "");
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          alive = false;
          setLast("Microphone is blocked for this site.");
        }
      };
      r.onend = () => {
        if (rec === r && alive && !speaking.current) setTimeout(start, 250); // keep listening
      };
      rec = r;
      try {
        r.start();
      } catch {}
    };
    start();
    return () => {
      alive = false;
      rec?.abort();
      speechSynthesis.cancel();
    };
  }, []);

  return (
    <section className="card handsfree">
      <div className="row">
        <span className="hf-dot" />
        <b style={{ flex: 1 }}>Hands-free · listening for “Jarvis”</b>
        <button className="btn ghost" onClick={p.onClose}>
          Turn off
        </button>
      </div>
      <div className="hf-body">
        <div className="hf-cam">
          <video ref={video} playsInline muted hidden={cam !== "on"} />
          {cam === "blocked" && <p className="muted">Camera blocked: voice photos won&apos;t work.</p>}
          {cam === "off" && <p className="muted">Starting camera…</p>}
        </div>
        <div className="hf-text">
          <p className="live">{heard || last}</p>
          <p className="muted hf-help">
            “Jarvis, note: …” · “take a photo of …” · “scan ID for driver one” · “next step” · “read the step” · “start traffic crash checklist” · “translate Spanish” · “draft the report” · “stop listening”
          </p>
        </div>
      </div>
    </section>
  );
}
