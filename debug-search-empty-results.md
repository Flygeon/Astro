# 搜索无结果调试记录

- 会话 ID：search-empty-results
- 状态：[OPEN]
- 环境：正式部署网站
- 症状：搜索功能无法搜索到任何内容

## 假设

1. 正式构建未生成或未部署 Pagefind 索引文件。
2. 搜索组件使用的 Pagefind 基础路径与正式部署路径不一致。
3. Pagefind 主脚本可用，但索引分片请求失败。
4. 搜索初始化时序导致 Pagefind API 不可用。
5. 正式文章 HTML 未被 Pagefind 收录，索引实际为空。

## 证据

- 正式站首页存在文章标题“博客更新日志”，搜索完整标题仍返回无结果。
- `https://flygeon.top/pagefind/pagefind.js` 返回 200，内容为 Pagefind 1.4.0。
- 首页和搜索过程中 `window.pagefind` 始终为 `undefined`。
- 正式站未发起任何 `/pagefind/` 脚本、索引、元数据或 WASM 请求。
- 搜索组件成功加载，但页面没有 Pagefind `<script>`，控制台也没有加载错误。
- 已确认假设 2、4：前端没有加载 Pagefind，超时后静默进入不可搜索状态。
- 已排除假设 1：正式站存在 Pagefind 主脚本产物。

## 结论

- 根因已定位为浏览器端缺少 Pagefind 加载与初始化。
- 待验证动态导入后能否查询正式索引，再实施最小修复。
