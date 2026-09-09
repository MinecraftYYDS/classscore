import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env });
}

let secrets = [];
try {
  secrets = JSON.parse(run("npx wrangler secret list --json"));
} catch {
  secrets = [];
}

const exists = Array.isArray(secrets) && secrets.some((s) => s.name === "JWT_SECRET");
if (exists) {
  console.log("JWT_SECRET 已存在,跳过");
  process.exit(0);
}

const value = randomBytes(48).toString("base64url");
execSync("npx wrangler secret put JWT_SECRET", {
  input: value,
  stdio: ["pipe", "inherit", "inherit"],
  env: process.env,
});
console.log("已生成并写入 JWT_SECRET");
