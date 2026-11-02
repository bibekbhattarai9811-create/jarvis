// Walkthrough checklists for Inspect Pro, picked by room name, so nothing gets missed.

const LISTS: [RegExp, string[]][] = [
  [/kitchen/i, ["Counters & backsplash", "Sink & faucet (run water)", "Under the sink (leaks)", "Stove & oven", "Fridge inside & seals", "Dishwasher", "Cabinets & drawers", "Floor", "Walls & ceiling", "Outlets & lights"]],
  [/bath|restroom|toilet/i, ["Toilet (flush, base)", "Sink & faucet", "Under the sink (leaks)", "Tub / shower & caulk", "Tiles & grout", "Mirror & cabinet", "Exhaust fan", "Floor", "Walls & ceiling (mold)", "Outlets (GFCI) & lights"]],
  [/bed/i, ["Walls", "Ceiling", "Floor / carpet", "Closet & doors", "Windows & blinds", "Outlets & lights", "Smoke detector"]],
  [/living|family|dining|den|office/i, ["Walls", "Ceiling", "Floor / carpet", "Windows & blinds", "Doors", "Outlets & lights", "Smoke detector"]],
  [/entry|hall|foyer|stair/i, ["Front door & lock", "Doorbell / peephole", "Floor", "Walls & ceiling", "Lights & switches", "Closet"]],
  [/laundry|utility/i, ["Washer & hoses", "Dryer & vent", "Floor (leaks)", "Water heater", "Walls", "Outlets & lights"]],
  [/garage/i, ["Garage door & opener", "Floor (oil stains)", "Walls", "Lights", "Storage"]],
  [/exterior|outside|yard|patio|balcony|porch|deck/i, ["Siding & paint", "Windows & screens", "Doors", "Patio / deck", "Yard", "Gutters", "Exterior lights"]],
];
const GENERIC = ["Walls", "Ceiling", "Floor", "Windows", "Doors", "Outlets & lights"];

export function checklistFor(room: string): string[] {
  return LISTS.find(([re]) => re.test(room))?.[1] ?? GENERIC;
}

/** First thing still to check: in the given room, else the first room with anything left. */
export function nextCheck(rooms: { name: string; checked?: string[] }[], prefer?: string): { room: string; item: string } | null {
  const ordered = prefer ? [...rooms.filter((r) => r.name === prefer), ...rooms.filter((r) => r.name !== prefer)] : rooms;
  for (const r of ordered) {
    const item = checklistFor(r.name).find((i) => !r.checked?.includes(i));
    if (item) return { room: r.name, item };
  }
  return null;
}

export function checkProgress(rooms: { name: string; checked?: string[] }[]) {
  let done = 0;
  let total = 0;
  for (const r of rooms) {
    const list = checklistFor(r.name);
    total += list.length;
    done += list.filter((i) => r.checked?.includes(i)).length;
  }
  return { done, total };
}
