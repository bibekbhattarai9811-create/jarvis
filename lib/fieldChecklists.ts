// Sample step-by-step checklists for Field Assist, shown one step at a time on the glasses.
// Generic examples for a demo; a real department would load its own written procedures here.

export const FIELD_CHECKLISTS: { name: string; steps: string[] }[] = [
  {
    name: "Arriving on scene",
    steps: [
      "Report arrival and exact location to dispatch",
      "Check for immediate hazards: traffic, fire, fuel, wires",
      "Check everyone for injuries; request EMS if needed",
      "Secure the scene and set up a perimeter",
      "Identify people involved and witnesses",
      "Start notes: time, weather, lighting, road conditions",
    ],
  },
  {
    name: "Traffic crash",
    steps: [
      "Make the scene safe: lights, cones, move traffic",
      "Check injuries; request EMS / fire / tow as needed",
      "Note vehicle positions before anything is moved",
      "Collect licenses, registration, insurance from each driver",
      "Photograph each vehicle: four sides, damage close-ups",
      "Photograph the road: skid marks, debris, signs, signals",
      "Get statements from drivers and witnesses",
      "Sketch the scene and note measurements",
      "Give drivers the report number and exchange info",
    ],
  },
  {
    name: "Scene photos",
    steps: [
      "Wide overview shots from every direction",
      "Mid-range shots showing how items relate",
      "Close-ups of each item, with a scale reference",
      "Photograph before moving or collecting anything",
      "Log time and a short caption for every photo",
    ],
  },
  {
    name: "Taking a statement",
    steps: [
      "Record the person's name and contact information",
      "Ask an open question: 'Tell me what happened'",
      "Let them finish without interrupting",
      "Clarify times, places, and what they saw directly",
      "Read the key points back to confirm",
      "Note whether a translator was used",
    ],
  },
];
