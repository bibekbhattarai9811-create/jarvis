// Live demo answers. The public demo has no Claude behind it (and no PC to control), so it answers instant
// commands for real and a handful of questions about itself; everything else explains how to run the full version.

import type { Action } from "./brain";
import { quickReply } from "./quick";

const REPO = "github.com/bibekbhattarai9811-create/jarvis";

const FAQ: [RegExp, string][] = [
  [/\b(who|what) are you\b|\bintroduce yourself\b/, "I'm Jarvis, a voice assistant built on Claude. I run on my owner's PC and phone, and this is my public demo."],
  [/\bwhat can you do\b|\bhelp\b|\bfeatures?\b/, "I answer questions with live web search, control the PC, play with holograms in HOLO, run rental inspections, and help officers write reports hands-free. Try HOLO, or say: set a one minute timer."],
  [/\bwho (made|built|created) you\b|\byour (creator|maker)\b/, "Bibek Bhattarai built me, a data science and civil engineering student at Arkansas State."],
  [/\bhow do you work\b|\bhow (were|are) you (made|built)\b/, "Speech recognition in your browser, Claude for thinking, and a Next.js server on the owner's PC. Hand tracking and face recognition run right in your browser."],
  [/\b(hi|hello|hey)\b/, "Hello. This is the live demo. Try HOLO, open Field Assist, or ask what I can do."],
  [/\bjoke\b/, "I would tell you a joke about my HOLO playground, but it would just blow up."],
];

const PC_ONLY = new Set(["media", "set_volume", "pc_status", "open_app", "lock_pc"]);
const DEMO_ACTIONS = new Set(["open_url", "timer", "timer_cancel", "holo_add", "holo_clear", "holo_scan", "holo_color", "holo_scale", "holo_explode", "face_learn"]);

export function demoReply(message: string): { say: string; actions: Action[] } {
  const quick = quickReply(message, "phone");
  if (quick) {
    if (quick.actions.some((a) => PC_ONLY.has(a.type)))
      return { say: "On a real install that controls the owner's PC. In the live demo I can't touch anyone's computer.", actions: [] };
    return { say: quick.say, actions: quick.actions.filter((a) => DEMO_ACTIONS.has(a.type)).map((a) => (a.type === "open_url" ? { ...a, where: "device" } : a)) };
  }
  const m = message.toLowerCase();
  for (const [re, say] of FAQ) if (re.test(m)) return { say, actions: [] };
  return {
    say: `In the live demo I only know a few things. Full answers come from Claude when you run me yourself: the code is at ${REPO.replace(/\./g, " dot ").replace(/\//g, " slash ")}.`,
    actions: [],
  };
}
