import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, RefreshCw, Settings2, Monitor, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { BoardData } from "@shared/types";

const MEDALS = ["🥇", "🥈", "🥉"];
const NAME_COLLATOR = new Intl.Collator("zh-Hans-CN", { sensitivity: "base" });

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
  const [bigScreen, setBigScreen] = useState(false);

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

  const sorted = useMemo(
    () => [...(data?.students ?? [])].sort((a, b) => b.score - a.score || a.id - b.id),
    [data]
  );

  const byName = useMemo(
    () => [...(data?.students ?? [])].sort((a, b) => NAME_COLLATOR.compare(a.name, b.name) || a.id - b.id),
    [data]
  );

  const dims = useMemo(() => {
    const n = Math.max(byName.length, 1);
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * 16) / 9)));
    return { cols, rows: Math.ceil(n / cols) };
  }, [byName.length]);

  useEffect(() => {
    if (!bigScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBigScreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bigScreen]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950/60 px-4 py-6 sm:px-8">
      {/* 大屏模式:一屏展示全部学生,按姓名首字母排序 */}
      <AnimatePresence>
        {bigScreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950/60 p-5 sm:p-8"
          >
            <header className="mb-4 flex items-center gap-3">
              <Trophy className="h-7 w-7 shrink-0 text-amber-400 sm:h-8 sm:w-8" />
              <h1 className="truncate text-xl font-bold text-slate-50 sm:text-3xl">
                {data?.className ?? "班级量化评分"}
              </h1>
              <span className="ml-auto shrink-0 text-xs text-slate-500">
                {updatedAt ? `更新于 ${updatedAt.toLocaleTimeString("zh-CN", { hour12: false })}` : ""}
              </span>
              <button
                onClick={() => setBigScreen(false)}
                className="cs-btn shrink-0 border border-slate-700 text-slate-300 hover:border-rose-500/60 hover:text-rose-300"
              >
                <X className="h-4 w-4" /> 退出
              </button>
            </header>

            <div
              className="grid min-h-0 flex-1 gap-2 sm:gap-3"
              style={{
                gridTemplateColumns: `repeat(${dims.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${dims.rows}, minmax(0, 1fr))`,
              }}
            >
              {byName.map((s) => (
                <div
                  key={s.id}
                  className="flex min-h-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-1 text-center sm:rounded-2xl"
                >
                  <span className="w-full truncate text-[clamp(0.7rem,1.8vw,1.6rem)] font-semibold text-slate-100">
                    {s.name}
                  </span>
                  <span
                    className={`text-[clamp(1.1rem,3vw,3.5rem)] font-black leading-tight tabular-nums ${scoreColor(
                      s.score,
                      data?.lottery.minScore ?? 3
                    )}`}
                  >
                    <AnimatedNumber value={s.score} />
                  </span>
                </div>
              ))}
              {data && byName.length === 0 && (
                <p className="col-span-full self-center text-center text-slate-500">还没有学生,请在教师端添加</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBigScreen(true)}
              className="cs-btn border border-slate-700 text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
              title="大屏模式"
            >
              <Monitor className="h-4 w-4" />
              大屏
            </button>
            <Link
              to="/admin"
              className="cs-btn border border-slate-700 text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
              title="教师端"
            >
              <Settings2 className="h-4 w-4" />
              教师端
            </Link>
          </div>
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
              const heights = ["h-36", "h-28", "h-24"];
              const colors = [
                "from-amber-500/40 to-amber-700/40 border-amber-400/50",
                "from-slate-500/40 to-slate-700/40 border-slate-400/40",
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
