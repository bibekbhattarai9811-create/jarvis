"use client";

import { useEffect, useRef, useState } from "react";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import { DroneGame } from "@/lib/droneGame";
import { HoloPlayground, holoQueue, type HandInput } from "@/lib/holoPlayground";
import { scanAt, thumbnail } from "@/lib/scanner";
import { detectFaces, loadFaces, saveFace, type SeenFace } from "@/lib/faceClient";

export type Gesture = "Open_Palm" | "Closed_Fist" | "Thumb_Up" | "Thumb_Down" | "Victory" | "Pointing_Up" | "ILoveYou";

export const GESTURE_LABELS: Record<Gesture, string> = {
  Open_Palm: "✋ Listen",
  Closed_Fist: "✊ Stop",
  Thumb_Up: "👍 Volume up",
  Thumb_Down: "👎 Volume down",
  Victory: "✌️ Play / pause",
  Pointing_Up: "☝️ Next track",
  ILoveYou: "🤟",
};

// MediaPipe prints harmless "INFO:"/"WARNING:" status lines through console.error, which
// Next.js dev shows as a red error box. Drop just those.
if (typeof window !== "undefined" && !(window as { __mpQuiet?: boolean }).__mpQuiet) {
  (window as { __mpQuiet?: boolean }).__mpQuiet = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && /^(INFO|WARNING|W\d{4}|I\d{4}):?\s/.test(args[0])) return;
    original(...args);
  };
}

const MIN_SCORE = 0.6;

// The 21 hand landmarks joined into bones.
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const TIPS = [4, 8, 12, 16, 20];

type Pt = { x: number; y: number };
type Status = "idle" | "listening" | "thinking" | "speaking";

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/**
 * Hand tracking for HOLO and the game (camera + MediaPipe, all in the browser).
 * With holo on, it also draws a full-screen Iron Man style HUD over the camera (glowing skeletons for up to
 * two hands, palm rings, readout) and runs the hologram playground; 🎮 runs Drone Blaster instead.
 */
