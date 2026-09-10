import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Gift, Plus, Trash2, Save, Dices, Search, ArrowLeft, X } from "lucide-react";
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

const PRIZE_EDIT_CODE = "114514";

export default function LotteryTab({ students, onDone }: { students: Student[]; onDone: () => Promise<void> }) {
  const settings = useSettings();
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [draft, setDraft] = useState<Prize[]>([]);
  const [logs, setLogs] = useState<LotteryLog[]>([]);
  const [step, setStep] = useState<"pick" | "spin">("pick");
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [prizeOpen, setPrizeOpen] = useState(false);
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

  const filtered = useMemo(
    () => students.filter((s) => !query || s.name.includes(query) || s.student_no.includes(query)),
    [students, query]
  );

  const pickStudent = (s: Student) => {
    if (s.score < settings.lottery_min_score) {
      toast.error(`${s.name} 当前 ${s.score} 分,低于抽奖门槛 ${settings.lottery_min_score} 分`);
      return;
    }
    setPickedId(s.id);
    setStep("spin");
  };

  const resetPick = () => {
    setPickedId(null);
    setStep("pick");
  };

  const spin = async () => {
    if (!pickedId) return toast.error("请先选择学生");
    setBusy(true);
    try {
      const r = await api.post<DrawResult>("/api/lottery/draw", { studentId: pickedId });
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

  const closeResult = () => {
    setResult(null);
    resetPick();
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

  const onSearchChange = (v: string) => {
    if (v.includes(PRIZE_EDIT_CODE)) {
      setQuery("");
      setPrizeOpen(true);
      return;
    }
    setQuery(v);
  };

  return (
    <div className="space-y-4">
      <Confetti fire={fire} />

      <div className="cs-card mx-auto w-full max-w-2xl p-5">
        {step === "pick" ? (
          <div className="flex flex-col">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300">
                <Dices className="h-4 w-4 text-indigo-400" /> 第一步:选择学生
              </h3>
              <span className="ml-auto text-xs text-slate-500">可抽 {eligible.length} 人</span>
            </div>
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                className="cs-input pl-8"
                placeholder="搜索姓名/学号"
                value={query}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
            <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((s) => {
                const ok = s.score >= settings.lottery_min_score;
                return (
                  <button
                    key={s.id}
                    disabled={!ok}
                    onClick={() => pickStudent(s)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                      ok
                        ? "border-slate-800 bg-slate-900 text-slate-200 hover:border-indigo-500/60"
                        : "border-slate-900 bg-slate-900/40 text-slate-600"
                    }`}
                  >
                    <span className="truncate">{s.name}</span>
                    <span className={`ml-auto shrink-0 text-xs ${ok ? "text-slate-500" : "text-rose-400/70"}`}>
                      {s.score}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-slate-500">没有匹配的学生</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">为以下学生抽奖</p>
                <p className="truncate text-lg font-bold text-slate-100">{picked?.name ?? "—"}</p>
              </div>
              <span className="ml-auto shrink-0 text-xl font-black tabular-nums text-slate-300">{picked?.score}</span>
              <button onClick={resetPick} className="cs-btn shrink-0 border border-slate-700 text-slate-300">
                <ArrowLeft className="h-4 w-4" /> 重选
              </button>
            </div>

            <Wheel
              prizes={draft}
              spinning={spinning}
              disabled={busy}
              targetPrizeId={targetId}
              onSpinRequest={spin}
              onFinish={onFinish}
            />

            <div className="text-center text-xs text-slate-500">
              每次消耗 <b className="text-amber-300">{settings.lottery_cost}</b> 分 · 低于{" "}
              <b className="text-amber-300">{settings.lottery_min_score}</b> 分不可抽奖
            </div>
          </div>
        )}
      </div>

      {/* 抽奖历史 */}
      <div className="cs-card mx-auto w-full max-w-2xl p-5">
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

      {/* 奖池编辑(默认隐藏,在搜索框输入暗号后弹出) */}
      <AnimatePresence>
        {prizeOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setPrizeOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="cs-card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 border-b border-slate-800 p-4">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300">
                  <Gift className="h-4 w-4 text-fuchsia-400" /> 奖池编辑
                </h3>
                <div className="ml-auto flex gap-2">
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
                  <button onClick={() => setPrizeOpen(false)} className="cs-btn px-2 py-1.5 text-slate-500">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-2">
                  {draft.map((p, i) => (
                    <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={p.color}
                          onChange={(e) => updateDraft(i, { color: e.target.value })}
                          className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent"
                          title="颜色"
                        />
                        <input
                          className="cs-input min-w-0 flex-1 py-1.5"
                          value={p.name}
                          onChange={(e) => updateDraft(i, { name: e.target.value })}
                          placeholder="奖项名称"
                        />
                        <button onClick={() => setDraft((d) => d.filter((_, x) => x !== i))} className="shrink-0 p-1 text-slate-500 hover:text-rose-400">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-10">
                        <label className="flex items-center gap-1 text-[11px] text-slate-500" title="权重(越大越容易中)">
                          权重
                          <input
                            type="number"
                            min={1}
                            className="cs-input w-16 px-1 py-1 text-center"
                            value={p.weight}
                            onChange={(e) => updateDraft(i, { weight: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex items-center gap-1 text-[11px] text-slate-500" title="库存,留空为不限">
                          库存
                          <input
                            type="number"
                            min={0}
                            placeholder="∞"
                            className="cs-input w-16 px-1 py-1 text-center"
                            value={p.stock ?? ""}
                            onChange={(e) => updateDraft(i, { stock: e.target.value === "" ? null : Number(e.target.value) })}
                          />
                        </label>
                        <button
                          onClick={() => updateDraft(i, { enabled: p.enabled ? 0 : 1 })}
                          className={`ml-auto rounded-full px-3 py-1 text-[11px] font-medium ${p.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}
                        >
                          {p.enabled ? "启用" : "停用"}
                        </button>
                      </div>
                    </div>
                  ))}
                  {draft.length === 0 && <p className="py-6 text-center text-xs text-slate-500">奖池为空,点击「添加」创建奖项</p>}
                </div>
                {dirty && <p className="mt-3 text-right text-xs text-amber-400">有未保存的修改</p>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 结果弹窗 */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
            onClick={closeResult}
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
              <button onClick={closeResult} className="cs-btn mt-6 w-full bg-indigo-500 text-white hover:bg-indigo-400">
                <Dices className="h-4 w-4" /> 好的,选择下一位
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
