"use client";

// Small banner on the public live demo: what it is, where the real thing lives, and image credits.

import { useEffect, useState } from "react";

export default function DemoBanner() {
  const [path, setPath] = useState("");
  const [open, setOpen] = useState(true);
  useEffect(() => setPath(location.pathname), []);
  if (process.env.NEXT_PUBLIC_DEMO !== "1" || path.startsWith("/hud") || path.includes("/print")) return null;
  if (!open)
    return (
      <button className="demo-pill" onClick={() => setOpen(true)} aria-label="About this demo">
        LIVE DEMO
      </button>
    );
  return (
    <div className="demo-banner" role="note">
      <b>LIVE DEMO</b>
      <span>
        Sample data, read-only, sample answers (no Claude or PC behind it). HOLO and face recognition run fully in your browser.{" "}
        <a href="https://github.com/bibekbhattarai9811-create/jarvis" target="_blank" rel="noreferrer">
          Run the full version →
        </a>
        {path.startsWith("/pro") && (
          <>
            {" "}
            · Photo: “BR” by Francisco Anzola,{" "}
            <a href="https://commons.wikimedia.org/wiki/File:BR_(4151040962).jpg" target="_blank" rel="noreferrer">
              CC BY 2.0
            </a>{" "}
            (move-out copy edited to add damage).
          </>
        )}
      </span>
      <button onClick={() => setOpen(false)} aria-label="Hide">
        ✕
      </button>
    </div>
  );
}