export default function Gestures({
  onError,
  onFace,
  holo,
  game,
  status,
}: {
  onError: (msg: string) => void;
  onFace?: (name: string) => void;
  holo: boolean;
  game: boolean;
  status: Status;
}) {
  const gameRef = useRef(game);
  gameRef.current = game;
  // Mouse / touch fallback for aiming in the game.
  const pointer = useRef<{ at: Pt | null; movedAt: number; clicked: boolean; down: boolean }>({ at: null, movedAt: 0, clicked: false, down: false });
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState("Loading hand tracking…");
  const holoRef = useRef(holo);
  holoRef.current = holo;
  const statusRef = useRef(status);
  statusRef.current = status;
  // Front ("user", mirrored like a selfie) or back ("environment") camera. Back is for scanning the world.
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const facingRef = useRef(facing);
  const switchCamera = useRef<(to: "user" | "environment") => void>(() => {});
  // Scan mode: point at a real object (or tap it) to turn it into a hologram.
  const [scanArmed, setScanArmed] = useState(false);
  const [guide, setGuide] = useState(false);
  const playRef = useRef<HoloPlayground | null>(null);
  // Show the gesture guide the first time HOLO opens.
  useEffect(() => {
    if (!holo) return;
    try {
      if (!localStorage.getItem("holo-guide-seen")) {
        setGuide(true);
        localStorage.setItem("holo-guide-seen", "1");
      }
    } catch {}
  }, [holo]);
  const scanRef = useRef(false);
  const armScan = (on: boolean) => {
    scanRef.current = on;
    setScanArmed(on);
  };
  const scanTap = useRef<Pt | null>(null);
  const onFaceRef = useRef(onFace);
  onFaceRef.current = onFace;
  const learnRef = useRef<string | null>(null); // name to learn from the next face samples

  useEffect(() => {
    let stream: MediaStream | null = null;
    let recognizer: GestureRecognizer | null = null;
    let raf = 0;
    let stopped = false;

    (async () => {
      try {
        const open = (to: "user" | "environment") =>
          navigator.mediaDevices.getUserMedia({ video: { facingMode: to, width: 1280, height: 720 }, audio: false });
        stream = await open(facingRef.current);
        if (stopped) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        switchCamera.current = async (to) => {
          try {
            const next = await open(to);
            stream?.getTracks().forEach((t) => t.stop());
            stream = next;
            v.srcObject = next;
            await v.play();
            facingRef.current = to;
            setFacing(to);
          } catch {
            onError("Couldn't switch camera on this device.");
          }
        };

        const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
        const files = await FilesetResolver.forVisionTasks("/mediapipe");
        const make = (delegate: "GPU" | "CPU") =>
          GestureRecognizer.createFromOptions(files, {
            baseOptions: { modelAssetPath: "/mediapipe/gesture_recognizer.task", delegate },
            runningMode: "VIDEO",
            numHands: 2,
          });
        recognizer = await make("GPU").catch(() => make("CPU"));
        if (stopped) return;
        setSeen("Show me your hand");

        // Gesture state
        let lastRun = 0;
        let label = "";

        // Holo state (screen pixels)
        let target: Pt[] | null = null;
        let hand: Pt[] | null = null;
        let lostAt = 0;
        let frames = 0;
        let fps = 0;
        let fpsAt = performance.now();
        const drone = new DroneGame();
        const play = new HoloPlayground();
        playRef.current = play;
        type Track = { target: Pt[]; hand: Pt[] | null; gesture: string; seenAt: number; prevPalm: Pt | null; vel: Pt; pinching: boolean; openSince: number };
        const tracks = new Map<string, Track>();
        let nextTrack = 1;
        let prevFrame = performance.now();
        let wasPinching = false;
        // Scan state
        let scanAnchor: Pt | null = null;
        let scanSince = 0;
        let scanBusy = false;
        let toast = { text: "", until: 0 };
        // Face recognition (HOLO only): runs a few times a second beside hand tracking.
        type ShownFace = SeenFace & { sx: number; sy: number; sw: number; sh: number };
        let faces: ShownFace[] = [];
        let faceState: "off" | "loading" | "ready" | "failed" = "off";
        let faceBusy = false;
        let faceAt = 0;
        let faceErrorShown = false;
        let learning: { name: string; samples: Float32Array[]; at: number } | null = null;
        const seenNames = new Set<string>();

        const loop = (now: number) => {
          if (stopped) return;
          raf = requestAnimationFrame(loop);
          if (v.readyState < 2) return;
          const playing = gameRef.current;
          const isHolo = holoRef.current || playing;
          const dt = Math.max(0, (now - prevFrame) / 1000);
          prevFrame = now;
          const cv = canvas.current;

          // Video "cover" mapping so landmarks line up with the mirrored full-screen feed.
          const W = window.innerWidth;
          const H = window.innerHeight;
          const vw = v.videoWidth || 640;
          const vh = v.videoHeight || 480;
          const s = Math.max(W / vw, H / vh);
          const ox = (W - vw * s) / 2;
          const mirror = facingRef.current === "user"; // selfie camera is shown mirrored
          const oy = (H - vh * s) / 2;

          if (now - lastRun >= (isHolo ? 33 : 100)) {
            lastRun = now;
            const res = recognizer!.recognizeForVideo(v, now);
            const top = res.gestures[0]?.[0];
            const name = top && top.score >= MIN_SCORE && top.categoryName !== "None" ? top.categoryName : "";
            label = name ? GESTURE_LABELS[name as Gesture] || name : res.landmarks.length ? "Hand seen" : "No hand";
            setSeen(label);
            // Follow each hand by position, not by MediaPipe's Left/Right label: that label flips mid-move,
            // which used to make a hand "let go" of what it was holding.
            const used = new Set<string>();
            res.landmarks.forEach((pts, i) => {
              const screen = pts.map((p) => ({ x: mirror ? W - (p.x * vw * s + ox) : p.x * vw * s + ox, y: p.y * vh * s + oy }));
              let key = "";
              let bestD = Math.min(W, H) * 0.35;
              for (const [k, t] of tracks) {
                if (used.has(k) || !t.target.length) continue;
                const d = dist(t.target[9], screen[9]);
                if (d < bestD) {
                  bestD = d;
                  key = k;
                }
              }
              if (!key) key = `hand${nextTrack++}`;
              used.add(key);
              const g = res.gestures[i]?.[0];
              const tr = tracks.get(key) || { target: [], hand: null, gesture: "", seenAt: 0, prevPalm: null, vel: { x: 0, y: 0 }, pinching: false, openSince: 0 };
              tr.target = screen;
              tr.gesture = g && g.score >= MIN_SCORE && g.categoryName !== "None" ? g.categoryName : "";
              tr.seenAt = now;
              tracks.set(key, tr);
            });
            // A hand that blurs out for a moment keeps its grip (fast throws often lose tracking for a few frames).
            for (const [k, tr] of tracks) if (now - tr.seenAt > 300) tracks.delete(k);
            const lm = res.landmarks[0];
            if (lm) {
              target = lm.map((p) => ({ x: mirror ? W - (p.x * vw * s + ox) : p.x * vw * s + ox, y: p.y * vh * s + oy }));
              lostAt = 0;
            } else if (target) {
              lostAt ||= now;
              if (now - lostAt > 250) target = null;
            }
          }

          if (!isHolo || !cv) return;
          frames++;
          if (now - fpsAt > 1000) {
            fps = frames;
            frames = 0;
            fpsAt = now;
          }
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
            cv.width = Math.round(W * dpr);
            cv.height = Math.round(H * dpr);
          }
          const ctx = cv.getContext("2d")!;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          // Smooth the hand toward the latest detection so lines glide instead of jitter.
          if (target) hand = hand ? hand.map((p, i) => ({ x: p.x + (target![i].x - p.x) * 0.55, y: p.y + (target![i].y - p.y) * 0.55 })) : target;
          else hand = null;

          if (!playing) {
            // Holo playground: pinch grabs (two hands stretch), flick throws, open palm swats, fist pulls.
            const inputs: HandInput[] = [];
            for (const [id, tr] of tracks) {
              const tg = tr.target;
              const hd = (tr.hand = tr.hand ? tr.hand.map((p, i) => ({ x: p.x + (tg[i].x - p.x) * 0.55, y: p.y + (tg[i].y - p.y) * 0.55 })) : tg);
              const size = dist(hd[0], hd[9]) || 1;
              const palm = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + hd[i].x / 5, y: a.y + hd[i].y / 5 }), { x: 0, y: 0 });
              if (tr.prevPalm && dt > 0) tr.vel = { x: tr.vel.x * 0.6 + ((palm.x - tr.prevPalm.x) / dt) * 0.4, y: tr.vel.y * 0.6 + ((palm.y - tr.prevPalm.y) / dt) * 0.4 };
              tr.prevPalm = palm;
              // Pinch with hysteresis: close below 0.33 to start, it holds until you clearly open (> 0.5)
              // for 120ms, so a sloppy pinch doesn't drop what you're holding.
              const gap = dist(hd[4], hd[8]) / size;
              if (gap < 0.38) {
                tr.pinching = true;
                tr.openSince = 0;
              } else if (tr.pinching && gap > 0.55) {
                tr.openSince ||= now;
                if (now - tr.openSince > 120) tr.pinching = false;
              } else tr.openSince = 0;
              const aim = { x: (hd[4].x + hd[8].x) / 2, y: (hd[4].y + hd[8].y) / 2 };
              inputs.push({
                id,
                aim,
                pinch: tr.pinching ? aim : null,
                palm,
                palmR: size * 0.9,
                vel: tr.vel,
                fist: tr.gesture === "Closed_Fist",
                open: tr.gesture === "Open_Palm",
              });
            }
            // Voice "Jarvis, scan this" arms scan mode.
            for (let i = holoQueue.length - 1; i >= 0; i--) if (holoQueue[i].op === "scan") {
              holoQueue.splice(i, 1);
              armScan(true);
            }
            for (let i = holoQueue.length - 1; i >= 0; i--) {
              const q = holoQueue[i];
              if (q.op !== "learnface") continue;
              holoQueue.splice(i, 1);
              learnRef.current = q.name || "Bibek";
            }
            // ---- Faces ----
            if (faceState === "off") {
              faceState = "loading";
              loadFaces()
                .then(() => (faceState = "ready"))
                .catch(() => (faceState = "failed"));
            }
            if (learnRef.current && !learning) {
              learning = { name: learnRef.current, samples: [], at: 0 };
              learnRef.current = null;
            }
            if (faceState === "ready" && !faceBusy && now - faceAt > 300) {
              faceBusy = true;
              faceAt = now;
              detectFaces(v)
                .then((found) => {
                  faces = found.map((f) => ({
                    ...f,
                    sx: mirror ? W - ((f.box.x + f.box.w) * s + ox) : f.box.x * s + ox,
                    sy: f.box.y * s + oy,
                    sw: f.box.w * s,
                    sh: f.box.h * s,
                  }));
                  // Teaching: take 8 samples of the biggest face, a moment apart, then save them.
                  if (learning && faces.length && performance.now() - learning.at > 250) {
                    const big = faces.reduce((a, b) => (b.sw > a.sw ? b : a));
                    learning.samples.push(big.descriptor);
                    learning.at = performance.now();
                    if (learning.samples.length >= 8) {
                      const { name, samples } = learning;
                      learning = null;
                      saveFace(name, samples)
                        .then((saved) => {
                          toast = { text: `FACE LEARNED: ${saved.toUpperCase()}`, until: performance.now() + 2500 };
                          seenNames.delete(saved);
                        })
                        .catch((e) => (toast = { text: String((e as Error).message).toUpperCase(), until: performance.now() + 3000 }));
                    }
                  }
                  for (const f of faces) {
                    if (f.name && !seenNames.has(f.name)) {
                      seenNames.add(f.name);
                      onFaceRef.current?.(f.name);
                    }
                  }
                })
                .catch((e) => {
                  if (!faceErrorShown) console.warn("Face detection failed:", e);
                  faceErrorShown = true;
                })
                .finally(() => (faceBusy = false));
            }
            const hands = [...tracks.values()].map((tr) => tr.hand!).filter(Boolean);
            let scanAim: Pt | null = null;
            let holdProgress = 0;
            if (scanRef.current && !scanBusy) {
              // Aim with your index fingertip; hold still ~0.8s or pinch to scan. A tap scans where you tapped.
              const tip = hands[0]?.[8];
              scanAim = tip || pointer.current.at || { x: W / 2, y: H / 2 };
              let fireAt: Pt | null = scanTap.current;
              scanTap.current = null;
              if (tip) {
                if (!scanAnchor || dist(tip, scanAnchor) > 22) {
                  scanAnchor = tip;
                  scanSince = now;
                }
                holdProgress = Math.min(1, (now - scanSince) / 800);
                if (holdProgress >= 1 || inputs[0]?.pinch) fireAt = tip;
              }
              if (fireAt) {
                armScan(false);
                scanBusy = true;
                scanAnchor = null;
                scanAim = null;
                const target = fireAt;
                // Screen point → normalized point in the (unmirrored) camera frame.
                const vx = ((mirror ? W - target.x : target.x) - ox) / s / vw;
                const vy = (target.y - oy) / s / vh;
                scanAt(v, vx, vy, mirror)
                  .then((res) => {
                    if (!res) {
                      toast = { text: "NO OBJECT FOUND — POINT RIGHT AT IT AND TRY AGAIN", until: performance.now() + 2500 };
                      return;
                    }
                    const b = res.box;
                    const left = mirror ? W - ((b.x + b.w) * s + ox) : b.x * s + ox;
                    const id = play.addScan(res.cutout, { x: left, y: b.y * s + oy, w: b.w * s, h: b.h * s });
                    identify(thumbnail(res.cutout)).then((name) => {
                      if (!name) return;
                      play.rename(id, name.toUpperCase());
                      speakShort(`${name} scanned, sir.`);
                    });
                  })
                  .catch(() => (toast = { text: "SCANNER FAILED TO LOAD — CHECK YOUR CONNECTION", until: performance.now() + 2500 }))
                  .finally(() => (scanBusy = false));
              }
            } else scanAnchor = null;
            // While scanning, a pinch is the shutter, not a grab.
            const playInputs = scanRef.current ? inputs.map((h) => ({ ...h, pinch: null })) : inputs;
            play.update(dt, W, H, playInputs, { at: pointer.current.at, down: pointer.current.down && !scanRef.current });
            drawHolo(ctx, { W, H, now, v, s, ox, oy, vw, vh, hands, label, grabbed: play.grabbedName, fps, status: statusRef.current, game: false, mirror });
            play.draw(ctx, now / 1000, statusRef.current);
            drawFaces(ctx, faces, now / 1000);
            if (learning) drawToast(ctx, W, H, faces.length ? `LEARNING FACE · HOLD STILL · ${learning.samples.length}/8` : "LOOK AT THE CAMERA TO LEARN YOUR FACE");
            else if (faceState === "loading" && learnRef.current) drawToast(ctx, W, H, "LOADING FACE RECOGNITION…");
            if (scanAim) drawScanReticle(ctx, scanAim, holdProgress, now / 1000, W, H);
            if (scanBusy) drawToast(ctx, W, H, "ANALYZING OBJECT…");
            else if (toast.until > now) drawToast(ctx, W, H, toast.text);
            return;
          }

          // Game: aim a little past the index fingertip, along the finger; pinch fires.
          let aim: Pt | null = null;
          let origin: Pt | null = null;
          let shoot = false;
          if (hand) {
            const size = dist(hand[0], hand[9]) || 1;
            const len = dist(hand[5], hand[8]) || 1;
            aim = { x: hand[8].x + ((hand[8].x - hand[5].x) / len) * size * 0.4, y: hand[8].y + ((hand[8].y - hand[5].y) / len) * size * 0.4 };
            origin = hand[8];
            const pinching = dist(hand[4], hand[8]) / size < 0.32;
            shoot = pinching && !wasPinching;
            wasPinching = pinching;
          }
          const p = pointer.current;
          if (p.at && (!hand || now - p.movedAt < 1500)) {
            aim = p.at;
            origin = { x: W / 2, y: H };
          }
          if (p.clicked) {
            shoot = true;
            p.clicked = false;
          }
          drone.update(dt, now, W, H, aim, shoot, origin);
          const sh = drone.shake();
          ctx.save();
          ctx.translate(sh.x, sh.y);
          drawHolo(ctx, { W, H, now, v, s, ox, oy, vw, vh, hands: hand ? [hand] : [], label, grabbed: null, fps, status: statusRef.current, game: true, mirror });
          drone.draw(ctx, W, H, now / 1000);
          ctx.restore();
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        const err = e as Error;
        onError(err.name === "NotAllowedError" ? "Camera is blocked. Allow camera access for this site." : `Gestures failed: ${err.message}`);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      recognizer?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas
        ref={canvas}
        className="holo-canvas"
        hidden={!holo && !game}
        onPointerMove={(e) => {
          pointer.current.at = { x: e.clientX, y: e.clientY };
          pointer.current.movedAt = performance.now();
        }}
        onPointerDown={(e) => {
          if (scanRef.current) scanTap.current = { x: e.clientX, y: e.clientY };
          pointer.current.at = { x: e.clientX, y: e.clientY };
          pointer.current.movedAt = performance.now();
          pointer.current.clicked = true;
          pointer.current.down = true;
        }}
        onPointerUp={() => (pointer.current.down = false)}
        onWheel={(e) => playRef.current?.resizeAt({ x: e.clientX, y: e.clientY }, Math.exp(-e.deltaY * 0.0015))}
        onPointerCancel={() => (pointer.current.down = false)}
      />
      {holo && (
        <div className="holo-btns">
          <button className={scanArmed ? "on" : ""} onClick={() => armScan(!scanArmed)}>
            {scanArmed ? "✕ Cancel scan" : "⊕ Scan object"}
          </button>
          <button onClick={() => switchCamera.current(facing === "user" ? "environment" : "user")}>
            🔄 {facing === "user" ? "Back camera" : "Front camera"}
          </button>
          <button onClick={() => holoQueue.push({ op: "reset" })}>↺ Reset orbs</button>
          <button
            onClick={() => {
              const name = window.prompt("Whose face is this? (Look at the camera after you press OK.)", "Bibek");
              if (name?.trim()) learnRef.current = name.trim();
            }}
          >
            👤 Learn face
          </button>
          <button className={guide ? "on" : ""} onClick={() => setGuide((g) => !g)}>
            ? How to play
          </button>
        </div>
      )}
      {holo && guide && (
        <div className="holo-guide" onClick={() => setGuide(false)}>
          <b>HOW TO PLAY</b>
          <p>🤏 <span>Move your fingers near an orb until a ring appears, then <em>pinch</em> to grab it.</span></p>
          <p>🙌 <span>Holding one? <em>Pinch your other hand</em> anywhere, then spread or squeeze to resize.</span></p>
          <p>💥 <span>Grab two orbs (one per hand) and <em>crash them together</em>. They blast, then come back at normal size.</span></p>
          <p>🫧 <span>Push two held orbs together <em>slowly</em> to <em>merge</em> them into one big orb. Blow it up and they split apart again.</span></p>
          <p>⚡ <span>Hold an orb <em>still</em> until its gold ring fills, then <em>throw</em> it: it explodes on whatever it hits.</span></p>
          <p>👋 <span>Flick and let go to <em>throw</em>. Open palm <em>swats</em>. Fist <em>pulls</em> everything to you.</span></p>
          <p>🗣️ <span>Say <em>“Jarvis, make it red”</em>, “bigger”, “smaller”, “blow it up”, or “explode everything”.</span></p>
          <p>👤 <span>Tap <em>Learn face</em> (or say “Jarvis, remember my face” / “this is Sam”) and look at the camera. Jarvis tags known faces by name.</span></p>
          <p>🖱️ <span>Mouse: drag to grab, <em>scroll wheel</em> over an orb to resize.</span></p>
          <small>Tip: keep your hand 1–2 feet from the camera in good light. Tap to close.</small>
        </div>
      )}
      <div className="cam" hidden={holo || game}>
        <video ref={video} playsInline muted />
        <span>{seen}</span>
      </div>
    </>
  );
}

type Frame = {
  W: number;
  H: number;
  now: number;
  v: HTMLVideoElement;
  s: number;
  ox: number;
  oy: number;
  vw: number;
  vh: number;
  hands: Pt[][];
  label: string;
  grabbed: string | null;
  fps: number;
  status: Status;
  game: boolean;
  mirror: boolean;
};

function drawHolo(ctx: CanvasRenderingContext2D, f: Frame) {
  const { W, H, now, hands, status } = f;
  const t = now / 1000;
  const rgb = status === "thinking" ? "255,181,71" : "63,216,255";
  const c = (a: number) => `rgba(${rgb},${a})`;

  // Camera feed, mirrored, tinted blue.
  ctx.save();
  if (f.mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(f.v, f.ox, f.oy, f.vw * f.s, f.vh * f.s);
  ctx.restore();
  ctx.fillStyle = "rgba(2,12,24,0.62)";
  ctx.fillRect(0, 0, W, H);
  const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,4,10,0.85)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // Grid + scan line.
  ctx.lineWidth = 1;
  ctx.strokeStyle = c(0.05);
  ctx.beginPath();
  for (let x = (t * 6) % 48; x < W; x += 48) ctx.moveTo(x, 0), ctx.lineTo(x, H);
  for (let y = 0; y < H; y += 48) ctx.moveTo(0, y), ctx.lineTo(W, y);
  ctx.stroke();
  const scanY = ((t * 140) % (H + 200)) - 100;
  const scan = ctx.createLinearGradient(0, scanY - 60, 0, scanY);
  scan.addColorStop(0, c(0));
  scan.addColorStop(1, c(0.12));
  ctx.fillStyle = scan;
  ctx.fillRect(0, scanY - 60, W, 60);

  // Corner brackets + header readout.
  ctx.strokeStyle = c(0.6);
  ctx.lineWidth = 2;
  const m = 14;
  const L = 34;
  for (const [x, y, dx, dy] of [
    [m, m, 1, 1],
    [W - m, m, -1, 1],
    [m, H - m, 1, -1],
    [W - m, H - m, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * L);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * L, y);
    ctx.stroke();
  }
  ctx.font = "11px Consolas, 'Courier New', monospace";
  ctx.fillStyle = c(0.7);
  ctx.textAlign = "left";
  ctx.fillText(`HOLO INTERFACE // ${status.toUpperCase()}`, 26, H - 52);
  ctx.fillText(`TRACK ${hands.length ? `${hands.length} HAND${hands.length > 1 ? "S" : ""} LOCKED` : "SEARCHING"} · ${f.fps} FPS`, 26, H - 36);

  // Hands (readout panel only on the first).
  hands.forEach((hand, hi) => {
    let pinchPt: Pt | null = null;
    const size = dist(hand[0], hand[9]) || 1;
    const palm = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + hand[i].x / 5, y: a.y + hand[i].y / 5 }), { x: 0, y: 0 });
    const open = Math.max(0, Math.min(1, (TIPS.slice(1).reduce((a, i) => a + dist(hand[i], hand[0]), 0) / 4 / size - 0.9) / 1.1));
    const pinchD = dist(hand[4], hand[8]) / size;
    const pinching = pinchD < 0.32;
    if (pinching) pinchPt = { x: (hand[4].x + hand[8].x) / 2, y: (hand[4].y + hand[8].y) / 2 };

    ctx.save();
    ctx.shadowColor = c(1);
    ctx.shadowBlur = 14;
    ctx.lineCap = "round";
    // Bones
    ctx.strokeStyle = c(0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const [a, b] of BONES) ctx.moveTo(hand[a].x, hand[a].y), ctx.lineTo(hand[b].x, hand[b].y);
    ctx.stroke();
    // Joints
    ctx.fillStyle = "#e9fbff";
    for (const p of hand) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fingertip reticles
    ctx.strokeStyle = c(0.85);
    ctx.lineWidth = 1.5;
    TIPS.forEach((i, k) => {
      const p = hand[i];
      const r = size * 0.16 + 6;
      const a = t * 3 + k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, a, a + 1.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, a + Math.PI, a + Math.PI + 1.3);
      ctx.stroke();
    });

    // Palm HUD rings
    const R = size * 0.95;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c(0.55);
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.arc(palm.x, palm.y, R, t * 0.8, t * 0.8 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = c(0.75);
    for (let k = 0; k < 3; k++) {
      const a = -t * 1.6 + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(palm.x, palm.y, R * 0.72, a, a + 0.9 * (0.4 + open));
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = c(0.45);
    ctx.beginPath();
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2 + t * 0.3;
      const r1 = R * 1.12;
      const r2 = R * (k % 4 === 0 ? 1.24 : 1.17);
      ctx.moveTo(palm.x + Math.cos(a) * r1, palm.y + Math.sin(a) * r1);
      ctx.lineTo(palm.x + Math.cos(a) * r2, palm.y + Math.sin(a) * r2);
    }
    ctx.stroke();

    // Pinch beam
    if (pinching) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hand[4].x, hand[4].y);
      ctx.lineTo(hand[8].x, hand[8].y);
      ctx.stroke();
      ctx.strokeStyle = c(0.9);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pinchPt!.x, pinchPt!.y, 10 + Math.sin(t * 10) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (f.game || hi > 0) return; // the game draws its own HUD; one readout is enough

    // Readout panel with leader line
    const side = palm.x < W * 0.6 ? 1 : -1;
    const bx = palm.x + side * (R * 1.35 + 30);
    const by = palm.y - R * 0.9;
    ctx.strokeStyle = c(0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(palm.x + side * R * 1.24 * 0.7, palm.y - R * 1.24 * 0.7);
    ctx.lineTo(bx - side * 12, by);
    ctx.lineTo(bx + side * 150, by);
    ctx.stroke();
    ctx.textAlign = side > 0 ? "left" : "right";
    ctx.font = "bold 12px Consolas, 'Courier New', monospace";
    ctx.fillStyle = c(1);
    ctx.fillText("HAND_01 // LOCKED", bx, by - 8);
    ctx.font = "11px Consolas, 'Courier New', monospace";
    ctx.fillStyle = c(0.8);
    const rows = [
      `POS  ${Math.round((palm.x / W) * 1000)
        .toString()
        .padStart(4, "0")} : ${Math.round((palm.y / H) * 1000)
        .toString()
        .padStart(4, "0")}`,
      `GRIP ${Math.round((1 - open) * 100)}%`,
      `SIG  ${f.label.toUpperCase()}`,
      f.grabbed ? `HOLD ${f.grabbed}` : pinching ? "PINCH ENGAGED" : "PINCH  ----",
    ];
    rows.forEach((r, i) => ctx.fillText(r, bx, by + 18 + i * 16));
    // grip bar
    const barX = side > 0 ? bx : bx - 120;
    ctx.strokeStyle = c(0.5);
    ctx.strokeRect(barX, by + 18 + rows.length * 16 - 6, 120, 6);
    ctx.fillStyle = c(0.9);
    ctx.fillRect(barX, by + 18 + rows.length * 16 - 6, 120 * (1 - open), 6);
  });
  if (!hands.length && !f.game) {
    ctx.textAlign = "center";
    ctx.font = "13px Consolas, 'Courier New', monospace";
    ctx.fillStyle = c(0.45 + 0.35 * Math.abs(Math.sin(t * 2.5)));
    ctx.fillText("RAISE YOUR HAND TO ENGAGE", W / 2, H - 120);
  }
}

