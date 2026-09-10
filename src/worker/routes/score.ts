import { Hono } from "hono";
import type { Env } from "../types";
import { getSettings } from "../lib/settings";
import { recordOperation } from "../lib/oplog";
import { sendWebhook } from "../lib/webhook";

type App = { Bindings: Env };

export interface StudentRow {
  id: number;
  name: string;
  score: number;
}

export const scoreRoutes = new Hono<App>();

scoreRoutes.use("*", async (c, next) => {
  const { requireAuth } = await import("../lib/auth");
  return requireAuth(c, next);
});

// 批量加减分:ids + delta + reason(统一入口,扣分为负数)
scoreRoutes.post("/adjust", async (c) => {
  const { ids, delta, reason } = await c.req.json<{
    ids?: number[];
    delta?: number;
    reason?: string;
  }>();
  const cleanIds = [...new Set((ids ?? []).filter((n) => Number.isInteger(n) && n > 0))];
  const d = Math.trunc(Number(delta ?? 0));
  const why = (reason ?? "").trim().slice(0, 200) || (d >= 0 ? "加分" : "扣分");

  if (!cleanIds.length) return c.json({ error: "请选择学生" }, 400);
  if (d === 0) return c.json({ error: "分值不能为 0" }, 400);
  if (Math.abs(d) > 100) return c.json({ error: "单次分值不能超过 100" }, 400);

  const settings = await getSettings(c.env.DB);
  const floor = 0; // 最低 0 分

  const placeholders = cleanIds.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, score FROM students WHERE id IN (${placeholders})`
  )
    .bind(...cleanIds)
    .all<StudentRow>();
  const map = new Map(results.map((r) => [r.id, r]));

  const applied: { studentId: number; name: string; before: number; after: number }[] = [];
  let clipped = false;
  for (const id of cleanIds) {
    const row = map.get(id);
    if (!row) continue;
    let after = row.score + d;
    if (after < floor) {
      after = floor;
      clipped = true;
    }
    applied.push({ studentId: id, name: row.name, before: row.score, after });
  }
  if (!applied.length) return c.json({ error: "学生不存在" }, 404);

  const summary = `${d > 0 ? "加分" : "扣分"} ${Math.abs(d)} 分「${why}」→ ${applied.map((a) => a.name).join("、")}${clipped ? "(部分学生已达 0 分下限)" : ""}`;
  const opId = await recordOperation(c.env.DB, "score.adjust", summary, {
    reason: why,
    delta: d,
    applied,
  });

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const a of applied) {
    stmts.push(c.env.DB.prepare("UPDATE students SET score = ?1 WHERE id = ?2").bind(a.after, a.studentId));
    stmts.push(
      c.env.DB
        .prepare(
          "INSERT INTO score_logs (student_id, delta, reason, source, operation_id, created_at) VALUES (?1, ?2, ?3, 'teacher', ?4, ?5)"
        )
        .bind(a.studentId, a.after - a.before, why, opId, now)
    );
  }
  await c.env.DB.batch(stmts);

  sendWebhook(c, settings, "score.adjust", summary, {
    delta: d,
    reason: why,
    applied,
    operationId: opId,
  });
  return c.json({ ok: true, applied, clipped, operationId: opId });
});

// 直接设置某个学生分数
scoreRoutes.post("/set", async (c) => {
  const { id, score, reason } = await c.req.json<{
    id?: number;
    score?: number;
    reason?: string;
  }>();
  const sid = Number(id);
  const target = Math.trunc(Number(score));
  if (!Number.isInteger(sid) || sid <= 0) return c.json({ error: "参数错误" }, 400);
  if (!Number.isInteger(target) || target < 0 || target > 9999)
    return c.json({ error: "分数需在 0-9999 之间" }, 400);

  const row = await c.env.DB.prepare("SELECT id, name, score FROM students WHERE id = ?1")
    .bind(sid)
    .first<StudentRow>();
  if (!row) return c.json({ error: "学生不存在" }, 404);
  if (row.score === target) return c.json({ error: "分数未变化" }, 400);

  const opId = await recordOperation(
    c.env.DB,
    "score.set",
    `${row.name}: ${row.score} → ${target}`,
    { studentId: sid, before: row.score, after: target, reason: reason ?? "手动设置" }
  );
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE students SET score = ?1 WHERE id = ?2").bind(target, sid),
    c.env.DB
      .prepare(
        "INSERT INTO score_logs (student_id, delta, reason, source, operation_id, created_at, result) VALUES (?1, ?2, ?3, 'teacher', ?4, ?5, ?6)"
      )
      .bind(sid, target - row.score, reason?.trim() || "手动设置", opId, Date.now(), target),
  ]);

  sendWebhook(c, 
    await getSettings(c.env.DB),
    "score.set",
    `设置 ${row.name} 分数 ${row.score} → ${target}`,
    { studentId: sid, before: row.score, after: target }
  );
  return c.json({ ok: true });
});
