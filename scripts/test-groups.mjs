// 使用独立临时本地 D1 和随机端口；绝不连接远程数据库或修改日常开发数据。
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
// 跳过联网的版本检查和遥测，离线也能稳定退出迁移命令。
const localEnv = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_HIDE_BANNER: "true" };
await mkdir(".wrangler", { recursive: true });
const persist = await mkdtemp(resolve(".wrangler/group-tests-"));
const secret = randomBytes(32).toString("base64url");
const config = resolve(persist, "wrangler.json");
await writeFile(config, JSON.stringify({
  name: "classscore-group-tests",
  main: resolve("src/worker/index.ts"),
  compatibility_date: "2025-09-01",
  compatibility_flags: ["nodejs_compat"],
  assets: { directory: resolve("dist"), binding: "ASSETS", not_found_handling: "single-page-application" },
  vars: { JWT_SECRET: secret },
  d1_databases: [{ binding: "DB", database_name: "classscore", database_id: "00000000-0000-0000-0000-000000000001", migrations_dir: resolve("migrations") }],
}));
const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const payload = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ role: "teacher", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const cookie = `cs_session=${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = `http://127.0.0.1:${port}`;

execFileSync(process.execPath, [wrangler, "d1", "migrations", "apply", "classscore", "--config", config, "--local", "--persist-to", persist], {
  stdio: "inherit", env: localEnv, timeout: 60000,
});
const worker = spawn(process.execPath, [wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port),
  "--config", config, "--persist-to", persist], { stdio: ["ignore", "pipe", "pipe"], env: localEnv });
let output = "";
worker.stdout.on("data", (chunk) => { output += chunk; });
worker.stderr.on("data", (chunk) => { output += chunk; });

