import { Hono } from "hono";
import type { Env } from "../types";
import { getSettings, seedDefaults } from "../lib/settings";
import { createSession, destroySession, hashPassword, requireAuth, verifyPassword } from "../lib/auth";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../lib/totp";
import { getSetting, setSetting, deleteSetting } from "../lib/db";
import { sendWebhook } from "../lib/webhook";

type App = { Bindings: Env };

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;

interface AuthState {
  pwHash: string | null;
  totpSecret: string | null;
  totpConfirmed: boolean;
  fails: number;
  lockedUntil: number;
  lastStep: number;
}

async function loadAuthState(db: D1Database): Promise<AuthState> {
  const [pwHash, totpSecret, totpConfirmed, fails, lockedUntil, lastStep] = await Promise.all([
    getSetting<string>(db, "auth_pw_hash"),
    getSetting<string>(db, "totp_secret"),
    getSetting<boolean>(db, "totp_confirmed"),
    getSetting<number>(db, "auth_fails"),
    getSetting<number>(db, "auth_locked_until"),
    getSetting<number>(db, "auth_last_step"),
  ]);
  return {
    pwHash: pwHash ?? null,
    totpSecret: totpSecret ?? null,
    totpConfirmed: totpConfirmed ?? false,
    fails: fails ?? 0,
    lockedUntil: lockedUntil ?? 0,
    lastStep: lastStep ?? 0,
  };
}

async function saveAuthState(db: D1Database, s: AuthState): Promise<void> {
  const ops = [
    setSetting(db, "auth_fails", s.fails),
    setSetting(db, "auth_locked_until", s.lockedUntil),
    setSetting(db, "auth_last_step", s.lastStep),
    s.pwHash ? setSetting(db, "auth_pw_hash", s.pwHash) : deleteSetting(db, "auth_pw_hash"),
  ];
  await Promise.all(ops);
}

export const authRoutes = new Hono<App>();

authRoutes.get("/status", async (c) => {
  await seedDefaults(c.env.DB);
  const st = await loadAuthState(c.env.DB);
  return c.json({ initialized: !!(st.pwHash && st.totpConfirmed) });
});

// 初始化:设置教师密码 + 生成 TOTP 密钥(返回 otpauth 链接,前端渲染二维码)
authRoutes.post("/init", async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  if (!password || password.length < 6)
    return c.json({ error: "密码至少 6 位" }, 400);
  const st = await loadAuthState(c.env.DB);
  if (st.pwHash && st.totpConfirmed) return c.json({ error: "已初始化,请直接登录" }, 400);

  const pwHash = await hashPassword(password);
  const secret = generateTotpSecret();
  await setSetting(c.env.DB, "auth_pw_hash", pwHash);
  await setSetting(c.env.DB, "totp_secret", secret);
  await setSetting(c.env.DB, "totp_confirmed", false);

  const uri = otpauthUri(secret, "teacher", "ClassScore");
  return c.json({ otpauth: uri, secret });
});

// 确认绑定:校验首个验证码,TOTP 正确才算初始化完成
authRoutes.post("/init/confirm", async (c) => {
  const { code } = await c.req.json<{ code?: string }>();
  const secret = await getSetting<string>(c.env.DB, "totp_secret");
  const confirmed = await getSetting<boolean>(c.env.DB, "totp_confirmed");
  if (!secret) return c.json({ error: "请先设置密码完成初始化" }, 400);
  if (confirmed) return c.json({ error: "已绑定,请直接登录" }, 400);
  const step = await verifyTotp(secret, code ?? "", { minStep: 0 });
  if (step === null) return c.json({ error: "验证码错误,请重试" }, 400);
  await setSetting(c.env.DB, "totp_confirmed", true);
  await setSetting(c.env.DB, "auth_last_step", step);
  sendWebhook(c, await getSettings(c.env.DB), "auth.init", "教师端完成 2FA 初始化", {});
  return c.json({ ok: true });
});

