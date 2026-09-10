import { Hono } from "hono";
import type { Env } from "../types";
import { getSettings, seedDefaults, DEFAULT_SETTINGS } from "../lib/settings";
import { recordOperation, undoLastOperation } from "../lib/oplog";
import { sendWebhook, testWebhook } from "../lib/webhook";
import { verifyPassword } from "../lib/auth";
import { verifyTotp } from "../lib/totp";
import { getSetting, setSetting } from "../lib/db";
import type { AppSettings } from "../../shared/types";

const RESET_CONFIRM_PHRASE = "重置整个系统";

type App = { Bindings: Env };

export const systemRoutes = new Hono<App>();

systemRoutes.use("*", async (c, next) => {
  const { requireAuth } = await import("../lib/auth");
  return requireAuth(c, next);
});

systemRoutes.get("/settings", async (c) => {
  return c.json(await getSettings(c.env.DB));
});

// 管理台一次拉取所需全部状态(学生 + 设置 + 最近操作),避免多次请求
systemRoutes.get("/state", async (c) => {
  const db = c.env.DB;
  const [students, settings, lastOperation] = await Promise.all([
    db.prepare("SELECT id, name, student_no, score FROM students ORDER BY id ASC").all(),
    getSettings(db),
    db
      .prepare(
        "SELECT id, type, summary, undone, created_at FROM operations WHERE undone = 0 AND type <> 'undo' ORDER BY id DESC LIMIT 1"
      )
      .first(),
  ]);
  return c.json({ students: students.results, settings, lastOperation: lastOperation ?? null });
});

// 保存设置(记录每项变更的旧值,支持撤销)
systemRoutes.post("/settings", async (c) => {
  const body = await c.req.json<Partial<AppSettings>>();
  const db = c.env.DB;
  const before = await getSettings(db);
  const next: AppSettings = { ...before };

  const changes: { key: string; before: unknown }[] = [];
  const mark = (key: string, oldVal: unknown) => changes.push({ key, before: oldVal });

  if (typeof body.class_name === "string" && body.class_name.trim()) {
    next.class_name = body.class_name.trim().slice(0, 30);
  }
  for (const key of ["initial_score", "lottery_cost", "lottery_min_score"] as const) {
    if (body[key] !== undefined) {
      const v = Math.trunc(Number(body[key]));
      if (Number.isFinite(v) && v >= 0 && v <= 999) next[key] = v;
    }
  }
  if (next.lottery_min_score < 0) next.lottery_min_score = 0;

  if (Array.isArray(body.preset_add)) {
    const arr = body.preset_add
      .slice(0, 20)
      .map((r) => ({ label: String(r?.label ?? "").trim().slice(0, 20), delta: Math.trunc(Number(r?.delta ?? 0)) }))
      .filter((r) => r.label && Number.isFinite(r.delta) && r.delta !== 0);
    if (arr.length) next.preset_add = arr;
  }
  if (Array.isArray(body.preset_deduct)) {
    const arr = body.preset_deduct
      .slice(0, 20)
      .map((r) => ({ label: String(r?.label ?? "").trim().slice(0, 20), delta: Math.trunc(Number(r?.delta ?? 0)) }))
      .filter((r) => r.label && Number.isFinite(r.delta) && r.delta !== 0);
    if (arr.length) next.preset_deduct = arr;
  }

  if (body.webhook && typeof body.webhook === "object") {
    const w = body.webhook;
    next.webhook = {
      enabled: !!w.enabled,
      url: String(w.url ?? "").trim().slice(0, 500),
      secret: String(w.secret ?? "").slice(0, 200),
      events: { ...before.webhook.events, ...(w.events ?? {}) },
    };
  }

  // 找出实际变化的项
  const stmts: D1PreparedStatement[] = [];
  const diff = (key: keyof AppSettings) => {
    const b = JSON.stringify(before[key]);
    const n = JSON.stringify(next[key]);
    if (b !== n) {
      mark(key, before[key]);
      stmts.push(
        db
          .prepare(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2"
          )
          .bind(key, n)
      );
    }
  };
  (Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]).forEach(diff);

  if (!stmts.length) return c.json({ ok: true, unchanged: true });

  const labels: Record<string, string> = {
    class_name: "班级名",
    initial_score: "初始分数",
    lottery_cost: "抽奖消耗",
    lottery_min_score: "抽奖门槛",
    preset_add: "加分理由",
    preset_deduct: "扣分理由",
    webhook: "Webhook",
  };
  const summary = `修改设置:${changes.map((ch) => labels[ch.key] ?? ch.key).join("、")}`;
  const opId = await recordOperation(db, "settings.update", summary, { changes });

  await db.batch(stmts);
  sendWebhook(c, next, "settings.update", summary, { changes, operationId: opId });
  return c.json({ ok: true, settings: next });
});

