// Field Assist evidence: fingerprints catch any change, review locks the report, every edit is recorded.
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-field-"));
process.env.JARVIS_DATA = dir;
let field: typeof import("@/lib/field");
beforeAll(async () => {
  field = await import("@/lib/field");
});

const fakeJpeg = (seed: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, seed)]);

describe("evidence integrity", () => {
  it("fingerprints a photo on arrival and catches a single changed byte", async () => {
    const inc = field.createIncident({ title: "Test", officer: "Test Officer" });
    const photo = await field.addPhoto(inc.id, fakeJpeg(1), "Front bumper");
    expect(photo.sha256).toBe(field.sha256(fakeJpeg(1)));
    expect(field.verifyEvidence(inc.id).allOk).toBe(true);

    const file = field.photoFile(inc.id, photo.id)!;
    const bytes = fs.readFileSync(file);
    bytes[100] ^= 0xff;
    fs.writeFileSync(file, bytes);
    const check = field.verifyEvidence(inc.id);
    expect(check.allOk).toBe(false);
    expect(check.items.find((x) => !x.ok)?.label).toBe("Photo #1");
  });

  it("changes the report fingerprint when anything in the report changes", async () => {
    const inc = field.createIncident({ title: "Fingerprint", officer: "A" });
    const before = field.reportFingerprint(field.getIncident(inc.id)!);
    expect(field.reportFingerprint(field.getIncident(inc.id)!)).toBe(before); // stable
    await field.mutate(inc.id, (i) => (i.notes = "Road was wet."));
    expect(field.reportFingerprint(field.getIncident(inc.id)!)).not.toBe(before);
  });

  it("records the timeline and keeps approved evidence from being deleted", async () => {
    const inc = field.createIncident({ title: "Review", officer: "A" });
    const photo = await field.addPhoto(inc.id, fakeJpeg(2), "Skid marks");
    await field.mutate(inc.id, (i) => (i.review = { status: "approved", by: "Sgt. B", at: new Date().toISOString() }));
    await expect(field.deletePhoto(inc.id, photo.id)).rejects.toThrow(/approved/);
    const i = field.getIncident(inc.id)!;
    expect(i.timeline.map((t) => t.text)).toEqual(["Incident opened", "Photo #1: Skid marks"]);
    expect(i.photos).toHaveLength(1);
  });

  it("fills in new fields for incidents saved by older versions", () => {
    const id = "oldversion1";
    fs.mkdirSync(path.join(dir, "field", id), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "field", id, "incident.json"),
      JSON.stringify({ id, createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "", title: "Old", location: "", officer: "", notes: "", photos: [] })
    );
    const i = field.getIncident(id)!;
    expect(i.review.status).toBe("open");
    expect(i.statements).toEqual([]);
    expect(i.ids).toEqual([]);
    expect(i.timeline[0].text).toBe("Incident opened");
  });
});
