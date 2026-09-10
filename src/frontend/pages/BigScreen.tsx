import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowLeft } from "lucide-react";
import type { BoardData } from "@shared/types";
import { AnimatedNumber, scoreColor } from "../components/ScoreBits";
import StudentDetailModal from "../components/StudentDetailModal";
import ThemeToggle from "../components/ThemeToggle";

const NAME_COLLATOR = new Intl.Collator("zh-Hans-CN", { sensitivity: "base" });

export default function BigScreen() {
  const [data, setData] = useState<BoardData | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = async () => {
    try {
      const d = await fetch("/api/public/board").then((r) => {
        if (!r.ok) throw new Error("加载失败");
        return r.json() as Promise<BoardData & { updatedAt: number }>;
      });
      setData(d);
      setUpdatedAt(new Date());
    } catch {
      /* 保持上一次数据 */
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const byName = useMemo(
    () => [...(data?.students ?? [])].sort((a, b) => NAME_COLLATOR.compare(a.name, b.name) || a.id - b.id),
    [data]
  );

  const dims = useMemo(() => {
    const n = Math.max(byName.length, 1);
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * 16) / 9)));
    return { cols, rows: Math.ceil(n / cols) };
  }, [byName.length]);

  const minScore = data?.lottery.minScore ?? 3;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950/60 p-5 sm:p-8">
      <header className="mb-4 flex items-center gap-3">
        <Trophy className="h-7 w-7 shrink-0 text-amber-400 sm:h-8 sm:w-8" />
        <h1 className="truncate text-xl font-bold text-slate-50 sm:text-3xl">{data?.className ?? "班级量化评分"}</h1>
        <span className="ml-auto shrink-0 text-xs text-slate-500">
          {updatedAt ? `更新于 ${updatedAt.toLocaleTimeString("zh-CN", { hour12: false })} · 每 15 秒刷新` : "加载中…"}
        </span>
        <ThemeToggle />
        <Link
          to="/"
          className="cs-btn shrink-0 border border-slate-700 text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
        >
          <ArrowLeft className="h-4 w-4" /> 返回
        </Link>
      </header>

      <div
        className="grid min-h-0 flex-1 gap-2 sm:gap-3"
        style={{
          gridTemplateColumns: `repeat(${dims.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${dims.rows}, minmax(0, 1fr))`,
        }}
      >
        {byName.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setDetailId(s.id)}
            className="flex min-h-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-1 text-center transition hover:border-indigo-500/60 hover:bg-slate-900 sm:rounded-2xl"
          >
            <span className="w-full truncate text-[clamp(0.7rem,1.8vw,1.6rem)] font-semibold text-slate-100">
              {s.name}
            </span>
            <span
              className={`text-[clamp(1.1rem,3vw,3.5rem)] font-black leading-tight tabular-nums ${scoreColor(
                s.score,
                minScore
              )}`}
            >
              <AnimatedNumber value={s.score} />
            </span>
          </button>
        ))}
        {data && byName.length === 0 && (
          <p className="col-span-full self-center text-center text-slate-500">还没有学生,请在教师端添加</p>
        )}
      </div>

      <StudentDetailModal studentId={detailId} minScore={minScore} onClose={() => setDetailId(null)} />
    </div>
  );
}
