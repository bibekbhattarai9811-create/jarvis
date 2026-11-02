import { authed, denied, json } from "@/lib/auth";
import { log, mutate, translate, type Translation } from "@/lib/field";

export const runtime = "nodejs";

/** Translate one spoken line: {text, fromLang, toLang, speaker: "officer"|"other", incident?}. The latest line also shows on the glasses. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const b = await req.json().catch(() => ({}));
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 1000) : "";
  const lang = (v: unknown) => (typeof v === "string" && /^[A-Za-z ()-]{2,30}$/.test(v) ? v : "");
  const fromLang = lang(b.fromLang);
  const toLang = lang(b.toLang);
  if (!text || !fromLang || !toLang) return json(req, { error: "Say something first." }, 400);
  try {
    const out = await translate(text, fromLang, toLang);
    const t: Translation = { at: new Date().toISOString(), fromLang, toLang, heard: text, text: out, speaker: b.speaker === "other" ? "other" : "officer" };
    if (typeof b.incident === "string")
      await mutate(b.incident, (i) => {
        i.lastTranslation = t;
        log(i, "translate", `${t.speaker === "officer" ? `Officer → ${toLang}` : `${fromLang} → officer`}: "${text}" = "${out}"`);
      }).catch(() => {});
    return json(req, t);
  } catch (e) {
    return json(req, { error: (e as Error).message }, 500);
  }
}
