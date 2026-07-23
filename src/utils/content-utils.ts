import { type CollectionEntry, getCollection } from "astro:content";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { getCategoryUrl } from "@utils/url-utils.ts";

// // Retrieve posts and sort them by publication date
async function getRawSortedPosts() {
	const allBlogPosts = await getCollection("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});

	const sorted = allBlogPosts.sort((a, b) => {
		// Pinned posts always come first
		const pinnedA = a.data.pinned === true;
		const pinnedB = b.data.pinned === true;
		if (pinnedA !== pinnedB) {
			return pinnedA ? -1 : 1;
		}
		// Then sort by publication date (newest first)
		const dateA = new Date(a.data.published);
		const dateB = new Date(b.data.published);
		return dateA > dateB ? -1 : 1;
	});
	return sorted;
}

export async function getSortedPosts() {
	const sorted = await getRawSortedPosts();

	for (let i = 1; i < sorted.length; i++) {
		sorted[i].data.nextSlug = sorted[i - 1].slug;
		sorted[i].data.nextTitle = sorted[i - 1].data.title;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		sorted[i].data.prevSlug = sorted[i + 1].slug;
		sorted[i].data.prevTitle = sorted[i + 1].data.title;
	}

	return sorted;
}

export function getRecommendedPosts(
	currentPost: CollectionEntry<"posts">,
	posts: CollectionEntry<"posts">[],
	limit = 3,
): CollectionEntry<"posts">[] {
	const currentTags = new Set(
		currentPost.data.tags.map((tag) => tag.trim().toLowerCase()),
	);
	const currentCategory =
		currentPost.data.category?.trim().toLowerCase() ?? null;
	const now = Date.now();

	return posts
		.filter(
			(post) => post.slug !== currentPost.slug && post.data.draft !== true,
		)
		.map((post) => {
			const sharedTags = post.data.tags.filter((tag) =>
				currentTags.has(tag.trim().toLowerCase()),
			).length;
			const sameCategory =
				currentCategory !== null &&
				post.data.category?.trim().toLowerCase() === currentCategory;
			const ageInDays = Math.max(
				0,
				(now - new Date(post.data.published).getTime()) / 86400000,
			);
			const freshness = 30 * Math.exp((-Math.LN2 * ageInDays) / 180);
			const score = sharedTags * 24 + (sameCategory ? 12 : 0) + freshness;

			return { post, score, sharedTags };
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				new Date(b.post.data.published).getTime() -
					new Date(a.post.data.published).getTime(),
		)
		.sort((a, b) => Number(b.sharedTags > 0) - Number(a.sharedTags > 0))
		.slice(0, limit)
		.map(({ post }) => post);
}

export function getRandomPosts(
	currentPost: CollectionEntry<"posts">,
	posts: CollectionEntry<"posts">[],
	excludedPosts: CollectionEntry<"posts">[] = [],
	limit = 5,
): CollectionEntry<"posts">[] {
	const excluded = new Set([
		currentPost.slug,
		...excludedPosts.map((post) => post.slug),
	]);
	let seed = Array.from(currentPost.slug).reduce(
		(value, character) => value * 31 + character.charCodeAt(0),
		7,
	);

	return posts
		.filter((post) => !excluded.has(post.slug) && post.data.draft !== true)
		.map((post) => {
			seed = (seed * 9301 + 49297) % 233280;
			return { post, order: seed / 233280 };
		})
		.sort((a, b) => a.order - b.order)
		.slice(0, limit)
		.map(({ post }) => post);
}
export type PostForList = {
	slug: string;
	data: CollectionEntry<"posts">["data"];
};
export async function getSortedPostsList(): Promise<PostForList[]> {
	const sortedFullPosts = await getRawSortedPosts();

	// delete post.body
	const sortedPostsList = sortedFullPosts.map((post) => ({
		slug: post.slug,
		data: post.data,
	}));

	return sortedPostsList;
}
export type Tag = {
	name: string;
	count: number;
};

export async function getTagList(): Promise<Tag[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});

	const countMap: { [key: string]: number } = {};
	allBlogPosts.forEach((post: { data: { tags: string[] } }) => {
		post.data.tags.forEach((tag: string) => {
			if (!countMap[tag]) countMap[tag] = 0;
			countMap[tag]++;
		});
	});

	// sort tags
	const keys: string[] = Object.keys(countMap).sort((a, b) => {
		return a.toLowerCase().localeCompare(b.toLowerCase());
	});

	return keys.map((key) => ({ name: key, count: countMap[key] }));
}

