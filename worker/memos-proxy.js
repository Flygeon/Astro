// worker/memos-proxy.js
// Cloudflare Worker：代理 Memos 的公开动态。
//
// 背景：本仓库通过 .github/workflows/deploy.yml 部署到 GitHub Pages（纯静态托管），
// GitHub Pages 无法运行 Cloudflare Pages Functions，所以仓库根目录的 functions/api/memos/
// 永远不会被执行，导致前端 /api/memos 404。
// 由于 flygeon.top 本身在 Cloudflare 边缘网络下，最稳妥的做法是用一个 Cloudflare Worker
// 在边缘拦截 /api/memos* 请求并代理到 memos.flygeon.top，token 只存在 Worker 的环境变量里。
//
// 部署步骤（需要你自己的 Cloudflare 账号凭证）：
//   1. cd worker
//   2. npx wrangler login            # 或在环境变量里配置 CF_API_TOKEN
//   3. npx wrangler secret put MEMOS_TOKEN   # 粘贴你的 Memos Open API token
//   4. npx wrangler deploy
// 路由 flygeon.top/api/memos* 已在 wrangler.toml 中声明，无需改前端代码。

const MEMOS_API = "https://memos.flygeon.top/api/v1/memos";
const PAGE_SIZE = 50;

async function fetchPublicMemos(token) {
	const memos = [];
	let pageToken = "";
	while (true) {
		const params = new URLSearchParams({
			limit: String(PAGE_SIZE),
			orderByTimeAsc: "false",
			filter: "visibility == 'PUBLIC'",
		});
		if (pageToken) params.set("pageToken", pageToken);

		const res = await fetch(`${MEMOS_API}?${params}`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(15000),
		});
		if (!res.ok) break;

		const data = await res.json();
		memos.push(...(data.memos ?? []).filter((m) => m.state === "NORMAL"));
		pageToken = data.nextPageToken ?? "";
		if (!pageToken) break;
	}
	return memos;
}

export default {
	async fetch(request, env) {
		const token = env.MEMOS_TOKEN;
		if (!token) {
			return Response.json(
				{ memos: [], error: "MEMOS_TOKEN not configured" },
				{ status: 200 },
			);
		}

		try {
			const memos = await fetchPublicMemos(token);

			// 置顶在前，其余按时间倒序
			memos.sort((a, b) => {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return (
					new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
				);
			});

			return Response.json(
				{ memos },
				{
					headers: {
						// 实时接口：禁止缓存，避免边缘缓存返回旧数据
						"Cache-Control": "no-store, no-cache, must-revalidate",
						"Access-Control-Allow-Origin": "*",
					},
				},
			);
		} catch (error) {
			return Response.json({ memos: [], error: String(error) }, { status: 500 });
		}
	},
};
