import type { APIRoute } from "astro";
import { PAGE_SIZE } from "../constants/constants";
import { getSortedPosts } from "../utils/content-utils";

const staticPaths = ["/about/", "/archive/", "/bangumi/", "/friends/"];

const escapeXml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");

export const GET: APIRoute = async ({ site }) => {
	if (!site) {
		throw new Error("Astro site is not configured");
	}

	const posts = await getSortedPosts();
	const urls: Array<{ loc: string; lastmod?: Date }> = staticPaths.map(
		(pathname) => ({ loc: new URL(pathname, site).href }),
	);

	for (const post of posts) {
		urls.push({
			loc: new URL(`/posts/${post.slug}/`, site).href,
			lastmod: post.data.updated ?? post.data.published,
		});
	}

	for (let offset = 0; offset < posts.length; offset += PAGE_SIZE) {
		const pageNumber = offset / PAGE_SIZE + 1;
		const pagePosts = posts.slice(offset, offset + PAGE_SIZE);
		const lastmod = new Date(
			Math.max(
				...pagePosts.map((post) =>
					(post.data.updated ?? post.data.published).getTime(),
				),
			),
		);
		urls.push({
			loc: new URL(pageNumber === 1 ? "/" : `/${pageNumber}/`, site).href,
			lastmod,
		});
	}

	const entries = urls
		.map(
			({ loc, lastmod }) =>
				`<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ""}</url>`,
		)
		.join("");

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
		{
			headers: {
				"Content-Type": "application/xml; charset=utf-8",
				"Cache-Control": "public, max-age=3600, must-revalidate",
			},
		},
	);
};
