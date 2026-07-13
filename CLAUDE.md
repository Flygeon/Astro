# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 约束

- 使用准确数据，不要猜变量名，不要猜 API 接口。所有引用的变量、函数、类型、配置项必须经 grep 或读取文件确认存在后再使用。

## 常用命令

| 命令 | 说明 |
|---------|-------------|
| `pnpm dev` | 启动本地开发服务器 `localhost:4321` |
| `pnpm build` | 构建到 `./dist/` + Pagefind 搜索索引 |
| `pnpm preview` | 本地预览生产构建 |
| `pnpm check` | 运行 Astro 错误检查 |
| `pnpm type-check` | TypeScript 类型检查（`tsc --noEmit`） |
| `pnpm format` | Biome 格式化代码 |
| `pnpm lint` | Biome 检查并自动修复 |
| `pnpm new-post <filename>` | 创建新的博客文章 |

## 架构

**Fuwari** — 基于 [Astro 5](https://astro.build) 的静态博客，部署于 Cloudflare Pages。

- **框架**：Astro SSG（静态站点生成），所有页面在编译时预构建。
- **UI**：Astro 组件（`.astro`）负责布局/静态内容，Svelte 5（`.svelte`）负责交互式组件（搜索、主题切换、归档面板、显示设置）。
- **样式**：Tailwind CSS 3 + `@tailwindcss/typography` 处理文章排版。CSS 变量驱动主题（色相、明暗模式）。
- **状态与路由**：无框架级状态管理——每个页面是静态 HTML。Swup 处理客户端导航和过渡动画。

## 目录结构

```
src/
├── config.ts                  # 站点配置：标题、主题、横幅、导航、个人信息、许可协议
├── content/
│   ├── config.ts              # 文章 frontmatter schema（zod 验证）
│   └── posts/                 # Markdown 博客文章（*.md）
├── components/                # 可复用的 UI 组件
│   ├── control/               # 回到顶部、分页、按钮
│   ├── misc/                  # Markdown 渲染、图片包装、许可协议
│   └── widget/                # 侧边栏、目录、标签、分类、搜索
├── layouts/                   # Layout.astro（根 HTML + head + 脚本）、MainGridLayout
├── pages/                     # [...page].astro（首页/分页）、posts/[...slug].astro（文章）、about、archive、friends、bangumi、rss.xml
├── i18n/                      # 多语言翻译（zh_CN、en、ja、ko、es、th、vi、id、tr）
├── plugins/                   # Remark/rehype 插件 + Expressive Code 插件
├── utils/                     # content-utils、url-utils、date-utils、setting-utils
├── types/                     # TypeScript 类型定义
├── constants/                 # 应用常量（主题模式、分页大小、图标定义）
└── styles/                    # 全局 CSS（main、markdown、expressive-code、scrollbar、transition、photoswipe）
```

## 内容管理

- **文章**：`src/content/posts/*.md`，使用 YAML frontmatter。Schema 定义在 `src/content/config.ts`：
  ```yaml
  title: string（必填）
  published: date（必填）
  description: string
  image: string（封面图片路径）
  tags: string[]
  category: string
  draft: boolean
  lang: string（仅当文章语言与站点默认语言不同时设置）
  ```
- **配置**：编辑 `src/config.ts` 修改站点标题、横幅、导航链接、个人信息、主题色等。
- **新文章**：运行 `pnpm new-post <filename>` 创建新的 markdown 文件。
- **国际化**：站点语言在 `src/config.ts` 中设置（`siteConfig.lang`）。单篇文章可通过 frontmatter 的 `lang` 字段覆盖。翻译键值在 `src/i18n/` 中。

## 主题系统

- 明/暗/自动模式，存储在 localStorage 中。
- 主题色相（0-360）可由访客调整，除非配置中设置 `themeColor.fixed: true`。
- CSS 变量 `--hue` 驱动所有强调色。

## 关键依赖

- **搜索**：Pagefind（构建时生成索引）
- **评论**：Giscus（基于 GitHub Discussions）
- **代码块**：Expressive Code（行号、可折叠章节、语言徽章、自定义复制按钮）
- **数学公式**：KaTeX（通过 rehype-katex + remark-math）
- **提示块/GitHub 卡片**：remark-directive + rehype-components（note/tip/important/caution/warning 提示块、GitHub 仓库卡片）
- **图标**：astro-icon + Iconify 图标集（fa6-brands、fa6-regular、fa6-solid、material-symbols）
- **分析**：Umami（自托管）
