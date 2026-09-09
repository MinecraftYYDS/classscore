import type { AppSettings, PresetReason, WebhookEventGroup } from "../../shared/types";

export const DEFAULT_PRESET_ADD: PresetReason[] = [
  { label: "作业优秀", delta: 2 },
  { label: "课堂表现好", delta: 1 },
  { label: "帮助同学", delta: 2 },
  { label: "考试进步", delta: 3 },
  { label: "卫生值日认真", delta: 1 },
  { label: "活动获奖", delta: 3 },
];

export const DEFAULT_PRESET_DEDUCT: PresetReason[] = [
  { label: "作业未交", delta: -1 },
  { label: "上课讲话", delta: -1 },
  { label: "迟到", delta: -2 },
  { label: "上课睡觉", delta: -1 },
  { label: "违纪", delta: -3 },
  { label: "卫生差", delta: -1 },
];

export const DEFAULT_WEBHOOK_EVENTS: Record<WebhookEventGroup, boolean> = {
  student: true,
  score: true,
  lottery: true,
  undo: true,
  settings: true,
  auth: true,
  system: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  class_name: "我的班级",
  initial_score: 10,
  lottery_cost: 3,
  lottery_min_score: 3,
  preset_add: DEFAULT_PRESET_ADD,
  preset_deduct: DEFAULT_PRESET_DEDUCT,
  webhook: { enabled: false, url: "", secret: "", events: DEFAULT_WEBHOOK_EVENTS },
};

export async function getSettings(db: D1Database): Promise<AppSettings> {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  try {
    const { results } = await db.prepare("SELECT key, value FROM settings").all<{
      key: string;
      value: string;
    }>();
    for (const r of results) {
      if (r.key.startsWith("auth") || r.key === "session_secret" || r.key === "totp_secret")
        continue;
      try {
        merged[r.key] = JSON.parse(r.value);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* table may not exist yet */
  }
  return merged as unknown as AppSettings;
}

export async function seedDefaults(db: D1Database): Promise<void> {
  const existing = await db.prepare("SELECT key FROM settings").all<{ key: string }>();
  const have = new Set(existing.results.map((r) => r.key));
  const stmts: D1PreparedStatement[] = [];
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!have.has(k)) {
      stmts.push(
        db
          .prepare("INSERT INTO settings (key, value) VALUES (?1, ?2)")
          .bind(k, JSON.stringify(v))
      );
    }
  }
  const cnt = await db.prepare("SELECT COUNT(*) AS c FROM prizes").first<{ c: number }>();
  if (cnt && cnt.c === 0) {
    const now = Date.now();
    const defaults: [string, number, string][] = [
      ["谢谢惠顾", 6, "#64748b"],
      ["合理要求", 3, "#10b981"],
      ["免跑操", 4, "#6366f1"],
      ["手机一天", 1, "#f59e0b"],
      ["提前放学", 2, "#f43f5e"],
    ];
    for (const [name, weight, color] of defaults) {
      stmts.push(
        db
          .prepare(
            "INSERT INTO prizes (name, weight, stock, color, enabled, created_at) VALUES (?1, ?2, NULL, ?3, 1, ?4)"
          )
          .bind(name, weight, color, now)
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
}
