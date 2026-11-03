// Public PDF redaction: nothing identifying survives, including what the AI wrote into the narrative.
import { describe, expect, it } from "vitest";
import { publicScrubber } from "@/lib/redact";
import type { IdScan, Statement } from "@/lib/field";

const witness = { name: "Maria Lopez (test)", contact: "555-0100" } as Statement;
const id = {
  role: "Driver of V1",
  fields: { docType: "driver license", fullName: "JANE QUINN SAMPLE", dob: "1995-03-14", address: "123 EXAMPLE ST, JONESBORO, AR 72401", idNumber: "9 876 54321", issuer: "Arkansas", expires: "2025-03-14", sex: "F" },
} as IdScan;
const scrub = publicScrubber({ statements: [witness], ids: [id], officer: "Officer Street #12" });

describe("public redaction", () => {
  it("turns names into roles, in any case and in parts", () => {
    const out = scrub("I spoke with Maria Lopez. Ms. Lopez said Jane Sample ran the light; jane quinn sample agreed.");
    expect(out).not.toMatch(/maria|lopez|jane|quinn|sample/i);
    expect(out).toContain("Witness 1");
    expect(out).toContain("Driver of V1");
  });

  it("removes ID details: date of birth in any format, ID number with or without spaces, street", () => {
    const out = scrub("DOB 1995-03-14 (03/14/1995, 3/14/1995). License 987654321 / 9 876 54321. Lives at 123 Example St.");
    expect(out).not.toMatch(/1995|987\s?654\s?321|9 876|example st/i);
  });

  it("removes phone numbers and anything after 'date of birth'", () => {
    expect(scrub("Call her at (870) 555-0100 or 870.555.0100.")).not.toMatch(/555/);
    expect(scrub("date of birth March 14, 1995, per license")).toBe("date of birth [removed], per license");
  });

  it("only replaces the officer's full name, never common words inside it", () => {
    expect(scrub("Officer Street #12 measured the skid on Main Street.")).toBe("the reporting officer measured the skid on Main Street.");
  });
});