/** Ask Claude what a scanned object is ("red car"). Empty string if it can't tell. */
async function identify(image: string): Promise<string> {
  try {
    let pin = "";
    try {
      pin = localStorage.getItem("jarvis-pin") || "";
    } catch {}
    const res = await fetch("/api/identify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-jarvis-pin": pin },
      body: JSON.stringify({ image }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && typeof data.name === "string" ? data.name : "";
  } catch {
    return "";
  }
}

function speakShort(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices();
    u.voice = v.find((x) => /Google UK English Male|Ryan.*United Kingdom|George|Daniel/i.test(x.name)) || v.find((x) => x.lang === "en-GB") || null;
    u.rate = 1.03;
    u.pitch = 0.9;
    speechSynthesis.speak(u);
  } catch {}
}

/** Targeting reticle for scan mode; the ring fills while you hold still. */
function drawScanReticle(ctx: CanvasRenderingContext2D, p: Pt, progress: number, t: number, W: number, H: number) {
  ctx.save();
  ctx.shadowColor = "rgba(63,216,255,1)";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "rgba(200,245,255,0.95)";
  ctx.lineWidth = 2;
  const r = 34;
  for (let i = 0; i < 4; i++) {
    const a = t * 1.5 + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, a, a + 0.9);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(p.x - 10, p.y);
  ctx.lineTo(p.x + 10, p.y);
  ctx.moveTo(p.x, p.y - 10);
  ctx.lineTo(p.x, p.y + 10);
  ctx.stroke();
  if (progress > 0) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 9, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  drawToast(ctx, W, H, "SCAN MODE — POINT AT AN OBJECT AND HOLD STILL (OR TAP IT)");
}

