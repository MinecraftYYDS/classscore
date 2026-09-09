import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NAME = "classscore";
const CONFIG = "wrangler.toml";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env });
}

function tryJson(cmd) {
  try {
    return JSON.parse(run(cmd));
  } catch {
    return null;
  }
}

let list = tryJson("npx wrangler d1 list --json");
let db = null;
if (Array.isArray(list)) {
  db = list.find((d) => d.name === NAME) ?? null;
}

if (!db) {
  console.log(`未找到 D1 数据库 "${NAME}",正在创建...`);
  const created = tryJson(`npx wrangler d1 create ${NAME} --json`);
  let id = created?.uuid ?? created?.database_id;
  if (!id) {
    const out = run(`npx wrangler d1 create ${NAME}`);
    id = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  }
  if (!id) {
    console.error("创建 D1 失败,无法获取 database_id");
    process.exit(1);
  }
  db = { uuid: id };
}

const id = db.uuid ?? db.database_id;
if (!id) {
  console.error("无法解析 database_id");
  process.exit(1);
}

let cfg = readFileSync(CONFIG, "utf8");
cfg = cfg.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
writeFileSync(CONFIG, cfg);
console.log(`D1 database_id = ${id}`);
