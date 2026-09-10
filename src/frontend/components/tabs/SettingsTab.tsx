import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Save, Webhook, Plus, Trash2, Send, KeyRound, ShieldCheck, SlidersHorizontal, ListPlus, Database, RefreshCw } from "lucide-react";
import { toast } from "react-hot-toast";
import type { AppSettings, PresetReason, WebhookEventGroup } from "@shared/types";
import { api } from "../../lib/api";
import { useSettings } from "../../lib/settings";

const EVENT_LABELS: Record<WebhookEventGroup, string> = {
  student: "学生增删改",
  score: "加减分/重置",
  lottery: "抽奖",
  undo: "撤销",
  settings: "设置修改",
  auth: "登录/安全",
  system: "系统/导入",
};

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="cs-card p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-300">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

function PresetEditor({
  title,
  items,
  sign,
  onChange,
}: {
  title: string;
  items: PresetReason[];
  sign: 1 | -1;
  onChange: (v: PresetReason[]) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">{title}</span>
        <button onClick={() => onChange([...items, { label: "", delta: sign }])} className="text-slate-500 hover:text-indigo-300">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className="cs-input min-w-0 flex-1 py-1.5"
              placeholder="理由"
              value={it.label}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <input
              type="number"
              className="cs-input w-16 py-1.5 text-center"
              value={it.delta}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, delta: Number(e.target.value) } : x)))}
            />
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-slate-600 hover:text-rose-400">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsTab({ onDone }: { onDone: () => Promise<void> }) {
  const settings = useSettings();
  const [form, setForm] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [rebindUri, setRebindUri] = useState("");
  const [rebindCode, setRebindCode] = useState("");

  useEffect(() => {
    setForm(JSON.parse(JSON.stringify(settings)));
  }, [settings]);

  if (!form) return <p className="py-12 text-center text-slate-500">加载中…</p>;

  const set = (patch: Partial<AppSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = async () => {
    setBusy(true);
    try {
      await api.post("/api/system/settings", form);
      toast.success("设置已保存");
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const testWebhook = async () => {
    setBusy(true);
    try {
      await api.post("/api/system/webhook-test");
      toast.success("测试消息发送成功");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发送失败");
    } finally {
      setBusy(false);
    }
  };

  const changePw = async () => {
    setBusy(true);
    try {
      await api.post("/api/auth/password", { oldPassword: oldPw, newPassword: newPw });
      toast.success("密码已修改");
      setOldPw("");
      setNewPw("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "修改失败");
    } finally {
      setBusy(false);
    }
  };

  const startRebind = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ otpauth: string; secret: string }>("/api/auth/totp/rebind");
      setRebindUri(r.otpauth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmRebind = async () => {
    setBusy(true);
    try {
      await api.post("/api/auth/totp/rebind/confirm", { code: rebindCode });
      toast.success("2FA 已重新绑定");
      setRebindUri("");
      setRebindCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "验证码错误");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Section title="基础设置" icon={<SlidersHorizontal className="h-4 w-4 text-indigo-400" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">班级名称</span>
            <input className="cs-input" value={form.class_name} onChange={(e) => set({ class_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">学生初始分数</span>
            <input type="number" className="cs-input" value={form.initial_score} onChange={(e) => set({ initial_score: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">每次抽奖消耗积分</span>
            <input type="number" className="cs-input" value={form.lottery_cost} onChange={(e) => set({ lottery_cost: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">低于该分数禁止抽奖</span>
            <input type="number" className="cs-input" value={form.lottery_min_score} onChange={(e) => set({ lottery_min_score: Number(e.target.value) })} />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-600">注:分数最低为 0,扣分不会低于 0;初始分数仅影响之后新增的学生。</p>
      </Section>

      <Section title="快捷理由" icon={<ListPlus className="h-4 w-4 text-emerald-400" />}>
        <div className="grid gap-5 sm:grid-cols-2">
          <PresetEditor title="加分理由" items={form.preset_add} sign={1} onChange={(v) => set({ preset_add: v })} />
          <PresetEditor title="扣分理由" items={form.preset_deduct} sign={-1} onChange={(v) => set({ preset_deduct: v })} />
        </div>
      </Section>

      <Section title="Webhook 通知" icon={<Webhook className="h-4 w-4 text-cyan-400" />}>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={form.webhook.enabled} onChange={(e) => set({ webhook: { ...form.webhook, enabled: e.target.checked } })} />
            启用 Webhook(所有操作推送到外部)
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Webhook URL</span>
            <input className="cs-input" placeholder="https://example.com/hook" value={form.webhook.url} onChange={(e) => set({ webhook: { ...form.webhook, url: e.target.value } })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">签名密钥(可选,HMAC-SHA256,写入 X-ClassScore-Signature)</span>
            <input className="cs-input" value={form.webhook.secret} onChange={(e) => set({ webhook: { ...form.webhook, secret: e.target.value } })} />
          </label>
          <div>
            <span className="mb-1.5 block text-xs text-slate-400">推送事件</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EVENT_LABELS) as WebhookEventGroup[]).map((g) => (
                <label key={g} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-cyan-500"
                    checked={form.webhook.events?.[g] !== false}
                    onChange={(e) => set({ webhook: { ...form.webhook, events: { ...form.webhook.events, [g]: e.target.checked } } })}
                  />
                  {EVENT_LABELS[g]}
                </label>
              ))}
            </div>
          </div>
          <button onClick={testWebhook} disabled={busy || !form.webhook.url} className="cs-btn border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10">
            <Send className="h-4 w-4" /> 发送测试
          </button>
        </div>
      </Section>

      <div className="flex justify-end">
        <motion.button whileTap={{ scale: 0.97 }} onClick={save} disabled={busy} className="cs-btn bg-indigo-500 px-6 text-white hover:bg-indigo-400">
          <Save className="h-4 w-4" /> 保存全部设置
        </motion.button>
      </div>

      <Section title="账号与安全" icon={<ShieldCheck className="h-4 w-4 text-amber-400" />}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <span className="text-xs text-slate-400">修改密码</span>
            <input type="password" className="cs-input" placeholder="当前密码" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
            <input type="password" className="cs-input" placeholder="新密码(至少 6 位)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <button onClick={changePw} disabled={busy || !oldPw || newPw.length < 6} className="cs-btn border border-slate-700 text-slate-300">
              <KeyRound className="h-4 w-4" /> 修改密码
            </button>
          </div>
          <div className="space-y-2">
            <span className="text-xs text-slate-400">两步验证(2FA)</span>
            {!rebindUri ? (
              <button onClick={startRebind} disabled={busy} className="cs-btn border border-slate-700 text-slate-300">
                <RefreshCw className="h-4 w-4" /> 重新绑定验证器
              </button>
            ) : (
              <div className="space-y-2">
                <p className="break-all rounded bg-slate-900 p-2 text-[10px] text-slate-500">{rebindUri}</p>
                <input className="cs-input text-center tracking-[0.4em]" maxLength={6} inputMode="numeric" placeholder="000000" value={rebindCode} onChange={(e) => setRebindCode(e.target.value.replace(/\D/g, ""))} />
                <div className="flex gap-2">
                  <button onClick={confirmRebind} disabled={busy || rebindCode.length !== 6} className="cs-btn bg-emerald-500/20 text-emerald-300">确认绑定</button>
                  <button onClick={() => setRebindUri("")} className="cs-btn text-slate-500">取消</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="数据管理" icon={<Database className="h-4 w-4 text-slate-400" />}>
        <p className="text-xs text-slate-500">
          数据备份 / 恢复请到「学生管理」页操作(支持 CSV 导出、JSON 全量备份与恢复)。重置全班分数也在该页。
        </p>
      </Section>
    </div>
  );
}
