"use client";

// ⚙ → Guest access (owner only): share Jarvis with someone without giving them your PC.
// Guests can chat and play in HOLO. They can't control your PC, see your memory, or open Inspect Pro.

import { useEffect, useState } from "react";

type Guest = { enabled: boolean; code: string };

export default function GuestAccess({ pin }: { pin: string }) {
  const [g, setG] = useState<Guest | null>(null);
  const [copied, setCopied] = useState(false);
  const call = async (body?: object) => {
    const r = await fetch("/api/guest", {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-jarvis-pin": pin },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.ok) setG(await r.json());
  };
  useEffect(() => {
    call();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!g) return null;
  const link = `${location.origin}/`;
  return (
    <div className="guest">
      <div className="guest-row">
        <b>Guest access</b>
        <button className={`pill ${g.enabled ? "on" : ""}`} onClick={() => call({ enabled: !g.enabled })}>
          <span className="dot" /> {g.enabled ? "On" : "Off"}
        </button>
      </div>
      {g.enabled ? (
        <>
          <p>
            Share <b>{link}</b> and this guest code: <code>{g.code}</code>
          </p>
          <div className="guest-row">
            <button
              className="pill"
              onClick={() => {
                navigator.clipboard?.writeText(`Jarvis: ${link}  ·  guest code: ${g.code}`).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Copied ✓" : "Copy invite"}
            </button>
            <button className="pill" onClick={() => call({ newCode: true })} title="Old code stops working right away">
              New code (kicks out guests)
            </button>
          </div>
          <p className="muted">Guests can chat and play in HOLO. They can&apos;t control your PC, see what Jarvis remembers about you, or open Inspect Pro.</p>
        </>
      ) : (
        <p className="muted">Off: only your passcode works.</p>
      )}
    </div>
  );
}
