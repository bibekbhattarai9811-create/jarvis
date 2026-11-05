// Drone Blaster: aim with your index finger (or mouse/touch), hover to lock on, pinch/click to fire.
// Open your palm (✋) or press Space when the Unibeam meter is full to vaporize every drone on screen!

type Pt = { x: number; y: number };
type Kind = "basic" | "fast" | "armor" | "emp" | "supply" | "boss";
type Drone = {
  x: number;
  y: number;
  z: number;
  time: number;
  kind: Kind;
  hp: number;
  maxHp: number;
  lock: number;
  spin: number;
  drift: number;
  summonIn?: number;
};
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; rgb: string; size?: number };
type Ring = { x: number; y: number; r: number; maxR: number; life: number; max: number; rgb: string };
type Floater = { x: number; y: number; text: string; life: number; rgb?: string; big?: boolean };
type Beam = { a: Pt; b: Pt; life: number; rgb?: string; wide?: boolean };

const KINDS: Record<Kind, { rgb: string; points: number; hp: number; speed: number }> = {
  basic: { rgb: "255,70,120", points: 100, hp: 1, speed: 1 },
  fast: { rgb: "255,181,71", points: 200, hp: 1, speed: 0.6 },
  armor: { rgb: "180,120,255", points: 300, hp: 2, speed: 1.25 },
  emp: { rgb: "63,216,255", points: 250, hp: 1, speed: 0.95 },
  supply: { rgb: "77,255,154", points: 150, hp: 1, speed: 0.9 },
  boss: { rgb: "255,50,70", points: 1200, hp: 8, speed: 2.4 },
};
const LOCK_SECONDS = 0.4;
const BUTTON_SECONDS = 0.9;

