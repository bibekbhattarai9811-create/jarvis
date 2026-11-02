import { authed, denied, json } from "@/lib/auth";
import { getSettings, importPolicy, saveSettings } from "@/lib/field";
import { FIELD_CHECKLISTS } from "@/lib/fieldChecklists";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!authed(req)) return denied(req);
  return json(req, { settings: getSettings(), builtIn: FIELD_CHECKLISTS.map((c) => c.name) });
}

/** {department} saves the name. {policy: "text"} turns a department policy into checklists + report sections. {reset: true} clears. */
export async function POST(req: Request) {
  if (!authed(req)) return denied(req);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.reset) return json(req, { settings: saveSettings({ department: getSettings().department, checklists: [], reportSections: [] }) });
    if (typeof b.policy === "string") {
      if (b.policy.trim().length < 80) return json(req, { error: "Paste more of the policy (at least a paragraph)." }, 400);
      return json(req, { settings: await importPolicy(b.policy) });
    }
    if (typeof b.department === "string") return json(req, { settings: saveSettings({ ...getSettings(), department: b.department.trim().slice(0, 100) }) });
    return json(req, { error: "Nothing to save." }, 400);
  } catch (e) {
    const msg = (e as Error).message;
    return json(req, { error: /JSON/.test(msg) ? "Couldn't read that document. Try pasting the procedure text." : msg }, 400);
  }
}
