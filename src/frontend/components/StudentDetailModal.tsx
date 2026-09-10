import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ScoreLog } from "@shared/types";

const SOURCE_LABEL: Record<string, string> = {
  teacher: "手动",
  lottery: "抽奖",
  undo: "撤销",
  system: "系统",
};

interface Detail {
  student: { id: number; name: string; student_no: string; score: number };
  logs: ScoreLog[];
}

function fmt(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

export default function StudentDetailModal({
  studentId,
  minScore,
  onClose,
}: {
  studentId: number | null;
  minScore: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (studentId === null) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setDetail(null);
    fetch(`/api/public/student/${studentId}`)
      .then((r) => (r.ok ? (r.json() as Promise<Detail>) : Promise.reject(new Error("加载失败"))))
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  useEffect(() => {
    if (studentId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [studentId, onClose]);

  const score = detail?.student.score ?? 0;
  const color = score <= 0 ? "text-rose-400" : score < minScore ? "text-amber-400" : "text-emerald-400";

  return (
    <AnimatePresence>
      {studentId !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.94, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0 }}
            className="cs-card flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-800 p-5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold text-slate-100">{detail?.student.name ?? "加载中…"}</h2>
                <p className="text-xs text-slate-500">
                  {detail?.student.student_no ? `学号 ${detail.student.student_no} · ` : ""}共 {detail?.logs.length ?? 0} 条记录
                </p>
              </div>
              {detail && <span className={`shrink-0 text-3xl font-black tabular-nums ${color}`}>{score}</span>}
              <button onClick={onClose} className="shrink-0 text-slate-500 hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading && <p className="py-10 text-center text-sm text-slate-500">加载中…</p>}
              {error && <p className="py-10 text-center text-sm text-rose-400">{error}</p>}
              {detail && detail.logs.length === 0 && (
                <p className="py-10 text-center text-sm text-slate-500">暂无加减分记录</p>
              )}
              {detail?.logs.map((l) => (
                <div key={l.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-800/40">
                  <span
                    className={`w-12 shrink-0 text-right font-bold tabular-nums ${
                      l.delta >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {l.delta > 0 ? `+${l.delta}` : l.delta}
                  </span>
                  <span className="flex-1 truncate text-sm text-slate-300">{l.reason || "—"}</span>
                  <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {SOURCE_LABEL[l.source] ?? l.source}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-600">{fmt(l.created_at)}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
