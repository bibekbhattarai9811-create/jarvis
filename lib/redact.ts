// Public-version redaction for Field Assist reports: names, ID details and phone numbers in free text
// (including what the AI wrote) become roles or "[removed]". Over-redacting is the safe side.

import type { Incident } from "./field";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns a function that scrubs one piece of text for the public version of this incident. */
export function publicScrubber(i: Pick<Incident, "statements" | "ids" | "officer">): (text: string) => string {
  // [full name, role, also replace single first/last names?] (only for witnesses and ID holders: an officer
  // field like "Officer Street #12" shouldn't turn every "Street" into a role)
  const names: [string, string, boolean][] = [
    ...i.statements.flatMap((s, n) => (s.name.trim().length > 1 ? [[s.name.replace(/\s*\(.*\)\s*$/, "").trim(), `Witness ${n + 1}`, true] as [string, string, boolean]] : [])),
    ...i.ids.flatMap((x) => (x.fields.fullName.trim().length > 1 ? [[x.fields.fullName.trim(), x.role || "the person", true] as [string, string, boolean]] : [])),
    ...(i.officer.trim() ? [[i.officer.trim(), "the reporting officer", false] as [string, string, boolean]] : []),
  ];
  return (t: string) => {
    let out = t;
    for (const [name, role, parts] of names) {
      out = out.replace(new RegExp(esc(name), "gi"), role);
      // First / last names on their own too (any case: IDs print names in capitals).
      if (parts) for (const part of name.split(/[\s,]+/).filter((p) => /^[A-Za-z][A-Za-z'-]{2,}$/.test(p))) out = out.replace(new RegExp(`\\b${esc(part)}\\b`, "gi"), role);
    }
    // Details read from ID cards: date of birth (any common format), ID number, street address.
    for (const x of i.ids) {
      const { dob, idNumber, address } = x.fields;
      const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const dobs = m ? [dob, `${m[2]}/${m[3]}/${m[1]}`, `${+m[2]}/${+m[3]}/${m[1]}`] : dob ? [dob] : [];
      for (const v of dobs) out = out.replace(new RegExp(esc(v), "g"), "[removed]");
      if (idNumber.replace(/\s/g, "").length > 3) out = out.replace(new RegExp(idNumber.replace(/\s/g, "").split("").map(esc).join("\\s?"), "gi"), "[ID number removed]");
      const street = address.split(",")[0].trim();
      if (street.length > 4) out = out.replace(new RegExp(esc(street), "gi"), "[address removed]");
    }
    // Whatever follows "date of birth" / "DOB": a written date ("March 14, 1995"), a numeric one, or the phrase.
    out = out.replace(
      /\b(date of birth|DOB)[:,]?\s+(?!\[)(?:[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[^,.;)]+)/gi,
      "$1 [removed]"
    );
    out = out.replace(/(identified as|named) (Witness \d+|the reporting officer)/gi, "$2");
    return out.replace(/\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]");
  };
}
