// Browser speech helpers for Field Assist: dictate in any language, speak a line in any language.

type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export const canListen = () => typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

/**
 * Start dictation. `long` keeps listening through pauses (for field notes) until stop() is called.
 * onText gets the running transcript; onDone gets the final text (may be empty).
 */
export function dictate(lang: string, long: boolean, onText: (t: string) => void, onDone: (t: string, error?: string) => void): { stop(): void } {
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Rec) {
    onDone("", "Voice isn't supported in this browser.");
    return { stop() {} };
  }
  const r = new Rec();
  r.lang = lang;
  r.continuous = long;
  r.interimResults = true;
  let text = "";
  let error = "";
  r.onresult = (e) => {
    text = Array.from(e.results)
      .map((x) => x[0].transcript)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    onText(text);
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") error = "Microphone is blocked for this site.";
    else if (e.error === "language-not-supported") error = "This browser can't listen in that language.";
  };
  r.onend = () => onDone(text, error || undefined);
  r.start();
  return { stop: () => r.stop() };
}

/** Speak a line in a language (picks a voice for it if the device has one). */
export function say(text: string, lang: string) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const base = lang.split("-")[0];
    const v = speechSynthesis.getVoices();
    u.voice = v.find((x) => x.lang === lang) || v.find((x) => x.lang.startsWith(base)) || null;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch {}
}

/** Languages for two-way translation: name for Claude, BCP-47 code for listening and speaking ("" = type only). */
export const LANGUAGES: { name: string; code: string }[] = [
  { name: "Spanish", code: "es-US" },
  { name: "Marshallese", code: "" }, // no browser speech engine: they type, and replies are shown as text
  { name: "Vietnamese", code: "vi-VN" },
  { name: "Chinese (Mandarin)", code: "zh-CN" },
  { name: "Arabic", code: "ar-SA" },
  { name: "Hindi", code: "hi-IN" },
  { name: "Nepali", code: "ne-NP" },
  { name: "French", code: "fr-FR" },
  { name: "Portuguese", code: "pt-BR" },
  { name: "Korean", code: "ko-KR" },
];