async function api(path, body, expected = 200, authenticated = true) {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(authenticated ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
  return result;
}

const state = () => api("/system/state");
const undo = () => api("/system/undo", {});
let checks = 0;
function passed(label) { checks++; console.log(`PASS ${label}`); }

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (worker.exitCode !== null) throw new Error(`Worker exited: ${output}`);
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) { ready = true; break; }
    } catch { /* 启动期间等待本地端口 */ }
    await delay(500);
  }
  assert.ok(ready, `Worker did not start: ${output}`);
  await api("/groups", undefined, 401, false);
  for (const action of ["create", "update", "delete"]) await api(`/groups/${action}`, {}, 401, false);
  passed("分组接口必须登录");

  await api("/students/batch-add", { namesText: "测试张三 001\n测试李四 002\n测试王五 003" });
  const [a, b, c] = (await state()).students.map((s) => s.id);
  for (const body of [
    null, [],
    { name: "", studentIds: [] }, { name: "x".repeat(31), studentIds: [] },
    { name: "错误组", studentIds: [999999] }, { name: "错误组", studentIds: ["1"] },
    { name: "错误组", studentIds: null }, { name: "错误组", studentIds: Array(501).fill(a) },
  ]) await api("/groups/create", body, 400);
  await api("/groups/update", { id: -1 }, 400);
  await api("/groups/update", { id: 999999, name: "不存在", studentIds: [] }, 404);
  await api("/groups/delete", { id: 999999 }, 404);
  passed("名称、成员、数量和不存在的分组校验");

  const first = await api("/groups/create", { name: " 第一组 ", studentIds: [a, b, a] });
  assert.deepEqual((await api("/groups"))[0], { id: first.id, name: "第一组", studentIds: [a, b] });
  await api("/groups/create", { name: "第一组", studentIds: [] }, 400);
  const second = await api("/groups/create", { name: "值日生", studentIds: [b, c] });
  assert.equal((await state()).groups.filter((g) => g.studentIds.includes(b)).length, 2);
  passed("创建分组、名称去空格、成员去重、多组重叠");

  const empty = await api("/groups/create", { name: "空分组", studentIds: [] });
  assert.deepEqual((await api("/groups")).find((g) => g.id === empty.id).studentIds, []);
  await undo();
  assert.equal((await api("/groups")).length, 2);
  passed("空分组和撤销创建");

  const lastBefore = (await state()).lastOperation.id;
  const unchanged = await api("/groups/update", { id: first.id, name: "第一组", studentIds: [b, a] });
  assert.equal(unchanged.unchanged, true);
  assert.equal((await state()).lastOperation.id, lastBefore);
  await api("/groups/update", { id: first.id, name: "值日生", studentIds: [a] }, 400);
  await api("/groups/update", { id: first.id, name: "新第一组", studentIds: [c] });
  assert.deepEqual((await api("/groups"))[0], { id: first.id, name: "新第一组", studentIds: [c] });
  await undo();
  assert.deepEqual((await api("/groups"))[0], { id: first.id, name: "第一组", studentIds: [a, b] });
  passed("修改、无变化不记日志、重名拒绝及撤销修改");

  await api("/groups/delete", { id: first.id });
  assert.equal((await api("/groups")).length, 1);
  assert.equal((await state()).students.length, 3);
  await undo();
  assert.deepEqual((await api("/groups"))[0].studentIds, [a, b]);
  passed("删除分组不删除学生，撤销恢复成员");

  const chosen = (await api("/groups"))[0].studentIds;
  await api("/scores/adjust", { ids: chosen, delta: 2, reason: "小组表现好" });
  assert.deepEqual((await state()).students.map((s) => s.score), [12, 12, 10]);
  await undo();
  const clipped = await api("/scores/adjust", { ids: chosen, delta: -20, reason: "小组扣分" });
  assert.equal(clipped.clipped, true);
  assert.deepEqual((await state()).students.map((s) => s.score), [0, 0, 10]);
  await undo();
  assert.deepEqual((await state()).students.map((s) => s.score), [10, 10, 10]);
  passed("整组加减分、0 分下限及撤销");

  await api("/students/batch-delete", { ids: [b] });
  assert.ok((await api("/groups")).every((g) => !g.studentIds.includes(b)));
  await undo();
  assert.equal((await api("/groups")).filter((g) => g.studentIds.includes(b)).length, 2);
  passed("删除学生清理关联，撤销恢复其所有分组");

  await api("/scores/set", { id: a, score: 15, reason: "测试绝对分数" });
  const backup = await api("/students/export");
  assert.equal(backup.version, 2);
  assert.equal(backup.groups.length, 2);
  assert.equal(backup.groupMembers.length, 4);
  await api("/groups/delete", { id: second.id });
  await api("/system/import", backup);
  assert.equal((await api("/groups")).length, 2);
  assert.equal((await api("/students/export")).scoreLogs.find((l) => l.result === 15).result, 15);
  await undo();
  assert.equal((await api("/groups")).length, 1);
  passed("新版备份恢复分组、分数明细及撤销导入");

  await api("/system/import", backup);
  const beforeInvalid = (await state()).lastOperation.id;
  for (const bad of [
    { ...backup, groupMembers: undefined },
    { ...backup, groups: [...backup.groups, backup.groups[0]] },
    { ...backup, groupMembers: [{ group_id: 999999, student_id: a }] },
    { ...backup, groupMembers: [{ group_id: first.id, student_id: 999999 }] },
  ]) await api("/system/import", bad, 400);
  assert.equal((await state()).lastOperation.id, beforeInvalid);
  assert.equal((await api("/groups")).length, 2);
  passed("无效备份在写入前拒绝，不污染数据或撤销记录");

  const { groups: _groups, groupMembers: _members, ...legacy } = backup;
  await api("/system/import", { ...legacy, version: 1 });
  assert.deepEqual(await api("/groups"), []);
  await undo();
  assert.equal((await api("/groups")).length, 2);
  passed("旧版备份兼容，并可撤销恢复原分组");

  for (let i = 3; i <= 50; i++) await api("/groups/create", { name: `数量测试${i}`, studentIds: [] });
  await api("/groups/create", { name: "超过上限", studentIds: [] }, 400);
  assert.equal((await api("/groups")).length, 50);
  passed("分组总数上限保护");

  // 通过正常初始化和双重认证流程验证系统重置。
  const password = randomBytes(18).toString("base64url");
  const auth = await api("/auth/init", { password });
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...auth.secret].map((ch) => alphabet.indexOf(ch).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const totp = (step) => {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hash = createHmac("sha1", key).update(counter).digest();
    const offset = hash[hash.length - 1] & 15;
    return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
  };
  const step = Math.floor(Date.now() / 30000);
  await api("/auth/init/confirm", { code: totp(step - 1) });
  await api("/system/reset-all", { password, code: totp(step), confirm: "重置整个系统" });
  assert.deepEqual((await state()).groups, []);
  assert.deepEqual((await state()).students, []);
  assert.deepEqual((await api("/students/export")).groupMembers, []);
  passed("系统重置清空分组和成员");
  console.log(`\n${checks} 项本地集成测试通过（独立数据库：${persist}）。`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (process.platform === "win32" && worker.exitCode === null) {
    execFileSync("taskkill", ["/pid", String(worker.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    worker.kill("SIGTERM");
  }
}
