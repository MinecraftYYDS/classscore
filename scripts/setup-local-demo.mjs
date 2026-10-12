// 仅初始化尚未设置账号的本地环境，不覆盖已有本地数据，不支持远程地址。
import { createHmac, randomBytes } from "node:crypto";

const base = "http://127.0.0.1:8787";
let cookie = "";
async function api(path, body) {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error}`);
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  return result;
}

if ((await api("/auth/status")).initialized) throw new Error("本地已有账号，不会覆盖。请使用现有账号登录。");
const password = `Local-${randomBytes(9).toString("base64url")}`;
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
await api("/auth/init/confirm", { code: totp(Math.floor(Date.now() / 30000) - 1) });
await api("/auth/login", { password, code: totp(Math.floor(Date.now() / 30000)) });
// 通过正常账号设置关闭本地演示登录的动态码验证；生产认证逻辑保持原样。
await api("/auth/2fa", { enabled: false });
await api("/students/batch-add", { namesText: "测试张三 001\n测试李四 002\n测试王五 003\n测试赵六 004\n测试陈七 005\n测试周八 006" });
const students = (await api("/system/state")).students;
await api("/groups/create", { name: "第一组", studentIds: students.slice(0, 3).map((s) => s.id) });
await api("/groups/create", { name: "第二组", studentIds: students.slice(3, 6).map((s) => s.id) });
await api("/groups/create", { name: "值日生", studentIds: [students[1].id, students[4].id] });
console.log(`本地演示环境已就绪：http://localhost:5173/admin\n本地登录密码：${password}\n已添加 6 名测试学生和 3 个分组，无需动态验证码。仅限本地，不用于生产。`);
