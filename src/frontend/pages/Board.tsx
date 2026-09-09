import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, RefreshCw, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { BoardData } from "@shared/types";

const MEDALS = ["🥇", "🥈", "🥉"];

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const start = display;
    const diff = value - start;
    if (diff === 0) return;
    const t0 = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + diff * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span>{display}</span>;
}

function scoreColor(score: number, min: number) {
  if (score <= 0) return "text-rose-400";
  if (score < min) return "text-amber-400";
  return "text-emerald-400";
}

export default function Board() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = async () => {
    try {
      const d = await fetch("/api/public/board").then((r) => {
        if (!r.ok) throw new Error("加载失败");
        return r.json() as Promise<BoardData & { updatedAt: number }>;
      });
      setData(d);
      setUpdatedAt(new Date());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误");
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const sorted = [...(data?.students ?? [])].sort((a, b) => b.score - a.score || a.id - b.id);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950/60 px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 text-2xl font-bold text-slate-50 sm:text-3xl"
            >
              <Trophy className="h-7 w-7 text-amber-400" />
              {data?.className ?? "班级量化评分"}
            </motion.h1>
            <p className="mt-1 text-xs text-slate-400">
              {updatedAt ? `更新于 ${updatedAt.toLocaleTimeString("zh-CN", { hour12: false })}` : "加载中…"}
              · 每 15 秒自动刷新
            </p>
          </div>
          <Link
            to="/admin"
            className="cs-btn border border-slate-700 text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
            title="教师端"
          >
            <Settings2 className="h-4 w-4" />
            教师端
          </Link>
        </header>

        {error && (
          <div className="cs-card mb-4 flex items-center gap-3 border-rose-500/30 p-4 text-rose-300">
            <RefreshCw className="h-4 w-4" /> {error}
            <button onClick={load} className="cs-btn ml-auto bg-rose-500/20 text-rose-200">重试</button>
          </div>
        )}

        {/* 前三名领奖台 */}
        {sorted.length >= 3 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-8 grid grid-cols-3 items-end gap-3"
          >
            {[1, 0, 2].map((rank) => {
              const s = sorted[rank];
              if (!s) return <div key={rank} />;
              const heights = ["h-28", "h-36", "h-24"];
              const colors = [
                "from-slate-500/40 to-slate-700/40 border-slate-400/40",
                "from-amber-500/40 to-amber-700/40 border-amber-400/50",
                "from-orange-600/40 to-orange-800/40 border-orange-400/40",
              ];
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.15 * rank, type: "spring", stiffness: 120 }}
                  className="flex flex-col items-center"
                >
                  <div className="mb-2 text-3xl">{MEDALS[rank]}</div>
                  <div
                    className={`cs-shine relative flex w-full flex-col items-center justify-center overflow-hidden rounded-t-2xl border bg-gradient-to-b ${heights[rank]} ${colors[rank]}`}
                  >
                    <span className="z-10 max-w-full truncate px-2 text-sm font-semibold text-slate-100">{s.name}</span>
                    <span className={`z-10 text-2xl font-bold ${scoreColor(s.score, data?.lottery.minScore ?? 3)}`}>
                      <AnimatedNumber value={s.score} />
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">第 {rank + 1} 名</div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* 完整榜单 */}
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {sorted.map((s, i) => (
              <motion.div
                key={s.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ layout: { type: "spring", stiffness: 260, damping: 30 } }}
                className="cs-card flex items-center gap-3 px-4 py-3"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    i < 3 ? "bg-amber-500/20 text-amber-300" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate font-medium text-slate-200">{s.name}</span>
                <span className={`text-xl font-bold tabular-nums ${scoreColor(s.score, data?.lottery.minScore ?? 3)}`}>
                  <AnimatedNumber value={s.score} />
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {!data && !error && <p className="py-16 text-center text-slate-500">加载中…</p>}
          {data && sorted.length === 0 && (
            <p className="py-16 text-center text-slate-500">还没有学生,请在教师端添加</p>
          )}
        </div>

        <footer className="mt-10 pb-6 text-center text-xs text-slate-600">
          ClassScore · {data?.lottery.cost ?? 3} 积分抽一次 · 低于 {data?.lottery.minScore ?? 3} 分不可抽奖
        </footer>
      </div>
    </div>
  );
}
