import { getSortedPostsList } from "@utils/content-utils";
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ site }) => {
	const posts = await getSortedPostsList();
	const payload = posts.map(({ slug, data }) => ({
		title: data.title,
		link: new URL(`/posts/${slug}/`, site).href,
		image: data.image || null,
		description: data.description,
		category: data.category || null,
		tags: data.tags,
	}));

	return new Response(JSON.stringify(payload, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"X-Robots-Tag": "noindex, nofollow, noarchive",
		},
	});
};
