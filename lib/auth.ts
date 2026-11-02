import crypto from "crypto";
import fs from "fs";
import path from "path";

// Who's calling?
//   owner = your passcode (JARVIS_PIN in .env.local): everything, including PC control and Inspect Pro.
//   guest = the guest code you share (⚙ → Guest access): chat and the holo playground only.
// Passcodes come in the x-jarvis-pin header. Image URLs can't send headers, so an owner login also sets an
// httpOnly cookie signed with a random server secret (never the passcode itself).
// Wrong guesses are rate-limited: 5 per address → 15 min lockout; 30 from everyone in 10 min → all passcode
// logins pause 15 min (already-logged-in devices keep working).

export type Role = "owner" | "guest";

const DATA = path.join(process.cwd(), "data");
const COOKIE = "jarvis_auth";

/** Random per-install secret for signing cookies (data/secret.key, created on first use). */
function secret(): string {
  const file = path.join(DATA, "secret.key");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const s = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

// ---- Guest access (data/guest.json) ----
export type Guest = { enabled: boolean; code: string };
const GUEST_FILE = path.join(DATA, "guest.json");
/** 8 characters without look-alikes (0/O, 1/l/I): about 10^12 possible codes. */
const newCode = () => Array.from(crypto.randomBytes(8), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

export function getGuest(): Guest {
  try {
    const g = JSON.parse(fs.readFileSync(GUEST_FILE, "utf8"));
    if (typeof g.code === "string" && g.code.length >= 8) return { enabled: !!g.enabled, code: g.code };
  } catch {}
  return saveGuest({ enabled: false, code: newCode() });
}
export function saveGuest(g: Guest): Guest {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(GUEST_FILE, JSON.stringify(g, null, 2));
  return g;
}
export function updateGuest(change: { enabled?: boolean; newCode?: boolean }): Guest {
  const g = getGuest();
  return saveGuest({ enabled: change.enabled ?? g.enabled, code: change.newCode ? newCode() : g.code });
}

// ---- Brute-force protection (in memory; survives hot reloads) ----
type Fails = { count: number; first: number; until: number };
const g = globalThis as unknown as { __jarvisFails?: Map<string, Fails>; __jarvisAll?: number[]; __jarvisPause?: number };
const fails = (g.__jarvisFails ??= new Map());
const LIMIT = 5;
const WINDOW = 15 * 60_000;

/** Client address. The HTTPS server (scripts/serve.mjs) overwrites x-jarvis-ip with the real socket address. */
const ipOf = (req: Request) => req.headers.get("x-jarvis-ip") || "local";

export function lockedOut(req: Request): number {
  const now = Date.now();
  const f = fails.get(ipOf(req));
  const until = Math.max(f && f.until > now ? f.until : 0, g.__jarvisPause && g.__jarvisPause > now ? g.__jarvisPause : 0);
  return until ? Math.ceil((until - now) / 60_000) : 0;
}

function recordFail(req: Request) {
  const now = Date.now();
  const ip = ipOf(req);
  const f = fails.get(ip);
  const cur = f && now - f.first < WINDOW ? f : { count: 0, first: now, until: 0 };
  cur.count++;
  if (cur.count >= LIMIT) cur.until = now + WINDOW;
  fails.set(ip, cur);
  const all = (g.__jarvisAll = [...(g.__jarvisAll || []).filter((t) => now - t < 10 * 60_000), now]);
  if (all.length >= 30) g.__jarvisPause = now + WINDOW;
  logSecurity(`wrong passcode from ${ip}${cur.until ? " (locked out 15 min)" : ""}`);
}

export function logSecurity(line: string) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(path.join(DATA, "security.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const sign = (role: Role, key: string) => `${role}.${crypto.createHmac("sha256", secret()).update(`${role}:${key}`).digest("hex")}`;

/** Who is this request from? null = nobody (wrong/missing passcode or locked out). */
export function roleOf(req: Request): Role | null {
  const pin = process.env.JARVIS_PIN;
  if (!pin) return "owner"; // no passcode configured: local-only setup
  const cookie = (req.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (cookie && same(cookie.slice(COOKIE.length + 1), sign("owner", pin))) return "owner";
  const sent = req.headers.get("x-jarvis-pin");
  if (!sent) return null;
  if (lockedOut(req)) return null;
  if (same(sent, pin)) return "owner";
  const guest = getGuest();
  if (guest.enabled && same(sent, guest.code)) return "guest";
  recordFail(req);
  return null;
}

/** Owner-only routes. */
export const authed = (req: Request) => roleOf(req) === "owner";

/** JSON response that also refreshes the owner's login cookie (call only after authed() passed). */
export function json(req: Request, body: unknown, status = 200): Response {
  const res = Response.json(body, { status });
  const pin = process.env.JARVIS_PIN;
  if (pin) {
    const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-jarvis-https") ? "; Secure" : "";
    res.headers.append("set-cookie", `${COOKIE}=${sign("owner", pin)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`);
  }
  return res;
}

/** 401, or 429 with how long to wait when the address is locked out. */
export function denied(req?: Request): Response {
  const mins = req ? lockedOut(req) : 0;
  return mins
    ? Response.json({ error: `Too many wrong passcodes. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` }, { status: 429 })
    : Response.json({ error: "pin" }, { status: 401 });
}

/** Decode a "data:image/jpeg;base64,..." upload (max ~4.5 MB). Must really be a JPEG, not just labelled as one. */
export function jpegFromDataUrl(image: unknown): Buffer | null {
  const m = typeof image === "string" ? image.match(/^data:image\/jpeg;base64,(.+)$/) : null;
  if (!m || m[1].length >= 6_000_000) return null;
  const b = Buffer.from(m[1], "base64");
  return b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? b : null;
}
