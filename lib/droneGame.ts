// Drone Blaster: aim with your index finger (or mouse/touch), hover to lock on, pinch/click to fire.

type Pt = { x: number; y: number };
type Kind = "basic" | "fast" | "armor";
type Drone = { x: number; y: number; z: number; time: number; kind: Kind; hp: number; lock: number; spin: number; drift: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; rgb: string };
type Floater = { x: number; y: number; text: string; life: number };
type Beam = { a: Pt; b: Pt; life: number };

const KINDS: Record<Kind, { rgb: string; points: number; hp: number; speed: number }> = {
  basic: { rgb: "255,70,120", points: 100, hp: 1, speed: 1 },
  fast: { rgb: "255,181,71", points: 200, hp: 1, speed: 0.6 },
  armor: { rgb: "180,120,255", points: 300, hp: 2, speed: 1.25 },
};
const LOCK_SECONDS = 0.4;
const BUTTON_SECONDS = 0.9;

export class DroneGame {
  state: "ready" | "playing" | "over" = "ready";
  score = 0;
  best = 0;
  hearts = 3;
  level = 1;
  kills = 0;
  combo = 1;
  private lastKill = 0;
  private drones: Drone[] = [];
  private parts: Particle[] = [];
  private floaters: Floater[] = [];
  private beams: Beam[] = [];
  private spawnIn = 1;
  private flash = 0;
  private shakeAmt = 0;
  private button = 0; // hover progress on START / PLAY AGAIN
  private overAt = 0;
  private aim: Pt | null = null;
  private audio: AudioContext | null = null;

  constructor() {
    try {
      this.best = Number(localStorage.getItem("jarvis-drone-best")) || 0;
    } catch {}
  }

  /** Screen-shake offset for this frame. */
  shake(): Pt {
    const s = this.shakeAmt;
    return { x: (Math.random() - 0.5) * s, y: (Math.random() - 0.5) * s };
  }

  private start() {
    this.state = "playing";
    this.score = 0;
    this.hearts = 3;
    this.level = 1;
    this.kills = 0;
    this.combo = 1;
    this.drones = [];
    this.spawnIn = 1;
    this.button = 0;
    this.sound("start");
  }

  update(dt: number, now: number, W: number, H: number, aim: Pt | null, fire: boolean, origin: Pt | null) {
    dt = Math.max(0, Math.min(dt, 0.05)); // rAF timestamps can run slightly behind performance.now()
    this.aim = aim;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 60);
    for (const p of this.parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.life -= dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const f of this.floaters) {
      f.y -= 40 * dt;
      f.life -= dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);

    if (this.state !== "playing") {
      // Hover (or click) the center button to start / restart.
      const btn = { x: W / 2, y: H * 0.58 };
      const r = Math.min(W, H) * 0.09;
      const ready = this.state === "ready" || now - this.overAt > 1200;
      const over = ready && aim && Math.hypot(aim.x - btn.x, aim.y - btn.y) < r * 1.2;
      this.button = over ? this.button + dt / BUTTON_SECONDS : Math.max(0, this.button - dt * 2);
      if (over && fire) this.button = 1;
      if (this.button >= 1) this.start();
      return;
    }

    // Combo expires
    if (now - this.lastKill > 2500) this.combo = 1;

