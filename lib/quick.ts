// Instant replies: everyday commands Jarvis can handle without asking Claude (no 5-10s wait).
// Anything that doesn't clearly match goes to Claude as usual.

import type { Action } from "./brain";

export type Quick = { say: string; actions: Action[] };

const SITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  gmail: "https://mail.google.com",
  "google maps": "https://maps.google.com",
  maps: "https://maps.google.com",
  netflix: "https://www.netflix.com",
  github: "https://github.com",
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
  facebook: "https://www.facebook.com",
  instagram: "https://www.instagram.com",
  twitter: "https://x.com",
  x: "https://x.com",
  reddit: "https://www.reddit.com",
  amazon: "https://www.amazon.com",
  linkedin: "https://www.linkedin.com",
  "google drive": "https://drive.google.com",
  drive: "https://drive.google.com",
  "google docs": "https://docs.google.com",
  canvas: "https://canvas.astate.edu",
  tradingview: "https://www.tradingview.com",
};

const APPS = new Set([
  "chrome", "google chrome", "edge", "microsoft edge", "notepad", "calculator", "calc", "explorer", "file explorer", "files",
  "settings", "spotify", "vscode", "vs code", "visual studio code", "word", "excel", "powerpoint", "terminal", "task manager",
  "paint", "camera", "discord", "whatsapp",
]);

export const HOLO_COLORS: Record<string, string> = {
  red: "255,70,70",
  orange: "255,150,50",
  yellow: "255,225,80",
  gold: "255,200,60",
  green: "80,255,140",
  blue: "70,140,255",
  cyan: "63,216,255",
  purple: "170,110,255",
  violet: "170,110,255",
  pink: "255,100,190",
  white: "235,245,255",
};

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty five": 45, sixty: 60 };

