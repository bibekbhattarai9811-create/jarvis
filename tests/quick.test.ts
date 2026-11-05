// Instant commands: everyday phrases are handled without Claude; anything unclear goes to Claude.
import { describe, expect, it } from "vitest";
import { quickReply } from "@/lib/quick";

const actions = (msg: string, device = "computer") => quickReply(msg, device)?.actions;

describe("instant commands", () => {
  it("handles media keys and the lock screen", () => {
    expect(actions("Turn the volume up")).toEqual([{ type: "media", key: "volume_up" }]);
    expect(actions("volume down please")).toEqual([{ type: "media", key: "volume_down" }]);
    expect(actions("set volume to 40%")).toEqual([{ type: "set_volume", level: 40 }]);
    expect(actions("system status")).toEqual([{ type: "pc_status" }]);
    expect(actions("pause")).toEqual([{ type: "media", key: "play_pause" }]);
    expect(actions("next song")).toEqual([{ type: "media", key: "next" }]);
    expect(actions("lock my pc")).toEqual([{ type: "lock_pc" }]);
  });

  it("sets timers from words or digits", () => {
    expect(actions("set a 5 minute timer for pasta")).toEqual([{ type: "timer", seconds: 300, label: "pasta" }]);
    expect(actions("timer for thirty seconds")).toEqual([{ type: "timer", seconds: 30, label: undefined }]);
    expect(actions("cancel the timer")).toEqual([{ type: "timer_cancel", label: undefined }]);
    expect(actions("stop the pasta timer")).toEqual([{ type: "timer_cancel", label: "pasta" }]);
  });

  it("opens sites on the PC from the computer, and on the device from a phone", () => {
    expect(actions("open youtube")).toEqual([{ type: "open_url", url: "https://www.youtube.com", where: "pc" }]);
    expect(actions("open youtube", "phone")).toEqual([{ type: "open_url", url: "https://www.youtube.com", where: "device" }]);
    expect(actions("play lofi on youtube", "phone")?.[0]).toMatchObject({ url: "https://www.youtube.com/results?search_query=lofi" });
  });

  it("drives holograms and face learning by voice", () => {
    expect(actions("make it red")).toEqual([{ type: "holo_color", color: "red" }]);
    expect(actions("explode everything")).toEqual([{ type: "holo_explode", all: true }]);
    expect(actions("remember my face")).toEqual([{ type: "face_learn" }]);
    expect(actions("this is my friend Sam")).toEqual([{ type: "face_learn", name: "Sam" }]);
  });

  it("leaves real questions and look-alike phrases to Claude", () => {
    for (const msg of ["what's the weather", "good morning", "tell me a joke", "this is great", "this is Sam", "remember my exam is friday", "open the pod bay doors"]) {
      expect(quickReply(msg, "computer"), msg).toBeNull();
    }
  });
});
