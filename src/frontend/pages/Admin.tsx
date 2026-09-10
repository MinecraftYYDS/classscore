import { useCallback, useEffect, useState } from "react";
import { toast, Toaster } from "react-hot-toast";
import { AnimatePresence, motion } from "framer-motion";
import { Undo2, LogOut, Loader2 } from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { AppSettings, Operation, Student } from "@shared/types";
import { api } from "../lib/api";
import { SettingsProvider, useSettingsApply } from "../lib/settings";
import ThemeToggle from "../components/ThemeToggle";
import ScoreTab from "../components/tabs/ScoreTab";
import StudentsTab from "../components/tabs/StudentsTab";
import LotteryTab from "../components/tabs/LotteryTab";
import LogsTab from "../components/tabs/LogsTab";
import SettingsTab from "../components/tabs/SettingsTab";

const TABS = [
  { key: "score", label: "加减分", path: "/admin" },
  { key: "students", label: "学生管理", path: "/admin/students" },
  { key: "lottery", label: "抽奖", path: "/admin/lottery" },
  { key: "logs", label: "操作日志", path: "/admin/logs" },
  { key: "settings", label: "系统设置", path: "/admin/settings" },
] as const;

interface AdminState {
  students: Student[];
  settings: AppSettings;
  lastOperation: Operation | null;
}

function AdminInner() {
  const nav = useNavigate();
  const loc = useLocation();
  const activePath = loc.pathname.replace(/\/+$/, "") || "/admin";
  const isActive = (path: string) => (path === "/admin" ? activePath === "/admin" : activePath.startsWith(path));
  const [students, setStudents] = useState<Student[]>([]);
  const [lastOp, setLastOp] = useState<Operation | null>(null);
  const [undoing, setUndoing] = useState(false);
  const applySettings = useSettingsApply();

  const refreshAll = useCallback(async () => {
    try {
      const s = await api.get<AdminState>("/api/system/state");
      setStudents(s.students);
      setLastOp(s.lastOperation);
      applySettings(s.settings);
    } catch (e) {
      if ((e as Error & { status?: number }).status === 401) nav("/admin/login", { replace: true });
    }
  }, [nav, applySettings]);

  useEffect(() => {
    void fetch("/api/bootstrap").catch(() => undefined);
    void refreshAll();
  }, [refreshAll]);

  const undo = async () => {
    if (undoing) return;
    setUndoing(true);
    try {
      const r = await api.post<{ undone: Operation }>("/api/system/undo");
      toast.success(`已撤销:${r.undone.summary}`);
      await refreshAll();
      window.dispatchEvent(new CustomEvent("cs:refresh"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "撤销失败");
    } finally {
      setUndoing(false);
    }
  };

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    nav("/admin/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-950 pb-24 text-slate-200">
      <Toaster position="top-center" toastOptions={{ style: { background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155" } }} />

      {/* 顶栏 */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 lg:max-w-6xl 2xl:max-w-7xl">
          <h1 className="text-base font-bold text-slate-100">ClassScore 管理台</h1>
          <div className="ml-auto flex items-center gap-2">
            <AnimatePresence>
              {lastOp && !lastOp.undone && lastOp.type !== "undo" && (
                <motion.button
                  key={lastOp.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={undo}
                  disabled={undoing}
                  className="cs-btn bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                  title={`撤销:${lastOp.summary}`}
                >
                  {undoing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                  撤销
                </motion.button>
              )}
            </AnimatePresence>
            <ThemeToggle />
            <button onClick={logout} className="cs-btn border border-slate-700 text-slate-400 hover:border-rose-500/50 hover:text-rose-300">
              <LogOut className="h-4 w-4" /> 退出
            </button>
          </div>
        </div>

        {/* 标签页 */}
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 lg:max-w-6xl 2xl:max-w-7xl">
          {TABS.map((t) => {
            const active = isActive(t.path);
            return (
              <Link
                key={t.key}
                to={t.path}
                className={`relative shrink-0 px-4 py-2.5 text-sm font-medium transition ${
                  active ? "text-indigo-300" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t.label}
                {active && (
                  <motion.div layoutId="tab-underline" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-indigo-400" />
                )}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-6 lg:max-w-6xl 2xl:max-w-7xl">
        <Routes>
          <Route index element={<ScoreTab students={students} onDone={refreshAll} />} />
          <Route path="students" element={<StudentsTab students={students} onDone={refreshAll} />} />
          <Route path="lottery" element={<LotteryTab students={students} onDone={refreshAll} />} />
          <Route path="logs" element={<LogsTab />} />
          <Route path="settings" element={<SettingsTab onDone={refreshAll} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function Admin() {
  return (
    <SettingsProvider>
      <AdminInner />
    </SettingsProvider>
  );
}
