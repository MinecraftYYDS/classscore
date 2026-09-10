import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Plus, Minus, Search, Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "react-hot-toast";
import type { Student } from "@shared/types";
import { api } from "../../lib/api";
import { useSettings } from "../../lib/settings";

const QUICK_ADD = [1, 2, 3, 5];
const QUICK_DEDUCT = [-1, -2, -3, -5];
const NAME_COLLATOR = new Intl.Collator("zh-Hans-CN", { sensitivity: "base" });

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

export default function ScoreTab({ students, onDone }: { students: Student[]; onDone: () => Promise<void> }) {
  const settings = useSettings();
  const isDesktop = useIsDesktop();
  const [mode, setMode] = useState<"add" | "deduct">("add");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [delta, setDelta] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileStep, setMobileStep] = useState<"pick" | "action">("pick");
  const [multi, setMulti] = useState(false);

  const presets = mode === "add" ? settings.preset_add : settings.preset_deduct;
  const quick = mode === "add" ? QUICK_ADD : QUICK_DEDUCT;
  const isDeduct = mode === "deduct";

  const filtered = useMemo(
    () =>
      students
        .filter((s) => !query || s.name.includes(query) || s.student_no.includes(query))
        .sort((a, b) => NAME_COLLATOR.compare(a.name, b.name) || a.id - b.id),
    [students, query]
  );

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => setSelected(new Set(filtered.map((s) => s.id)));
  const clear = () => {
    setSelected(new Set());
    setMulti(false);
  };

  const pickOne = (id: number) => {
    setSelected(new Set([id]));
    setMobileStep("action");
  };

  // 点方框进入多选;之后点名字也继续多选,只有底部「下一步」才进入操作页
  const tapBox = (id: number) => {
    setMulti(true);
    toggle(id);
  };
  const tapName = (id: number) => {
    if (multi) toggle(id);
    else pickOne(id);
  };

  const applyPreset = (label: string, d: number) => {
    setReason(label);
    setDelta(Math.abs(d) * (mode === "add" ? 1 : -1));
  };

  const submit = async () => {
    if (!selected.size) return toast.error("请选择学生");
    if (!delta) return toast.error("请选择或输入分值");
    const d = isDeduct ? -Math.abs(delta) : Math.abs(delta);
    if (!reason.trim()) return toast.error("请填写理由");
    setBusy(true);
    try {
      const r = await api.post<{ clipped: boolean }>("/api/scores/adjust", {
        ids: [...selected],
        delta: d,
        reason: reason.trim(),
      });
      if (r.clipped) toast.success(`已${mode === "add" ? "加" : "扣"}分(部分学生触及 0 分下限)`);
      else toast.success(`成功给 ${selected.size} 名学生${mode === "add" ? "加" : "扣"} ${Math.abs(delta)} 分`);
      setSelected(new Set());
      setDelta(null);
      setReason("");
      await onDone();
      if (!isDesktop) {
        setMobileStep("pick");
        setMulti(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const modeToggle = (
    <div className="cs-card relative mx-auto grid w-full max-w-md grid-cols-2 p-1 lg:max-w-lg">
      {(["add", "deduct"] as const).map((m) => (
        <button
          key={m}
          onClick={() => {
            setMode(m);
            setDelta(null);
            setReason("");
          }}
          className={`relative z-10 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition lg:py-3.5 lg:text-base ${
            mode === m
              ? m === "add"
                ? "text-emerald-300"
                : "text-rose-300"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {mode === m && (
            <motion.div
              layoutId="mode-pill"
              className={`absolute inset-0 -z-10 rounded-xl ${
                m === "add" ? "bg-emerald-500/15 ring-1 ring-emerald-500/40" : "bg-rose-500/15 ring-1 ring-rose-500/40"
              }`}
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
          {m === "add" ? <Plus className="h-4 w-4 lg:h-5 lg:w-5" /> : <Minus className="h-4 w-4 lg:h-5 lg:w-5" />}
          {m === "add" ? "加分" : "扣分"}
        </button>
      ))}
    </div>
  );

  const actionPanel = (
    <div className="cs-card space-y-4 p-4 lg:sticky lg:top-24 lg:self-start lg:p-5">
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-300 lg:text-base">
          <Sparkles className="h-4 w-4 text-indigo-400" /> 快捷理由
        </h3>
        <div className="flex flex-wrap gap-1.5 lg:gap-2">
          {presets.length === 0 && <span className="text-xs text-slate-600">(在系统设置中配置快捷理由)</span>}
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.label, p.delta)}
              className={`rounded-full border px-3 py-1.5 text-xs transition active:scale-95 lg:px-4 lg:py-2 lg:text-sm ${
                reason === p.label
                  ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                  : isDeduct
                    ? "border-rose-500/25 bg-rose-500/5 text-rose-300/80 hover:border-rose-400/50"
                    : "border-emerald-500/25 bg-emerald-500/5 text-emerald-300/80 hover:border-emerald-400/50"
              }`}
            >
              {p.label} <b>{p.delta > 0 ? "+" : ""}{p.delta}</b>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300 lg:text-base">快捷分值</h3>
        <div className="flex flex-wrap items-center gap-1.5 lg:gap-2">
          {quick.map((q) => (
            <button
              key={q}
              onClick={() => setDelta(q)}
              className={`h-10 w-14 rounded-lg border text-sm font-bold transition active:scale-95 lg:h-12 lg:w-16 lg:text-base ${
                delta === q
                  ? isDeduct
                    ? "border-rose-400 bg-rose-500/25 text-rose-200"
                    : "border-emerald-400 bg-emerald-500/25 text-emerald-200"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
              }`}
            >
              {q > 0 ? `+${q}` : q}
            </button>
          ))}
          <input
            type="number"
            className="cs-input h-10 w-24 py-0 text-center lg:h-12 lg:w-28 lg:text-base"
            placeholder="自定义"
            value={delta === null ? "" : delta}
            onChange={(e) => setDelta(e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300 lg:text-base">理由</h3>
        <input
          className="cs-input h-11 text-base lg:h-12"
          placeholder="例:课堂积极回答问题"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={50}
        />
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        disabled={busy}
        onClick={submit}
        className={`cs-btn w-full py-3 text-base font-bold text-white lg:py-4 lg:text-lg ${
          isDeduct ? "bg-rose-500 hover:bg-rose-400" : "bg-emerald-500 hover:bg-emerald-400"
        }`}
      >
        {isDeduct ? <Minus className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        {selected.size ? `对 ${selected.size} 人${isDeduct ? "扣" : "加"} ${delta ? Math.abs(delta) : "?"} 分` : "请先选择学生"}
      </motion.button>
    </div>
  );

  // 电脑端:左学生列表 + 右操作区
  if (isDesktop) {
    return (
      <div className="space-y-4">
        {modeToggle}
        <div className="grid gap-4 lg:grid-cols-12 lg:items-start lg:gap-5">
          <div className="cs-card p-4 lg:col-span-7 lg:p-5 xl:col-span-8">
            <div className="mb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  className="cs-input h-11 pl-9 text-base lg:h-12"
                  placeholder="搜索姓名/学号"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button onClick={selectAllVisible} className="cs-btn h-11 border border-slate-700 px-3 text-slate-300 lg:h-12 lg:px-4">
                全选
              </button>
              <button onClick={clear} className="cs-btn h-11 border border-slate-700 px-3 text-slate-400 lg:h-12 lg:px-4">
                清空
              </button>
            </div>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500 lg:text-sm">
              <span>
                已选 <span className="font-bold text-indigo-300">{selected.size}</span> 人
              </span>
              <span>共 {filtered.length} 人</span>
            </div>
            <div className="grid max-h-[48vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:max-h-[62vh] lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {filtered.map((s) => {
                const on = selected.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggle(s.id)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left text-sm transition active:scale-95 lg:py-3 lg:text-base ${
                      on
                        ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200"
                        : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border lg:h-5 lg:w-5 ${
                        on ? "border-indigo-400 bg-indigo-500" : "border-slate-600"
                      }`}
                    >
                      {on && <Check className="h-3 w-3 text-white lg:h-3.5 lg:w-3.5" />}
                    </span>
                    <span className="truncate">{s.name}</span>
                    <span className={`ml-auto shrink-0 text-xs lg:text-sm ${isDeduct && s.score <= 0 ? "text-rose-400" : "text-slate-500"}`}>
                      {s.score}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="col-span-full py-8 text-center text-sm text-slate-500">没有匹配的学生</p>}
            </div>
          </div>

          <div className="lg:col-span-5 xl:col-span-4">{actionPanel}</div>
        </div>
      </div>
    );
  }

  // 手机端:两步
  if (mobileStep === "action") {
    return (
      <div className="space-y-3">
        <button
          onClick={() => {
            setMobileStep("pick");
            setMulti(false);
          }}
          className="cs-btn border border-slate-700 text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" /> 返回选择({selected.size} 人)
        </button>
        {modeToggle}
        {actionPanel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="cs-card p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            已选 <span className="font-bold text-indigo-300">{selected.size}</span> / {filtered.length} 人
            {multi && <span className="ml-2 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">多选模式</span>}
          </span>
          <span className="flex gap-3">
            <button onClick={selectAllVisible} className="text-slate-400">
              全选
            </button>
            <button onClick={clear} className="text-slate-400">
              清空
            </button>
          </span>
        </div>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className="cs-input h-10 pl-8"
            placeholder="搜索姓名/学号"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {filtered.map((s) => {
            const on = selected.has(s.id);
            return (
              <div
                key={s.id}
                className={`flex items-center gap-1 rounded-lg border px-1.5 py-1.5 ${
                  on ? "border-indigo-500/60 bg-indigo-500/15" : "border-slate-800 bg-slate-900"
                }`}
              >
                <button
                  type="button"
                  onClick={() => tapBox(s.id)}
                  aria-label={on ? "取消选择" : "选择"}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on ? "border-indigo-400 bg-indigo-500" : "border-slate-600"
                  }`}
                >
                  {on && <Check className="h-3 w-3 text-white" />}
                </button>
                <button
                  type="button"
                  onClick={() => tapName(s.id)}
                  className={`min-w-0 flex-1 truncate text-left text-xs ${on ? "text-indigo-200" : "text-slate-300"}`}
                >
                  {s.name}
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && <p className="col-span-full py-8 text-center text-sm text-slate-500">没有匹配的学生</p>}
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-600">
          {multi
            ? "多选模式:点方框或名字都会加入/移出选择,完成后点底部「下一步」"
            : "点方框开始多选;直接点名字则只对该学生操作"}
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/90 p-3 backdrop-blur">
        <div className="mx-auto max-w-5xl">
          <button
            disabled={!selected.size}
            onClick={() => setMobileStep("action")}
            className="cs-btn w-full bg-indigo-500 py-3 text-base font-bold text-white hover:bg-indigo-400 disabled:opacity-40"
          >
            {selected.size ? `下一步(已选 ${selected.size} 人)` : "请选择学生"}
          </button>
        </div>
      </div>
    </div>
  );
}
