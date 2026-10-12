import type { StudentGroup } from "../../shared/types";

export interface GroupRow {
  id: number;
  name: string;
  created_at: number;
}

export interface GroupMemberRow {
  group_id: number;
  student_id: number;
}

export const MAX_GROUPS = 50;
export const MAX_GROUP_MEMBERS = 500;

export async function getGroups(db: D1Database): Promise<StudentGroup[]> {
  const [groups, members] = await Promise.all([
    db.prepare("SELECT id, name FROM student_groups ORDER BY id ASC").all<{ id: number; name: string }>(),
    db.prepare("SELECT group_id, student_id FROM student_group_members ORDER BY student_id ASC").all<GroupMemberRow>(),
  ]);
  const byGroup = new Map<number, number[]>();
  for (const m of members.results) {
    const ids = byGroup.get(m.group_id) ?? [];
    ids.push(m.student_id);
    byGroup.set(m.group_id, ids);
  }
  return groups.results.map((g) => ({ ...g, studentIds: byGroup.get(g.id) ?? [] }));
}

export function restoreGroups(db: D1Database, groups: GroupRow[], members: GroupMemberRow[]): D1PreparedStatement[] {
  return [
    ...groups.map((g) => db.prepare("INSERT INTO student_groups (id, name, created_at) VALUES (?1, ?2, ?3)")
      .bind(g.id, g.name, g.created_at)),
    ...restoreGroupMembers(db, members),
  ];
}

export function restoreGroupMembers(db: D1Database, members: GroupMemberRow[]): D1PreparedStatement[] {
  return members.map((m) => db.prepare("INSERT OR IGNORE INTO student_group_members (group_id, student_id) VALUES (?1, ?2)")
    .bind(m.group_id, m.student_id));
}

// 旧版备份没有分组字段，按无分组处理；新版必须校验完整的关联关系。
export function parseGroupBackup(body: Record<string, unknown>, studentIds: Set<number>): {
  groups: GroupRow[];
  groupMembers: GroupMemberRow[];
} {
  if (body.groups === undefined && body.groupMembers === undefined) return { groups: [], groupMembers: [] };
  if (!Array.isArray(body.groups) || !Array.isArray(body.groupMembers)) throw new Error("备份的分组数据不完整");
  if (body.groups.length > MAX_GROUPS) throw new Error(`最多支持 ${MAX_GROUPS} 个分组`);
  const groupIds = new Set<number>();
  const names = new Set<string>();
  const groups = body.groups.map((value: unknown) => {
    const g = value as Partial<GroupRow> | null;
    const name = typeof g?.name === "string" ? g.name.trim() : "";
    if (!g || !Number.isInteger(g.id) || Number(g.id) <= 0 || !name || name.length > 30 || groupIds.has(g.id!) || names.has(name)) {
      throw new Error("备份的分组 ID 或名称不合法、重复");
    }
    groupIds.add(g.id!);
    names.add(name);
    return { id: g.id!, name, created_at: Number(g.created_at) || Date.now() };
  });
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  const groupMembers: GroupMemberRow[] = [];
  for (const value of body.groupMembers) {
    const m = value as Partial<GroupMemberRow> | null;
    if (!m || !groupIds.has(m.group_id!) || !studentIds.has(m.student_id!)) throw new Error("备份的分组成员关联不存在");
    const key = `${m.group_id}:${m.student_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const count = (counts.get(m.group_id!) ?? 0) + 1;
    if (count > MAX_GROUP_MEMBERS) throw new Error(`每组最多 ${MAX_GROUP_MEMBERS} 人`);
    counts.set(m.group_id!, count);
    groupMembers.push({ group_id: m.group_id!, student_id: m.student_id! });
  }
  return { groups, groupMembers };
}
