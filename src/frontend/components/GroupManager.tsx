import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import { toast } from "react-hot-toast";
import type { Student, StudentGroup } from "@shared/types";
import { api } from "../lib/api";

interface Draft {
  id?: number;
  name: string;
  studentIds: Set<number>;
}

export default function GroupManager({ students, groups, onDone }: {
  students: Student[];
  groups: StudentGroup[];
  onDone: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(students.map((s) => [s.id, s.name]));
  const filtered = useMemo(() => students.filter((s) => s.name.includes(query) || s.student_no.includes(query)), [students, query]);

  useEffect(() => {
    setDraft(null);
    setQuery("");
  }, [groups]);

  const edit = (group?: StudentGroup) => {
    setDraft({ id: group?.id, name: group?.name ?? "", studentIds: new Set(group?.studentIds ?? []) });
    setQuery("");
  };

  const toggle = (id: number) => setDraft((prev) => {
    if (!prev) return prev;
    const ids = new Set(prev.studentIds);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ...prev, studentIds: ids };
  });

  const save = async () => {
    if (!draft || busy) return;
    if (!draft.name.trim()) return toast.error("请填写分组名称");
    setBusy(true);
    try {
      await api.post(`/api/groups/${draft.id ? "update" : "create"}`, {
        id: draft.id,
        name: draft.name.trim(),
        studentIds: [...draft.studentIds],
      });
      toast.success(draft.id ? "分组已保存" : "分组已创建");
      setDraft(null);
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (group: StudentGroup) => {
    if (busy || !confirm(`删除分组「${group.name}」？不会删除学生或改变分数，可通过撤销恢复。`)) return;
    setBusy(true);
    try {
      await api.post("/api/groups/delete", { id: group.id });
      toast.success("分组已删除");
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cs-card space-y-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-slate-200"><Users className="h-5 w-5 text-indigo-400" /> 分组管理</h2>
        <button disabled={busy || groups.length >= 50} onClick={() => edit()} className="cs-btn ml-auto bg-indigo-500/20 text-indigo-300">
          <Plus className="h-4 w-4" /> 新建分组
        </button>
      </div>
      <p className="text-xs text-slate-500">提前设置成员，加减分时一键选择整组。每名学生可以加入多个组，最多 50 组、每组 500 人。</p>

      {draft && (
        <div className="space-y-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
          <h3 className="text-sm font-semibold text-indigo-300">{draft.id ? "编辑分组" : "新建分组"}</h3>
          <label className="block space-y-1 text-xs text-slate-400">
            <span>分组名称</span>
            <input autoFocus disabled={busy} className="cs-input" placeholder="例如：第一组、值日生" maxLength={30} value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="cs-input pl-9" aria-label="搜索分组成员" placeholder="搜索姓名/学号" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>已选 <b className="text-indigo-300">{draft.studentIds.size}</b> 人</span>
            <button disabled={busy} onClick={() => setDraft({ ...draft, studentIds: new Set([...draft.studentIds, ...filtered.map((s) => s.id)]) })} className="ml-auto text-indigo-300">全选搜索结果</button>
            <button disabled={busy} onClick={() => setDraft({ ...draft, studentIds: new Set() })}>清空</button>
          </div>
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-5">
            {filtered.map((s) => (
              <label key={s.id} className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${draft.studentIds.has(s.id) ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200" : "border-slate-800 text-slate-400"}`}>
                <input disabled={busy} type="checkbox" checked={draft.studentIds.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 shrink-0 accent-indigo-500" />
                <span className="truncate">{s.name}</span>
              </label>
            ))}
            {!filtered.length && <p className="col-span-full py-4 text-center text-sm text-slate-500">{students.length ? "没有匹配的学生" : "请先添加学生，也可以先保存空分组"}</p>}
          </div>
          <div className="flex gap-2">
            <button disabled={busy || !draft.name.trim() || draft.studentIds.size > 500} onClick={save} className="cs-btn bg-indigo-500 text-white hover:bg-indigo-400"><Check className="h-4 w-4" /> {busy ? "保存中…" : "保存分组"}</button>
            <button disabled={busy} onClick={() => setDraft(null)} className="cs-btn border border-slate-700 text-slate-400"><X className="h-4 w-4" /> 取消</button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.id} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">{g.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{g.studentIds.length} 人</span>
              <button disabled={busy} onClick={() => edit(g)} aria-label={`编辑分组${g.name}`} className="p-1 text-slate-500 hover:text-indigo-300"><Pencil className="h-4 w-4" /></button>
              <button disabled={busy} onClick={() => remove(g)} aria-label={`删除分组${g.name}`} className="p-1 text-slate-500 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">{g.studentIds.map((id) => names.get(id)).filter(Boolean).join("、") || "暂无成员，编辑分组可添加"}</p>
          </div>
        ))}
      </div>
      {!groups.length && !draft && <p className="py-4 text-center text-sm text-slate-500">还没有分组，点击「新建分组」开始</p>}
    </section>
  );
}
