<!--
  MusicPreview.svelte

  导航栏音乐按钮的 hover 迷你播放器。
  与 /music 整页播放器共用 src/lib/musicEngine.ts 中的同一个引擎单例，
  因此两处的播放状态、进度、歌词、播放模式完全同步。

  显隐由父级 .nav-music-wrap:hover 的纯 CSS 控制（见 Navbar.astro），
  本组件只负责：首次悬浮时惰性初始化引擎 + 渲染紧凑控制面板。
-->
<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { formatTime, music } from "@/lib/musicEngine";

const FALLBACK_COVER = "/music/default.svg";

let rootEl: HTMLDivElement | undefined;
let progressEl: HTMLDivElement | undefined;
let opened = $state(false);

const song = $derived($music.songs[$music.current]);
const progress = $derived(
	$music.duration > 0 ? ($music.currentTime / $music.duration) * 100 : 0,
);
const lyricLine = $derived(
	$music.activeLyric >= 0 ? $music.lyrics[$music.activeLyric]?.text : "",
);

function open() {
	if (!opened) opened = true;
	// 惰性初始化：只有用户真的悬浮过音乐按钮才去拉歌单，避免每个页面都发一次请求
	music.init();
}

function seekTo(clientX: number) {
	if (!progressEl || $music.duration <= 0) return;
	const rect = progressEl.getBoundingClientRect();
	music.seek((clientX - rect.left) / rect.width);
}

let wrap: HTMLElement | null = null;

onMount(() => {
	wrap = rootEl?.closest<HTMLElement>(".nav-music-wrap") ?? null;
	wrap?.addEventListener("mouseenter", open);
	wrap?.addEventListener("focusin", open);
});

onDestroy(() => {
	// 只解绑监听，绝不停止播放：音频由引擎持有并挂在 document.body 上
	wrap?.removeEventListener("mouseenter", open);
	wrap?.removeEventListener("focusin", open);
});
</script>

