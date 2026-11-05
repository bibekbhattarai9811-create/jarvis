"use client";

// Inspect: point the camera at something, tap it, and get a condition report
// (what it is, condition score, numbered issues on the photo, next steps, safety).

import { useEffect, useRef, useState } from "react";
import ReportView, { type Report } from "../ReportView";
import { scanAt } from "@/lib/scanner";

type Pt = { x: number; y: number };

function pin(): string {
  try {
    return localStorage.getItem("jarvis-pin") || "";
  } catch {
    return "";
  }
}

function speak(text: string) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices();
    u.voice = v.find((x) => /Google UK English Male|Ryan.*United Kingdom|George|Daniel/i.test(x.name)) || v.find((x) => x.lang === "en-GB") || null;
    u.rate = 1.03;
    u.pitch = 0.9;
    speechSynthesis.speak(u);
  } catch {}
}

export default function Inspect() {
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [camError, setCamError] = useState("");
  const [tap, setTap] = useState<Pt | null>(null); // % position of the tap ring
  const [shot, setShot] = useState<string | null>(null); // frozen photo while inspecting
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Laptops only have a front camera; phones start on the back one.
    if (!/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) setFacing("user");
  }, []);

  useEffect(() => {
    if (report) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
        setCamError("");
      })
      .catch(() => setCamError("Camera is blocked or missing. Allow camera access for this site."));
    return () => {
      cancelled = true;
    };
  }, [facing, report]);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  const mirror = facing === "user";

  /** Crop the frame around the tapped object (with context) and send it for inspection. */
  const run = async (at: Pt | null) => {
    const v = video.current;
    if (!v || !v.videoWidth || busy) return;
    setError("");
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const frame = document.createElement("canvas");
    frame.width = vw;
    frame.height = vh;
    frame.getContext("2d")!.drawImage(v, 0, 0);

    let crop = { x: 0, y: 0, w: vw, h: vh };
    if (at) {
      setBusy("Finding the object…");
      try {
        const scan = await scanAt(frame, at.x, at.y, false);
        if (scan) {
          // Keep surrounding context: pad the object's box by 25% (at least 40% of the frame).
          const b = scan.box;
          const w = Math.min(vw, Math.max(b.w * 1.5, vw * 0.4));
          const h = Math.min(vh, Math.max(b.h * 1.5, vh * 0.4));
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          crop = { x: Math.max(0, Math.min(vw - w, cx - w / 2)), y: Math.max(0, Math.min(vh - h, cy - h / 2)), w, h };
        }
      } catch {
        // Segmenter failed to load: inspect the whole view instead.
      }
    }
    const k = Math.min(1, 1600 / Math.max(crop.w, crop.h));
    const out = document.createElement("canvas");
    out.width = Math.round(crop.w * k);
    out.height = Math.round(crop.h * k);
    out.getContext("2d")!.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
    await sendImage(out.toDataURL("image/jpeg", 0.88));
  };

  const sendImage = async (image: string) => {
    setShot(image);
    setBusy("Inspecting…");
    try {
      const res = await fetch("/api/inspect", {
        method: "POST",
        headers: { "content-type": "application/json", "x-jarvis-pin": pin() },
        body: JSON.stringify({ image, note: note.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Open Jarvis once on this device and enter your passcode first.");
      if (!res.ok) throw new Error(data.error || "Inspection failed.");
      const r: Report = { ...data, image };
      setReport(r);
      speak(`${r.object}. Condition ${r.condition}, ${r.score} out of 10. ${r.summary}`);
    } catch (e) {
      setError((e as Error).message);
      setShot(null);
    } finally {
      setBusy("");
      setTap(null);
    }
  };

  const onUpload = (file?: File | null) => {
    if (!file || busy) return;
    setError("");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(img.width * k));
      out.height = Math.max(1, Math.round(img.height * k));
      out.getContext("2d")!.drawImage(img, 0, 0, out.width, out.height);
      URL.revokeObjectURL(url);
      sendImage(out.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Couldn't read that image file.");
    };
    img.src = url;
  };

  const onTap = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = video.current;
    if (!v || busy || report) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    setTap({ x: (px / rect.width) * 100, y: (py / rect.height) * 100 });
    // Screen point → normalized point in the camera frame (object-fit: cover, maybe mirrored).
    const s = Math.max(rect.width / v.videoWidth, rect.height / v.videoHeight);
    const ox = (rect.width - v.videoWidth * s) / 2;
    const oy = (rect.height - v.videoHeight * s) / 2;
    const sx = mirror ? rect.width - px : px;
    run({ x: (sx - ox) / s / v.videoWidth, y: (py - oy) / s / v.videoHeight });
  };

  const again = () => {
    setReport(null);
    setShot(null);
    setNote("");
    speechSynthesis.cancel();
  };

  return (
    <main className="tool">
      <style>{`html, body { overflow: auto !important; }`}</style>
      <div className="tool-top no-print">
        <a href="/">← Jarvis</a>
        <span className="tool-title">INSPECT</span>
        <a href="/inspections">Reports →</a>
      </div>

      {!report && (
        <>
          <div className="viewfinder" onPointerDown={onTap}>
            {/* The camera stays mounted (keeps its stream); the frozen photo sits on top while inspecting. */}
            <video ref={video} className={mirror ? "mirror" : ""} playsInline muted />
            {shot && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shot} alt="Captured" style={{ position: "absolute", inset: 0, objectFit: "contain", background: "#000" }} />
            )}
            {tap && !shot && <span className="tap-ring" style={{ left: `${tap.x}%`, top: `${tap.y}%` }} />}
            {busy && <div className="busy">{busy.toUpperCase()}</div>}
            {!busy && !camError && <p className="vf-hint">Tap the thing you want inspected</p>}
            {camError && <div className="busy">{camError}</div>}
          </div>

          <div className="tool-row">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should I check? (optional)"
              enterKeyHint="done"
            />
          </div>
          <div className="tool-row">
            <button className="btn" onClick={() => run(null)} disabled={!!busy || !!camError}>
              Inspect whole view
            </button>
            <button className="btn ghost" onClick={() => fileInput.current?.click()} disabled={!!busy}>
              📁 Upload photo
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                onUpload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button className="btn ghost" onClick={() => setFacing(facing === "user" ? "environment" : "user")} disabled={!!busy}>
              🔄 {facing === "user" ? "Back camera" : "Front camera"}
            </button>
          </div>
          {error && <p className="tool-error">{error}</p>}
        </>
      )}

      {report && (
        <>
          <ReportView report={report} />
          <div className="tool-row no-print">
            <button className="btn" onClick={again}>
              New inspection
            </button>
            <button className="btn ghost" onClick={() => window.print()}>
              Print / Save PDF
            </button>
            <a className="btn ghost" href="/inspections">
              All reports
            </a>
          </div>
        </>
      )}
    </main>
  );
}
