import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import type { Prize } from "@shared/types";

interface Props {
  prizes: Prize[];
  disabled?: boolean;
  spinning: boolean;
  targetPrizeId: number | null;
  onSpinRequest: () => void;
  onFinish: () => void;
}

const TAU = Math.PI * 2;

function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

class TickSound {
  private ctx: AudioContext | null = null;
  play() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
      }
      const ctx = this.ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880 + Math.random() * 120;
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      /* ignore */
    }
  }
}

export default function Wheel({ prizes, disabled, spinning, targetPrizeId, onSpinRequest, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);
  const rafRef = useRef(0);
  const lastSegRef = useRef(-1);
  const soundRef = useRef(new TickSound());
  const [muted, setMuted] = useState(() => localStorage.getItem("cs_mute") === "1");

  const active = prizes.filter((p) => p.enabled && (p.stock === null || p.stock > 0));

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = size / dpr;
    const cx = W / 2;
    const cy = W / 2;
    const R = W / 2 - 6;
    ctx.clearRect(0, 0, W, W);

    const list = active.length ? active : prizes;
    const n = list.length;
    if (!n) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.fillStyle = "#64748b";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("奖池为空", cx, cy);
      return;
    }

    const seg = TAU / n;
    const rot = rotationRef.current;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    for (let i = 0; i < n; i++) {
      const p = list[i];
      const start = i * seg - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, start, start + seg);
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(15,23,42,0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.rotate(start + seg / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold ${Math.max(11, Math.min(16, R / 12))}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.fillText(p.name, R - 16, 5);
      ctx.restore();
    }
    ctx.restore();

    // 外圈光晕 + 中心
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, TAU);
    ctx.fillStyle = "#0f172a";
    ctx.fill();
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const px = 320;
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prizes]);

  useEffect(() => {
    if (!spinning || targetPrizeId === null || !active.length) return;
    const list = active;
    const idx = list.findIndex((p) => p.id === targetPrizeId);
    if (idx < 0) {
      onFinish();
      return;
    }
    const n = list.length;
    const seg = TAU / n;
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    const target = -(idx + 0.5) * seg + jitter;
    const current = rotationRef.current;
    const minSpins = 5 + Math.floor(Math.random() * 3);
    let final = target;
    while (final < current + minSpins * TAU) final += TAU;

    const t0 = performance.now();
    const dur = 4200 + Math.random() * 600;
    const startRot = current;
    lastSegRef.current = -1;

    const tick = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      const eased = easeOutQuart(p);
      rotationRef.current = startRot + (final - startRot) * eased;
      const segNow = Math.floor(((rotationRef.current % TAU) + TAU) / seg);
      if (segNow !== lastSegRef.current) {
        lastSegRef.current = segNow;
        if (!muted) soundRef.current.play();
      }
      draw();
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rotationRef.current = ((final % TAU) + TAU) % TAU;
        onFinish();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, targetPrizeId]);

  return (
    <div className="relative mx-auto" style={{ width: 320, height: 320 }}>
      <canvas ref={canvasRef} className="rounded-full shadow-[0_0_60px_-12px_rgba(99,102,241,0.5)]" />
      {/* 指针 */}
      <div className="pointer-events-none absolute left-1/2 top-[-2px] -translate-x-1/2">
        <div className="h-0 w-0 border-x-[10px] border-t-[18px] border-x-transparent border-t-amber-400 drop-shadow" />
      </div>
      {/* 中心按钮 */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        disabled={disabled || spinning || !active.length}
        onClick={onSpinRequest}
        className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-black tracking-widest text-white shadow-lg transition disabled:opacity-60"
        style={{ width: 64, height: 64 }}
      >
        {spinning ? "…" : "GO"}
      </motion.button>
      <button
        onClick={() => {
          const next = !muted;
          setMuted(next);
          localStorage.setItem("cs_mute", next ? "1" : "0");
        }}
        className="absolute -right-1 -top-1 rounded-full bg-slate-800 p-2 text-slate-400 hover:text-slate-200"
        title={muted ? "开启音效" : "静音"}
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
