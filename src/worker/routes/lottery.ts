import { Hono } from "hono";
import type { Env } from "../types";
import { getSettings } from "../lib/settings";
import { recordOperation } from "../lib/oplog";
import { sendWebhook } from "../lib/webhook";
import type { Prize } from "../../shared/types";

type App = { Bindings: Env };

export const lotteryRoutes = new Hono<App>();

lotteryRoutes.use("*", async (c, next) => {
  const { requireAuth } = await import("../lib/auth");
  return requireAuth(c, next);
});

function normalizePrizes(raw: unknown): Prize[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > 24) return null;
  const out: Prize[] = [];
  for (const r of raw) {
    const name = String(r?.name ?? "").trim().slice(0, 20);
    if (!name) return null;
    const weight = Math.min(Math.max(Math.trunc(Number(r?.weight ?? 1)), 1), 100);
    let stock: number | null = null;
    if (r?.stock !== null && r?.stock !== undefined && r?.stock !== "") {
      const s = Math.trunc(Number(r.stock));
      if (Number.isFinite(s) && s > 0) stock = s;
      else stock = null;
    }
    const color = /^#[0-9a-fA-F]{6}$/.test(String(r?.color ?? "")) ? String(r.color) : "#6366f1";
    out.push({
      id: Number(r?.id) || 0,
      name,
      weight,
      stock,
      color,
      enabled: r?.enabled === 0 ? 0 : 1,
    });
  }
  return out;
}

async function getPrizes(db: D1Database): Promise<Prize[]> {
  const { results } = await db
    .prepare("SELECT id, name, weight, stock, color, enabled, created_at FROM prizes ORDER BY id ASC")
    .all();
  return results as unknown as Prize[];
}

lotteryRoutes.get("/prizes", async (c) => c.json(await getPrizes(c.env.DB)));

// 整包替换奖池(单条操作记录,支持撤销)
lotteryRoutes.post("/prizes", async (c) => {
  const next = normalizePrizes(await c.req.json());
  if (!next) return c.json({ error: "奖池数据无效(至少 1 项、名称非空)" }, 400);
  if (!next.some((p) => p.enabled)) return c.json({ error: "至少保留一个启用奖项" }, 400);

  const before = await getPrizes(c.env.DB);
  const db = c.env.DB;
  const now = Date.now();

  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM prizes")];
  for (const p of next) {
    if (p.id > 0) {
      stmts.push(
        db
          .prepare(
            "INSERT INTO prizes (id, name, weight, stock, color, enabled, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
          )
          .bind(p.id, p.name, p.weight, p.stock, p.color, p.enabled, now)
      );
    } else {
      stmts.push(
        db
          .prepare(
            "INSERT INTO prizes (name, weight, stock, color, enabled, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
          )
          .bind(p.name, p.weight, p.stock, p.color, p.enabled, now)
      );
    }
  }
  await db.batch(stmts);

  const after = await getPrizes(db);
  const opId = await recordOperation(db, "prize.batch", `编辑奖池(${next.length} 项)`, {
    before,
    after,
  });

  sendWebhook(c, await getSettings(db), "lottery.prize_update", "奖池已更新", {
    before,
    after,
    operationId: opId,
  });
  return c.json({ ok: true, prizes: after });
});

// 抽奖:扣除积分 → 按权重抽中奖品 → 记录日志(一条原子操作,可撤销)
lotteryRoutes.post("/draw", async (c) => {
  const body = await c.req.json<{ studentId?: number }>();
  const db = c.env.DB;
  const settings = await getSettings(db);
  const { lottery_cost: cost, lottery_min_score: minScore } = settings;

  let student: { id: number; name: string; score: number } | null = null;
  if (body.studentId) {
    const row = await db
      .prepare("SELECT id, name, score FROM students WHERE id = ?1")
      .bind(Number(body.studentId))
      .first<{ id: number; name: string; score: number }>();
    if (!row) return c.json({ error: "学生不存在" }, 404);
    student = row;
    if (student.score < minScore)
      return c.json({ error: `${student.name} 当前 ${student.score} 分,低于抽奖门槛 ${minScore} 分` }, 400);
  } else {
    const { results } = await db
      .prepare("SELECT id, name, score FROM students WHERE score >= ?1 ORDER BY RANDOM() LIMIT 1")
      .bind(minScore)
      .all<{ id: number; name: string; score: number }>();
    student = results[0] ?? null;
    if (!student) return c.json({ error: `没有分数 ≥ ${minScore} 的学生可参与抽奖` }, 400);
  }

  const prizes = await getPrizes(db);
  const pool = prizes.filter((p) => p.enabled && (p.stock === null || p.stock > 0));
  if (!pool.length) return c.json({ error: "奖池为空或奖品已抽完" }, 400);

  const totalWeight = pool.reduce((s, p) => s + Math.max(1, p.weight), 0);
  let roll = Math.random() * totalWeight;
  let prize = pool[pool.length - 1];
  for (const p of pool) {
    roll -= Math.max(1, p.weight);
    if (roll < 0) {
      prize = p;
      break;
    }
  }

  const after = Math.max(0, student.score - cost);
  const actualCost = student.score - after;
  const isThanks = prize.name.includes("谢谢惠顾");
  const now = Date.now();

  const opId = await recordOperation(
    db,
    "lottery.draw",
    `${student.name} 抽中「${prize.name}」(-${actualCost}分)`,
    {
      studentId: student.id,
      studentName: student.name,
      prizeId: prize.id,
      prizeName: prize.name,
      cost,
      actualCost,
      hadStock: prize.stock !== null,
    }
  );

  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE students SET score = ?1 WHERE id = ?2").bind(after, student.id),
    db
      .prepare(
        "INSERT INTO score_logs (student_id, delta, reason, source, operation_id, created_at) VALUES (?1, ?2, ?3, 'lottery', ?4, ?5)"
      )
      .bind(student.id, -actualCost, `抽奖:${prize.name}`, opId, now),
    db
      .prepare(
        "INSERT INTO lottery_logs (student_id, prize_id, prize_name, cost, operation_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
      )
      .bind(student.id, prize.id, prize.name, actualCost, opId, now),
  ];
  if (prize.stock !== null) {
    stmts.push(
      db.prepare("UPDATE prizes SET stock = stock - 1 WHERE id = ?1").bind(prize.id)
    );
  }
  await db.batch(stmts);

  sendWebhook(c, 
    settings,
    "lottery.draw",
    isThanks ? `${student.name} 抽奖:谢谢惠顾(-${actualCost}分)` : `${student.name} 抽中「${prize.name}」(-${actualCost}分)`,
    {
      student,
      prize,
      cost: actualCost,
      newScore: after,
      operationId: opId,
    }
  );

  return c.json({
    ok: true,
    prize,
    actualCost,
    newScore: after,
    studentName: student.name,
  });
});

// 抽奖记录
lotteryRoutes.get("/logs", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 30), 200);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.student_id, s.name AS student_name, l.prize_name, l.cost, l.created_at
     FROM lottery_logs l LEFT JOIN students s ON s.id = l.student_id
     ORDER BY l.id DESC LIMIT ?1`
  )
    .bind(limit)
    .all();
  return c.json(results);
});