const pick = (...lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

export function quickReply(raw: string, device: string): Quick | null {
  const m = raw.toLowerCase().replace(/[.!?,]+$/g, "").replace(/^(please |can you |could you |jarvis,? )+/g, "").replace(/ please$/, "").trim();
  const onPc = / on (my |the )?(pc|computer|laptop)$/.test(m);
  const msg = m.replace(/ on (my |the )?(pc|computer|laptop)$/, "").trim();

  // Media keys & volume percentage
  const vol = msg.match(/^(?:set (?:the )?)?volume (?:to |at )?(\d{1,3})\s*%?$/);
  if (vol) {
    const level = Math.max(0, Math.min(100, Number(vol[1])));
    return { say: `Setting volume to ${level} percent.`, actions: [{ type: "set_volume", level }] };
  }
  if (/^(system status|pc status|computer status|diagnostics|system diagnostics|how('s| is) my (pc|computer|system)( doing)?|check my (pc|computer)|what('s| is) my battery( at)?|battery (level|status))$/.test(msg)) {
    return { say: "All systems nominal, sir.", actions: [{ type: "pc_status" }] };
  }
  if (/^(turn (the )?(volume|it|music) up|volume up|louder|turn up( the volume)?|increase( the)? volume)$/.test(msg)) return { say: "Louder it is.", actions: [{ type: "media", key: "volume_up" }] };
  if (/^(turn (the )?(volume|it|music) down|volume down|quieter|turn down( the volume)?|lower( the)? volume|decrease( the)? volume)$/.test(msg)) return { say: "Bringing it down.", actions: [{ type: "media", key: "volume_down" }] };
  if (/^(mute|unmute)( (it|the (sound|volume|pc|computer)))?$/.test(msg)) return { say: "Done.", actions: [{ type: "media", key: "mute" }] };
  if (/^(pause|play|resume|stop)( (the )?(music|song|video|it))?$/.test(msg)) return { say: pick("Done.", "Of course."), actions: [{ type: "media", key: "play_pause" }] };
  if (/^(next|skip)( (song|track|video|this))?$|^skip (it|this)$|^next one$/.test(msg)) return { say: "Skipping.", actions: [{ type: "media", key: "next" }] };
  if (/^(previous|last|go back)( (song|track|video))?$/.test(msg)) return { say: "Going back.", actions: [{ type: "media", key: "previous" }] };
  if (/^lock (my |the )?(pc|computer|laptop|screen)$/.test(m)) return { say: "Locking your PC, sir.", actions: [{ type: "lock_pc" }] };

  // Time / date
  if (/^what('s| is) the time( now)?$|^what time is it( now)?$/.test(msg))
    return { say: `It's ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`, actions: [] };
  if (/^what('s| is) (the date|today('s date)?)$|^what day is (it|today)$/.test(msg))
    return { say: `It's ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`, actions: [] };

  // Timers: "set a 5 minute timer for pasta", "timer for 30 seconds"
  const t = msg.match(/^(?:set (?:a |an )?)?(?:timer (?:for )?)?(\d+|[a-z]+(?: [a-z]+)?) (second|minute|hour)s?(?: timer)?(?: for (?:the |my )?(.+))?$/);
  if (t && (/timer/.test(msg) || /^set /.test(msg))) {
    const n = /^\d+$/.test(t[1]) ? Number(t[1]) : NUM[t[1]];
    if (n) {
      const seconds = n * (t[2] === "hour" ? 3600 : t[2] === "minute" ? 60 : 1);
      const label = t[3]?.trim();
      return { say: `${n} ${t[2]}${n === 1 ? "" : "s"}${label ? ` for the ${label}` : ""}. Timer's running.`, actions: [{ type: "timer", seconds, label }] };
    }
  }
  const tc = msg.match(/^(?:cancel|stop|clear|delete) (?:all )?(?:the |my )?(?:(.+?) )?timers?$/);
  if (tc) {
    const label = tc[1] && !/^(all|active|running)$/.test(tc[1]) ? tc[1].trim() : undefined;
    return { say: label ? `Cancelled the ${label} timer.` : "Timer cancelled.", actions: [{ type: "timer_cancel", label }] };
  }

  // "play lofi on youtube" / "search youtube for X"
  const yt = msg.match(/^(?:play|put on) (.+) on youtube$|^search youtube for (.+)$/);
  if (yt) {
    const q = (yt[1] || yt[2]).trim();
    return { say: `Pulling up ${q} on YouTube.`, actions: [{ type: "open_url", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, where: onPc || device === "computer" ? "pc" : "device" }] };
  }
  const g = msg.match(/^(?:google|search for|search google for|look up) (.+)$/);
  if (g && !/weather|news|score/.test(g[1]))
    return { say: `Searching for ${g[1]}.`, actions: [{ type: "open_url", url: `https://www.google.com/search?q=${encodeURIComponent(g[1])}`, where: onPc || device === "computer" ? "pc" : "device" }] };

  // "open youtube" / "open spotify"
  const o = msg.match(/^(?:open|launch|start|pull up|go to) (?:up )?(?:the )?(.+?)(?: app)?$/);
  if (o) {
    const name = o[1].trim();
    if (SITES[name]) return { say: `Opening ${name}.`, actions: [{ type: "open_url", url: SITES[name], where: onPc || device === "computer" ? "pc" : "device" }] };
    if (APPS.has(name)) return { say: `Opening ${name} on your PC.`, actions: [{ type: "open_app", name }] };
  }

  // Holo playground: act on the hologram you're holding (or touched last).
  const color = msg.match(/^(?:make|turn|paint|change) (?:it|this|that)(?: one)?(?: to)? (\w+)$/);
  if (color && HOLO_COLORS[color[1]]) return { say: pick(`${color[1][0].toUpperCase() + color[1].slice(1)} it is.`, "Done, sir."), actions: [{ type: "holo_color", color: color[1] }] };
  if (/^(make (it|this|that) )?(bigger|larger|grow)$/.test(msg)) return { say: "Scaling up.", actions: [{ type: "holo_scale", factor: 1.5 }] };
  if (/^(make (it|this|that) )?(smaller|shrink( it)?)$/.test(msg)) return { say: "Scaling down.", actions: [{ type: "holo_scale", factor: 0.67 }] };
  if (/^(explode|blow up|detonate|destroy|smash) (everything|them all|all( of them)?|it all)$/.test(msg)) return { say: "Detonating everything, sir.", actions: [{ type: "holo_explode", all: true }] };
  if (/^(explode|blow up|detonate|destroy|smash)( (it|this|that)( up)?)?$|^blow (it|this|that) up$/.test(msg)) return { say: pick("Boom.", "With pleasure."), actions: [{ type: "holo_explode" }] };

  // Face recognition: "remember my face", "meet Sam", "this is my friend Sam", "remember Sam's face"
  if (/^(remember|learn|scan|save) my face$/.test(msg)) return { say: "Look at the camera and hold still, sir.", actions: [{ type: "face_learn" }] };
  const who =
    msg.match(/^(?:meet|this is my (?:friend|brother|sister|mom|mother|dad|father|roommate|classmate|cousin|partner|girlfriend|boyfriend|wife|husband)) ([a-z][a-z'-]{1,20}(?: [a-z][a-z'-]{1,20})?)$/) ||
    msg.match(/^(?:remember|learn|save) ([a-z][a-z'-]{1,20}(?: [a-z][a-z'-]{1,20})?)'s face$/);
  if (who) {
    const name = who[1].replace(/\b\w/g, (c) => c.toUpperCase());
    return { say: `Nice to meet you, ${name}. Look at the camera and hold still.`, actions: [{ type: "face_learn", name }] };
  }

  return null;
}
