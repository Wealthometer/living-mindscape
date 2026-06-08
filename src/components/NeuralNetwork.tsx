import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Sparkles, Trash2, Link2, X } from "lucide-react";

type Neuron = {
  id: string;
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  createdAt: number;
  activations: number;
};

type Synapse = {
  id: string;
  a: string;
  b: string;
  strength: number; // 1..n
  lastFired: number;
};

type Brain = { neurons: Neuron[]; synapses: Synapse[] };

const STORAGE_KEY = "living-neural-network-v1";

const loadBrain = (): Brain => {
  if (typeof window === "undefined") return { neurons: [], synapses: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { neurons: [], synapses: [] };
    return JSON.parse(raw);
  } catch {
    return { neurons: [], synapses: [] };
  }
};

const saveBrain = (b: Brain) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(b)); } catch {}
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function NeuralNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const brainRef = useRef<Brain>({ neurons: [], synapses: [] });
  const [, forceTick] = useState(0);
  const rerender = useCallback(() => forceTick((n) => n + 1), []);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pulse, setPulse] = useState<{ from: string; to: string; t: number }[]>([]);
  const draggingRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const mountedRef = useRef(false);

  // Initial load
  useEffect(() => {
    brainRef.current = loadBrain();
    // ensure positions exist
    const c = containerRef.current;
    if (c) {
      const w = c.clientWidth, h = c.clientHeight;
      brainRef.current.neurons.forEach((n) => {
        if (!isFinite(n.x)) n.x = w / 2;
        if (!isFinite(n.y)) n.y = h / 2;
        n.vx = 0; n.vy = 0;
      });
    }
    mountedRef.current = true;
    rerender();
  }, [rerender]);

  // Persistence
  useEffect(() => {
    if (!mountedRef.current) return;
    const t = setInterval(() => saveBrain(brainRef.current), 1500);
    return () => clearInterval(t);
  }, []);

  // Physics + render loop
  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const c = containerRef.current!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = c.clientWidth * dpr;
      canvas.height = c.clientHeight * dpr;
      canvas.style.width = c.clientWidth + "px";
      canvas.style.height = c.clientHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const step = () => {
      const c = containerRef.current!;
      const w = c.clientWidth, h = c.clientHeight;
      const { neurons, synapses } = brainRef.current;

      // forces
      for (const n of neurons) {
        if (draggingRef.current?.id === n.id) continue;
        // repulsion
        for (const m of neurons) {
          if (m.id === n.id) continue;
          const dx = n.x - m.x, dy = n.y - m.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const f = 1800 / d2;
          n.vx += (dx / Math.sqrt(d2)) * f;
          n.vy += (dy / Math.sqrt(d2)) * f;
        }
        // weak centering
        n.vx += (w / 2 - n.x) * 0.0008;
        n.vy += (h / 2 - n.y) * 0.0008;
      }
      // spring along synapses
      for (const s of synapses) {
        const a = neurons.find((x) => x.id === s.a);
        const b = neurons.find((x) => x.id === s.b);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const rest = 140;
        const k = 0.002 + Math.min(s.strength, 10) * 0.0008;
        const f = (d - rest) * k;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        if (draggingRef.current?.id !== a.id) { a.vx += fx; a.vy += fy; }
        if (draggingRef.current?.id !== b.id) { b.vx -= fx; b.vy -= fy; }
      }
      // integrate
      for (const n of neurons) {
        if (draggingRef.current?.id === n.id) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
        const pad = 40;
        n.x = Math.max(pad, Math.min(w - pad, n.x));
        n.y = Math.max(pad, Math.min(h - pad, n.y));
      }

      // draw
      ctx.clearRect(0, 0, w, h);

      // synapses
      const now = Date.now();
      for (const s of synapses) {
        const a = neurons.find((x) => x.id === s.a);
        const b = neurons.find((x) => x.id === s.b);
        if (!a || !b) continue;
        const thickness = Math.min(0.6 + s.strength * 0.5, 5);
        const recent = Math.max(0, 1 - (now - s.lastFired) / 1500);
        ctx.strokeStyle = `oklch(0.78 0.16 180 / ${0.18 + Math.min(s.strength, 8) * 0.06})`;
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (recent > 0) {
          ctx.strokeStyle = `oklch(0.72 0.18 30 / ${recent})`;
          ctx.lineWidth = thickness + 1.5;
          ctx.stroke();
        }
      }

      // pulses traveling
      const stillPulse: typeof pulse = [];
      for (const p of pulse) {
        const a = neurons.find((x) => x.id === p.from);
        const b = neurons.find((x) => x.id === p.to);
        if (!a || !b) continue;
        const t = p.t + 0.04;
        if (t < 1) stillPulse.push({ ...p, t });
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        ctx.fillStyle = "oklch(0.72 0.18 30 / 0.95)";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (stillPulse.length !== pulse.length) setPulse(stillPulse);

      // neurons
      for (const n of neurons) {
        const age = (now - n.createdAt) / 1000;
        const baseR = 8 + Math.min(n.activations, 12) * 1.2 + Math.min(age / 30, 6);
        const isSel = selected === n.id;
        const isHov = hover === n.id;
        const isLink = linking === n.id;

        // glow
        const grad = ctx.createRadialGradient(n.x, n.y, 1, n.x, n.y, baseR * 3);
        grad.addColorStop(0, "oklch(0.78 0.16 180 / 0.45)");
        grad.addColorStop(1, "oklch(0.78 0.16 180 / 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, baseR * 3, 0, Math.PI * 2);
        ctx.fill();

        // core
        ctx.fillStyle = isLink ? "oklch(0.72 0.18 30)" : "oklch(0.85 0.14 180)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, baseR, 0, Math.PI * 2);
        ctx.fill();

        if (isSel || isHov || isLink) {
          ctx.strokeStyle = "oklch(0.95 0.01 250 / 0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(n.x, n.y, baseR + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (isHov || isSel) {
          ctx.fillStyle = "oklch(0.95 0.01 250)";
          ctx.font = "500 13px 'Space Grotesk', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(n.text.slice(0, 40), n.x, n.y - baseR - 10);
        }
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [selected, hover, linking, pulse]);

  // hit testing helpers
  const hitTest = (x: number, y: number) => {
    const { neurons } = brainRef.current;
    for (let i = neurons.length - 1; i >= 0; i--) {
      const n = neurons[i];
      const age = (Date.now() - n.createdAt) / 1000;
      const r = 8 + Math.min(n.activations, 12) * 1.2 + Math.min(age / 30, 6) + 4;
      const dx = x - n.x, dy = y - n.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hit = hitTest(x, y);
    if (hit) {
      if (linking && linking !== hit.id) {
        // create / strengthen synapse
        const b = brainRef.current;
        let s = b.synapses.find(
          (s) => (s.a === linking && s.b === hit.id) || (s.b === linking && s.a === hit.id)
        );
        if (s) { s.strength += 1; s.lastFired = Date.now(); }
        else {
          b.synapses.push({ id: uid(), a: linking, b: hit.id, strength: 1, lastFired: Date.now() });
        }
        const from = b.neurons.find((n) => n.id === linking)!;
        const to = b.neurons.find((n) => n.id === hit.id)!;
        from.activations += 1; to.activations += 1;
        setPulse((p) => [...p, { from: from.id, to: to.id, t: 0 }]);
        setLinking(null);
        setSelected(hit.id);
        saveBrain(b);
        rerender();
        return;
      }
      setSelected(hit.id);
      // fire — activate neighbors
      hit.activations += 1;
      const b = brainRef.current;
      const neighbors = b.synapses.filter((s) => s.a === hit.id || s.b === hit.id);
      const now = Date.now();
      const newPulses = neighbors.map((s) => {
        s.lastFired = now;
        const otherId = s.a === hit.id ? s.b : s.a;
        return { from: hit.id, to: otherId, t: 0 };
      });
      if (newPulses.length) setPulse((p) => [...p, ...newPulses]);
      draggingRef.current = { id: hit.id, ox: x - hit.x, oy: y - hit.y };
      rerender();
    } else {
      setSelected(null);
      setLinking(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (draggingRef.current) {
      const n = brainRef.current.neurons.find((n) => n.id === draggingRef.current!.id);
      if (n) { n.x = x - draggingRef.current.ox; n.y = y - draggingRef.current.oy; }
    } else {
      const hit = hitTest(x, y);
      setHover(hit?.id ?? null);
    }
  };

  const onPointerUp = () => {
    if (draggingRef.current) { draggingRef.current = null; saveBrain(brainRef.current); }
  };

  const addNeuron = () => {
    const text = draft.trim();
    if (!text) return;
    const c = containerRef.current!;
    const w = c.clientWidth, h = c.clientHeight;
    const angle = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 100;
    const n: Neuron = {
      id: uid(),
      text,
      x: w / 2 + Math.cos(angle) * r,
      y: h / 2 + Math.sin(angle) * r,
      vx: 0, vy: 0,
      createdAt: Date.now(),
      activations: 0,
    };
    brainRef.current.neurons.push(n);
    saveBrain(brainRef.current);
    setDraft("");
    setAdding(false);
    setSelected(n.id);
    rerender();
  };

  const removeNeuron = (id: string) => {
    const b = brainRef.current;
    b.neurons = b.neurons.filter((n) => n.id !== id);
    b.synapses = b.synapses.filter((s) => s.a !== id && s.b !== id);
    saveBrain(b);
    setSelected(null);
    rerender();
  };

  const clearAll = () => {
    if (!confirm("Erase the entire network? This cannot be undone.")) return;
    brainRef.current = { neurons: [], synapses: [] };
    saveBrain(brainRef.current);
    setSelected(null);
    rerender();
  };

  const { neurons, synapses } = brainRef.current;
  const selectedNeuron = selected ? neurons.find((n) => n.id === selected) : null;
  const totalStrength = synapses.reduce((a, s) => a + s.strength, 0);

  return (
    <div ref={containerRef} className="relative h-screen w-screen overflow-hidden bg-background">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: linking ? "crosshair" : hover ? "pointer" : "default" }}
      />

      {/* Header */}
      <header className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-start justify-between p-6">
        <div className="pointer-events-auto">
          <h1 className="font-display text-lg font-semibold tracking-tight text-foreground">
            Living Neural Network
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {neurons.length} neurons · {synapses.length} synapses · {totalStrength} signal
          </p>
        </div>
        <div className="pointer-events-auto flex gap-2">
          {neurons.length > 0 && (
            <button
              onClick={clearAll}
              className="rounded-md border border-border bg-surface/60 px-3 py-2 font-mono text-xs text-muted-foreground backdrop-blur transition hover:text-foreground"
            >
              clear
            </button>
          )}
        </div>
      </header>

      {/* Empty state */}
      {neurons.length === 0 && !adding && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm text-center">
            <Sparkles className="mx-auto h-8 w-8 text-primary" />
            <h2 className="mt-4 font-display text-2xl font-semibold text-foreground">
              Plant your first thought.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Each idea becomes a neuron. Link them, revisit them, and watch your knowledge grow.
            </p>
          </div>
        </div>
      )}

      {/* Selected panel */}
      {selectedNeuron && (
        <div className="absolute bottom-24 left-1/2 z-10 w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-border bg-surface/90 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-base text-foreground">{selectedNeuron.text}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                fired {selectedNeuron.activations}× ·{" "}
                {Math.max(1, Math.floor((Date.now() - selectedNeuron.createdAt) / 60000))}m old
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setLinking(linking === selectedNeuron.id ? null : selectedNeuron.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                linking === selectedNeuron.id
                  ? "bg-accent text-primary-foreground"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              <Link2 className="h-4 w-4" />
              {linking === selectedNeuron.id ? "Tap another neuron…" : "Connect"}
            </button>
            <button
              onClick={() => removeNeuron(selectedNeuron.id)}
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Add neuron */}
      <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
        {adding ? (
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface/95 p-1.5 pl-4 shadow-2xl backdrop-blur">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addNeuron();
                if (e.key === "Escape") { setAdding(false); setDraft(""); }
              }}
              placeholder="A new thought…"
              className="w-[min(70vw,360px)] bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              onClick={addNeuron}
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Grow
            </button>
            <button
              onClick={() => { setAdding(false); setDraft(""); }}
              className="rounded-full p-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-xl shadow-primary/20 transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            New neuron
          </button>
        )}
      </div>
    </div>
  );
}
