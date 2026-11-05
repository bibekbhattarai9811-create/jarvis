"use client";

import { useEffect, useRef, useState } from "react";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import { DroneGame } from "@/lib/droneGame";
import { HoloPlayground, holoQueue, type HandInput } from "@/lib/holoPlayground";
import { scanAt, thumbnail } from "@/lib/scanner";
import { detectFaces, loadFaces, saveFace, type SeenFace } from "@/lib/faceClient";
import { DEFAULT_PINCH, loadPinch, pinchFromSamples, pinchProgress, savePinch, type PinchCfg } from "@/lib/pinch";

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
  onExit,
  holo,
  game,
  status,
}: {
  onError: (msg: string) => void;
  onFace?: (name: string) => void;
  onExit?: () => void;
  holo: boolean;
  game: boolean;
  status: Status;
}) {
  const gameRef = useRef(game);
  gameRef.current = game;
  // Mouse / touch fallback for aiming in the game.
  const pointer = useRef<{ at: Pt | null; movedAt: number; clicked: boolean; down: boolean; special: boolean }>({ at: null, movedAt: 0, clicked: false, down: false, special: false });
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
  const [dock, setDock] = useState(false);
  const [handMenu, setHandMenu] = useState(false);
  const dockRef = useRef(false);
  dockRef.current = dock;
  const handMenuRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
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
  // Pinch cut-offs, personalised by "Train my hand" (saved on this device).
  const pinchCfg = useRef<PinchCfg>(DEFAULT_PINCH);
  const [trained, setTrained] = useState(false);
  useEffect(() => {
    pinchCfg.current = loadPinch();
    setTrained(pinchCfg.current.trained);
  }, []);
  type Training = { step: "open" | "pinch"; open: number[]; pinch: number[]; startAt: number; until: number; tick: number };
  const trainRef = useRef<Training | null>(null);
  const [train, setTrain] = useState<{ step: "open" | "pinch" | "done" | "fail"; progress: number } | null>(null);
  const startTrain = () => {
    trainRef.current = { step: "open", open: [], pinch: [], startAt: performance.now() + 900, until: 0, tick: -1 };
    setTrain({ step: "open", progress: 0 });
  };

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
        type Track = { target: Pt[]; hand: Pt[] | null; gesture: string; seenAt: number; prevPalm: Pt | null; vel: Pt; pinching: boolean; openSince: number; world: { x: number; y: number; z: number }[] | null; gap?: number };
        const tracks = new Map<string, Track>();
        let nextTrack = 1;
        let prevFrame = performance.now();
        let wasPinching = false;
        // Scan state
        let scanAnchor: Pt | null = null;
        let scanSince = 0;
        let scanBusy = false;
        let toast = { text: "", until: 0 };
        let hoverBtn: HTMLButtonElement | null = null;
        let hoverSince = 0;
        let hoverFired = false;
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
              const tr = tracks.get(key) || { target: [], hand: null, gesture: "", seenAt: 0, prevPalm: null, vel: { x: 0, y: 0 }, pinching: false, openSince: 0, world: null };
              tr.target = screen;
              // Real-world hand points (meters, centred on the hand): the pinch measure doesn't depend on how far the hand is from the camera.
              tr.world = (res as unknown as { worldLandmarks?: { x: number; y: number; z: number }[][] }).worldLandmarks?.[i] || null;
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
              // Adaptive smoothing: steady when the hand is still (no jitter), quick when it moves (no lag).
              const moved = tr.hand ? dist(tr.hand[9], tg[9]) : 0;
              const k = Math.min(0.9, 0.25 + moved / 40);
              const hd = (tr.hand = tr.hand ? tr.hand.map((p, i) => ({ x: p.x + (tg[i].x - p.x) * k, y: p.y + (tg[i].y - p.y) * k })) : tg);
              const size = dist(hd[0], hd[9]) || 1;
              const palm = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + hd[i].x / 5, y: a.y + hd[i].y / 5 }), { x: 0, y: 0 });
              if (tr.prevPalm && dt > 0) tr.vel = { x: tr.vel.x * 0.6 + ((palm.x - tr.prevPalm.x) / dt) * 0.4, y: tr.vel.y * 0.6 + ((palm.y - tr.prevPalm.y) / dt) * 0.4 };
              tr.prevPalm = palm;
              // Pinch = thumb-tip to index-tip distance ÷ palm length, in the tracker's real-world hand coordinates
              // (x, y only: its depth guess at the fingertips is unreliable and reads a closed pinch as open).
              // Tested on photos: open hands 0.68–1.12, pinches 0.14–0.15. Fallback: image coordinates with a palm
              // size that doesn't shrink when the hand turns sideways.
              // Hysteresis: close below `on` to grab; it holds until you clearly open (> `off`) for 120 ms, so a
              // sloppy pinch doesn't drop what you're holding. `on`/`off` come from "Train my hand" (defaults otherwise).
              const w = tr.world;
              const gap =
                w && w.length > 9
                  ? dist(w[4], w[8]) / (dist(w[0], w[9]) || 1)
                  : dist(hd[4], hd[8]) / Math.max(size, dist(hd[5], hd[17]) * 1.6);
              tr.gap = gap;
              const { on: pinchOn, off: pinchOff } = pinchCfg.current;
              if (gap < pinchOn) {
                tr.pinching = true;
                tr.openSince = 0;
              } else if (tr.pinching && gap > pinchOff) {
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
            // "Train my hand": sample the pinch gap with your hand open, then pinched (2.5 s each).
            const T = trainRef.current;
            if (T) {
              const first = [...tracks.values()].find((t) => typeof t.gap === "number" && now - t.seenAt < 150);
              const samples = T.step === "open" ? T.open : T.pinch;
              if (!first) {
                // Hand left the picture: start this step over once it's back.
                samples.length = 0;
                T.until = 0;
              } else if (now >= T.startAt) {
                T.until ||= now + 2500;
                samples.push(first.gap!);
                const progress = Math.min(1, 1 - (T.until - now) / 2500);
                if (now >= T.until) {
                  if (T.step === "open") {
                    Object.assign(T, { step: "pinch", startAt: now + 1200, until: 0, tick: -1 });
                    setTrain({ step: "pinch", progress: 0 });
                  } else {
                    const cfg = pinchFromSamples(T.open, T.pinch);
                    trainRef.current = null;
                    if (cfg) {
                      pinchCfg.current = cfg;
                      savePinch(cfg);
                      setTrained(true);
                      setTrain({ step: "done", progress: 1 });
                    } else setTrain({ step: "fail", progress: 0 });
                  }
                } else if (Math.floor(progress * 20) !== T.tick) {
                  T.tick = Math.floor(progress * 20);
                  setTrain({ step: T.step, progress });
                }
              }
            }
            // While scanning or training, a pinch is not a grab.
            const playInputs = scanRef.current || trainRef.current ? inputs.map((h) => ({ ...h, pinch: null })) : inputs;
            play.update(dt, W, H, playInputs, { at: pointer.current.at, down: pointer.current.down && !scanRef.current });
            drawHolo(ctx, { W, H, now, v, s, ox, oy, vw, vh, hands, label, grabbed: play.grabbedName, fps, status: statusRef.current, game: false, mirror });
            play.draw(ctx, now / 1000, statusRef.current);
            drawFaces(ctx, faces, now / 1000);
            // Pinch meter at each hand's fingertips: fills as you close the pinch, turns green when it grabs.
            for (const tr of tracks.values()) {
              if (!tr.hand || typeof tr.gap !== "number" || now - tr.seenAt > 150) continue;
              drawPinchMeter(ctx, { x: (tr.hand[4].x + tr.hand[8].x) / 2, y: (tr.hand[4].y + tr.hand[8].y) / 2 }, pinchProgress(tr.gap, pinchCfg.current), tr.pinching);
            }

            // Hand-hover menu at bottom center: move index fingertip near bottom to reveal & hover-select options.
            const tip0 = hands[0]?.[8];
            const zoneH = dockRef.current ? 210 : handMenuRef.current ? 96 : 64;
            const nearBottom = !!tip0 && !play.grabbedName && tip0.y > H - zoneH && Math.abs(tip0.x - W / 2) < 360;
            if (nearBottom !== handMenuRef.current) {
              handMenuRef.current = nearBottom;
              setHandMenu(nearBottom);
              if (!nearBottom) setDock(false);
            }
            let btnProgress = 0;
            if (tip0 && nearBottom) {
              const el = document.elementFromPoint(tip0.x, tip0.y)?.closest(".holo-hover-zone button") as HTMLButtonElement | null;
              if (el !== hoverBtn) {
                hoverBtn?.removeAttribute("data-hand-hover");
                hoverBtn = el;
                hoverBtn?.setAttribute("data-hand-hover", "1");
                hoverSince = now;
                hoverFired = false;
              } else if (el && !hoverFired) {
                btnProgress = Math.min(1, (now - hoverSince) / 550);
                if (btnProgress >= 1 || inputs[0]?.pinch) {
                  hoverFired = true;
                  el.click();
                }
              }
              if (tip0 && el) {
                ctx.save();
                ctx.strokeStyle = "#3fd8ff";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(tip0.x, tip0.y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * btnProgress);
                ctx.stroke();
                ctx.restore();
              }
            } else if (hoverBtn) {
              hoverBtn.removeAttribute("data-hand-hover");
              hoverBtn = null;
            }

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
          const openPalm = [...tracks.values()].some((tr) => tr.gesture === "Open_Palm");
          const special = openPalm || p.special;
          p.special = false;
          drone.update(dt, now, W, H, aim, shoot, origin, special);
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

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        onExitRef.current?.();
      } else if (gameRef.current && e.code === "Space") {
        e.preventDefault();
        pointer.current.special = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stopped = true;
      window.removeEventListener("keydown", onKey);
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
        <div
          className={`holo-hover-zone ${handMenu || dock || scanArmed ? "open" : ""}`}
          onMouseLeave={() => setDock(false)}
        >
          <span className="holo-trigger" aria-hidden="true">
            ✦ Options
          </span>
          {dock && (
            <div className="holo-dock">
              <div className="holo-dock-row">
                {[
                  { id: "helmet", label: "🦾 Helmet" },
                  { id: "reactor", label: "⚛ Reactor" },
                  { id: "cube", label: "🧊 Cube" },
                  { id: "globe", label: "🌍 Earth" },
                  { id: "gyro", label: "🧭 Gyro" },
                  { id: "crystal", label: "💎 Crystal" },
                  { id: "pyramid", label: "🔺 Pyramid" },
                  { id: "torus", label: "🍩 Torus" },
                  { id: "dna", label: "🧬 DNA" },
                  { id: "atom", label: "🔬 Atom" },
                  { id: "star", label: "⭐ Star" },
                  { id: "heart", label: "❤️ Heart" },
                ].map((s) => (
                  <button key={s.id} type="button" onClick={() => holoQueue.push({ op: "add", shape: s.id })}>
                    + {s.label}
                  </button>
                ))}
              </div>
              <div className="holo-dock-row">
                {[
                  { name: "cyan", hex: "#3fd8ff" },
                  { name: "gold", hex: "#ffc83c" },
                  { name: "red", hex: "#ff4646" },
                  { name: "green", hex: "#50ff8c" },
                  { name: "blue", hex: "#468cff" },
                  { name: "purple", hex: "#aa6eff" },
                  { name: "pink", hex: "#ff64be" },
                  { name: "white", hex: "#ebf5ff" },
                ].map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className="swatch"
                    style={{ background: c.hex }}
                    onClick={() => holoQueue.push({ op: "color", color: c.name })}
                    title={`Color active hologram ${c.name}`}
                  />
                ))}
                <button type="button" onClick={() => holoQueue.push({ op: "scale", factor: 1.35 })} title="Scale up">
                  ➕ Bigger
                </button>
                <button type="button" onClick={() => holoQueue.push({ op: "scale", factor: 0.74 })} title="Scale down">
                  ➖ Smaller
                </button>
                <button type="button" onClick={() => holoQueue.push({ op: "explode", all: true })} title="Detonate all holograms">
                  💥 Boom All
                </button>
              </div>
            </div>
          )}
          <div className="holo-toolbar">
            <div className="holo-toolbar-row">
              {onExit && (
                <button type="button" className="exit-btn" onClick={onExit}>
                  ← Exit
                </button>
              )}
              <button
                type="button"
                className={dock ? "on" : ""}
                onMouseEnter={() => setDock(true)}
                onClick={() => setDock((d) => !d)}
              >
                ✨ Shapes
              </button>
              <button type="button" className={scanArmed ? "on" : ""} onClick={() => armScan(!scanArmed)}>
                {scanArmed ? "✕ Cancel" : "📸 Scan"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt("Whose face is this? (Look at the camera after you press OK.)", "Bibek");
                  if (name?.trim()) learnRef.current = name.trim();
                }}
              >
                👤 Face
              </button>
              <button type="button" onClick={() => switchCamera.current(facing === "user" ? "environment" : "user")}>
                🔄 Cam
              </button>
              <button type="button" className={train ? "on" : ""} onClick={startTrain} title="Teach Jarvis your open hand and your pinch">
                ✋ {trained ? "Retrain" : "Train hand"}
              </button>
              <button type="button" onClick={() => holoQueue.push({ op: "reset" })}>
                ↺ Reset
              </button>
              <button type="button" className={guide ? "on" : ""} onClick={() => setGuide((g) => !g)}>
                ?
              </button>
            </div>
          </div>
        </div>
      )}
      {game && (
        <div className="holo-hover-zone">
          <span className="holo-trigger" aria-hidden="true">
            🎮 Options
          </span>
          <div className="holo-toolbar game-toolbar">
            <div className="holo-toolbar-row">
              {onExit && (
                <button type="button" className="exit-btn" onClick={onExit}>
                  ← Exit
                </button>
              )}
              <button
                type="button"
                className="on"
                onClick={() => {
                  pointer.current.special = true;
                }}
                title="Fire Chest Unibeam (or press Spacebar / show Open Palm)"
              >
                ⚡ Unibeam
              </button>
              <button type="button" onClick={() => switchCamera.current(facing === "user" ? "environment" : "user")}>
                🔄 Cam
              </button>
            </div>
          </div>
        </div>
      )}
      {holo && train && (
        <div className="holo-guide holo-train" role="dialog" aria-label="Train my hand">
          <b>TRAIN MY HAND</b>
          {train.step === "open" && (
            <p>
              ✋ <span>Hold your hand up to the camera, <em>open and relaxed</em>, like you&apos;re about to grab something.</span>
            </p>
          )}
          {train.step === "pinch" && (
            <p>
              🤏 <span>Now <em>pinch</em>: touch your thumb and index fingertips together and hold.</span>
            </p>
          )}
          {train.step === "done" && (
            <p>
              ✓ <span>Trained to your hand. Pinching should feel easy now. Watch the ring at your fingertips: it turns <em>green</em> when you grab.</span>
            </p>
          )}
          {train.step === "fail" && (
            <p>
              ⚠ <span>Couldn&apos;t tell your open hand from your pinch. Keep your hand in view, 1–2 feet from the camera, and try again.</span>
            </p>
          )}
          {(train.step === "open" || train.step === "pinch") && (
            <div className="train-bar">
              <span style={{ width: `${Math.round(train.progress * 100)}%` }} />
            </div>
          )}
          <div className="train-btns">
            {train.step === "fail" && (
              <button type="button" onClick={startTrain}>
                Try again
              </button>
            )}
            {trained && train.step !== "open" && train.step !== "pinch" && (
              <button
                type="button"
                onClick={() => {
                  savePinch(null);
                  pinchCfg.current = { ...DEFAULT_PINCH };
                  setTrained(false);
                  setTrain(null);
                }}
              >
                Use default
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                trainRef.current = null;
                setTrain(null);
              }}
            >
              {train.step === "done" ? "Done" : "Cancel"}
            </button>
          </div>
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
          <p>✊✊ <span>Make <em>two fists</em> to summon a <em>Gravity Singularity</em> that swirls all holograms into orbit, then open to slingshot!</span></p>
          <p>👋 <span>Flick and let go to <em>throw</em>. Open palm <em>swats</em>. Single fist <em>pulls</em> everything to you.</span></p>
          <p>🗣️ <span>Say <em>“Jarvis, make it red”</em>, “bigger”, “smaller”, “blow it up”, or “explode everything”.</span></p>
          <p>👤 <span>Tap <em>Learn face</em> (or say “Jarvis, remember my face” / “this is Sam”) and look at the camera. Jarvis tags known faces by name.</span></p>
          <p>🖱️ <span>Mouse: drag to grab, <em>scroll wheel</em> over an orb to resize.</span></p>
          <p>✋ <span>Pinch feels off? Tap <em>Train hand</em>: show an open hand, then a pinch, and Jarvis tunes grabbing to your hand.</span></p>
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
/** Small ring between thumb and index tips: how close you are to the grab point (green = grabbing). */
function drawPinchMeter(ctx: CanvasRenderingContext2D, at: Pt, progress: number, grabbing: boolean) {
  const r = 15;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(63,216,255,0.25)";
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = grabbing ? "rgba(77,255,154,0.95)" : `rgba(63,216,255,${0.4 + progress * 0.6})`;
  ctx.shadowColor = grabbing ? "#4dff9a" : "#3fd8ff";
  ctx.shadowBlur = grabbing ? 14 : 6;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (grabbing ? 1 : progress));
  ctx.stroke();
  if (grabbing) {
    ctx.fillStyle = "rgba(77,255,154,0.9)";
    ctx.beginPath();
    ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

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
