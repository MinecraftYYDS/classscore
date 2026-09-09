import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Gift, Plus, Trash2, Save, Dices, UserCheck, Users } from "lucide-react";
import { toast } from "react-hot-toast";
import type { LotteryLog, Prize, Student } from "@shared/types";
import { api } from "../../lib/api";
import { useSettings } from "../../lib/settings";
import Wheel from "../Wheel";
import Confetti from "../Confetti";

interface DrawResult {
  prize: Prize;
  actualCost: number;
  newScore: number;
  studentName: string;
}

export default function LotteryTab({ students, onDone }: { students: Student[]; onDone: () => Promise<void> }) {
  const settings = useSettings();
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [draft, setDraft] = useState<Prize[]>([]);
  const [logs, setLogs] = useState<LotteryLog[]>([]);
  const [mode, setMode] = useState<"random" | "pick">("random");
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [pending, setPending] = useState<DrawResult | null>(null);
  const [fire, setFire] = useState(0);
  const [busy, setBusy] = useState(false);

  const loadPrizes = useCallback(async () => {
    const list = await api.get<Prize[]>("/api/lottery/prizes");
    setPrizes(list);
    setDraft(list.map((p) => ({ ...p })));
  }, []);

  const loadLogs = useCallback(async () => {
    setLogs(await api.get<LotteryLog[]>("/api/lottery/logs?limit=20"));
  }, []);

  useEffect(() => {
    void loadPrizes();
    void loadLogs();
  }, [loadPrizes, loadLogs]);

  const eligible = students.filter((s) => s.score >= settings.lottery_min_score);
  const picked = students.find((s) => s.id === pickedId) ?? null;
  const dirty = JSON.stringify(prizes) !== JSON.stringify(draft);

  const spin = async () => {
    if (mode === "pick" && !pickedId) return toast.error("请选择一名学生");
    if (mode === "random" && !eligible.length) return toast.error("没有满足条件的学生");
    setBusy(true);
    try {
      const r = await api.post<DrawResult>("/api/lottery/draw", {
        studentId: mode === "pick" ? pickedId : undefined,
      });
      setPending(r);
      setTargetId(r.prize.id);
      setSpinning(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "抽奖失败");
    } finally {
      setBusy(false);
    }
  };

  const onFinish = async () => {
    setSpinning(false);
    if (pending) {
      setResult(pending);
      if (!pending.prize.name.includes("谢谢惠顾")) setFire((f) => f + 1);
      setPending(null);
    }
    setTargetId(null);
    await Promise.all([onDone(), loadPrizes(), loadLogs()]);
  };

  const updateDraft = (idx: number, patch: Partial<Prize>) =>
    setDraft((d) => d.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const addPrize = () =>
    setDraft((d) => [
      ...d,
      { id: 0, name: "新奖项", weight: 1, stock: null, color: "#6366f1", enabled: 1 },
    ]);

  const savePrizes = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ prizes: Prize[] }>("/api/lottery/prizes", draft);
      setPrizes(r.prizes);
      setDraft(r.prizes.map((p) => ({ ...p })));
      toast.success("奖池已保存");
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Confetti fire={fire} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 转盘 */}
        <div className="cs-card flex flex-col items-center gap-4 p-5">
          <Wheel
            prizes={draft}
            spinning={spinning}
            disabled={busy}
            targetPrizeId={targetId}
            onSpinRequest={spin}
            onFinish={onFinish}
          />

          <div className="flex w-full max-w-xs gap-1 rounded-xl bg-slate-900 p-1">
            {(["random", "pick"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition ${
                  mode === m ? "text-indigo-200" : "text-slate-500"
                }`}
              >
                {mode === m && (
                  <motion.div layoutId="lottery-mode" className="absolute inset-0 -z-10 rounded-lg bg-indigo-500/20 ring-1 ring-indigo-500/40" />
                )}
                {m === "random" ? <Users className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                {m === "random" ? "全班随机" : "指定学生"}
              </button>
            ))}
          </div>

          {mode === "pick" && (
            <select className="cs-input max-w-xs" value={pickedId ?? ""} onChange={(e) => setPickedId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">选择学生…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id} disabled={s.score < settings.lottery_min_score}>
                  {s.name}({s.score} 分){s.score < settings.lottery_min_score ? " · 分数不足" : ""}
                </option>
              ))}
            </select>
          )}

          <div className="text-center text-xs text-slate-500">
            每次消耗 <b className="text-amber-300">{settings.lottery_cost}</b> 分 · 低于{" "}
            <b className="text-amber-300">{settings.lottery_min_score}</b> 分不可抽奖 · 可抽学生{" "}
            <b className="text-emerald-300">{eligible.length}</b> 人
          </div>

          <button
            onClick={spin}
            disabled={busy || spinning || (mode === "pick" ? !picked : !eligible.length)}
            className="cs-btn w-full max-w-xs bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 text-base font-bold text-white"
          >
            <Dices className="h-5 w-5" />
            {spinning ? "抽奖中…" : mode === "pick" && picked ? `让 ${picked.name} 抽一次` : "开始抽奖"}
          </button>
        </div>

        {/* 奖池编辑 */}
        <div className="cs-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300">
              <Gift className="h-4 w-4 text-fuchsia-400" /> 奖池编辑
            </h3>
            <div className="flex gap-2">
              <button onClick={addPrize} className="cs-btn border border-slate-700 px-2.5 py-1.5 text-slate-300">
                <Plus className="h-4 w-4" /> 添加
              </button>
              <button
                onClick={savePrizes}
                disabled={!dirty || busy}
                className="cs-btn bg-emerald-500/20 px-2.5 py-1.5 text-emerald-300 disabled:opacity-40"
              >
                <Save className="h-4 w-4" /> 保存
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {draft.map((p, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                <input
                  type="color"
                  value={p.color}
                  onChange={(e) => updateDraft(i, { color: e.target.value })}
                  className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent"
                  title="颜色"
                />
                <input
                  className="cs-input flex-1 py-1.5"
                  value={p.name}
                  onChange={(e) => updateDraft(i, { name: e.target.value })}
                  placeholder="奖项名称"
                />
                <label className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500" title="权重(越大越容易中)">
                  权重
                  <input
                    type="number"
                    min={1}
                    className="cs-input w-14 px-1 py-1.5 text-center"
                    value={p.weight}
                    onChange={(e) => updateDraft(i, { weight: Number(e.target.value) })}
                  />
                </label>
                <label className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500" title="库存,留空为不限">
                  库存
                  <input
                    type="number"
                    min={0}
                    placeholder="∞"
                    className="cs-input w-14 px-1 py-1.5 text-center"
                    value={p.stock ?? ""}
                    onChange={(e) => updateDraft(i, { stock: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </label>
                <button
                  onClick={() => updateDraft(i, { enabled: p.enabled ? 0 : 1 })}
                  className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${p.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}
                >
                  {p.enabled ? "启用" : "停用"}
                </button>
                <button onClick={() => setDraft((d) => d.filter((_, x) => x !== i))} className="shrink-0 text-slate-500 hover:text-rose-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {draft.length === 0 && <p className="py-6 text-center text-xs text-slate-500">奖池为空,点击「添加」创建奖项</p>}
          </div>
          {dirty && <p className="mt-2 text-right text-xs text-amber-400">有未保存的修改</p>}
        </div>
      </div>

      {/* 抽奖历史 */}
      <div className="cs-card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-300">抽奖记录</h3>
        <div className="space-y-1.5">
          {logs.length === 0 && <p className="py-4 text-center text-xs text-slate-500">还没有抽奖记录</p>}
          {logs.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-lg bg-slate-900/50 px-3 py-2 text-sm">
              <span className="font-medium text-slate-200">{l.student_name ?? "已删除"}</span>
              <span className="text-slate-500">抽中</span>
              <span className="font-semibold text-fuchsia-300">{l.prize_name}</span>
              <span className="ml-auto text-xs text-amber-300/70">-{l.cost} 分</span>
              <span className="text-xs text-slate-600">{new Date(l.created_at).toLocaleString("zh-CN", { hour12: false })}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 结果弹窗 */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setResult(null)}
          >
            <motion.div
              initial={{ scale: 0.7, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="cs-card w-full max-w-sm p-8 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-6xl">{result.prize.name.includes("谢谢惠顾") ? "😅" : "🎉"}</div>
              <p className="mt-3 text-sm text-slate-400">{result.studentName}</p>
              <h2 className="mt-1 text-2xl font-black text-fuchsia-300">{result.prize.name}</h2>
              <p className="mt-3 text-sm text-slate-400">
                消耗 <b className="text-amber-300">{result.actualCost}</b> 分 · 剩余{" "}
                <b className="text-emerald-300">{result.newScore}</b> 分
              </p>
              <button onClick={() => setResult(null)} className="cs-btn mt-6 w-full bg-indigo-500 text-white hover:bg-indigo-400">
                好的
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