export class DroneGame {
  state: "ready" | "playing" | "over" = "ready";
  score = 0;
  best = 0;
  hearts = 3;
  maxHearts = 4;
  level = 1;
  kills = 0;
  combo = 1;
  energy = 0; // 0..100 for Chest Unibeam
  overdriveUntil = 0;
  private lastKill = 0;
  private lastBossLevel = 0;
  private drones: Drone[] = [];
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private floaters: Floater[] = [];
  private beams: Beam[] = [];
  private spawnIn = 1;
  private flash = 0;
  private flashRgb = "255,30,50";
  private shakeAmt = 0;
  private button = 0; // hover progress on START / PLAY AGAIN
  private overAt = 0;
  private aim: Pt | null = null;
  private banner: { text: string; rgb: string; until: number } | null = null;
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
    this.energy = 25;
    this.overdriveUntil = 0;
    this.lastBossLevel = 0;
    this.drones = [];
    this.rings = [];
    this.spawnIn = 0.8;
    this.button = 0;
    this.banner = { text: "WEAPONS ONLINE · PROTECT THE SUIT", rgb: "63,216,255", until: performance.now() + 2000 };
    this.sound("start");
  }

  update(dt: number, now: number, W: number, H: number, aim: Pt | null, fire: boolean, origin: Pt | null, special = false) {
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
    for (const r of this.rings) {
      r.life -= dt;
      r.r = r.maxR * (1 - r.life / r.max);
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const f of this.floaters) {
      f.y -= (f.big ? 55 : 40) * dt;
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
    if (now - this.lastKill > 2800) this.combo = 1;
    const overdrive = now < this.overdriveUntil;

    // Trigger Chest Unibeam when energy is full and player opens palm (or presses Space)
    if (special && this.energy >= 100 && this.drones.length > 0) {
      this.fireUnibeam(now, W, H);
    }

    // Boss wave every 3 levels (level 3, 6, 9, ...)
    if (this.level >= 3 && this.level % 3 === 0 && this.lastBossLevel !== this.level) {
      this.lastBossLevel = this.level;
      const k = KINDS.boss;
      const bossHp = k.hp + Math.floor(this.level * 1.2);
      this.drones.push({
        x: W * (0.3 + Math.random() * 0.4),
        y: H * 0.28,
        z: 0.05,
        time: Math.max(8, 13 - this.level * 0.3),
        kind: "boss",
        hp: bossHp,
        maxHp: bossHp,
        lock: 0,
        spin: 0,
        drift: 22,
        summonIn: 2.6,
      });
      this.banner = { text: "⚠ DREADNOUGHT CARRIER DETECTED", rgb: "255,70,90", until: now + 2600 };
      this.sound("boss");
    }

    // Spawning
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = Math.max(0.35, 1.55 - this.level * 0.11) * (0.7 + Math.random() * 0.6);
      const roll = Math.random();
      let kind: Kind = "basic";
      if (roll < 0.08) kind = "supply";
      else if (roll < 0.18) kind = "emp";
      else if (this.level >= 3 && roll < 0.38) kind = "armor";
      else if (this.level >= 2 && roll < 0.62) kind = "fast";
      const k = KINDS[kind];
      const m = Math.min(W, H) * 0.12;
      this.drones.push({
        x: m + Math.random() * (W - 2 * m),
        y: H * 0.18 + Math.random() * (H * 0.55),
        z: 0,
        time: Math.max(2, 6 - this.level * 0.32) * k.speed,
        kind,
        hp: k.hp,
        maxHp: k.hp,
        lock: 0,
        spin: Math.random() * 6,
        drift: (Math.random() - 0.5) * (kind === "fast" ? 55 : 32),
      });
    }

    const scale = Math.min(W, H) / 700;
    const lockTime = overdrive ? LOCK_SECONDS * 0.42 : LOCK_SECONDS;

    for (const d of this.drones) {
      d.z += dt / d.time;
      d.spin += dt * (d.kind === "fast" ? 5.5 : d.kind === "boss" ? 1.2 : 2.2);
      d.x += d.drift * dt;
      if (d.x < W * 0.1 || d.x > W * 0.9) d.drift = -d.drift;
      d.y += Math.sin(d.spin) * (d.kind === "boss" ? 6 : 12) * dt;

      // Boss periodically deploys mini fast drones
      if (d.kind === "boss" && d.summonIn !== undefined) {
        d.summonIn -= dt;
        if (d.summonIn <= 0 && this.drones.length < 12) {
          d.summonIn = 2.8;
          this.drones.push({
            x: d.x + (Math.random() - 0.5) * 80,
            y: d.y + (Math.random() - 0.5) * 50,
            z: Math.min(0.65, d.z + 0.05),
            time: 3.5,
            kind: "fast",
            hp: 1,
            maxHp: 1,
            lock: 0,
            spin: Math.random() * 6,
            drift: (Math.random() - 0.5) * 65,
          });
        }
      }

      const baseR = d.kind === "boss" ? 26 + d.z * 85 : 10 + d.z * 55;
      const r = baseR * scale;
      const hovered = aim && Math.hypot(aim.x - d.x, aim.y - d.y) < r * 1.2 + 12;
      d.lock = hovered ? d.lock + dt / lockTime : Math.max(0, d.lock - dt * 3);
      if (d.lock >= 1 || (fire && hovered)) {
        d.lock = 0;
        this.hit(d, now, origin ?? { x: W / 2, y: H }, W, H);
        fire = false; // one shot per pinch
      }
    }
    if (fire && aim) {
      // Missed shot: still draw a beam.
      this.beams.push({ a: origin ?? { x: W / 2, y: H }, b: aim, life: 0.12, rgb: overdrive ? "255,215,90" : "120,230,255" });
      this.sound("fire");
    }

    // Drones that reach you
    for (const d of this.drones) {
      if (d.z >= 1 && d.hp > 0) {
        d.hp = 0;
        if (d.kind === "supply") {
          // Supply pods harmlessly expire if not shot in time
          this.floaters.push({ x: d.x, y: d.y, text: "POD MISSED", life: 0.8, rgb: "150,200,180" });
          continue;
        }
        this.hearts -= d.kind === "boss" ? 2 : 1;
        this.combo = 1;
        this.flashRgb = "255,30,50";
        this.flash = 1;
        this.shakeAmt = 28;
        this.burst(d.x, d.y, "255,60,60", 30);
        this.sound("hurt");
        navigator.vibrate?.(200);
        if (this.hearts <= 0) {
          this.hearts = 0;
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

  private fireUnibeam(now: number, W: number, H: number) {
    this.energy = 0;
    this.flashRgb = "63,216,255";
    this.flash = 0.9;
    this.shakeAmt = 34;
    const center = { x: W / 2, y: H * 0.88 };
    this.rings.push({ x: W / 2, y: H / 2, r: 10, maxR: Math.max(W, H) * 0.7, life: 0.55, max: 0.55, rgb: "63,216,255" });
    for (const d of this.drones) {
      this.beams.push({ a: center, b: { x: d.x, y: d.y }, life: 0.35, rgb: "63,216,255", wide: true });
      d.hp = 0;
      const k = KINDS[d.kind];
      this.score += k.points * this.combo;
      this.kills++;
      this.burst(d.x, d.y, k.rgb, 24);
      this.rings.push({ x: d.x, y: d.y, r: 5, maxR: 90, life: 0.4, max: 0.4, rgb: k.rgb });
    }
    this.level = 1 + Math.floor(this.kills / 10);
    this.banner = { text: "⚡ UNIBEAM FIRED · SKY CLEARED!", rgb: "63,216,255", until: now + 2200 };
    this.sound("unibeam");
  }

  private hit(d: Drone, now: number, origin: Pt, W: number, H: number) {
    const overdrive = now < this.overdriveUntil;
    this.beams.push({
      a: origin,
      b: { x: d.x, y: d.y },
      life: 0.16,
      rgb: overdrive ? "255,210,80" : "120,230,255",
      wide: overdrive,
    });
    d.hp -= overdrive ? 2 : 1;
    const k = KINDS[d.kind];
    if (d.hp > 0) {
      this.burst(d.x, d.y, k.rgb, 10);
      this.sound("clang");
      return;
    }

    this.combo = now - this.lastKill < 2800 ? Math.min(this.combo + 1, 10) : 1;
    this.lastKill = now;
    const pts = k.points * this.combo;
    this.score += pts;
    this.kills++;
    this.level = 1 + Math.floor(this.kills / 10);
    this.energy = Math.min(100, this.energy + (d.kind === "boss" ? 50 : 14));

    this.floaters.push({
      x: d.x,
      y: d.y,
      text: `+${pts}${this.combo > 1 ? ` x${this.combo}` : ""}`,
      life: 0.95,
      rgb: k.rgb,
      big: d.kind === "boss" || this.combo >= 5,
    });
    this.burst(d.x, d.y, k.rgb, d.kind === "boss" ? 65 : 28);
    this.burst(d.x, d.y, "200,245,255", 12);
    this.rings.push({ x: d.x, y: d.y, r: 6, maxR: d.kind === "boss" ? 180 : 75, life: 0.38, max: 0.38, rgb: k.rgb });
    this.shakeAmt = Math.max(this.shakeAmt, d.kind === "boss" ? 26 : 7);

    // Special drone effects
    if (d.kind === "emp") {
      // Chain lightning to all nearby drones!
      let chained = 0;
      for (const other of this.drones) {
        if (other !== d && other.hp > 0 && Math.hypot(other.x - d.x, other.y - d.y) < Math.min(W, H) * 0.42) {
          this.beams.push({ a: { x: d.x, y: d.y }, b: { x: other.x, y: other.y }, life: 0.25, rgb: "63,216,255", wide: true });
          other.hp -= 2;
          this.burst(other.x, other.y, "63,216,255", 18);
          if (other.hp <= 0) {
            this.score += KINDS[other.kind].points * this.combo;
            this.kills++;
            chained++;
          }
        }
      }
      this.rings.push({ x: d.x, y: d.y, r: 10, maxR: Math.min(W, H) * 0.42, life: 0.45, max: 0.45, rgb: "63,216,255" });
      this.floaters.push({ x: d.x, y: d.y - 24, text: chained ? `⚡ EMP CHAIN x${chained + 1}!` : "⚡ EMP SHOCKWAVE!", life: 1.1, rgb: "63,216,255", big: true });
      this.sound("emp");
      return;
    }

    if (d.kind === "supply") {
      if (this.hearts < this.maxHearts) {
        this.hearts++;
        this.floaters.push({ x: d.x, y: d.y - 22, text: "💚 SUIT REPAIRED +1", life: 1.2, rgb: "77,255,154", big: true });
      } else {
        this.overdriveUntil = Math.max(now, this.overdriveUntil) + 6000;
        this.floaters.push({ x: d.x, y: d.y - 22, text: "🔥 RAPID OVERDRIVE 6s!", life: 1.2, rgb: "255,215,90", big: true });
      }
      this.energy = Math.min(100, this.energy + 25);
      this.sound("powerup");
      return;
    }

    if (d.kind === "boss") {
      this.overdriveUntil = Math.max(now, this.overdriveUntil) + 5000;
      this.banner = { text: "💥 DREADNOUGHT DESTROYED · OVERDRIVE ENGAGED!", rgb: "255,210,80", until: now + 2400 };
    } else if (this.combo === 5) {
      this.overdriveUntil = Math.max(now, this.overdriveUntil) + 4500;
      this.banner = { text: "🔥 5x STREAK · OVERDRIVE LOCK-ON!", rgb: "255,210,80", until: now + 1800 };
    }

    this.sound("boom");
  }

  private burst(x: number, y: number, rgb: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 340;
      const life = 0.4 + Math.random() * 0.55;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life, max: life, rgb, size: Math.random() < 0.3 ? 5 : 3.5 });
    }
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
    const scale = Math.min(W, H) / 700;
    const nowMs = t * 1000;
    const overdrive = nowMs < this.overdriveUntil;
    const mono = (px: number, bold = false) => `${bold ? "bold " : ""}${Math.round(px)}px Consolas, 'Courier New', monospace`;

    // Expanding shockwave rings
    for (const r of this.rings) {
      ctx.save();
      ctx.strokeStyle = `rgba(${r.rgb},${Math.max(0, r.life / r.max)})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = `rgba(${r.rgb},0.9)`;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Drones
    for (const d of this.drones) {
      const k = KINDS[d.kind];
      const baseR = d.kind === "boss" ? 26 + d.z * 85 : 10 + d.z * 55;
      const r = baseR * scale;
      const c = (a: number) => `rgba(${k.rgb},${a})`;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.shadowColor = c(1);
      ctx.shadowBlur = d.kind === "boss" ? 24 : 16;
      ctx.strokeStyle = c(0.95);
      ctx.lineWidth = d.kind === "boss" ? 3 : 2;
      ctx.rotate(d.spin * 0.5);

      if (d.kind === "supply") {
        // Green repair cross / pod
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = c(0.2);
        ctx.fill();
        ctx.rotate(-d.spin * 0.5);
        ctx.fillStyle = "#fff";
        ctx.fillRect(-r * 0.35, -r * 0.1, r * 0.7, r * 0.2);
        ctx.fillRect(-r * 0.1, -r * 0.35, r * 0.2, r * 0.7);
      } else if (d.kind === "emp") {
        // Electric octagon EMP orb
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const rad = i % 2 === 0 ? r * 1.05 : r * 0.68;
          ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = c(0.22);
        ctx.fill();
      } else {
        // Standard / Fast / Armor / Boss diamond chassis
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * (d.kind === "boss" ? 1.1 : 0.75), 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * (d.kind === "boss" ? 1.1 : 0.75), 0);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = c(0.16);
        ctx.fill();
        ctx.rotate(-d.spin);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
        }
        ctx.closePath();
        ctx.stroke();
      }

      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(2, r * 0.13), 0, Math.PI * 2);
      ctx.fill();

      if (d.kind === "armor" || d.kind === "boss") {
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

      // Boss HP bar
      if (d.kind === "boss") {
        const bw = r * 1.8;
        const bx = d.x - bw / 2;
        const by = d.y - r * 1.42;
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(bx, by, bw, 6);
        ctx.fillStyle = "#ff465a";
        ctx.fillRect(bx, by, bw * Math.max(0, d.hp / d.maxHp), 6);
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, 6);
      }

      // Danger ring as it gets close
      if (d.z > 0.7 && d.kind !== "supply") {
        ctx.strokeStyle = `rgba(255,60,60,${(d.z - 0.7) * 2.5 * (0.5 + 0.5 * Math.sin(t * 20))})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Lock-on arc
      if (d.lock > 0) {
        ctx.strokeStyle = overdrive ? "#ffd85a" : "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r * 1.35, -Math.PI / 2, -Math.PI / 2 + d.lock * Math.PI * 2);
        ctx.stroke();
      }
    }

    // Repulsor beams
    for (const b of this.beams) {
      const rgb = b.rgb || "120,230,255";
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life * 8);
      ctx.shadowColor = `rgba(${rgb},1)`;
      ctx.shadowBlur = b.wide ? 32 : 25;
      ctx.strokeStyle = `rgba(${rgb},0.92)`;
      ctx.lineWidth = b.wide ? 16 : 10;
      ctx.beginPath();
      ctx.moveTo(b.a.x, b.a.y);
      ctx.lineTo(b.b.x, b.b.y);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = b.wide ? 5 : 3;
      ctx.stroke();
      ctx.restore();
    }

    // Particles
    for (const p of this.parts) {
      const sz = p.size || 4;
      ctx.fillStyle = `rgba(${p.rgb},${p.life / p.max})`;
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }

    // Floating score & callout text
    ctx.textAlign = "center";
    for (const f of this.floaters) {
      ctx.font = mono((f.big ? 20 : 16) * Math.max(scale, 0.8), true);
      ctx.fillStyle = f.rgb ? `rgba(${f.rgb},${Math.min(1, f.life * 2)})` : `rgba(255,255,255,${Math.min(1, f.life * 2)})`;
      ctx.fillText(f.text, f.x, f.y);
    }

    // Crosshair
    if (this.aim) {
      const { x, y } = this.aim;
      ctx.save();
      ctx.shadowColor = overdrive ? "rgba(255,210,80,1)" : "rgba(63,216,255,1)";
      ctx.shadowBlur = 12;
      ctx.strokeStyle = overdrive ? "rgba(255,230,120,0.98)" : "rgba(220,250,255,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, overdrive ? 18 : 14, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = t * (overdrive ? 4.5 : 2) + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18);
        ctx.lineTo(x + Math.cos(a) * 28, y + Math.sin(a) * 28);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      ctx.restore();
    }

    // Screen flash (damage or Unibeam)
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashRgb},${this.flash * 0.35})`;
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
      ctx.fillStyle = overdrive ? "#ffd85a" : "rgba(63,216,255,0.88)";
      ctx.fillText(
        `LEVEL ${this.level}   ·   COMBO x${this.combo}${overdrive ? " (OVERDRIVE!)" : ""}   ·   BEST ${this.best.toLocaleString()}`,
        W / 2,
        top + 32
      );
      // Hearts as mini reactors
      for (let i = 0; i < this.maxHearts; i++) {
        const hx = W / 2 - ((this.maxHearts - 1) * 14) + i * 28;
        const hy = top + 52;
        const alive = i < this.hearts;
        ctx.strokeStyle = alive ? "rgba(63,216,255,0.9)" : "rgba(255,60,60,0.35)";
        ctx.fillStyle = alive ? "rgba(200,245,255,0.95)" : "rgba(0,0,0,0)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 7.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Unibeam Super Meter
      const mw = Math.min(240, W * 0.45);
      const mx = W / 2 - mw / 2;
      const my = top + 70;
      const ready = this.energy >= 100;
      ctx.fillStyle = "rgba(5,20,35,0.75)";
      ctx.fillRect(mx, my, mw, 7);
      ctx.fillStyle = ready ? (Math.sin(t * 12) > 0 ? "#ffffff" : "#3fd8ff") : "rgba(63,216,255,0.85)";
      ctx.fillRect(mx, my, mw * (this.energy / 100), 7);
      ctx.strokeStyle = "rgba(63,216,255,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(mx, my, mw, 7);
      if (ready) {
        ctx.font = mono(11, true);
        ctx.fillStyle = "#ffffff";
        ctx.fillText("⚡ UNIBEAM READY — OPEN PALM ✋ OR PRESS SPACE!", W / 2, my + 22);
      }

      // Tactical Banner
      if (this.banner && this.banner.until > nowMs) {
        ctx.font = mono(15 * Math.max(scale, 0.85), true);
        ctx.fillStyle = `rgb(${this.banner.rgb})`;
        ctx.shadowColor = `rgba(${this.banner.rgb},0.9)`;
        ctx.fillText(this.banner.text, W / 2, H * 0.22);
      }
    } else {
      const over = this.state === "over";
      ctx.font = mono(Math.max(26, 44 * scale), true);
      ctx.fillStyle = over ? "#ff5a6e" : "#dff8ff";
      ctx.shadowColor = over ? "rgba(255,60,80,0.9)" : "rgba(63,216,255,0.9)";
      ctx.fillText(over ? "SUIT INTEGRITY FAILED" : "DRONE BLASTER", W / 2, H * 0.26);
      ctx.font = mono(13);
      ctx.fillStyle = "rgba(200,240,255,0.88)";
      if (over) {
        ctx.fillText(`SCORE ${this.score.toLocaleString()}   ·   BEST ${this.best.toLocaleString()}   ·   LEVEL ${this.level}`, W / 2, H * 0.26 + 34);
      } else {
        ctx.fillText("☝ point to aim  ·  hover to lock on  ·  🤏 pinch to fire  ·  ✋ open palm = UNIBEAM", W / 2, H * 0.26 + 34);
        ctx.fillText(`⚡ Blue = EMP chain   ·   💚 Green = Repair / Overdrive   ·   BEST ${this.best.toLocaleString()}`, W / 2, H * 0.26 + 56);
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

  private sound(kind: "fire" | "boom" | "hurt" | "clang" | "start" | "over" | "emp" | "powerup" | "unibeam" | "boss") {
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
      if (kind === "emp") {
        tone("sawtooth", 1800, 180, 0.28, 0.12);
        tone("sine", 900, 1600, 0.2, 0.08, 0.05);
        noise(0.4, 0.28);
      }
      if (kind === "powerup") {
        [523, 659, 784, 1046].forEach((f, i) => tone("sine", f, f * 1.05, 0.12, 0.1, i * 0.06));
      }
      if (kind === "unibeam") {
        tone("sawtooth", 220, 1200, 0.2, 0.14);
        tone("square", 880, 110, 0.55, 0.15, 0.1);
        noise(0.65, 0.35);
      }
      if (kind === "boss") {
        [180, 140, 110].forEach((f, i) => tone("sawtooth", f, f * 0.85, 0.28, 0.12, i * 0.22));
      }
      if (kind === "clang") tone("triangle", 900, 700, 0.15, 0.12);
      if (kind === "hurt") tone("sawtooth", 220, 60, 0.4, 0.15);
      if (kind === "start") [440, 660, 880].forEach((f, i) => tone("sine", f, f, 0.12, 0.1, i * 0.09));
      if (kind === "over") [440, 330, 220].forEach((f, i) => tone("sawtooth", f, f * 0.95, 0.25, 0.08, i * 0.2));
    } catch {}
  }
}
