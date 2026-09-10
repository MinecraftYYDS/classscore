import { Hono } from "hono";
import type { Env } from "../types";
import { getSettings } from "../lib/settings";

type App = { Bindings: Env };

export const publicRoutes = new Hono<App>();

// 学生端大屏:全班分数排行(无需登录)
publicRoutes.get("/board", async (c) => {
  const settings = await getSettings(c.env.DB);
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, score FROM students ORDER BY score DESC, id ASC"
  ).all<{ id: number; name: string; score: number }>();
  return c.json({
    className: settings.class_name,
    students: results,
    lottery: { cost: settings.lottery_cost, minScore: settings.lottery_min_score },
    initialScore: settings.initial_score,
    updatedAt: Date.now(),
  });
});

// 某个学生的加减分明细(无需登录,供学生端点击查看)
publicRoutes.get("/student/:id", async (c) => {
  const sid = Number(c.req.param("id"));
  if (!Number.isInteger(sid) || sid <= 0) return c.json({ error: "参数错误" }, 400);

  const [student, logs] = await Promise.all([
    c.env.DB.prepare("SELECT id, name, student_no, score FROM students WHERE id = ?1")
      .bind(sid)
      .first(),
    c.env.DB.prepare(
      "SELECT id, delta, reason, source, result, created_at FROM score_logs WHERE student_id = ?1 ORDER BY id DESC LIMIT 100"
    )
      .bind(sid)
      .all(),
  ]);
  if (!student) return c.json({ error: "学生不存在" }, 404);
  return c.json({ student, logs: logs.results });
});
