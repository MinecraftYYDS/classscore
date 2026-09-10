import { Hono } from "hono";
import type { Env } from "../types";
import { getSettings } from "../lib/settings";
import { recordOperation } from "../lib/oplog";
import { sendWebhook } from "../lib/webhook";
import type { StudentRow } from "./score";

type App = { Bindings: Env };

export const studentRoutes = new Hono<App>();

studentRoutes.use("*", async (c, next) => {
  const { requireAuth } = await import("../lib/auth");
  return requireAuth(c, next);
});

studentRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, student_no, score FROM students ORDER BY id ASC"
  ).all();
  return c.json(results);
});

// 批量加入学生(按行拆分姓名,支持"姓名 学号")
studentRoutes.post("/batch-add", async (c) => {
  const body = await c.req.json<{ names?: string[]; namesText?: string }>();
  const settings = await getSettings(c.env.DB);
  const initial = settings.initial_score;

  const rawNames = body.names && body.names.length ? body.names : (body.namesText ?? "").split(/\r?\n/);
  const parsed = rawNames
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\S+)(?:\s+(\S+))?$/);
      return m ? { name: m[1], no: m[2] ?? "" } : null;
    })
    .filter((x): x is { name: string; no: string } => !!x);

  if (!parsed.length) return c.json({ error: "没有可添加的姓名" }, 400);
  if (parsed.length > 200) return c.json({ error: "一次最多添加 200 人" }, 400);

  const existing = await c.env.DB.prepare("SELECT name FROM students").all<{ name: string }>();
  const have = new Set(existing.results.map((r) => r.name));
  const added: { id: number; name: string; score: number }[] = [];
  const skipped: string[] = [];
  const now = Date.now();

  for (const p of parsed) {
    if (have.has(p.name)) {
      skipped.push(p.name);
      continue;
    }
    const res = await c.env.DB.prepare(
      "INSERT INTO students (name, student_no, score, created_at) VALUES (?1, ?2, ?3, ?4)"
    )
      .bind(p.name, p.no, initial, now)
      .run();
    have.add(p.name);
    added.push({ id: Number(res.meta.last_row_id), name: p.name, score: initial });
  }

  if (!added.length) return c.json({ error: "全部姓名已存在", skipped }, 409);

  const opId = await recordOperation(c.env.DB, "student.add", `新增学生 ${added.length} 人`, {
    students: added.map((a) => ({ ...a, created_at: now, student_no: "" })),
  });

  sendWebhook(c, 
    settings,
    "student.add",
    `新增学生:${added.map((a) => a.name).join("、")}${skipped.length ? `(跳过已存在:${skipped.join("、")})` : ""}`,
    { added, skipped, initialScore: initial, operationId: opId }
  );
  return c.json({ ok: true, added, skipped });
});