// 撤销上一步操作
systemRoutes.post("/undo", async (c) => {
  const result = await undoLastOperation(c.env.DB);
  if (!result) return c.json({ error: "没有可撤销的操作" }, 400);
  const settings = await getSettings(c.env.DB);
  sendWebhook(c, settings, "undo.done", `已撤销:${result.summary}`, {
    undone: result,
  });
  return c.json({ ok: true, undone: result });
});

// 最近操作列表
systemRoutes.get("/operations", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const { results } = await c.env.DB.prepare(
    "SELECT id, type, summary, undone, created_at FROM operations ORDER BY id DESC LIMIT ?1"
  )
    .bind(limit)
    .all();
  return c.json(results);
});

// Webhook 测试
systemRoutes.post("/webhook-test", async (c) => {
  const settings = await getSettings(c.env.DB);
  if (!settings.webhook.url) return c.json({ error: "请先填写 Webhook 地址" }, 400);
  const r = await testWebhook(settings, { hello: "classscore" });
  return r.ok
    ? c.json({ ok: true, status: r.status })
    : c.json({ error: `发送失败(HTTP ${r.status || "无响应"})` }, 502);
});

// 全量导入(备份恢复)
systemRoutes.post("/import", async (c) => {
  const body = await c.req.json<{
    students?: unknown[];
    prizes?: unknown[];
    scoreLogs?: unknown[];
    lotteryLogs?: unknown[];
  }>();
  if (!Array.isArray(body.students) || !body.students.length)
    return c.json({ error: "备份文件无学生数据" }, 400);

  const db = c.env.DB;
  const [students, prizes, scoreLogs, lotteryLogs] = await Promise.all([
    db.prepare("SELECT * FROM students").all(),
    db.prepare("SELECT * FROM prizes").all(),
    db.prepare("SELECT * FROM score_logs").all(),
    db.prepare("SELECT * FROM lottery_logs").all(),
  ]);

  const opId = await recordOperation(db, "data.import", "导入备份数据", {
    students: students.results,
    prizes: prizes.results,
    scoreLogs: scoreLogs.results,
    lotteryLogs: lotteryLogs.results,
  });

  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM lottery_logs"),
    db.prepare("DELETE FROM score_logs"),
    db.prepare("DELETE FROM prizes"),
    db.prepare("DELETE FROM students"),
  ];
  for (const s of body.students as Record<string, unknown>[]) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO students (id, name, student_no, score, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET name=?2, student_no=?3, score=?4, created_at=?5"
        )
        .bind(Number(s.id), String(s.name ?? "").slice(0, 40), String(s.student_no ?? ""), Math.max(0, Math.trunc(Number(s.score ?? 0))), Number(s.created_at) || Date.now())
    );
  }
  if (Array.isArray(body.prizes)) {
    for (const p of body.prizes as Record<string, unknown>[]) {
      stmts.push(
        db
          .prepare(
            "INSERT INTO prizes (id, name, weight, stock, color, enabled, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET name=?2, weight=?3, stock=?4, color=?5, enabled=?6"
          )
          .bind(
            Number(p.id),
            String(p.name ?? "").slice(0, 20),
            Math.max(1, Math.trunc(Number(p.weight ?? 1))),
            p.stock === null || p.stock === undefined ? null : Math.trunc(Number(p.stock)),
            /^#[0-9a-fA-F]{6}$/.test(String(p.color)) ? String(p.color) : "#6366f1",
            Number(p.enabled) ? 1 : 0,
            Number(p.created_at) || Date.now()
          )
      );
    }
  }
  if (Array.isArray(body.scoreLogs)) {
    for (const l of body.scoreLogs as Record<string, unknown>[]) {
      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO score_logs (id, student_id, delta, reason, source, operation_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
          )
          .bind(
            Number(l.id),
            Number(l.student_id),
            Math.trunc(Number(l.delta ?? 0)),
            String(l.reason ?? ""),
            String(l.source ?? "teacher"),
            l.operation_id === null ? null : Number(l.operation_id),
            Number(l.created_at) || Date.now()
          )
      );
    }
  }
  if (Array.isArray(body.lotteryLogs)) {
    for (const l of body.lotteryLogs as Record<string, unknown>[]) {
      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO lottery_logs (id, student_id, prize_id, prize_name, cost, operation_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
          )
          .bind(
            Number(l.id),
            Number(l.student_id),
            l.prize_id === null ? null : Number(l.prize_id),
            String(l.prize_name ?? ""),
            Math.trunc(Number(l.cost ?? 0)),
            l.operation_id === null ? null : Number(l.operation_id),
            Number(l.created_at) || Date.now()
          )
      );
    }
  }

  await db.batch(stmts);
  sendWebhook(c, await getSettings(db), "system.import", "导入备份数据", {
    students: body.students.length,
    operationId: opId,
  });
  return c.json({ ok: true, students: body.students.length });
});

