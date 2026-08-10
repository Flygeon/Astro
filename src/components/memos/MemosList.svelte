<script lang="ts">
import Icon from "@iconify/svelte";
import MarkdownIt from "markdown-it";
import { onDestroy, onMount } from "svelte";
import { profileConfig } from "../../config";
import I18nKey from "../../i18n/i18nKey";
import { i18n } from "../../i18n/translation";

// 头像的已处理 URL 与 Memos 站点地址由 .astro 传入（client:only 会序列化 props）
export let avatarSrc: string;
export let memosSite: string;

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

const markdown = new MarkdownIt({
	linkify: true,
	breaks: true,
	html: false,
});

const POLL_INTERVAL = 60_000;

let memos: Memo[] = [];
let loading = true;
let refreshing = false;
let error = "";
let lastUpdated: Date | null = null;
let timer: ReturnType<typeof setInterval>;
let selectedYear = "";

// 与文章日期一致：按 UTC 渲染，避免时区影响
function formatTime(iso: string): string {
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// 更新时间用本地时间，直观体现"多久前刷新的"
function formatClock(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function memoUrl(name: string): string {
	const id = name.split("/").pop();
	return `${memosSite}/m/${id}`;
}

function imageAttachments(m: Memo): MemoAttachment[] {
	return m.attachments.filter((a) => a.type.startsWith("image"));
}

// 从 memos 提取可用年份（降序）
$: years = [...new Set(memos.map((m) => new Date(m.createTime).getUTCFullYear()))].sort(
	(a, b) => b - a,
);

// 按年份过滤后的 memos
$: filteredMemos = selectedYear
	? memos.filter((m) => new Date(m.createTime).getUTCFullYear() === Number(selectedYear))
	: memos;

async function load() {
	refreshing = true;
	error = "";
	try {
		const res = await fetch("/api/memos", {
			signal: AbortSignal.timeout(15000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		memos = data.memos ?? [];
		lastUpdated = new Date();
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	} finally {
		loading = false;
		refreshing = false;
	}
}

// 后台标签页不轮询；回到前台立即拉取一次
function onVisibility() {
	if (document.visibilityState === "hidden") {
		clearInterval(timer);
	} else {
		timer = setInterval(load, POLL_INTERVAL);
		load();
	}
}

onMount(() => {
	load();
	timer = setInterval(load, POLL_INTERVAL);
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("focus", onVisibility);
});

onDestroy(() => {
	clearInterval(timer);
	document.removeEventListener("visibilitychange", onVisibility);
	window.removeEventListener("focus", onVisibility);
});
</script>

<!-- Header 卡片：标题 + 副标题 + 计数 + 年份筛选 -->
<header class="card-base rounded-[var(--radius-large)] px-6 py-5 mb-4">
	<div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:gap-4 items-center">
		<div class="min-w-0">
			<h1 class="text-2xl font-bold text-[var(--primary)] leading-tight">动态</h1>
			<p class="text-sm text-[var(--content-muted)] mt-1">随手记下此刻的想法与日常。</p>
			<div class="text-xs text-[var(--content-muted)] mt-2">
				{filteredMemos.length} 动态
			</div>
		</div>
		<div class="flex items-center gap-2 sm:justify-end">
			{#if years.length > 0}
				<select
					bind:value={selectedYear}
					class="text-sm rounded-lg border-none bg-[var(--btn-plain-bg-hover)] text-[var(--content-text)] px-3 py-1.5 cursor-pointer outline-none transition hover:opacity-80 focus:opacity-80"
					aria-label="按年份筛选"
				>
					<option value="">全部年份</option>
					{#each years as year}
						<option value={year}>{year}</option>
					{/each}
				</select>
			{/if}
		</div>
	</div>
</header>

<!-- 工具栏：刷新 + 更新时间 -->
<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--content-muted)] mb-4">
	<button
		type="button"
		on:click={load}
		class="flex items-center gap-1 btn-plain rounded-lg px-2 py-1 text-xs font-bold transition active:scale-95 cursor-pointer"
		aria-label="刷新动态"
	>
		<Icon
			class={refreshing ? "animate-spin text-[1rem]" : "text-[1rem]"}
			icon="material-symbols:refresh-rounded"
		/>
		刷新
	</button>
	{#if lastUpdated}
		<span class="text-[var(--meta-divider)]">|</span>
		<span class="text-xs">更新于 {formatClock(lastUpdated)}</span>
	{/if}
</div>

{#if error && memos.length > 0}
	<div class="mb-4 flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-500">
		<Icon class="text-[1.25rem]" icon="material-symbols:warning-outline-rounded" />
		<span>刷新失败，当前显示的是上次获取的数据（{error}）。点击上方"刷新"重试。</span>
	</div>
{/if}

{#if loading}
	<!-- 首次加载骨架屏 -->
	<div class="flex flex-col gap-4">
		{#each [1, 2] as _}
			<div class="card-base rounded-[var(--radius-large)] p-5 sm:p-6 animate-pulse">
				<div class="flex items-start gap-3 sm:gap-4">
					<div class="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-zinc-200 dark:bg-zinc-700 shrink-0"></div>
					<div class="grow">
						<div class="h-3 w-24 bg-zinc-200 dark:bg-zinc-700 rounded mb-3"></div>
						<div class="h-3 w-full bg-zinc-200 dark:bg-zinc-700 rounded mb-2"></div>
						<div class="h-3 w-2/3 bg-zinc-200 dark:bg-zinc-700 rounded"></div>
					</div>
				</div>
			</div>
		{/each}
	</div>
{:else if error && memos.length === 0}
	<!-- 首次加载失败 -->
	<div class="flex flex-col items-center justify-center gap-3 py-16 text-gray-400 dark:text-gray-500">
		<Icon
			class="text-5xl opacity-60"
			icon="material-symbols:cloud-off-outline-rounded"
		/>
		<span class="text-sm">动态加载失败</span>
		<span class="text-xs text-gray-400 dark:text-gray-500">{error}</span>
		<button
			type="button"
			on:click={load}
			class="mt-1 btn-plain rounded-lg px-4 py-1.5 text-sm font-bold transition active:scale-95 cursor-pointer"
		>
			重试
		</button>
	</div>
{:else if filteredMemos.length === 0}
	<!-- 空态 -->
	<div class="flex flex-col items-center justify-center gap-3 py-16 text-gray-400 dark:text-gray-500">
		<Icon
			class="text-5xl opacity-60"
			icon="material-symbols:feed-outline-rounded"
		/>
		<span class="text-sm">{selectedYear ? `${selectedYear} 年暂无动态` : "暂无动态"}</span>
	</div>
{:else}
	<ul class="flex flex-col gap-4">
		{#each filteredMemos as m}
			<li class="card-base rounded-[var(--radius-large)] p-5 sm:p-6">
				<div class="flex items-start gap-3 sm:gap-4">
					<img
						src={avatarSrc}
						alt="avatar"
						class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover shrink-0 mt-1"
						loading="lazy"
					/>
					<div class="grow min-w-0">
						<div class="flex flex-wrap items-center justify-between gap-1 mb-2">
							<div class="flex items-center gap-2">
								<span class="font-bold text-sm text-neutral-900 dark:text-neutral-100">
									{profileConfig.name}
								</span>
								{#if m.pinned}
									<span class="text-xs text-[var(--primary)] bg-[var(--btn-plain-bg)] px-2 py-0.5 rounded-full">
										{i18n(I18nKey.pinned)}
									</span>
								{/if}
							</div>
							<a
								href={memoUrl(m.name)}
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-gray-400 dark:text-gray-500 hover:text-[var(--primary)] hover:underline transition"
							>
								{formatTime(m.createTime)}
							</a>
						</div>

						<div
							class="memo-content prose dark:prose-invert prose-sm !max-w-none custom-md break-words"
						>
							{@html markdown.render(m.content)}
						</div>

						{#if m.tags.length > 0}
							<div class="flex flex-wrap gap-2 mt-3">
								{#each m.tags as tag}
									<span class="text-xs text-[var(--primary)] bg-[var(--btn-plain-bg)] px-2 py-0.5 rounded-full">
										#{tag}
									</span>
								{/each}
							</div>
						{/if}

						{#if imageAttachments(m).length > 0}
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
								{#each imageAttachments(m) as a}
									<a
										href={a.externalLink}
										target="_blank"
										rel="noopener noreferrer"
										class="overflow-hidden rounded-lg block relative bg-zinc-200 dark:bg-zinc-700 animate-pulse"
									>
										<img
											src={a.externalLink}
											alt={a.filename}
											loading="lazy"
											class="w-full h-auto max-h-80 object-cover hover:scale-105 transition duration-300 opacity-0"
											on:load={(e) => {
												const img = e.currentTarget as HTMLImageElement;
												img.style.opacity = "1";
												const parent = img.parentElement;
												if (parent) {
													parent.classList.remove("animate-pulse", "bg-zinc-200", "dark:bg-zinc-700");
												}
											}}
											on:error={(e) => {
												const img = e.currentTarget as HTMLImageElement;
												const parent = img.parentElement;
												if (parent) {
													parent.classList.remove("animate-pulse", "bg-zinc-200", "dark:bg-zinc-700");
													parent.classList.add("flex", "items-center", "justify-center", "min-h-32");
													parent.innerHTML = '<span class="text-xs text-gray-400">图片加载失败</span>';
												}
											}}
										/>
									</a>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</li>
		{/each}
	</ul>
{/if}
