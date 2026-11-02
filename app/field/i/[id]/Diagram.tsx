"use client";

// Scene diagram: pick a road layout, drag vehicles / people / the point of impact into place, turn them,
// label them. Saved as a picture (fingerprinted) for the report, plus the pieces so it can be edited later.

import { useRef, useState } from "react";
import { api } from "@/lib/proClient";
import type { DiagramEl, Incident } from "@/lib/field";

const W = 400;
const H = 300;
const COLORS = ["#3fd8ff", "#ffb547", "#4dff9a", "#ff5a6e", "#c49bff"];
const TEMPLATES: Record<string, string> = { cross: "4-way intersection", tee: "T intersection", straight: "Straight road", lot: "Parking lot" };

function Road({ t }: { t: string }) {
  const road = "#2a3644";
  const line = "#e8c95a";
  if (t === "lot")
    return (
      <g>
        <rect x={20} y={20} width={360} height={260} fill={road} />
        {Array.from({ length: 9 }, (_, n) => (
          <g key={n}>
            <line x1={40 + n * 40} y1={20} x2={40 + n * 40} y2={80} stroke="#fff" strokeWidth={2} />
            <line x1={40 + n * 40} y1={220} x2={40 + n * 40} y2={280} stroke="#fff" strokeWidth={2} />
          </g>
        ))}
      </g>
    );
  const h = <rect x={0} y={115} width={W} height={70} fill={road} />;
  const v = t === "tee" ? <rect x={165} y={185} width={70} height={115} fill={road} /> : <rect x={165} y={0} width={70} height={H} fill={road} />;
  return (
    <g>
      {h}
      {t !== "straight" && v}
      <line x1={0} y1={150} x2={t === "straight" ? W : 165} y2={150} stroke={line} strokeWidth={2} strokeDasharray="10 8" />
      {t !== "straight" && <line x1={235} y1={150} x2={W} y2={150} stroke={line} strokeWidth={2} strokeDasharray="10 8" />}
      {t === "cross" && <line x1={200} y1={0} x2={200} y2={115} stroke={line} strokeWidth={2} strokeDasharray="10 8" />}
      {t !== "straight" && <line x1={200} y1={185} x2={200} y2={H} stroke={line} strokeWidth={2} strokeDasharray="10 8" />}
    </g>
  );
}

function Piece({ e, selected }: { e: DiagramEl; selected: boolean }) {
  const sel = selected ? { stroke: "#fff", strokeWidth: 2 } : {};
  let body;
  if (e.kind === "car" || e.kind === "truck") {
    const L = e.kind === "truck" ? 46 : 34;
    const Wd = e.kind === "truck" ? 20 : 17;
    body = (
      <g>
        <rect x={-L / 2} y={-Wd / 2} width={L} height={Wd} rx={4} fill={e.color} {...sel} />
        <polygon points={`${L / 2 - 2},${-Wd / 2 + 3} ${L / 2 + 9},0 ${L / 2 - 2},${Wd / 2 - 3}`} fill="#fff" />
      </g>
    );
  } else if (e.kind === "person") body = <circle r={7} fill={e.color} {...sel} />;
  else if (e.kind === "impact")
    body = <polygon points="0,-13 4,-4 13,-5 6,2 10,12 0,6 -10,12 -6,2 -13,-5 -4,-4" fill="#ff5a6e" stroke={selected ? "#fff" : "#ffd34d"} strokeWidth={2} />;
  else body = <rect x={-3} y={-3} width={6} height={6} fill={selected ? "#fff" : "transparent"} />;
  return (
    <g transform={`translate(${e.x} ${e.y})`}>
      <g transform={`rotate(${e.rot})`}>{body}</g>
      {e.text && (
        <text y={e.kind === "label" ? 4 : -16} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke" fontFamily="system-ui">
          {e.text}
        </text>
      )}
    </g>
  );
}

