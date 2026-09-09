# ClassScore · 班级量化评分系统

一个面向班级的量化评分网页应用，分为**学生端**（只读排行榜大屏）与**教师端**（加减分、抽奖、学生管理、撤销、Webhook、2FA 登录）。基于 Cloudflare Workers + D1 免费部署，GitHub Actions 自动化发布。

## ✨ 功能

### 学生端 `/`
- 全班分数排行榜大屏，无需登录
- 前三名领奖台、分数变化数字动画、排名实时重排
- 每 15 秒自动刷新，手机 / 电脑 / 投影均适配

### 教师端 `/admin`
- **登录安全**：密码 + TOTP 两步验证（Google Authenticator 等），连续失败 5 次锁定 10 分钟，验证码防重放
- **加分**：多选学生（搜索 / 全选）、快捷理由、快捷分值（+1/+2/+3/+5 或自定义），一键批量
- **扣分**：同样的多选与快捷操作，可快速选择扣分理由与分值，**最低 0 分保护**
- **抽奖**：Canvas 幸运转盘（惯性缓动动画 + 音效 + 彩带），按权重抽取，两种模式（全班随机 / 指定学生），奖池可视化编辑（名称 / 权重 / 库存 / 颜色 / 启停），抽奖记录
- **撤销**：一键回退上一步操作（加减分 / 抽奖退款 / 学生增删改 / 奖池 / 设置全部可撤销）
- **学生管理**：批量粘贴导入（一行一个，支持「姓名 学号」）、批量删除、改名改学号、重置分数、CSV 导出、JSON 全量备份 / 恢复
- **操作日志**：操作记录 + 分数明细，自动刷新
- **系统设置**：班级名、初始分、抽奖消耗、抽奖门槛、快捷理由编辑、Webhook 配置、改密码、重绑 2FA

### 全局设置（默认值）
| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 学生初始分 | 10 | 新增 / 导入学生的起始分 |
| 抽奖消耗 | 3 | 每次抽奖扣除的积分 |
| 抽奖门槛 | 3 | 低于该分不可抽奖（前端置灰 + 后端校验） |
| 分数下限 | 0 | 扣分永不低于 0 |

### Webhook
任意操作都会向配置的地址 POST 通用 JSON，可开启 / 关闭，可按事件分组过滤，并支持 HMAC-SHA256 签名。

```http
POST https://your-endpoint.example/hook
Content-Type: application/json
X-ClassScore-Event: score.adjust
X-ClassScore-Signature: sha256=<base64url(HMAC-SHA256(secret, body))>
```

```json
{
  "event": "score.adjust",
  "group": "score",
  "summary": "加分 2 分「课堂表现好」→ 张三、李四",
  "data": { "delta": 2, "reason": "课堂表现好", "applied": [...], "operationId": 12 },
  "ts": 1788963106888
}
```

事件分组：`student` / `score` / `lottery` / `undo` / `settings` / `auth` / `system`。

## 🚀 部署（全免费）

### 1. 准备 Cloudflare 凭据
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → 右侧获取 **Account ID**
2. 右上角头像 → **My Profile → API Tokens → Create Token** → 使用模板 **Edit Cloudflare Workers**
   （或自定义权限：`Account.Workers Scripts: Edit`、`Account.D1: Edit`、`Account.Account Settings: Read`）
3. 复制生成的 **API Token**

### 2. 配置 GitHub 仓库 Secrets
在仓库 `Settings → Secrets and variables → Actions → New repository secret` 添加：

| Secret | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 上一步的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Account ID |

### 3. 推送代码即可自动部署
推送到 `main` 分支后，GitHub Actions 会自动：
1. 安装依赖、类型检查、构建前端
2. **自动创建 D1 数据库**（若不存在）并写入 `wrangler.toml`
3. 执行数据库迁移
4. 部署 Worker（前端静态资源 + API 同一个 Worker）
5. 首次自动生成并写入 `JWT_SECRET`

部署完成后，Actions 日志会显示访问地址：`https://classscore.<你的子域>.workers.dev`

> 也可以本地手动部署：
> ```bash
> npx wrangler login
> npx wrangler d1 create classscore      # 复制返回的 database_id 填入 wrangler.toml
> npm run db:migrate:remote
> npm run deploy
> ```

### 4. 首次使用初始化
1. 打开 `https://你的域名/admin` → 自动进入初始化
2. 设置教师密码（至少 6 位）
3. 用验证器 App 扫描二维码（Google Authenticator / Microsoft Authenticator / 腾讯身份验证器等）
4. 输入 6 位动态码完成绑定 → 以后每次登录都需密码 + 动态码

## 🛠 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars      # Windows: copy .dev.vars.example .dev.vars
npm run db:migrate                  # 初始化本地 D1
npm run dev                         # 同时启动 Worker(8787) 与 Vite(5173)
# 浏览器打开 http://localhost:5173
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建前端到 `dist/` |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run deploy` | 构建并部署到 Cloudflare |
| `npm run db:migrate:remote` | 对远程 D1 执行迁移 |
| `npm run db:reset-auth` | 重置本地登录状态（忘记密码） |
| `npm run db:reset-auth:remote` | 重置远程登录状态（忘记密码 / 换设备） |

## 📁 项目结构

```
src/
├── frontend/            # React + Vite + Tailwind 前端
│   ├── pages/           # Board(学生端) / Login / Admin
│   ├── components/      # Wheel 转盘 / Confetti / 各功能 Tab
│   └── lib/             # api 封装 / 设置上下文
├── worker/              # Cloudflare Worker (Hono)
│   ├── lib/             # auth(PBKDF2+JWT) / totp / oplog(撤销) / webhook / settings
│   └── routes/          # auth / public / score / students / lottery / system
└── shared/types.ts      # 前后端共享类型
migrations/              # D1 SQL 迁移
scripts/                 # CI 自动建库 / 写入密钥
.github/workflows/       # GitHub Actions 自动部署
```

## ❓ 常见问题

**忘记教师密码 / 丢失验证器怎么办？**
执行 `npm run db:reset-auth:remote`（会清空登录保护状态），再打开 `/admin` 重新初始化。

**数据会丢吗？**
数据存在 Cloudflare D1。建议定期在「学生管理」页点击「备份」下载 JSON；需要时用「恢复」导入。

**免费额度够用吗？**
Workers 免费版每天 10 万请求、D1 免费版 5GB 存储，一个班级完全够用。

**改了 `wrangler.toml` 里的 `database_id` 占位符会不会影响 CI？**
不会。CI 会在部署前自动创建数据库并替换为真实 ID。
