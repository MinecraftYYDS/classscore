import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { History as HistoryIcon, ListChecks, Gift, RefreshCw } from "lucide-react";
import type { Operation, ScoreLog } from "@shared/types";
import { OPERATION_LABELS } from "@shared/types";
import { api } from "../../lib/api";

const SOURCE_LABEL: Record<string, string> = {
  teacher: "手动",
  lottery: "抽奖",
  undo: "撤销",
  system: "系统",
};

function fmt(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

export default function LogsTab() {
  const [view, setView] = useState<"ops" | "scores">("ops");
  const [ops, setOps] = useState<Operation[]>([]);
  const [logs, setLogs] = useState<ScoreLog[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, l] = await Promise.all([
        api.get<Operation[]>("/api/system/operations?limit=100"),
        api.get<{ logs: ScoreLog[] }>("/api/students/logs/all?limit=150"),
      ]);
      setOps(o);
      setLogs(l.logs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="cs-card flex gap-1 p-1">
          {(
            [
              ["ops", "操作记录", ListChecks],
              ["scores", "分数明细", HistoryIcon],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`relative flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
                view === k ? "text-indigo-200" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {view === k && <motion.div layoutId="logs-pill" className="absolute inset-0 -z-10 rounded-lg bg-indigo-500/20 ring-1 ring-indigo-500/40" />}
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <button onClick={load} className="cs-btn ml-auto border border-slate-700 text-slate-400" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
        </button>
      </div>

      {view === "ops" && (
        <div className="cs-card divide-y divide-slate-800/70">
          {ops.length === 0 && <p className="p-8 text-center text-sm text-slate-500">暂无操作记录</p>}
          {ops.map((o) => (
            <div key={o.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium ${
                  o.type === "undo" ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-400"
                }`}
              >
                {OPERATION_LABELS[o.type] ?? o.type}
              </span>
              <span className={`flex-1 truncate text-sm ${o.undone ? "text-slate-600 line-through" : "text-slate-200"}`}>{o.summary}</span>
              {o.undone === 1 && <span className="shrink-0 text-[10px] text-slate-600">已撤销</span>}
              <span className="shrink-0 text-xs text-slate-600">{fmt(o.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {view === "scores" && (
        <div className="cs-card divide-y divide-slate-800/70">
          {logs.length === 0 && <p className="p-8 text-center text-sm text-slate-500">暂无分数记录</p>}
          {logs.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`w-14 shrink-0 text-right font-bold tabular-nums ${l.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {l.delta > 0 ? `+${l.delta}` : l.delta}
              </span>
              <span className="w-20 shrink-0 truncate text-sm text-slate-300">{l.student_name ?? "已删除"}</span>
              <span className="flex-1 truncate text-sm text-slate-500">{l.reason}</span>
              <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">{SOURCE_LABEL[l.source] ?? l.source}</span>
              <span className="shrink-0 text-xs text-slate-600">{fmt(l.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="flex items-center justify-center gap-1 text-center text-xs text-slate-600">
        <Gift className="h-3.5 w-3.5" /> 每 20 秒自动刷新 · 撤销可回退最近一步操作
      </p>
    </div>
  );
}