export default function Diagram({ i, reload, setError }: { i: Incident; reload: () => void; setError: (s: string) => void }) {
  const [template, setTemplate] = useState(i.diagram?.template || "cross");
  const [els, setEls] = useState<DiagramEl[]>(i.diagram?.elements || []);
  const [sel, setSel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!i.diagram);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const locked = i.review.status === "approved" || i.review.status === "submitted";

  const pt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const change = (id: string, patch: Partial<DiagramEl>) => {
    setEls((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setSaved(false);
  };
  const add = (kind: DiagramEl["kind"]) => {
    const vehicles = els.filter((x) => x.kind === "car" || x.kind === "truck").length;
    const people = els.filter((x) => x.kind === "person").length;
    const e: DiagramEl = {
      id: Math.random().toString(36).slice(2, 8),
      kind,
      x: 60 + Math.random() * 60,
      y: 60 + Math.random() * 40,
      rot: 0,
      text: kind === "car" || kind === "truck" ? `V${vehicles + 1}` : kind === "person" ? `P${people + 1}` : kind === "impact" ? "Impact" : "Label",
      color: kind === "person" ? "#ffd34d" : COLORS[vehicles % COLORS.length],
    };
    setEls((l) => [...l, e]);
    setSel(e.id);
    setSaved(false);
  };
  const s = els.find((x) => x.id === sel);

  /** Render the SVG to a PNG for the report. */
  const toPng = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const clone = svg.current!.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("width", String(W * 2));
      clone.setAttribute("height", String(H * 2));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = W * 2;
        c.height = H * 2;
        c.getContext("2d")!.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = url;
    });

  const save = async () => {
    setSaving(true);
    const keep = sel;
    setSel(null);
    await new Promise((r) => setTimeout(r, 30)); // let the selection outline disappear before the snapshot
    try {
      await api(`/api/field/${i.id}/extras`, { method: "POST", body: JSON.stringify({ what: "diagram", template, elements: els, image: await toPng() }) });
      setSaved(true);
      reload();
    } catch (e) {
      setError((e as Error).message);
      setSel(keep);
    }
    setSaving(false);
  };

  return (
    <section className="card">
      <div className="row">
        <h3 style={{ flex: 1 }}>Scene diagram</h3>
        <select value={template} onChange={(e) => (setTemplate(e.target.value), setSaved(false))} disabled={locked}>
          {Object.entries(TEMPLATES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {!locked && (
        <div className="row">
          <button className="btn ghost" onClick={() => add("car")}>
            + Car
          </button>
          <button className="btn ghost" onClick={() => add("truck")}>
            + Truck
          </button>
          <button className="btn ghost" onClick={() => add("person")}>
            + Person
          </button>
          <button className="btn ghost" onClick={() => add("impact")}>
            + 💥 Impact
          </button>
          <button className="btn ghost" onClick={() => add("label")}>
            + Label
          </button>
        </div>
      )}
      <svg
        ref={svg}
        className="diagram"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = pt(e);
          change(drag.current.id, { x: Math.max(0, Math.min(W, p.x - drag.current.dx)), y: Math.max(0, Math.min(H, p.y - drag.current.dy)) });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerDown={(e) => e.target === svg.current && setSel(null)}
      >
        <rect width={W} height={H} fill="#1d4a2b" />
        <Road t={template} />
        <text x={W - 14} y={22} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff" fontFamily="system-ui">
          N ↑
        </text>
        {els.map((e) => (
          <g
            key={e.id}
            style={{ cursor: locked ? "default" : "grab" }}
            onPointerDown={(ev) => {
              if (locked) return;
              ev.stopPropagation();
              (ev.target as Element).setPointerCapture?.(ev.pointerId);
              const p = pt(ev);
              drag.current = { id: e.id, dx: p.x - e.x, dy: p.y - e.y };
              setSel(e.id);
            }}
          >
            <Piece e={e} selected={e.id === sel} />
          </g>
        ))}
      </svg>
      {s && !locked && (
        <div className="row">
          <input type="text" value={s.text} onChange={(e) => change(s.id, { text: e.target.value.slice(0, 40) })} style={{ flex: 1, minWidth: 120 }} placeholder="Label" />
          {s.kind !== "label" && s.kind !== "person" && (
            <>
              <button className="btn ghost" onClick={() => change(s.id, { rot: s.rot - 15 })} title="Turn left">
                ⟲
              </button>
              <button className="btn ghost" onClick={() => change(s.id, { rot: s.rot + 15 })} title="Turn right">
                ⟳
              </button>
            </>
          )}
          <button
            className="btn ghost"
            onClick={() => {
              setEls((l) => l.filter((x) => x.id !== s.id));
              setSel(null);
              setSaved(false);
            }}
          >
            Delete
          </button>
        </div>
      )}
      {!locked && (
        <div className="row">
          <button className="btn" onClick={save} disabled={saving || saved || !els.length}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save diagram"}
          </button>
          <span className="muted">Drag pieces to place them. The white arrow is the front of a vehicle. Not to scale.</span>
        </div>
      )}
    </section>
  );
}
