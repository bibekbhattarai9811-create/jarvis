// Inspect Pro walkthrough: the right checklist per room, and what to check next.
import { describe, expect, it } from "vitest";
import { checklistFor, checkProgress, nextCheck } from "@/lib/checklists";

describe("walkthrough checklists", () => {
  it("picks a checklist by room name", () => {
    expect(checklistFor("Kitchen")).toContain("Under the sink (leaks)");
    expect(checklistFor("Master bathroom")).toContain("Toilet (flush, base)");
    expect(checklistFor("Bedroom 2")).toContain("Smoke detector");
    expect(checklistFor("Sunroom")).toEqual(["Walls", "Ceiling", "Floor", "Windows", "Doors", "Outlets & lights"]);
  });

  it("finds the next item in the current room, then moves on", () => {
    const kitchen = checklistFor("Kitchen");
    const rooms = [{ name: "Kitchen", checked: kitchen.slice(0, -1) }, { name: "Bedroom 1" }];
    expect(nextCheck(rooms, "Kitchen")).toEqual({ room: "Kitchen", item: kitchen[kitchen.length - 1] });
    rooms[0].checked = kitchen;
    expect(nextCheck(rooms, "Kitchen")).toEqual({ room: "Bedroom 1", item: "Walls" });
    expect(checkProgress(rooms)).toEqual({ done: kitchen.length, total: kitchen.length + checklistFor("Bedroom 1").length });
  });
});
