import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UserPlus, Trash2, Download, Pencil, RotateCcw, Upload, Check, X } from "lucide-react";
import { toast } from "react-hot-toast";
import type { Student } from "@shared/types";
import { api } from "../../lib/api";
import { useSettings } from "../../lib/settings";

export default function StudentsTab({ students, onDone }: { students: Student[]; onDone: () => Promise<void> }) {
  const settings = useSettings();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [namesText, setNamesText] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string; no: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const addStudents = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ added: unknown[]; skipped: string[] }>("/api/students/batch-add", { namesText });
      toast.success(`已添加 ${r.added.length} 人${r.skipped.length ? `,跳过 ${r.skipped.length} 个重名` : ""}`);
      setNamesText("");
      setAddOpen(false);
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected.size) return toast.error("请先勾选要删除的学生");
    if (!confirm(`确定删除选中的 ${selected.size} 名学生?其所有记录将被清除(可通过撤销恢复)`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ count: number }>("/api/students/batch-delete", { ids: [...selected] });
      toast.success(`已删除 ${r.count} 名学生`);
      setSelected(new Set());
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const resetScores = async () => {
    if (!confirm(`将全班 ${students.length} 名学生的分数重置为 ${settings.initial_score} 分?`)) return;
    setBusy(true);
    try {
      await api.post("/api/students/reset-scores");
      toast.success("已重置全班分数");
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重置失败");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.post("/api/students/update", { id: editing.id, name: editing.name, studentNo: editing.no });
      toast.success("已保存");
      setEditing(null);
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const rows = [["姓名", "学号", "分数"], ...students.map((s) => [s.name, s.student_no, String(s.score)])];
    const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `班级分数_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    if (!confirm("导入备份将覆盖当前全部数据(可撤销),确定?")) return;
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      const r = await api.post<{ students: unknown[] }>("/api/system/import", data);
      toast.success(`已导入 ${r.students} 名学生的备份`);
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = async () => {
    try {
      const data = await api.get<Record<string, unknown>>("/api/students/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `classscore_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("备份已下载");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    }
  };

  const previewNames = useMemo(
    () => namesText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    [namesText]
  );

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="cs-card flex flex-wrap items-center gap-2 p-3">
        <button onClick={() => setAddOpen((v) => !v)} className="cs-btn bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30">
          <UserPlus className="h-4 w-4" /> 批量加入
        </button>
        <button onClick={deleteSelected} disabled={!selected.size} className="cs-btn bg-rose-500/15 text-rose-300 hover:bg-rose-500/25">
          <Trash2 className="h-4 w-4" /> 删除选中 ({selected.size})
        </button>
        <button onClick={resetScores} className="cs-btn border border-slate-700 text-amber-300 hover:border-amber-500/50">
          <RotateCcw className="h-4 w-4" /> 重置分数
        </button>
        <div className="ml-auto flex gap-2">
          <button onClick={exportCsv} className="cs-btn border border-slate-700 text-slate-300"><Download className="h-4 w-4" /> CSV</button>
          <button onClick={exportBackup} className="cs-btn border border-slate-700 text-slate-300"><Download className="h-4 w-4" /> 备份</button>
          <label className="cs-btn cursor-pointer border border-slate-700 text-slate-300">
            <Upload className="h-4 w-4" /> 恢复
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
          </label>
        </div>
      </div>

      {/* 批量加入面板 */}
      <AnimatePresence>
        {addOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="cs-card space-y-3 p-4">
              <p className="text-xs text-slate-400">
                每行一个姓名,可选学号:<code className="rounded bg-slate-800 px-1">张三 2026001</code>。初始分 {settings.initial_score} 分(可在设置中修改)。
              </p>
              <textarea
                className="cs-input h-36 resize-y font-mono"
                placeholder={"张三\n李四 2026002\n王五"}
                value={namesText}
                onChange={(e) => setNamesText(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <button onClick={addStudents} disabled={busy || !previewNames.length} className="cs-btn bg-emerald-500 text-white hover:bg-emerald-400">
                  添加 {previewNames.length || ""} 人
                </button>
                <span className="text-xs text-slate-500">重名会自动跳过</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 学生列表 */}
      <div className="cs-card divide-y divide-slate-800/70">
        {students.length === 0 && <p className="p-8 text-center text-sm text-slate-500">还没有学生,点击「批量加入」开始</p>}
        {students.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 accent-indigo-500" />
            {editing?.id === s.id ? (
              <>
                <input className="cs-input flex-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <input className="cs-input w-28" placeholder="学号" value={editing.no} onChange={(e) => setEditing({ ...editing, no: e.target.value })} />
                <button onClick={saveEdit} disabled={busy} className="cs-btn bg-emerald-500/20 px-2 text-emerald-300"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditing(null)} className="cs-btn px-2 text-slate-500"><X className="h-4 w-4" /></button>
              </>
            ) : (
              <>
                <span className="flex-1 truncate text-sm text-slate-200">
                  {s.name}
                  {s.student_no && <span className="ml-2 text-xs text-slate-500">{s.student_no}</span>}
                </span>
                <span className={`text-sm font-bold tabular-nums ${s.score <= 0 ? "text-rose-400" : "text-slate-300"}`}>{s.score}</span>
                <button onClick={() => setEditing({ id: s.id, name: s.name, no: s.student_no })} className="text-slate-500 hover:text-indigo-300" title="编辑">
                  <Pencil className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
