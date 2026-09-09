import { Hono } from "hono";
import type { Env } from "./types";
import { seedDefaults } from "./lib/settings";

const app = new Hono<{ Bindings: Env }>();

// 全局安全头
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
});

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "服务器内部错误" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

const { authRoutes } = await import("./routes/auth");
const { publicRoutes } = await import("./routes/public");
const { scoreRoutes } = await import("./routes/score");
const { studentRoutes } = await import("./routes/students");
const { lotteryRoutes } = await import("./routes/lottery");
const { systemRoutes } = await import("./routes/system");

app.route("/api/auth", authRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/scores", scoreRoutes);
app.route("/api/students", studentRoutes);
app.route("/api/lottery", lotteryRoutes);
app.route("/api/system", systemRoutes);

// 初始化检查(前端首屏调用)
app.get("/api/bootstrap", async (c) => {
  await seedDefaults(c.env.DB);
  return c.json({ ok: true });
});

// 非 /api 请求交给静态资源(SPA 回退)
app.all("/api/*", (c) => c.json({ error: "接口不存在" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