// 全部重置:清空全部业务数据并恢复默认设置(需密码 + 动态验证码双重认证)
systemRoutes.post("/reset-all", async (c) => {
  const { password, code, confirm } = await c.req.json<{
    password?: string;
    code?: string;
    confirm?: string;
  }>();

  if (confirm !== RESET_CONFIRM_PHRASE) return c.json({ error: "确认文字不正确" }, 400);

  const db = c.env.DB;
  const [pwHash, totpSecret, totpConfirmed, lastStep] = await Promise.all([
    getSetting<string>(db, "auth_pw_hash"),
    getSetting<string>(db, "totp_secret"),
    getSetting<boolean>(db, "totp_confirmed"),
    getSetting<number>(db, "auth_last_step"),
  ]);

  if (!pwHash || !totpSecret || !totpConfirmed)
    return c.json({ error: "账号安全状态异常,无法执行重置" }, 400);

  if (!(await verifyPassword(password ?? "", pwHash))) return c.json({ error: "密码错误" }, 401);

  const step = await verifyTotp(totpSecret, code ?? "", { minStep: lastStep ?? 0 });
  if (step === null) return c.json({ error: "动态验证码错误" }, 401);
  await setSetting(db, "auth_last_step", step);

  await db.batch([
    db.prepare("DELETE FROM students"),
    db.prepare("DELETE FROM score_logs"),
    db.prepare("DELETE FROM lottery_logs"),
    db.prepare("DELETE FROM prizes"),
    db.prepare("DELETE FROM operations"),
    db.prepare(
      "DELETE FROM settings WHERE key NOT IN ('auth_pw_hash','totp_secret','totp_confirmed','totp_login_enabled','auth_last_step','session_secret')"
    ),
  ]);
  await seedDefaults(db);

  sendWebhook(c, await getSettings(db), "system.reset_all", "已重置整个系统(清空全部数据并恢复默认设置)", {});
  return c.json({ ok: true });
});
