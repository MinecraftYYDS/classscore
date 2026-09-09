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
