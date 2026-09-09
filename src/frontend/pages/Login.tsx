import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, Link } from "react-router-dom";
import { ShieldCheck, KeyRound, ArrowLeft, QrCode } from "lucide-react";
import { api } from "../lib/api";

function QrImage({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        if (!cancelled && ref.current) {
          await QRCode.toCanvas(ref.current, text, { width: 200, margin: 1, color: { dark: "#0f172a", light: "#e2e8f0" } });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);
  return <canvas ref={ref} className="rounded-lg" />;
}

type Mode = "loading" | "init" | "bind" | "login" | "rebind";

export default function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("loading");
  const [otpauth, setOtpauth] = useState("");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ initialized: boolean }>("/api/auth/status")
      .then((r) => setMode(r.initialized ? "login" : "init"))
      .catch(() => setError("无法连接服务器"));
  }, []);

  const checkSession = async () => {
    try {
      await api.get("/api/auth/me");
      nav("/admin", { replace: true });
    } catch {
      /* not logged in */
    }
  };
  useEffect(() => {
    void checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doInit = async () => {
    setError("");
    if (password.length < 6) return setError("密码至少 6 位");
    if (password !== password2) return setError("两次密码不一致");
    setBusy(true);
    try {
      const r = await api.post<{ otpauth: string; secret: string }>("/api/auth/init", { password });
      setOtpauth(r.otpauth);
      setSecret(r.secret);
      setMode("bind");
    } catch (e) {
      setError(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  };

  const doBind = async () => {
    setError("");
    setBusy(true);
    try {
      await api.post("/api/auth/init/confirm", { code });
      nav("/admin", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  };

  const doLogin = async () => {
    setError("");
    setBusy(true);
    try {
      await api.post("/api/auth/login", { password, code });
      nav("/admin", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/40 to-slate-950 px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="cs-card w-full max-w-md p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/20">
            <ShieldCheck className="h-6 w-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100">教师端登录</h1>
            <p className="text-xs text-slate-500">
              {mode === "init" && "首次使用:设置教师密码"}
              {mode === "bind" && "用验证器 App 扫码绑定两步验证"}
              {mode === "login" && "密码 + 动态验证码"}
              {mode === "loading" && "检查初始化状态…"}
            </p>
          </div>
          <Link to="/" className="ml-auto text-slate-500 hover:text-slate-300" title="返回学生端">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {mode === "init" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">设置教师密码</label>
              <input type="password" className="cs-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">确认密码</label>
              <input type="password" className="cs-input" value={password2} onChange={(e) => setPassword2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doInit()} />
            </div>
            <button className="cs-btn w-full bg-indigo-500 text-white hover:bg-indigo-400" disabled={busy} onClick={doInit}>
              <KeyRound className="h-4 w-4" /> 下一步:绑定 2FA
            </button>
          </div>
        )}

        {mode === "bind" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-800/50 p-4">
              <QrCode className="h-5 w-5 text-indigo-400" />
              <QrImage text={otpauth} />
              <p className="text-center text-xs text-slate-400">
                用 Google Authenticator / 微信小程序「腾讯身份验证器」等扫码
              </p>
              <code className="break-all rounded bg-slate-900 px-2 py-1 text-[10px] text-slate-500">{secret}</code>
            </div>
            <input className="cs-input text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
            <button className="cs-btn w-full bg-indigo-500 text-white hover:bg-indigo-400" disabled={busy || code.length !== 6} onClick={doBind}>
              确认绑定并登录
            </button>
          </div>
        )}

        {mode === "login" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">密码</label>
              <input type="password" className="cs-input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">两步验证码(6 位)</label>
              <input className="cs-input text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" onKeyDown={(e) => e.key === "Enter" && doLogin()} />
            </div>
            <button className="cs-btn w-full bg-indigo-500 text-white hover:bg-indigo-400" disabled={busy || !code} onClick={doLogin}>
              <ShieldCheck className="h-4 w-4" /> 登录
            </button>
          </div>
        )}

        {mode === "loading" && <p className="py-8 text-center text-slate-500">加载中…</p>}
      </motion.div>
    </div>
  );
}