/** Iron Man style face tracking: corner brackets, a name tag, and a confidence bar. Unknown faces get a red tag. */
function drawFaces(ctx: CanvasRenderingContext2D, faces: (SeenFace & { sx: number; sy: number; sw: number; sh: number })[], t: number) {
  for (const f of faces) {
    const known = !!f.name;
    const col = known ? "77,255,154" : "255,90,110";
    const pad = f.sw * 0.12;
    const x = f.sx - pad;
    const y = f.sy - pad * 1.4;
    const w = f.sw + pad * 2;
    const h = f.sh + pad * 2.2;
    const L = Math.min(w, h) * 0.22;
    ctx.save();
    ctx.strokeStyle = `rgba(${col},0.95)`;
    ctx.shadowColor = `rgba(${col},1)`;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.5;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * L);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx * L, cy);
      ctx.stroke();
    }
    // scan line sweeping down the face
    const sy = y + ((t * 0.8) % 1) * h;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(x + 4, sy);
    ctx.lineTo(x + w - 4, sy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const label = known ? f.name!.toUpperCase() : "UNKNOWN";
    ctx.font = "bold 13px Consolas, 'Courier New', monospace";
    const tw = ctx.measureText(label).width + 16;
    ctx.fillStyle = `rgba(${col},0.18)`;
    ctx.fillRect(x, y - 26, Math.max(tw, 90), 20);
    ctx.fillStyle = `rgb(${col})`;
    ctx.textAlign = "left";
    ctx.fillText(label, x + 8, y - 11);
    ctx.font = "10px Consolas, 'Courier New', monospace";
    ctx.fillText(known ? `MATCH ${Math.round(f.score * 100)}%` : "NOT IN DATABASE", x, y + h + 14);
    if (known) {
      ctx.fillStyle = `rgba(${col},0.25)`;
      ctx.fillRect(x, y + h + 19, w, 3);
      ctx.fillStyle = `rgb(${col})`;
      ctx.fillRect(x, y + h + 19, w * f.score, 3);
    }
    ctx.restore();
  }
}

function drawToast(ctx: CanvasRenderingContext2D, W: number, H: number, text: string) {
  ctx.save();
  ctx.font = "bold 13px Consolas, 'Courier New', monospace";
  ctx.textAlign = "center";
  const w = Math.min(W - 32, ctx.measureText(text).width + 32);
  ctx.fillStyle = "rgba(2,12,24,0.75)";
  ctx.fillRect(W / 2 - w / 2, 70, w, 30);
  ctx.strokeStyle = "rgba(63,216,255,0.6)";
  ctx.strokeRect(W / 2 - w / 2, 70, w, 30);
  ctx.fillStyle = "rgba(200,245,255,1)";
  ctx.fillText(text, W / 2, 90, W - 48);
  ctx.restore();
}
