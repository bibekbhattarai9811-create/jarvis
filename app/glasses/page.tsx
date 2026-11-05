"use client";

// Simulator: what Jarvis looks like through Meta Ray-Ban Display glasses.
// Your camera is "the world"; the real glasses app (/hud) floats in the right lens, blended additively
// (black disappears, light glows) the way a see-through waveguide display shows it.

import { useEffect, useRef, useState } from "react";

export default function GlassesSim() {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [cam, setCam] = useState<"loading" | "on" | "off">("loading");
  const [frameOn, setFrameOn] = useState(true);
  // /glasses?report=<id> shows the live Inspect Pro view in the lens instead of the voice assistant.
  const [hudSrc, setHudSrc] = useState<string | null>(null);
  const [latestField, setLatestField] = useState<string | null>(null);
  const [latestReport, setLatestReport] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const ok = (v: string | null) => !!v && /^[a-z0-9]{6,20}$/.test(v);
    const r = q.get("report");
    const f = q.get("field");
    setHudSrc(ok(f) ? `/hud?field=${f}` : ok(r) ? `/hud?report=${r}` : "/hud");
    let pin = "";
    try {
      pin = localStorage.getItem("jarvis-pin") || "";
    } catch {}
    fetch("/api/field", { headers: { "x-jarvis-pin": pin } })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d?.incidents?.[0]?.id && setLatestField(d.incidents[0].id))
      .catch(() => {});
    fetch("/api/pro/reports", { headers: { "x-jarvis-pin": pin } })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d?.reports?.[0]?.id && setLatestReport(d.reports[0].id))
      .catch(() => {});
  }, []);
  // Place the display inside the right lens. The frame SVG is drawn with "slice" (cover) scaling over a viewBox:
  // the whole glasses (1000×600) on wide screens, a close-up of the right lens on portrait phones.
  // Map the lens center (735, 280) and a 210-unit display to screen pixels.
  const [lens, setLens] = useState({ x: 0, y: 0, size: 0, vb: "0 0 1000 600" });
  useEffect(() => {
    const place = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const vb = H > W ? { x: 545, y: 120, w: 380, h: 330 } : { x: 0, y: 0, w: 1000, h: 600 };
      const k = Math.max(W / vb.w, H / vb.h);
      const size = Math.min(210 * k, W * (H > W ? 0.7 : 0.42), H * 0.5);
      setLens({
        x: (W - vb.w * k) / 2 + (735 - vb.x) * k,
        y: (H - vb.h * k) / 2 + (280 - vb.y) * k,
        size,
        vb: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: 1280, height: 720 }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
        setCam("on");
      })
      .catch(() => setCam("off"));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  // A tap anywhere (or Space/Enter) is the Neural Band pinch, forwarded to the glasses app.
  const pinch = () => frame.current?.contentWindow?.postMessage("jarvis-pinch", window.location.origin);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        pinch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="sim" onClick={pinch}>
      <video ref={video} className="world" playsInline muted hidden={cam === "off"} />
      {cam === "off" && <div className="world fallback" />}

      {frameOn && (
        <svg className="frames" viewBox={lens.vb} preserveAspectRatio="xMidYMid slice" aria-hidden>
          <defs>
            <mask id="lenses">
              <rect width="1000" height="600" fill="white" />
              <path d="M95 185 Q100 140 160 135 L430 135 Q470 138 470 185 L462 330 Q450 420 330 430 L215 430 Q110 425 100 330 Z" fill="black" />
              <path d="M905 185 Q900 140 840 135 L570 135 Q530 138 530 185 L538 330 Q550 420 670 430 L785 430 Q890 425 900 330 Z" fill="black" />
            </mask>
          </defs>
          <rect width="1000" height="600" fill="rgba(0,0,0,0.78)" mask="url(#lenses)" />
          <g fill="none" stroke="#1b1b1f" strokeWidth="22" strokeLinejoin="round">
            <path d="M95 185 Q100 140 160 135 L430 135 Q470 138 470 185 L462 330 Q450 420 330 430 L215 430 Q110 425 100 330 Z" />
            <path d="M905 185 Q900 140 840 135 L570 135 Q530 138 530 185 L538 330 Q550 420 670 430 L785 430 Q890 425 900 330 Z" />
            <path d="M470 175 Q500 155 530 175" />
          </g>
        </svg>
      )}

      {/* The real glasses app, sitting in the right lens. */}
      <div className="lens-display" style={{ left: lens.x, top: lens.y, width: lens.size }}>
        {hudSrc && <iframe ref={frame} src={hudSrc} title="Jarvis glasses display" allow="microphone; autoplay" />}
      </div>

      <div className="sim-bar" onClick={(e) => e.stopPropagation()}>
        <a href="/">← Jarvis</a>
        <div className="sim-modes">
          <button className={hudSrc === "/hud" ? "on" : ""} onClick={() => setHudSrc("/hud")}>
            🎙 Voice
          </button>
          {latestField && (
            <button className={hudSrc?.startsWith("/hud?field=") ? "on" : ""} onClick={() => setHudSrc(`/hud?field=${latestField}`)}>
              🚓 Field HUD
            </button>
          )}
          {latestReport && (
            <button className={hudSrc?.startsWith("/hud?report=") ? "on" : ""} onClick={() => setHudSrc(`/hud?report=${latestReport}`)}>
              📋 Inspect HUD
            </button>
          )}
          {hudSrc && (
            <a className="sim-link" href={hudSrc} title="Open raw 600×600 glasses display">
              ⛶ Full HUD
            </a>
          )}
        </div>
        <button onClick={() => setFrameOn((f) => !f)}>{frameOn ? "Hide frames" : "Show frames"}</button>
      </div>
      <p className="sim-hint">Tap anywhere or press Space = pinch to talk · tap again to stop</p>

      <style>{`
        html, body { overflow: hidden; background: #000 !important; }
        .sim { position: fixed; inset: 0; cursor: pointer; overflow: hidden; }
        .world { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .world.fallback { background: linear-gradient(180deg, #7aa6c8 0%, #b9cfe0 45%, #6d7a68 46%, #3f4a3c 100%); }
        .frames { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        /* Right lens, slightly outside center like the real monocular display. */
        .lens-display { position: absolute; aspect-ratio: 1; transform: translate(-50%, -50%); mix-blend-mode: screen; opacity: .93; }
        /* The HUD sizes itself in vmin, so it fills whatever square it's given. */
        .lens-display iframe { width: 100%; height: 100%; border: 0; background: #000; display: block; }
        .sim-bar { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 10px; align-items: center; justify-content: space-between;
          flex-wrap: wrap; padding: 10px 16px; background: linear-gradient(#000d, #0000); color: #cfefff; font: 13px "Segoe UI", system-ui, sans-serif; }
        .sim-bar a { color: #3fd8ff; text-decoration: none; }
        .sim-modes { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .sim-bar button, .sim-link { background: #0b1a26; color: #cfefff !important; border: 1px solid #3fd8ff66; border-radius: 99px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
        .sim-bar button.on { border-color: #3fd8ff; box-shadow: 0 0 12px #3fd8ff66; background: #102a3d; }
        .sim-hint { position: absolute; bottom: 12px; left: 0; right: 0; margin: 0; text-align: center; color: #cfefffcc;
          font: 12px "Segoe UI", system-ui, sans-serif; text-shadow: 0 1px 3px #000; padding: 0 16px; }
      `}</style>
    </main>
  );
}