<div class="mpv" bind:this={rootEl}>
	{#if !opened}
		<div class="mpv-empty">加载中…</div>
	{:else if $music.listError && $music.songs.length === 0}
		<div class="mpv-empty">
			<span>歌单加载失败</span>
			<button type="button" class="mpv-retry" onclick={() => music.loadPlaylist(true)}>
				重试
			</button>
		</div>
	{:else if !song}
		<div class="mpv-empty">加载中…</div>
	{:else}
		<div class="mpv-head">
			<img
				class="mpv-cover"
				class:is-spinning={$music.playing}
				src={song.pic || FALLBACK_COVER}
				alt=""
				referrerpolicy="no-referrer"
			/>
			<div class="mpv-meta">
				<p class="mpv-title" title={song.title}>{song.title}</p>
				<p class="mpv-author" title={song.author}>{song.author}</p>
			</div>
		</div>

		<p class="mpv-lyric">{lyricLine || "♪"}</p>

		<div
			class="mpv-progress"
			bind:this={progressEl}
			role="slider"
			tabindex="0"
			aria-label="播放进度"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress)}
			onpointerdown={(e) => seekTo(e.clientX)}
			onkeydown={(e) => {
				if (e.key === "ArrowRight") {
					music.seekBy(5);
					e.preventDefault();
				} else if (e.key === "ArrowLeft") {
					music.seekBy(-5);
					e.preventDefault();
				}
			}}
		>
			<span class="mpv-progress-fill" style={`width:${progress}%`}></span>
		</div>

		<div class="mpv-times">
			<span>{formatTime($music.currentTime)}</span>
			<span>{formatTime($music.duration)}</span>
		</div>

		<div class="mpv-controls">
			<button
				type="button"
				class="mpv-btn"
				aria-label="上一首"
				onclick={() => music.playNext(-1)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg
				>
			</button>

			<button
				type="button"
				class="mpv-btn mpv-btn-main"
				aria-label={$music.playing ? "暂停" : "播放"}
				onclick={() => music.togglePlay()}
			>
				{#if $music.playing}
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path fill="currentColor" d="M8 5h3v14H8zm5 0h3v14h-3z" /></svg
					>
				{:else}
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path fill="currentColor" d="M8 5.5v13l11-6.5z" /></svg
					>
				{/if}
			</button>

			<button
				type="button"
				class="mpv-btn"
				aria-label="下一首"
				onclick={() => music.playNext(1)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path fill="currentColor" d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" /></svg
				>
			</button>

			<span class="mpv-spacer"></span>

			<button
				type="button"
				class="mpv-btn mpv-btn-mode"
				aria-label="播放模式"
				title={$music.mode === "list"
					? "列表循环"
					: $music.mode === "single"
						? "单曲循环"
						: "随机播放"}
				onclick={() => music.cycleMode()}
			>
				{#if $music.mode === "single"}
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path
							fill="currentColor"
							d="M7 7h10v3l4-4l-4-4v3H5v6h2zm10 10H7v-3l-4 4l4 4v-3h12v-6h-2zm-4-1V8h-1l-2 1v1h1.5v6z"
						/></svg
					>
				{:else if $music.mode === "shuffle"}
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path
							fill="currentColor"
							d="M14.83 13.41l1.42-1.41l3.24 3.24V13h2v6h-6v-2h2.59zM4 6h3.5l3.2 3.2l-1.41 1.42L6.67 8H4zm12.25 0H14V4h6v6h-2V7.41l-11.3 11.3l-1.41-1.42z"
						/></svg
					>
				{:else}
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path
							fill="currentColor"
							d="M7 7h10v3l4-4l-4-4v3H5v6h2zm10 10H7v-3l-4 4l4 4v-3h12v-6h-2z"
						/></svg
					>
				{/if}
			</button>

			<a class="mpv-btn mpv-full" href="/music/" aria-label="打开完整播放器" title="完整播放器">
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path
						fill="currentColor"
						d="M5 5h6V3H3v8h2zm14 0v6h2V3h-8v2zM5 19v-6H3v8h8v-2zm14 0h-6v2h8v-8h-2z"
					/></svg
				>
			</a>
		</div>

		{#if $music.audioError}
			<p class="mpv-error">{$music.audioError}</p>
		{/if}
	{/if}
</div>

<style>
	.mpv {
		width: 17.5rem;
		padding: 0.85rem 0.9rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		color: var(--content-text);
	}

	.mpv-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 5rem;
		font-size: 0.8rem;
		color: var(--content-muted);
	}

	.mpv-retry {
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.75rem;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		cursor: pointer;
	}

	.mpv-head {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.mpv-cover {
		width: 2.9rem;
		height: 2.9rem;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
	}

	.mpv-cover.is-spinning {
		animation: mpv-spin 14s linear infinite;
	}

	@keyframes mpv-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.mpv-meta {
		min-width: 0;
		flex: 1;
	}

	.mpv-title {
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mpv-author {
		margin-top: 0.1rem;
		font-size: 0.72rem;
		color: var(--content-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mpv-lyric {
		font-size: 0.75rem;
		line-height: 1.3;
		min-height: 1.3em;
		text-align: center;
		color: var(--primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mpv-progress {
		position: relative;
		height: 4px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--content-muted) 30%, transparent);
		cursor: pointer;
	}

	.mpv-progress:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}

	.mpv-progress-fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: 999px;
		background: var(--primary);
		transition: width 0.15s linear;
	}

	.mpv-times {
		display: flex;
		justify-content: space-between;
		font-size: 0.66rem;
		color: var(--content-muted);
		font-variant-numeric: tabular-nums;
	}

	.mpv-controls {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		margin-top: 0.1rem;
	}

	.mpv-spacer {
		flex: 1;
	}

	.mpv-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		color: var(--content-text);
		background: transparent;
		cursor: pointer;
		transition:
			background 0.15s ease,
			transform 0.15s ease;
	}

	.mpv-btn:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--primary);
	}

	.mpv-btn:active {
		transform: scale(0.92);
	}

	.mpv-btn svg {
		width: 1.05rem;
		height: 1.05rem;
	}

	.mpv-btn-main {
		width: 2.25rem;
		height: 2.25rem;
		color: #fff;
		background: var(--primary);
	}

	.mpv-btn-main:hover {
		color: #fff;
		background: var(--primary);
		filter: brightness(1.08);
	}

	.mpv-btn-main svg {
		width: 1.2rem;
		height: 1.2rem;
	}

	.mpv-btn-mode,
	.mpv-full {
		color: var(--content-muted);
	}

	.mpv-btn-mode svg,
	.mpv-full svg {
		width: 0.95rem;
		height: 0.95rem;
	}

	.mpv-error {
		font-size: 0.68rem;
		line-height: 1.3;
		color: #e05d5d;
	}
</style>
