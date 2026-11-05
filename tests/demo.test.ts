// Live demo answers: honest about having no PC, but instant commands still work.
import { describe, expect, it } from "vitest";
import { demoReply } from "@/lib/demoAnswers";

describe("live demo answers", () => {
  it("never pretends to control a PC", () => {
    for (const msg of ["volume up", "set volume to 40%", "system status", "lock my pc", "open spotify"]) {
      const r = demoReply(msg);
      expect(r.actions, msg).toEqual([]);
      expect(r.say, msg).toMatch(/can't touch/);
    }
  });

  it("runs timers and holograms for real", () => {
    expect(demoReply("set a 1 minute timer").actions).toEqual([{ type: "timer", seconds: 60, label: undefined }]);
    expect(demoReply("cancel the timer").actions).toEqual([{ type: "timer_cancel", label: undefined }]);
    expect(demoReply("make it red").actions).toEqual([{ type: "holo_color", color: "red" }]);
  });

  it("opens links on the visitor's own device", () => {
    expect(demoReply("open youtube").actions[0]).toMatchObject({ type: "open_url", where: "device" });
  });
});
