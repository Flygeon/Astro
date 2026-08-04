// functions/api/memos.ts
// Cloudflare Pages Function：代理 Memos 的公开动态。
// Access key（MEMOS_TOKEN）只存放在服务端（Pages 环境变量），不会暴露到浏览器。
// 前端 /memos 页面通过 GET /api/memos 实时拉取最新动态。
// 路由由 Cloudflare Pages 自动识别（仓库根目录 functions/api/memos.ts -> /api/memos）。

interface MemoAttachment {
	name: string;
	filename: string;
	externalLink: string;
	type: string;
}

interface Memo {
	name: string;
	state: string;
	createTime: string;
	content: string;
	pinned: boolean;
	tags: string[];
	attachments: MemoAttachment[];
}

interface Env {
	MEMOS_TOKEN?: string;
}

const MEMOS_API = "https://memos.flygeon.top/api/v1/memos";
const PAGE_SIZE = 50;

async function fetchPublicMemos(token: string): Promise<Memo[]> {
	const memos: Memo[] = [];
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
		memos.push(...(data.memos ?? []).filter((m: Memo) => m.state === "NORMAL"));
		pageToken = data.nextPageToken ?? "";
		if (!pageToken) break;
	}
	return memos;
}

export async function onRequest({ env }: { env: Env }): Promise<Response> {
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
					// 实时接口：禁止缓存，避免浏览器/边缘缓存返回旧数据
					"Cache-Control": "no-store, no-cache, must-revalidate",
					"Access-Control-Allow-Origin": "*",
				},
			},
		);
	} catch (error) {
		return Response.json({ memos: [], error: String(error) }, { status: 500 });
	}
}
