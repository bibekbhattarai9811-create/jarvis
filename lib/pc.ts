import { execFile } from "child_process";
import os from "os";
import type { Action } from "./brain";

const APPS: Record<string, string> = {
  chrome: "chrome",
  "google chrome": "chrome",
  edge: "msedge",
  "microsoft edge": "msedge",
  notepad: "notepad",
  calculator: "calc",
  calc: "calc",
  explorer: "explorer",
  "file explorer": "explorer",
  files: "explorer",
  settings: "ms-settings:",
  spotify: "spotify:",
  vscode: "code",
  "vs code": "code",
  "visual studio code": "code",
  word: "winword",
  excel: "excel",
  powerpoint: "powerpnt",
  terminal: "wt",
  "task manager": "taskmgr",
  paint: "mspaint",
  camera: "microsoft.windows.camera:",
  discord: "discord:",
  whatsapp: "whatsapp:",
};

// Virtual-key codes for WScript.Shell SendKeys.
const MEDIA: Record<string, { code: number; times: number }> = {
  play_pause: { code: 179, times: 1 },
  next: { code: 176, times: 1 },
  previous: { code: 177, times: 1 },
  volume_up: { code: 175, times: 5 },
  volume_down: { code: 174, times: 5 },
  mute: { code: 173, times: 1 },
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const BLOCKED_APPS = /powershell|command prompt|\bcmd\b|regedit|registry|\bwsl\b|bash|ubuntu|debian|kali|admin|policy|services|\brun\b|control panel|defender|security|firewall|recovery|disk|format|credential/i;

function psOut(command: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 15_000 }, (err, out) => resolve(err ? "" : String(out).trim()));
  });
}

function ps(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 15_000 }, (err) => (err ? reject(err) : resolve()));
  });
}

/** Run one PC action on this Windows machine. Returns an error message, or null on success. */
export async function runOnPc(a: Action): Promise<string | null> {
  if (process.platform !== "win32") return "PC control only works when Jarvis runs on Windows.";
  try {
    switch (a.type) {
      case "open_url":
        if (!/^https?:\/\//i.test(a.url)) return "Only web links can be opened.";
        await ps(`Start-Process ${q(a.url)}`);
        return null;
      case "open_app": {
        // Known apps, or an app from the Start menu by name. Never an arbitrary program, and never shells or
        // system tools, so a tricked reply can't launch something dangerous.
        const name = a.name.trim().toLowerCase();
        if (APPS[name]) {
          await ps(`Start-Process ${q(APPS[name])}`);
          return null;
        }
        if (!/^[\w .+-]{2,40}$/.test(name) || BLOCKED_APPS.test(name)) return `I can't open "${a.name}".`;
        const id = await psOut(`(Get-StartApps | Where-Object { $_.Name -like ${q(`*${name}*`)} } | Select-Object -First 1).AppID`);
        if (!id || BLOCKED_APPS.test(id)) return `I couldn't find ${a.name} on your PC.`;
        await ps(`Start-Process ${q(`shell:AppsFolder\\${id}`)}`);
        return null;
      }
      case "media": {
        const m = MEDIA[a.key];
        if (!m) return `Unknown media key ${a.key}.`;
        await ps(`$s = New-Object -ComObject WScript.Shell; 1..${m.times} | % { $s.SendKeys([char]${m.code}) }`);
        return null;
      }
      case "set_volume": {
        // The level may come from Claude's JSON: only a real number reaches PowerShell.
        if (!Number.isFinite(Number(a.level))) return "I didn't catch a volume level.";
        const lvl = Math.max(0, Math.min(100, Math.round(Number(a.level))));
        const steps = Math.round(lvl / 2);
        await ps(`$s = New-Object -ComObject WScript.Shell; 1..50 | % { $s.SendKeys([char]174) }; if (${steps} -gt 0) { 1..${steps} | % { $s.SendKeys([char]175) } }`);
        return null;
      }
      case "lock_pc":
        await ps("rundll32.exe user32.dll,LockWorkStation");
        return null;
      default:
        return null;
    }
  } catch {
    return a.type === "open_app" ? `I couldn't find ${a.name} on your PC.` : "That PC command failed.";
  }
}

let cachedBattery: { pct: number | null; charging: boolean; at: number } = { pct: null, charging: false, at: 0 };

export async function getPcStats() {
  const cpus = os.cpus();
  let busy = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    const all = t.user + t.nice + t.sys + t.irq + t.idle;
    total += all;
    busy += all - t.idle;
  }
  const cpu = total > 0 ? Math.round((busy / total) * 100) : 0;
  const totalMem = os.totalmem();
  const usedMem = totalMem - os.freemem();
  const memPct = Math.round((usedMem / totalMem) * 100);
  const memUsedGb = Math.round((usedMem / 1024 ** 3) * 10) / 10;
  const memTotalGb = Math.round((totalMem / 1024 ** 3) * 10) / 10;
  const uptimeHours = Math.round((os.uptime() / 3600) * 10) / 10;

  if (process.platform === "win32" && Date.now() - cachedBattery.at > 30_000) {
    cachedBattery.at = Date.now();
    const out = await psOut("$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if ($b) { \"$($b.EstimatedChargeRemaining),$($b.BatteryStatus)\" }");
    if (out) {
      const [p, st] = out.split(",");
      cachedBattery.pct = Number(p) || null;
      cachedBattery.charging = Number(st) === 2;
    }
  }

  return { cpu, memPct, memUsedGb, memTotalGb, uptimeHours, battery: cachedBattery.pct, charging: cachedBattery.charging };
}

export async function pcStatusLine(): Promise<string> {
  const s = await getPcStats();
  const bat = s.battery !== null ? ` Battery is at ${s.battery} percent${s.charging ? " and charging" : ""}.` : "";
  return `All systems nominal, sir. CPU averages ${s.cpu} percent, memory is at ${s.memPct} percent (${s.memUsedGb} of ${s.memTotalGb} gigabytes), and your PC has been up for ${s.uptimeHours} hours.${bat}`;
}