    // Spawning
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = Math.max(0.4, 1.6 - this.level * 0.12) * (0.7 + Math.random() * 0.6);
      const roll = Math.random();
      const kind: Kind = this.level >= 3 && roll < 0.2 ? "armor" : this.level >= 2 && roll < 0.45 ? "fast" : "basic";
      const k = KINDS[kind];
      const m = Math.min(W, H) * 0.12;
      this.drones.push({
        x: m + Math.random() * (W - 2 * m),
        y: H * 0.18 + Math.random() * (H * 0.55),
        z: 0,
        time: Math.max(2, 6 - this.level * 0.35) * k.speed,
        kind,
        hp: k.hp,
        lock: 0,
        spin: Math.random() * 6,
        drift: (Math.random() - 0.5) * 30,
      });
    }

    const scale = Math.min(W, H) / 700;
    for (const d of this.drones) {
      d.z += dt / d.time;
      d.spin += dt * (d.kind === "fast" ? 5 : 2);
      d.x += d.drift * dt;
      d.y += Math.sin(d.spin) * 12 * dt;
      const r = (10 + d.z * 55) * scale;
      const hovered = aim && Math.hypot(aim.x - d.x, aim.y - d.y) < r * 1.15 + 10;
      d.lock = hovered ? d.lock + dt / LOCK_SECONDS : Math.max(0, d.lock - dt * 3);
      if (d.lock >= 1 || (fire && hovered)) {
        d.lock = 0;
        this.hit(d, now, origin ?? { x: W / 2, y: H });
        fire = false; // one shot per pinch
      }
    }
    if (fire && aim) {
      // Missed shot: still draw a beam.
      this.beams.push({ a: origin ?? { x: W / 2, y: H }, b: aim, life: 0.12 });
      this.sound("fire");
    }

    // Drones that reach you
    for (const d of this.drones) {
      if (d.z >= 1 && d.hp > 0) {
        d.hp = 0;
        this.hearts--;
        this.combo = 1;
        this.flash = 1;
        this.shakeAmt = 28;
        this.burst(d.x, d.y, "255,60,60", 30);
        this.sound("hurt");
        navigator.vibrate?.(200);
        if (this.hearts <= 0) {
          this.state = "over";
          this.overAt = now;
          this.button = 0;
          if (this.score > this.best) {
            this.best = this.score;
            try {
              localStorage.setItem("jarvis-drone-best", String(this.best));
            } catch {}
          }
          this.sound("over");
        }
      }
    }
    this.drones = this.drones.filter((d) => d.hp > 0);
  }

  private hit(d: Drone, now: number, origin: Pt) {
    this.beams.push({ a: origin, b: { x: d.x, y: d.y }, life: 0.15 });
    d.hp--;
    const k = KINDS[d.kind];
    if (d.hp > 0) {
      this.burst(d.x, d.y, k.rgb, 8);
      this.sound("clang");
      return;
    }
    this.combo = now - this.lastKill < 2500 ? Math.min(this.combo + 1, 8) : 1;
    this.lastKill = now;
    const pts = k.points * this.combo;
    this.score += pts;
    this.kills++;
    this.level = 1 + Math.floor(this.kills / 10);
    this.floaters.push({ x: d.x, y: d.y, text: `+${pts}${this.combo > 1 ? ` x${this.combo}` : ""}`, life: 0.9 });
    this.burst(d.x, d.y, k.rgb, 26);
    this.burst(d.x, d.y, "200,245,255", 10);
    this.shakeAmt = Math.max(this.shakeAmt, 6);
    this.sound("boom");
  }

  private burst(x: number, y: number, rgb: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 320;
      const life = 0.4 + Math.random() * 0.5;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life, max: life, rgb });
    }
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
    const scale = Math.min(W, H) / 700;
    const mono = (px: number, bold = false) => `${bold ? "bold " : ""}${Math.round(px)}px Consolas, 'Courier New', monospace`;

    // Drones
    for (const d of this.drones) {
      const k = KINDS[d.kind];
      const r = (10 + d.z * 55) * scale;
      const c = (a: number) => `rgba(${k.rgb},${a})`;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.shadowColor = c(1);
      ctx.shadowBlur = 16;
      ctx.strokeStyle = c(0.95);
      ctx.lineWidth = 2;
      ctx.rotate(d.spin * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.75, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.75, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = c(0.15);
      ctx.fill();
      ctx.rotate(-d.spin);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(2, r * 0.12), 0, Math.PI * 2);
      ctx.fill();
      if (d.kind === "armor") {
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
      // Danger ring as it gets close
      if (d.z > 0.7) {
        ctx.strokeStyle = `rgba(255,60,60,${(d.z - 0.7) * 2.5 * (0.5 + 0.5 * Math.sin(t * 20))})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Lock-on arc
      if (d.lock > 0) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r * 1.35, -Math.PI / 2, -Math.PI / 2 + d.lock * Math.PI * 2);
        ctx.stroke();
      }
    }

    // Repulsor beams
    for (const b of this.beams) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life * 8);
      ctx.shadowColor = "rgba(120,230,255,1)";
      ctx.shadowBlur = 25;
      ctx.strokeStyle = "rgba(120,230,255,0.9)";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(b.a.x, b.a.y);
      ctx.lineTo(b.b.x, b.b.y);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // Particles
    for (const p of this.parts) {
      ctx.fillStyle = `rgba(${p.rgb},${p.life / p.max})`;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }

    // Floating score text
    ctx.textAlign = "center";
    ctx.font = mono(16 * Math.max(scale, 0.8), true);
    for (const f of this.floaters) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, f.life * 2)})`;
      ctx.fillText(f.text, f.x, f.y);
    }

    // Crosshair
    if (this.aim) {
      const { x, y } = this.aim;
      ctx.save();
      ctx.shadowColor = "rgba(63,216,255,1)";
      ctx.shadowBlur = 10;
      ctx.strokeStyle = "rgba(220,250,255,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = t * 2 + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18);
        ctx.lineTo(x + Math.cos(a) * 27, y + Math.sin(a) * 27);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      ctx.restore();
    }

    // Hit flash
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,30,50,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }

    // HUD
    const top = 78;
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(63,216,255,0.8)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#dff8ff";
    if (this.state === "playing") {
      ctx.font = mono(30, true);
      ctx.fillText(this.score.toLocaleString(), W / 2, top + 10);
      ctx.font = mono(12);
      ctx.fillStyle = "rgba(63,216,255,0.85)";
      ctx.fillText(`LEVEL ${this.level}   ·   COMBO x${this.combo}   ·   BEST ${this.best.toLocaleString()}`, W / 2, top + 32);
      // Hearts as mini reactors
      for (let i = 0; i < 3; i++) {
        const hx = W / 2 - 30 + i * 30;
        const hy = top + 54;
        const alive = i < this.hearts;
        ctx.strokeStyle = alive ? "rgba(63,216,255,0.9)" : "rgba(255,60,60,0.4)";
        ctx.fillStyle = alive ? "rgba(200,245,255,0.95)" : "rgba(0,0,0,0)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const over = this.state === "over";
      ctx.font = mono(Math.max(26, 44 * scale), true);
      ctx.fillStyle = over ? "#ff5a6e" : "#dff8ff";
      ctx.shadowColor = over ? "rgba(255,60,80,0.9)" : "rgba(63,216,255,0.9)";
      ctx.fillText(over ? "SUIT INTEGRITY FAILED" : "DRONE BLASTER", W / 2, H * 0.28);
      ctx.font = mono(14);
      ctx.fillStyle = "rgba(200,240,255,0.85)";
      if (over) {
        ctx.fillText(`SCORE ${this.score.toLocaleString()}   ·   BEST ${this.best.toLocaleString()}   ·   LEVEL ${this.level}`, W / 2, H * 0.28 + 34);
      } else {
        ctx.fillText("☝ point to aim  ·  hover a drone to lock on  ·  🤏 pinch to fire", W / 2, H * 0.28 + 34);
        ctx.fillText(`Don't let them reach you.   BEST ${this.best.toLocaleString()}`, W / 2, H * 0.28 + 56);
      }
      // Start / play again button (hover to press)
      const bx = W / 2;
      const by = H * 0.58;
      const r = Math.min(W, H) * 0.09;
      ctx.strokeStyle = "rgba(63,216,255,0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(bx, by, r, t, t + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (this.button > 0) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(bx, by, r, -Math.PI / 2, -Math.PI / 2 + Math.min(1, this.button) * Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = mono(15, true);
      ctx.fillStyle = "#fff";
      ctx.fillText(over ? "PLAY AGAIN" : "START", bx, by + 5);
      ctx.font = mono(11);
      ctx.fillStyle = "rgba(200,240,255,0.7)";
      ctx.fillText("point here and hold", bx, by + r + 22);
    }
    ctx.shadowBlur = 0;
  }

  private sound(kind: "fire" | "boom" | "hurt" | "clang" | "start" | "over") {
    try {
      this.audio ||= new AudioContext();
      const ac = this.audio;
      if (ac.state === "suspended") ac.resume();
      const now = ac.currentTime;
      const tone = (type: OscillatorType, f1: number, f2: number, dur: number, vol: number, delay = 0) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f1, now + delay);
        o.frequency.exponentialRampToValueAtTime(f2, now + delay + dur);
        g.gain.setValueAtTime(vol, now + delay);
        g.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
        o.connect(g).connect(ac.destination);
        o.start(now + delay);
        o.stop(now + delay + dur);
      };
      const noise = (dur: number, vol: number) => {
        const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = ac.createBufferSource();
        const g = ac.createGain();
        src.buffer = buf;
        g.gain.value = vol;
        src.connect(g).connect(ac.destination);
        src.start();
      };
      if (kind === "fire") tone("square", 1400, 300, 0.12, 0.05);
      if (kind === "boom") {
        tone("square", 1200, 200, 0.1, 0.05);
        noise(0.35, 0.25);
      }
      if (kind === "clang") tone("triangle", 900, 700, 0.15, 0.12);
      if (kind === "hurt") tone("sawtooth", 220, 60, 0.4, 0.15);
      if (kind === "start") [440, 660, 880].forEach((f, i) => tone("sine", f, f, 0.12, 0.1, i * 0.09));
      if (kind === "over") [440, 330, 220].forEach((f, i) => tone("sawtooth", f, f * 0.95, 0.25, 0.08, i * 0.2));
    } catch {}
  }
}