authRoutes.post("/login", async (c) => {
  const { password, code } = await c.req.json<{ password?: string; code?: string }>();
  const st = await loadAuthState(c.env.DB);

  if (Date.now() < st.lockedUntil) {
    const mins = Math.ceil((st.lockedUntil - Date.now()) / 60000);
    return c.json({ error: `尝试次数过多,已锁定,请 ${mins} 分钟后再试` }, 429);
  }

  let passwordOk = false;
  if (st.pwHash) {
    passwordOk = !!(password && (await verifyPassword(password, st.pwHash)));
  }

  if (!passwordOk) {
    const fails = st.fails + 1;
    const lockedUntil = fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
    await saveAuthState(c.env.DB, { ...st, fails, lockedUntil });
    sendWebhook(c, await getSettings(c.env.DB), "auth.login_failed", "教师端登录失败", { fails });
    return c.json({ error: lockedUntil ? "尝试次数过多,已锁定 10 分钟" : "密码或验证码错误" }, 401);
  }

  if (st.totpConfirmed && st.totpSecret) {
    const step = await verifyTotp(st.totpSecret, code ?? "", { minStep: st.lastStep });
    if (step === null) {
      const fails = st.fails + 1;
      const lockedUntil = fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
      await saveAuthState(c.env.DB, { ...st, fails, lockedUntil });
      sendWebhook(c, await getSettings(c.env.DB), "auth.login_failed", "教师端登录失败(2FA)", { fails });
      return c.json({ error: lockedUntil ? "尝试次数过多,已锁定 10 分钟" : "密码或验证码错误" }, 401);
    }
    await saveAuthState(c.env.DB, { ...st, fails: 0, lockedUntil: 0, lastStep: step });
  } else if (st.pwHash && !st.totpConfirmed) {
    return c.json({ error: "需要重新绑定 2FA", needRebind: true }, 403);
  } else if (!st.pwHash) {
    return c.json({ error: "尚未初始化", needInit: true }, 403);
  }

  await createSession(c);
  sendWebhook(c, await getSettings(c.env.DB), "auth.login", "教师端登录成功", {});
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, (c) => c.json({ ok: true }));

// 修改密码(需已登录)
authRoutes.post("/password", requireAuth, async (c) => {
  const { oldPassword, newPassword } = await c.req.json<{
    oldPassword?: string;
    newPassword?: string;
  }>();
  const st = await loadAuthState(c.env.DB);
  if (!st.pwHash) return c.json({ error: "状态异常" }, 400);
  if (!(await verifyPassword(oldPassword ?? "", st.pwHash)))
    return c.json({ error: "当前密码错误" }, 400);
  if (!newPassword || newPassword.length < 6)
    return c.json({ error: "新密码至少 6 位" }, 400);
  await setSetting(c.env.DB, "auth_pw_hash", await hashPassword(newPassword));
  sendWebhook(c, await getSettings(c.env.DB), "auth.password_changed", "教师密码已修改", {});
  return c.json({ ok: true });
});

// 重新绑定 2FA(需已登录)
authRoutes.post("/totp/rebind", requireAuth, async (c) => {
  const secret = generateTotpSecret();
  await setSetting(c.env.DB, "totp_secret", secret);
  await setSetting(c.env.DB, "totp_confirmed", false);
  const uri = otpauthUri(secret, "teacher", "ClassScore");
  return c.json({ otpauth: uri, secret });
});

authRoutes.post("/totp/rebind/confirm", requireAuth, async (c) => {
  const { code } = await c.req.json<{ code?: string }>();
  const secret = await getSetting<string>(c.env.DB, "totp_secret");
  if (!secret) return c.json({ error: "请先生成新密钥" }, 400);
  const step = await verifyTotp(secret, code ?? "", { minStep: 0 });
  if (step === null) return c.json({ error: "验证码错误,请重试" }, 400);
  await setSetting(c.env.DB, "totp_confirmed", true);
  await setSetting(c.env.DB, "auth_last_step", step);
  sendWebhook(c, await getSettings(c.env.DB), "auth.totp_rebound", "2FA 已重新绑定", {});
  return c.json({ ok: true });
});

// 清除全部登录保护状态(忘记密码时使用):见 package.json 中 db:reset-auth 脚本
