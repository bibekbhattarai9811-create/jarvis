// Browser speech helpers for Jarvis, HUD, and Field Assist: dictate in any language, speak a line in any language.

export type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
export type Recognizer = {
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

export const PREFERRED_VOICES = [/Google UK English Male/i, /Ryan.*United Kingdom/i, /George/i, /Daniel/i, /Thomas.*United Kingdom/i, /en-GB.*male/i, /en-GB/i];

export function getRecognizerClass(): (new () => Recognizer) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const canListen = () => !!getRecognizerClass();

export function pickEnglishVoice(voiceName?: string): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === "undefined") return undefined;
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
}

/** Speak English text in Jarvis's voice; resolves when done. Split into sentences because Chrome cuts off long utterances. */
export function speakEnglish(text: string, voiceName?: string, onStart?: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof speechSynthesis === "undefined") {
      resolve();
      return;
    }
    speechSynthesis.cancel();
    const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
    const voice = pickEnglishVoice(voiceName);
    let left = parts.length;
    onStart?.();
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
  });
}

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
