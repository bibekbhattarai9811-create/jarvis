import { denied, json, logSecurity, roleOf } from "@/lib/auth";
import { think, type Action, type Turn } from "@/lib/brain";
import { forget, remember } from "@/lib/memory";
import { runOnPc } from "@/lib/pc";
import { quickReply } from "@/lib/quick";
import { demoReply } from "@/lib/demoAnswers";
import { isDemo } from "@/lib/paths";

export const runtime = "nodejs";

// "Good morning, Jarvis" / "brief me" → a spoken daily briefing.
const BRIEFING = /^(hey |ok )?(jarvis,? )?(good morning|morning briefing|brief me|daily briefing|what('s| is) my day( look like)?|what do i have today)\b/i;
const BRIEFING_ASK =
  "Give me my daily briefing, spoken, under 30 seconds: greet me for the time of day; today's weather where I am (search it: temperature now, high and low, chance of rain); anything you remember about me that matters today or soon (exams, deadlines, plans); and one top news headline. Natural sentences, no lists.";

const isPcAction = (a: Action) => a.type === "open_app" || a.type === "media" || a.type === "lock_pc" || (a.type === "open_url" && a.where === "pc");
// What a guest's reply may do: things that happen on their own screen, nothing on this PC or in your memory.
const GUEST_ACTIONS = new Set(["open_url", "timer", "holo_add", "holo_clear", "holo_scan", "holo_color", "holo_scale", "holo_explode"]);

// Guests use your Claude subscription, so they share a budget: 40 messages per hour.
const g = globalThis as unknown as { __jarvisGuestUse?: number[] };
const GUEST_PER_HOUR = 40;

export async function POST(req: Request) {
  const role = roleOf(req);
  if (!role) return denied(req);
  const guest = role === "guest";

  const body = (await req.json().catch(() => ({}))) as { message?: unknown; history?: unknown; device?: unknown };
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return Response.json({ error: "Say something first." }, { status: 400 });
  if (isDemo()) return Response.json({ ...demoReply(message), engine: "instant" });
  // Only well-formed past turns, kept short.
  const history: Turn[] = (Array.isArray(body.history) ? body.history : [])
    .filter((t): t is Turn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .slice(-12)
    .map((t) => ({ role: t.role, text: t.text.slice(0, 2000) }));
  const dev = body.device === "phone" ? "phone" : "computer";

  if (guest) {
    const now = Date.now();
    const used = (g.__jarvisGuestUse = (g.__jarvisGuestUse || []).filter((t) => now - t < 3600_000));
    if (used.length >= GUEST_PER_HOUR) return Response.json({ error: "Guest mode is busy right now. Try again in a little while." }, { status: 429 });
    used.push(now);
  }

  try {
    // Everyday commands answer instantly; everything else asks Claude.
    const quick = quickReply(message, guest ? "phone" : dev);
    const reply = quick ? { ...quick, engine: "instant" } : await think(history, BRIEFING.test(message) ? BRIEFING_ASK : message, dev, guest);
    const problems: string[] = [];
    const deviceActions: Action[] = [];
    let blocked = false;
    for (const a of reply.actions) {
      if (guest) {
        // Guests never touch the PC or memory, whatever the reply asks for.
        if (!GUEST_ACTIONS.has(a.type) || (a.type === "open_url" && !/^https:\/\//i.test(a.url))) {
          blocked = true;
          continue;
        }
        deviceActions.push(a.type === "open_url" ? { ...a, where: "device" } : a);
      } else if (a.type === "remember") remember(a.note);
      else if (a.type === "forget") forget(a.match);
      else if (isPcAction(a)) {
        const err = await runOnPc(a);
        if (err) problems.push(err);
      } else deviceActions.push(a);
    }
    if (blocked) logSecurity(`guest request blocked: ${JSON.stringify(message).slice(0, 120)}`);
    const say = blocked && !deviceActions.length ? "That's not available in guest mode, I'm afraid." : problems.length ? `${reply.say} ${problems.join(" ")}` : reply.say;
    return Response.json({ say, actions: deviceActions, engine: reply.engine });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Lets the page check a passcode (and learn owner vs guest) without asking Claude anything. */
export async function GET(req: Request) {
  const role = roleOf(req);
  if (!role) return denied(req);
  const body = { ok: true, role: isDemo() ? "demo" : role, engine: isDemo() ? "demo" : process.env.ANTHROPIC_API_KEY ? "api" : "cli" };
  // Owner devices also get the signed login cookie, so they stay in even while wrong guesses lock others out.
  return role === "owner" ? json(req, body) : Response.json(body);
}