// 批量删除学生(连带其分数记录)
studentRoutes.post("/batch-delete", async (c) => {
  const { ids } = await c.req.json<{ ids?: number[] }>();
  const clean = [...new Set((ids ?? []).filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return c.json({ error: "请选择要删除的学生" }, 400);

  const ph = clean.map(() => "?").join(",");
  const students = await c.env.DB.prepare(
    `SELECT id, name, student_no, score, created_at FROM students WHERE id IN (${ph})`
  )
    .bind(...clean)
    .all();
  const logs = await c.env.DB.prepare(
    `SELECT id, student_id, delta, reason, source, operation_id, created_at FROM score_logs WHERE student_id IN (${ph})`
  )
    .bind(...clean)
    .all();

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM score_logs WHERE student_id IN (${ph})`).bind(...clean),
    c.env.DB.prepare(`DELETE FROM lottery_logs WHERE student_id IN (${ph})`).bind(...clean),
    c.env.DB.prepare(`DELETE FROM students WHERE id IN (${ph})`).bind(...clean),
  ]);

  const opId = await recordOperation(c.env.DB, "student.delete", `删除学生 ${students.results.length} 人`, {
    students: students.results,
    logs: logs.results,
  });

  const names = (students.results as { name: string }[]).map((s) => s.name).join("、");
  sendWebhook(c, await getSettings(c.env.DB), "student.delete", `删除学生:${names}`, {
    students: students.results,
    operationId: opId,
  });
  return c.json({ ok: true, count: students.results.length });
});

// 修改学生信息(姓名/学号)
studentRoutes.post("/update", async (c) => {
  const { id, name, studentNo } = await c.req.json<{
    id?: number;
    name?: string;
    studentNo?: string;
  }>();
  const sid = Number(id);
  const newName = (name ?? "").trim().slice(0, 40);
  if (!Number.isInteger(sid) || sid <= 0 || !newName)
    return c.json({ error: "参数错误" }, 400);

  const row = await c.env.DB.prepare("SELECT id, name, student_no FROM students WHERE id = ?1")
    .bind(sid)
    .first<{ id: number; name: string; student_no: string }>();
  if (!row) return c.json({ error: "学生不存在" }, 404);

  const dup = await c.env.DB.prepare("SELECT id FROM students WHERE name = ?1 AND id <> ?2")
    .bind(newName, sid)
    .first();
  if (dup) return c.json({ error: "已有同名学生" }, 400);

  await c.env.DB.prepare("UPDATE students SET name = ?1, student_no = ?2 WHERE id = ?3")
    .bind(newName, (studentNo ?? "").trim().slice(0, 40), sid)
    .run();

  const opId = await recordOperation(c.env.DB, "student.update", `${row.name} → ${newName}`, {
    studentId: sid,
    before: { name: row.name, student_no: row.student_no },
  });

  sendWebhook(c, 
    await getSettings(c.env.DB),
    "student.update",
    `修改学生:${row.name} → ${newName}`,
    { studentId: sid, before: row.name, after: newName, operationId: opId }
  );
  return c.json({ ok: true });
});

// 学生明细(分数历史 + 抽奖历史)
studentRoutes.get("/:id/detail", async (c) => {
  const sid = Number(c.req.param("id"));
  if (!Number.isInteger(sid)) return c.json({ error: "参数错误" }, 400);
  const student = await c.env.DB
    .prepare("SELECT id, name, student_no, score, created_at FROM students WHERE id = ?1")
    .bind(sid)
    .first();
  if (!student) return c.json({ error: "学生不存在" }, 404);
  const scores = await c.env.DB
    .prepare(
      "SELECT id, delta, reason, source, result, created_at FROM score_logs WHERE student_id = ?1 ORDER BY id DESC LIMIT 100"
    )
    .bind(sid)
    .all();
  const lotteries = await c.env.DB
    .prepare(
      "SELECT id, prize_name, cost, created_at FROM lottery_logs WHERE student_id = ?1 ORDER BY id DESC LIMIT 50"
    )
    .bind(sid)
    .all();
  return c.json({ student, scores: scores.results, lotteries: lotteries.results });
});

// 重置全班分数到初始值
studentRoutes.post("/reset-scores", async (c) => {
  const settings = await getSettings(c.env.DB);
  const { results } = await c.env.DB.prepare("SELECT id, name, score FROM students").all<StudentRow>();
  if (!results.length) return c.json({ error: "没有学生" }, 400);

  const opId = await recordOperation(c.env.DB, "reset.scores", `重置全班分数为 ${settings.initial_score}`, {
    scores: results.map((r) => ({ id: r.id, score: r.score })),
  });

  const stmts = results.map((r) =>
    c.env.DB.prepare("UPDATE students SET score = ?1 WHERE id = ?2").bind(settings.initial_score, r.id)
  );
  stmts.push(
    c.env.DB
      .prepare(
        "INSERT INTO score_logs (student_id, delta, reason, source, operation_id, created_at, result) SELECT id, ?1 - score, '重置分数', 'system', ?2, ?3, ?1 FROM students"
      )
      .bind(settings.initial_score, opId, Date.now())
  );
  await c.env.DB.batch(stmts);

  sendWebhook(c, 
    settings,
    "reset.scores",
    `全班分数已重置为 ${settings.initial_score}`,
    { count: results.length, operationId: opId }
  );
  return c.json({ ok: true, count: results.length });
});

// 操作日志(带学生名)
studentRoutes.get("/logs/all", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.student_id, s.name AS student_name, l.delta, l.reason, l.source, l.result, l.created_at
     FROM score_logs l LEFT JOIN students s ON s.id = l.student_id
     ORDER BY l.id DESC LIMIT ?1 OFFSET ?2`
  )
    .bind(limit, offset)
    .all();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS c FROM score_logs").first<{ c: number }>();
  return c.json({ logs: results, total: total?.c ?? 0 });
});

// 数据备份导出
studentRoutes.get("/export", async (c) => {
  const [students, scoreLogs, prizes, lotteryLogs, ops] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM students").all(),
    c.env.DB.prepare("SELECT * FROM score_logs").all(),
    c.env.DB.prepare("SELECT * FROM prizes").all(),
    c.env.DB.prepare("SELECT * FROM lottery_logs").all(),
    c.env.DB.prepare("SELECT * FROM operations").all(),
  ]);
  return c.json({
    version: 1,
    exportedAt: Date.now(),
    students: students.results,
    scoreLogs: scoreLogs.results,
    prizes: prizes.results,
    lotteryLogs: lotteryLogs.results,
    operations: ops.results,
  });
});
