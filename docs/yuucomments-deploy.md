# YuuComments 部署指南（Flygeon 博客）

把博客评论系统从 giscus 迁移到自托管的 [YuuComments](https://github.com/zxykevin/YuuComments)
（Cloudflare Workers + D1 + Turnstile）。前端改动已全部完成，本文件仅记录**部署/上线**步骤。

> 账户前提：本机没有登录态 / API Token，下列 `wrangler` 命令需**你自己在终端执行**。

---

## 0. 已完成的代码改动（无需再动）

- `public/comments/`：自托管的 `comments.js` / `comments.css` 及本地化依赖（`vendor/` 下的 marked / dompurify / katex / auto-render，避免运行时访问 jsDelivr）。
- `src/components/comments/Comments.astro`：评论挂载点 + 主题适配（跟随站点浅/深色）。
- `src/layouts/Layout.astro`：全局设置 `window.YuuCommentsConfig`、引入 `comments.css`、一次性加载 `comments.js`，并通过 `window.swup` 的 `page:view` 钩子支持 SPA 软导航重挂载。
- `src/pages/posts/[...slug].astro` 与 `src/pages/friends.astro`：移除 giscus，改为 `<Comments />`。
- `YuuComments/worker/src/utils/cors.ts`：已把 `flygeon.top` / `www.flygeon.top` 等加入允许的来源。
- `YuuComments/worker/wrangler.toml`：已预配自定义域名 `comments.flygeon.top`。

---

## 1. 后端：部署 YuuComments Worker

进入仓库：

```bash
cd C:\blog\YuuComments
```

### 1.1 安装依赖

仓库要求 **pnpm@11.0.9**（博客本身用 pnpm@9.14.4，二者互不影响）。
若 `corepack` 损坏，用 npm 全局安装指定版本：

```bash
npm install -g pnpm@11.0.9
pnpm install
```

> 也可以不污染全局：`npx -y pnpm@11.0.9 install` / `npx -y pnpm@11.0.9 deploy`。

### 1.2 创建 D1 数据库

> 若 `worker/wrangler.toml` 里的 `database_id` 已经填好（之前建过库），**直接跳过本步**。

```bash
wrangler d1 create yuucomments-db
```

控制台会输出一串 `database_id`。把它填进 `worker/wrangler.toml`，替换占位符：

```toml
[[d1_databases]]
binding = "DB"
database_name = "yuucomments-db"
database_id = "替换成上面输出的 id"
migrations_dir = "migrations"
```

> 验证 id 是否正确：跑 `wrangler d1 list --config worker/wrangler.toml`，确认列表里有 `yuucomments-db`
> 且 id 与 toml 一致；不一致会导致后面 `migrations apply` 报 “Could not find database”。

### 1.3 应用数据库迁移

> 配置在子目录 `worker/wrangler.toml`，所以每条 `wrangler` 命令都要带 `--config worker/wrangler.toml`。
> 也可以直接跑仓库里已配好 config 的脚本 `pnpm db:migrate:remote`。

```bash
pnpm db:migrate:remote
# 等价于：
wrangler d1 migrations apply yuucomments-db --remote --config worker/wrangler.toml
```

（会依次执行 `worker/migrations/` 下的 0001~0004。）

### 1.4 配置服务端密钥

```bash
# Turnstile 服务端密钥（与下面的站点密钥成对）
wrangler secret put TURNSTILE_SECRET_KEY --config worker/wrangler.toml

# 后台管理令牌（用于删除/封禁评论）
wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml
```

### 1.5 构建后台静态资源并部署

```bash
pnpm build        # 生成 admin 资源（scripts/build-assets.ts）
pnpm deploy       # = wrangler deploy --config worker/wrangler.toml
```

### 1.6 自定义域名

`worker/wrangler.toml` 已配置：

```toml
routes = [
  { pattern = "comments.flygeon.top", custom_domain = true }
]
```

前提：`flygeon.top` 必须托管在**当前登录的 Cloudflare 账号**的 zone 下，wrangler 会自动建 DNS 记录。
若部署报 `zone not found` / 无权限：**删除整个 `routes = [...]` 块**先跑通默认的 `*.workers.dev` 域名，
之后去 Cloudflare 后台 `Workers & Pages → yuucomments → Settings → Domains & Routes` 手动加 `comments.flygeon.top`。

---

## 2. 前端：博客环境变量

评论前端通过两个**公开**环境变量拿到后端地址与 Turnstile 站点密钥：

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `PUBLIC_COMMENTS_API_BASE_URL` | Worker 地址（不带结尾斜杠） | `https://comments.flygeon.top` |
| `PUBLIC_TURNSTILE_SITE_KEY` | Turnstile 站点密钥（前端可见） | `0x...` |

### 2.1 本地 / 预览

复制 `C:\blog\blog\.env.example` 为 `.env` 并填写。

### 2.2 Cloudflare Pages（生产）

在 Pages 项目 `flygeon-top` 的 **Settings → Environment variables** 里加这两个变量
（`PUBLIC_` 前缀的变量会在构建时注入客户端 JS）。然后重新部署（git push 触发，或手动 Retry Deployment）。

> 不设置时，评论区会显示「配置缺失」的提示，不会崩页——先上线后端再补变量即可。

---

## 3. Turnstile 小部件

在 Cloudflare 控制台 `Turnstile` 创建 widget：

- **Allowed hostnames**：`flygeon.top`、`www.flygeon.top`
- 站点密钥 → 填到前端的 `PUBLIC_TURNSTILE_SITE_KEY`
- 密钥（secret）→ 填到后端的 `TURNSTILE_SECRET_KEY`

---

## 4. 旧评论迁移（仅 2 条）

原有 giscus 评论只有 2 条，已手工整理为 `YuuComments/migrate-old-comments.sql`，
`page_path` 与文章 pathname 对应、`status='approved'`：

```bash
wrangler d1 execute yuucomments-db --file=./migrate-old-comments.sql --remote --config worker/wrangler.toml
```

- `/posts/10/`：mistn — “你博客我一张图也看不见，是我的问题还是你的问题”
- `/posts/8/`：ECYDW — “来交换友链吧！我的是 http://543902.xyz😖😆🤓😇”

---

## 5. 验证

1. 打开任意文章页，底部出现评论框（浅/深色跟随站点主题）。
2. 填写昵称 + 内容，完成 Turnstile 验证，提交后应立即可见。
3. 用 Swup 软导航在文章间跳转，评论能正常重新加载（不刷新整页）。
4. 旧评论出现在对应文章下。
5. 管理后台（受 `ADMIN_TOKEN` 保护）

   **注意：后台页面不是由 Worker 托管的**，Worker 只提供 `/api/*` 接口。
   `comments.flygeon.top/admin` 打不开是正常的。admin 是 `pnpm build` 生成的
   独立静态站点（`dist/admin/`，构建时把 API 地址写进 `index.html` 的 `data-api-base`）。

   **当前方案：挂在博客域名下，任何地方都能直接打开**（按你后续要求改为公开）。
   已把 `dist/admin/` 复制到 `C:\blog\blog\public\admin\`，重新部署博客后即可访问：

   ```
   https://flygeon.top/admin/
   ```

   首次打开会要求输入 **Admin Token**（即你 `wrangler secret put ADMIN_TOKEN` 设的值），
   输入后存进浏览器 localStorage，之后直接管理评论（删除 / 审核 / 封禁 / 查看举报）。
   Worker 的 CORS 已放行 `https://flygeon.top`、`https://www.flygeon.top`，无需改。

   > 页面本身公网可见，但**所有写操作都要 ADMIN_TOKEN**，没有 token 什么都做不了。
   > `data-api-base` 已固定为 `https://comments.flygeon.top`（若以后在 YuuComments 仓库
   > 重新 `pnpm build`，务必先设 `$env:PUBLIC_COMMENTS_API_BASE_URL="https://comments.flygeon.top"`，
   > 否则会回到占位符地址；改完再重新复制 `dist/admin/` 到 `public/admin/` 并部署博客）。

   备选（仅本机）：`cd C:\blog\YuuComments\dist\admin && python -m http.server 8787` →
   `http://localhost:8787/`（端口 8787 在 CORS 白名单）。
   忘了 ADMIN_TOKEN：用 `wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml` 重设。

---

## 6. 备注 / 踩坑

- **CORS**：`worker/src/utils/cors.ts` 已允许 `flygeon.top` 等来源；以后换域名需改这里并重部署 worker。
- **KaTeX 版本**：博客全站已加载 KaTeX 0.16.27，评论区复用站点样式（`vendor/katex-noop.css` 为空占位），
  避免与上游默认 0.16.10 冲突。
- **SPA 挂载**：上游 `comments.js` 只在 `DOMContentLoaded` 挂载一次，已改造为监听 `window.swup` 的 `page:view`，
  保证软导航后评论仍加载。
- **依赖本地化**：`commentRenderAssets` 指向 `/comments/vendor/` 下的本地文件，生产环境不依赖 jsDelivr。