export type Category = {
	name: string;
	count: number;
	url: string;
};

export async function getCategoryList(): Promise<Category[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});
	const count: { [key: string]: number } = {};
	allBlogPosts.forEach((post: { data: { category: string | null } }) => {
		if (!post.data.category) {
			const ucKey = i18n(I18nKey.uncategorized);
			count[ucKey] = count[ucKey] ? count[ucKey] + 1 : 1;
			return;
		}

		const categoryName =
			typeof post.data.category === "string"
				? post.data.category.trim()
				: String(post.data.category).trim();

		count[categoryName] = count[categoryName] ? count[categoryName] + 1 : 1;
	});

	const lst = Object.keys(count).sort((a, b) => {
		return a.toLowerCase().localeCompare(b.toLowerCase());
	});

	const ret: Category[] = [];
	for (const c of lst) {
		ret.push({
			name: c,
			count: count[c],
			url: getCategoryUrl(c),
		});
	}
	return ret;
}

export type ActivityDay = {
	date: string;
	count: number;
	titles: string[];
};

export type SiteStatistics = {
	postCount: number;
	categoryCount: number;
	tagCount: number;
	totalWords: number;
	firstPublishedAt: Date | null;
	lastActivityAt: Date | null;
	categoryDetails: Category[];
	tagDetails: Tag[];
	activity: ActivityDay[];
};

function dateKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export async function getSiteStatistics(): Promise<SiteStatistics> {
	const posts = await getCollection("posts", ({ data }) =>
		import.meta.env.PROD ? data.draft !== true : true,
	);
	const activityMap = new Map<string, ActivityDay>();
	let totalWords = 0;
	let firstPublishedAt: Date | null = null;
	let lastActivityAt: Date | null = null;

	for (const post of posts) {
		const { remarkPluginFrontmatter } = await post.render();
		totalWords += Number(remarkPluginFrontmatter.words ?? 0);
		const publishedAt = new Date(post.data.published);
		const updatedAt = post.data.updated ? new Date(post.data.updated) : null;
		if (!firstPublishedAt || publishedAt < firstPublishedAt)
			firstPublishedAt = publishedAt;
		const activityDates = [publishedAt, ...(updatedAt ? [updatedAt] : [])];
		for (const date of activityDates) {
			const key = dateKey(date);
			const day = activityMap.get(key) ?? { date: key, count: 0, titles: [] };
			if (!day.titles.includes(post.data.title)) {
				day.count += 1;
				day.titles.push(post.data.title);
			}
			activityMap.set(key, day);
		}
		if (!lastActivityAt || publishedAt > lastActivityAt)
			lastActivityAt = publishedAt;
		if (updatedAt && updatedAt > lastActivityAt) lastActivityAt = updatedAt;
	}

	const categoryDetails = await getCategoryList();
	const tagDetails = await getTagList();
	const today = new Date();
	const start = new Date(today);
	start.setDate(today.getDate() - 364);
	const activity: ActivityDay[] = [];
	for (
		let date = new Date(start);
		date <= today;
		date.setDate(date.getDate() + 1)
	) {
		const key = dateKey(date);
		activity.push(activityMap.get(key) ?? { date: key, count: 0, titles: [] });
	}

	return {
		postCount: posts.length,
		categoryCount: categoryDetails.length,
		tagCount: tagDetails.length,
		totalWords,
		firstPublishedAt,
		lastActivityAt,
		categoryDetails,
		tagDetails,
		activity,
	};
}
