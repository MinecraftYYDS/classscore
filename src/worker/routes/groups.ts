import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth } from "../lib/auth";
import { getGroups, MAX_GROUPS, MAX_GROUP_MEMBERS, type GroupRow, type GroupMemberRow } from "../lib/groups";
import { getSettings } from "../lib/settings";
import { sendWebhook } from "../lib/webhook";

export const groupRoutes = new Hono<{ Bindings: Env }>();
groupRoutes.use("*", requireAuth);

groupRoutes.get("/", async (c) => c.json(await getGroups(c.env.DB)));

interface GroupInput {
  id?: number;
  name?: string;
  studentIds?: number[];
}

async function validateGroup(db: D1Database, body: GroupInput) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 30) return { error: "分组名称需为 1-30 个字" } as const;
  if (!Array.isArray(body.studentIds) || body.studentIds.length > MAX_GROUP_MEMBERS ||
    body.studentIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { error: `请选择有效的学生，每组最多 ${MAX_GROUP_MEMBERS} 人` } as const;
  }
  const studentIds = [...new Set(body.studentIds)];
  const students = await db.prepare("SELECT id FROM students").all<{ id: number }>();
  const existing = new Set(students.results.map((s) => s.id));
  if (studentIds.some((id) => !existing.has(id))) return { error: "部分学生已不存在，请刷新后重试" } as const;
  const dup = await db.prepare("SELECT id FROM student_groups WHERE name = ?1 AND id <> ?2")
    .bind(name, body.id ?? 0).first();
  if (dup) return { error: "已有同名分组" } as const;
  return { name, studentIds } as const;
}

function operation(db: D1Database, type: string, summary: string, payload: unknown) {
  return db.prepare("INSERT INTO operations (type, summary, payload, undone, created_at) VALUES (?1, ?2, ?3, 0, ?4)")
    .bind(type, summary, JSON.stringify(payload), Date.now());
}

groupRoutes.post("/create", async (c) => {
  const body = await c.req.json<GroupInput>();
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "分组参数错误" }, 400);
  const db = c.env.DB;
  const valid = await validateGroup(db, { ...body, id: undefined });
  if ("error" in valid) return c.json({ error: valid.error }, 400);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM student_groups").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_GROUPS) return c.json({ error: `最多创建 ${MAX_GROUPS} 个分组` }, 400);
  const { name, studentIds } = valid;
  const summary = `创建分组：${name}（${studentIds.length} 人）`;
  // 创建、成员和撤销记录在同一个原子批次中保存。
  const result = await db.batch([
    db.prepare("INSERT INTO student_groups (name, created_at) VALUES (?1, ?2)").bind(name, Date.now()),
    ...studentIds.map((id) => db.prepare("INSERT INTO student_group_members (group_id, student_id) SELECT id, ?1 FROM student_groups WHERE name = ?2")
      .bind(id, name)),
    db.prepare("INSERT INTO operations (type, summary, payload, undone, created_at) SELECT 'group.create', ?1, json_object('groupId', id), 0, ?2 FROM student_groups WHERE name = ?3")
      .bind(summary, Date.now(), name),
  ]);
  const id = Number(result[0].meta.last_row_id);
  const operationId = Number(result[result.length - 1].meta.last_row_id);
  sendWebhook(c, await getSettings(db), "group.create", summary, { id, name, studentIds, operationId });
  return c.json({ ok: true, id, operationId });
});

groupRoutes.post("/update", async (c) => {
  const body = await c.req.json<GroupInput>();
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "分组参数错误" }, 400);
  if (!Number.isInteger(body.id) || Number(body.id) <= 0) return c.json({ error: "分组 ID 错误" }, 400);
  const db = c.env.DB;
  const before = await db.prepare("SELECT * FROM student_groups WHERE id = ?1").bind(body.id).first<GroupRow>();
  if (!before) return c.json({ error: "分组不存在" }, 404);
  const valid = await validateGroup(db, body);
  if ("error" in valid) return c.json({ error: valid.error }, 400);
  const members = await db.prepare("SELECT group_id, student_id FROM student_group_members WHERE group_id = ?1").bind(body.id).all<GroupMemberRow>();
  const { name, studentIds } = valid;
  const oldIds = new Set(members.results.map((m) => m.student_id));
  if (before.name === name && oldIds.size === studentIds.length && studentIds.every((id) => oldIds.has(id))) {
    return c.json({ ok: true, unchanged: true });
  }
  const summary = `修改分组：${before.name}${name !== before.name ? ` → ${name}` : ""}（${studentIds.length} 人）`;
  await db.batch([
    db.prepare("UPDATE student_groups SET name = ?1 WHERE id = ?2").bind(name, body.id),
    db.prepare("DELETE FROM student_group_members WHERE group_id = ?1").bind(body.id),
    ...studentIds.map((id) => db.prepare("INSERT INTO student_group_members (group_id, student_id) VALUES (?1, ?2)").bind(body.id, id)),
    operation(db, "group.update", summary, { before, members: members.results }),
  ]);
  sendWebhook(c, await getSettings(db), "group.update", summary, { id: body.id, name, studentIds });
  return c.json({ ok: true });
});

groupRoutes.post("/delete", async (c) => {
  const body = await c.req.json<{ id?: number }>();
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "分组参数错误" }, 400);
  const { id } = body;
  if (!Number.isInteger(id) || Number(id) <= 0) return c.json({ error: "分组 ID 错误" }, 400);
  const db = c.env.DB;
  const before = await db.prepare("SELECT * FROM student_groups WHERE id = ?1").bind(id).first<GroupRow>();
  if (!before) return c.json({ error: "分组不存在" }, 404);
  const members = await db.prepare("SELECT group_id, student_id FROM student_group_members WHERE group_id = ?1").bind(id).all<GroupMemberRow>();
  const summary = `删除分组：${before.name}`;
  await db.batch([
    db.prepare("DELETE FROM student_groups WHERE id = ?1").bind(id),
    operation(db, "group.delete", summary, { before, members: members.results }),
  ]);
  sendWebhook(c, await getSettings(db), "group.delete", summary, { id, name: before.name });
  return c.json({ ok: true });
});
