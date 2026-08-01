<!--
  MusicPlayer.svelte

  本组件改编自开源项目 MusicPlayer（Apple Music 风格滚动歌词网页播放器）
  Original project : https://github.com/Mengobs/MusicPlayer
  Original author  : Meng Xinhong
  License          : MIT License, Copyright (c) 2025 Meng Xinhong
  完整许可证文本见仓库根目录 THIRD-PARTY-NOTICES.md 与 MusicPlayer/LICENSE

  本文件相对原项目的主要修改：
  1. 由原生 HTML/JS 页面重写为 Svelte 5 组件，可嵌入 Astro 博客；
  2. 移除本地文件选择逻辑，改为通过 Meting API 拉取网易云歌单并渲染播放列表；
  3. 歌词改为按 URL 远程拉取解析，新增多时间戳、译文分行支持；
  4. 新增上一首/下一首、播放模式、音量、Media Session、错误兜底等能力；
  5. 保留并还原原项目的封面取色、四象限旋转模糊背景（canvas.screen 合成）与
     阶梯式歌词滚动动画；
  6. 播放状态与 <audio> 抽离到共享引擎 src/lib/musicEngine.ts，使音乐可跨页面
     后台播放，并与导航栏 hover 迷你播放器共用同一份状态。
-->
<script lang="ts">
import { onDestroy, onMount, tick } from "svelte";
import type { LyricLine, PlayMode, Song } from "@/types/music";
import { music, formatTime } from "@/lib/musicEngine";

interface Props {
	apiUrl?: string;
	initialSongs?: Song[];
}

const {
	apiUrl = "https://meting.mikus.ink/api?server=netease&type=playlist&id=18117338659",
	initialSongs = [],
}: Props = $props();

/* ---------------------------------- 常量 ---------------------------------- */

const LINE_GAP = 18; // 歌词行间距（对应原项目 LINE_HEIGHT）
const MAX_BLUR_DISTANCE = 6;
const FALLBACK_COVER = "/music/default.svg";

/*
  播放状态与控制逻辑全部来自共享引擎 musicEngine（模块级单例，<audio> 挂在
  document.body，位于 Astro + Swup 交换容器之外，因此跨页面导航时音乐持续后台播放）。
  下面这些本地 $state 是引擎状态的镜像，供模板与纯视觉逻辑（canvas 背景、歌词阶梯布局）直接读取。
*/

let songs = $state<Song[]>([]);
let listLoading = $state(false);
let listError = $state("");

let current = $state(0);
let playing = $state(false);
let currentTime = $state(0);
let duration = $state(0);
let volume = $state(0.8);
let muted = $state(false);
let mode = $state<PlayMode>("list");
let audioError = $state("");
let seeking = $state(false);

let lyrics = $state<LyricLine[]>([]);
let lyricState = $state<"idle" | "loading" | "ready" | "empty" | "error">(
	"idle",
);
let activeLyric = $state(-1);

let canvasEl: HTMLCanvasElement | undefined;
let lyricsBox: HTMLElement | undefined;
let lyricsInner: HTMLElement | undefined;
let progressEl: HTMLElement | undefined;

let layoutTimers: ReturnType<typeof setTimeout>[] = [];
let animationId = 0;
let resizeObserver: ResizeObserver | undefined;
let visible = true;

const song = $derived($music.songs[$music.current]);
const progress = $derived(
	$music.duration > 0 ? ($music.currentTime / $music.duration) * 100 : 0,
);

// 引擎状态 → 本地镜像（单向同步，避免回写导致循环）
$effect(() => {
	const s = $music;
	songs = s.songs;
	listLoading = s.listLoading;
	listError = s.listError;
	current = s.current;
	playing = s.playing;
	currentTime = s.currentTime;
	duration = s.duration;
	volume = s.volume;
	muted = s.muted;
	mode = s.mode;
	audioError = s.audioError;
	lyrics = s.lyrics;
	lyricState = s.lyricState;
	activeLyric = s.activeLyric;
});

// 封面变化 → 重建流动背景（仅依赖 song 派生值，不会因 timeupdate 重复触发）
$effect(() => {
	const pic = song?.pic;
	if (pic) setupBackground(pic);
});

// 当前歌词行 / 歌词数据变化 → 重新布局
$effect(() => {
	const a = activeLyric;
	const l = lyrics;
	void tick().then(() => layoutLyrics(a, true));
});

/* 歌单加载 / 歌词解析 / 歌词拉取已迁移至共享引擎 musicEngine（见 src/lib/musicEngine.ts）。
   本组件只负责纯视觉：canvas 流动背景、Slice 旋转、歌词阶梯布局。 */

/* ------------------------- 歌词布局（源自原项目算法） ------------------------- */

function clearLayoutTimers() {
	for (const t of layoutTimers) clearTimeout(t);
	layoutTimers = [];
}

function layoutLyrics(active: number, animate = true) {
	if (!lyricsInner || !lyricsBox) return;
	const els = Array.from(lyricsInner.children) as HTMLElement[];
	if (els.length === 0) return;
	clearLayoutTimers();

	const anchor = active < 0 ? 0 : Math.min(active, els.length - 1);
	const offset = lyricsBox.clientHeight * 0.34;
	const heights = els.map((el) => el.offsetHeight + LINE_GAP);

	const positions: number[] = new Array(els.length);
	positions[anchor] = 0;
	let acc = 0;
	for (let i = anchor + 1; i < els.length; i++) {
		acc += heights[i - 1];
		positions[i] = acc;
	}
	acc = 0;
	for (let i = anchor - 1; i >= 0; i--) {
		acc -= heights[i];
		positions[i] = acc;
	}

	els.forEach((el, i) => {
		const distance = Math.abs(i - anchor);
		const isActive = active >= 0 && i === active;
		el.style.filter = `blur(${Math.min(distance, MAX_BLUR_DISTANCE) * 0.85}px)`;
		el.style.opacity = distance > 12 ? "0" : isActive ? "1" : "0.32";

		// 阶梯式延迟：越靠后的行启动越晚，复现原项目的瀑布滚动手感
		const step = Math.max(0, Math.min(i - anchor + 1, 10));
		const delay = animate ? step * 55 : 0;
		const apply = () => {
			el.style.transform = `translateY(${positions[i] + offset}px)`;
		};
		if (delay > 0) layoutTimers.push(setTimeout(apply, delay));
		else apply();
	});
}

async function relayout(animate = true) {
	await tick();
	requestAnimationFrame(() => layoutLyrics(activeLyric, animate));
}

/* -------------------------------- 播放控制 -------------------------------- */

async function playCurrent() {
	await music.playCurrent();
}

function togglePlay() {
	music.togglePlay();
}

async function selectSong(index: number, autoplay = true) {
	await music.selectSong(index, autoplay);
}

function playNext(step = 1) {
	music.playNext(step);
}

function cycleMode() {
	music.cycleMode();
}

function toggleMute() {
	music.toggleMute();
}

/* ------------------------------ 进度条交互 ------------------------------ */

function seekTo(clientX: number) {
	if (!progressEl || !Number.isFinite(duration) || duration <= 0) return;
	const rect = progressEl.getBoundingClientRect();
	const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
	music.seek(ratio);
}

function onProgressDown(event: PointerEvent) {
	if (duration <= 0) return;
	seeking = true;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	seekTo(event.clientX);
}

function onProgressMove(event: PointerEvent) {
	if (seeking) seekTo(event.clientX);
}

function onProgressUp(event: PointerEvent) {
	if (!seeking) return;
	seeking = false;
	(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}

function onProgressKey(event: KeyboardEvent) {
	if (duration <= 0) return;
	if (event.key === "ArrowRight") {
		music.seekBy(5);
		event.preventDefault();
	} else if (event.key === "ArrowLeft") {
		music.seekBy(-5);
		event.preventDefault();
	}
}

/* ------------------------- 封面取色 + 流动背景（原项目） ------------------------- */

function getDominantColors(imageData: ImageData, minDistance = 60) {
	const pixels = imageData.data;
	const { width, height } = imageData;
	const halfW = Math.floor(width / 2);
	const halfH = Math.floor(height / 2);
	const step = 4;
	const regions = [
		{ x1: 0, y1: 0, x2: halfW, y2: halfH },
		{ x1: halfW, y1: 0, x2: width, y2: halfH },
		{ x1: 0, y1: halfH, x2: halfW, y2: height },
		{ x1: halfW, y1: halfH, x2: width, y2: height },
	];
	const picked: number[][] = [];
	for (const region of regions) {
		let r = 0;
		let g = 0;
		let b = 0;
		let count = 0;
		for (let y = region.y1; y < region.y2; y += step) {
			for (let x = region.x1; x < region.x2; x += step) {
				const i = (y * width + x) * 4;
				r += pixels[i];
				g += pixels[i + 1];
				b += pixels[i + 2];
				count++;
			}
		}
		if (count === 0) continue;
		const color = [
			Math.round(r / count),
			Math.round(g / count),
			Math.round(b / count),
		];
		const unique = picked.every(
			([pr, pg, pb]) =>
				Math.sqrt(
					(color[0] - pr) ** 2 + (color[1] - pg) ** 2 + (color[2] - pb) ** 2,
				) >= minDistance,
		);
		if (unique) picked.push(color);
	}
	while (picked.length < 4) picked.push(picked[picked.length - 1] ?? [90, 90, 90]);
	return picked.map(([r, g, b]) => `rgba(${r},${g},${b},0.85)`);
}

class Slice {
	img: HTMLImageElement;
	index: number;
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	angle: number;
	velocity: number;

	constructor(img: HTMLImageElement, index: number, canvas: HTMLCanvasElement) {
		this.img = img;
		this.index = index;
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
		this.angle = Math.random() * Math.PI * 2;
		this.velocity = (Math.random() - 0.5) * 0.006;
	}

	update() {
		this.angle += this.velocity;
	}

	draw() {
		const { width, height } = this.canvas;
		const ctx = this.ctx;
		const centerX = this.index % 2 === 0 ? width * 0.25 : width * 0.75;
		const centerY = this.index < 2 ? height * 0.25 : height * 0.75;
		ctx.save();
		ctx.translate(centerX, centerY);
		ctx.rotate(this.angle);
		const sw = this.img.width / 2;
		const sh = this.img.height / 2;
		const sx = (this.index % 2) * sw;
		const sy = Math.floor(this.index / 2) * sh;
		const drawSize = Math.max(width, height) * 0.75;
		ctx.drawImage(
			this.img,
			sx,
			sy,
			sw,
			sh,
			-drawSize / 2,
			-drawSize / 2,
			drawSize,
			drawSize,
		);
		ctx.restore();
	}
}

function stopBackground() {
	if (animationId) cancelAnimationFrame(animationId);
	animationId = 0;
}

function setupBackground(pic: string) {
	if (!canvasEl || !pic) return;
	const canvas = canvasEl;
	const img = new Image();
	img.crossOrigin = "anonymous";
	img.onload = () => {
		try {
			const temp = document.createElement("canvas");
			temp.width = 80;
			temp.height = Math.max(
				1,
				Math.round(80 * (img.height / Math.max(img.width, 1))),
			);
			const tctx = temp.getContext("2d", { willReadFrequently: true });
			if (tctx) {
				tctx.drawImage(img, 0, 0, temp.width, temp.height);
				const colors = getDominantColors(
					tctx.getImageData(0, 0, temp.width, temp.height),
				);
				colors.forEach((color, i) => {
					const parent = canvas.parentElement;
					if (!parent) return;
					parent.style.setProperty(`--mp-color${i + 1}`, color);
					// 流动色块层使用半透明变体（对应原版 --colorN-rgba）
					parent.style.setProperty(
						`--mp-color${i + 1}-rgba`,
						color.replace(/[\d.]+\)$/, "0.3)"),
					);
				});
			}
		} catch {
			// 图床未返回 CORS 头时取色会失败，忽略即可，仍使用模糊封面兜底
		}

		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const host = canvas.parentElement;
		// 与原版一致：画布缓冲接近舞台尺寸，scale(1.5)+blur(30px) 后仍保持清晰流动
		canvas.width = Math.max(320, Math.round(host?.clientWidth ?? 640));
		canvas.height = Math.max(240, Math.round(host?.clientHeight ?? 480));

		const slices = [0, 1, 2, 3].map((i) => new Slice(img, i, canvas));
		stopBackground();
		const frame = () => {
			if (!visible) {
				animationId = 0;
				return;
			}
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.globalCompositeOperation = "screen";
			for (const slice of slices) {
				slice.update();
				slice.draw();
			}
			animationId = requestAnimationFrame(frame);
		};
		frame();
	};
	img.onerror = () => stopBackground();
	img.src = pic;
}

/* --------------------------------- 生命周期 --------------------------------- */

onMount(() => {
	// 初始化共享引擎（幂等）：加载歌单 / 首曲歌词。
	// 后台播放的 <audio> 由引擎持有并挂在 document.body，跨页面导航不销毁。
	music.init({ apiUrl, initialSongs });

	// 封面流动背景由 song 派生值的 $effect 驱动；此处仅建立歌词尺寸监听
	if (lyricsBox && typeof ResizeObserver !== "undefined") {
		resizeObserver = new ResizeObserver(() => layoutLyrics(activeLyric, false));
		resizeObserver.observe(lyricsBox);
	}

	const onVisibility = () => {
		visible = !document.hidden;
		if (visible && !animationId && song) setupBackground(song.pic);
	};
	document.addEventListener("visibilitychange", onVisibility);

	return () => {
		document.removeEventListener("visibilitychange", onVisibility);
	};
});

onDestroy(() => {
	// 注意：不要在此暂停 / 清空引擎的 <audio>，否则会中断后台播放。
	// 仅停止本组件私有的 canvas 动画与歌词布局计时器。
	stopBackground();
	clearLayoutTimers();
	resizeObserver?.disconnect();
});
</script>

<div class="mp-root">
	<!-- 播放器主体 -->
	<div class="mp-stage card-base">
		<canvas class="mp-canvas" bind:this={canvasEl}></canvas>
		<div class="mp-scrim"></div>

		<div class="mp-body">
			<div class="mp-left">
				<div class="mp-cover">
					<img
						src={song?.pic || FALLBACK_COVER}
						alt={song ? `${song.title} 封面` : "封面"}
						referrerpolicy="no-referrer"
						onerror={(e) => {
							(e.currentTarget as HTMLImageElement).src = FALLBACK_COVER;
						}}
					/>
					{#if playing}
						<div class="mp-playing-badge">
							<span></span><span></span><span></span>
						</div>
					{/if}
				</div>

				<div class="mp-meta">
					<div class="mp-title" title={song?.title}>
						{song?.title ?? (listLoading ? "正在加载歌单…" : "暂无曲目")}
					</div>
					<div class="mp-author" title={song?.author}>{song?.author ?? "—"}</div>
				</div>

				<div
					class="mp-progress"
					bind:this={progressEl}
					role="slider"
					tabindex="0"
					aria-label="播放进度"
					aria-valuemin="0"
					aria-valuemax={Math.round(duration)}
					aria-valuenow={Math.round(currentTime)}
					onpointerdown={onProgressDown}
					onpointermove={onProgressMove}
					onpointerup={onProgressUp}
					onpointercancel={onProgressUp}
					onkeydown={onProgressKey}
				>
					<div class="mp-progress-track">
						<div class="mp-progress-fill" style={`width:${progress}%`}></div>
					</div>
				</div>

				<div class="mp-time">
					<span>{formatTime(currentTime)}</span>
					<span>-{formatTime(Math.max(0, duration - currentTime))}</span>
				</div>

				<div class="mp-controls">
					<button
						class="mp-btn mp-btn-mode"
						type="button"
						aria-label="播放模式"
						title={mode === "list" ? "列表循环" : mode === "single" ? "单曲循环" : "随机播放"}
						onclick={cycleMode}
					>
						{#if mode === "list"}
							<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 7h10v3l4-4l-4-4v3H5v6h2zm10 10H7v-3l-4 4l4 4v-3h12v-6h-2z"/></svg>
						{:else if mode === "single"}
							<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 7h10v3l4-4l-4-4v3H5v6h2zm10 10H7v-3l-4 4l4 4v-3h12v-6h-2zm-4-4V8h-1l-2 1v1h1.5v3z"/></svg>
						{:else}
							<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.83 13.41l1.42-1.41l3.29 3.29V13h2v6h-6v-2h2.59zM4 6h3.5l2.6 2.6l-1.42 1.42L6.67 8H4zm16 0v5h-2V8h-2.59l-9 9H4v-2h2.67L15.5 6z"/></svg>
						{/if}
					</button>

					<button class="mp-btn" type="button" aria-label="上一首" onclick={() => playNext(-1)}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
					</button>

					<button class="mp-btn mp-btn-main" type="button" aria-label={playing ? "暂停" : "播放"} onclick={togglePlay}>
						{#if playing}
							<!-- 图标路径来自原项目 Mengobs/MusicPlayer -->
							<svg viewBox="0 0 32 28" aria-hidden="true"><path fill="currentColor" fill-rule="nonzero" d="M13.293 22.772c.955 0 1.436-.481 1.436-1.436V6.677c0-.98-.481-1.427-1.436-1.427h-2.457c-.954 0-1.436.473-1.436 1.427v14.66c-.008.954.473 1.435 1.436 1.435h2.457zm7.87 0c.954 0 1.427-.481 1.427-1.436V6.677c0-.98-.473-1.427-1.428-1.427h-2.465c-.955 0-1.428.473-1.428 1.427v14.66c0 .954.473 1.435 1.428 1.435h2.465z"/></svg>
						{:else}
							<svg viewBox="0 0 32 28" aria-hidden="true"><path fill="currentColor" fill-rule="nonzero" d="M10.345 23.287c.415 0 .763-.15 1.22-.407l12.742-7.404c.838-.481 1.178-.855 1.178-1.46 0-.599-.34-.972-1.178-1.462L11.565 5.158c-.457-.265-.805-.407-1.22-.407-.789 0-1.345.606-1.345 1.57V21.71c0 .971.556 1.577 1.345 1.577z"/></svg>
						{/if}
					</button>

					<button class="mp-btn" type="button" aria-label="下一首" onclick={() => playNext(1)}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
					</button>

					<div class="mp-volume">
						<button class="mp-btn mp-btn-mode" type="button" aria-label="静音" onclick={toggleMute}>
							{#if muted || volume === 0}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9zm13.5 3l2.5-2.5l-1.4-1.4L15 10.6l-2.6-2.5L11 9.5l2.5 2.5L11 14.5l1.4 1.4l2.6-2.5l2.6 2.5l1.4-1.4z"/></svg>
							{:else}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77"/></svg>
							{/if}
						</button>
						<input
							class="mp-volume-range"
							type="range"
							min="0"
							max="1"
							step="0.01"
							aria-label="音量"
							value={volume}
							oninput={(e) =>
								music.setVolume(Number((e.currentTarget as HTMLInputElement).value))}
						/>
					</div>
				</div>

				{#if audioError}
					<p class="mp-hint mp-hint-error">{audioError}</p>
				{/if}
			</div>

			<div class="mp-right" bind:this={lyricsBox}>
				{#if lyricState === "loading"}
					<p class="mp-hint">歌词加载中…</p>
				{:else if lyricState === "ready"}
					<div class="mp-lyrics" bind:this={lyricsInner}>
						{#each lyrics as line, i (i)}
							<div class="mp-lyric-line" class:is-active={i === activeLyric}>
								<p>{line.text}</p>
								{#if line.sub}<p class="mp-lyric-sub">{line.sub}</p>{/if}
							</div>
						{/each}
					</div>
				{:else if lyricState === "error"}
					<p class="mp-hint">歌词加载失败</p>
				{:else}
					<p class="mp-hint">暂无歌词</p>
				{/if}
			</div>
		</div>
	</div>

	<!-- 播放列表 -->
	<div class="card-base mp-list-card">
		<div class="mp-list-head">
			<h2>播放列表</h2>
			<div class="mp-list-actions">
				<span class="mp-count">{songs.length} 首</span>
				<button type="button" class="mp-refresh" onclick={() => loadPlaylist(true)} disabled={listLoading}>
					{listLoading ? "刷新中…" : "刷新"}
				</button>
			</div>
		</div>

		{#if listError}
			<p class="mp-list-empty">歌单加载失败：{listError}</p>
		{:else if songs.length === 0}
			<p class="mp-list-empty">{listLoading ? "正在获取歌单…" : "暂无曲目"}</p>
		{:else}
			<ol class="mp-list">
				{#each songs as item, i (item.url)}
					<li>
						<button
							type="button"
							class="mp-list-item"
							class:is-current={i === current}
							onclick={() => selectSong(i, true)}
						>
							<span class="mp-list-index">{i + 1}</span>
							<img
								class="mp-list-cover"
								src={item.pic || FALLBACK_COVER}
								alt=""
								loading="lazy"
								referrerpolicy="no-referrer"
							/>
							<span class="mp-list-info">
								<span class="mp-list-title">{item.title}</span>
								<span class="mp-list-author">{item.author}</span>
							</span>
							{#if i === current}
								<span class="mp-list-state">{playing ? "播放中" : "已选中"}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</div>

<style>
	.mp-root {
		--mp-color1: rgba(120, 120, 130, 0.85);
		--mp-color2: rgba(90, 90, 110, 0.85);
		--mp-color3: rgba(150, 150, 160, 0.85);
		--mp-color4: rgba(70, 70, 90, 0.85);
		--mp-color1-rgba: rgba(120, 120, 130, 0.3);
		--mp-color2-rgba: rgba(90, 90, 110, 0.3);
		--mp-color3-rgba: rgba(150, 150, 160, 0.3);
		--mp-color4-rgba: rgba(70, 70, 90, 0.3);
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI",
			"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ------------------------------ 播放器主体 ------------------------------ */
	.mp-stage {
		position: relative;
		overflow: hidden;
		min-height: 30rem;
		background: #111;
		isolation: isolate;
	}

	/*
	  背景效果说明：
	  原版 Mengobs/MusicPlayer 的"液体流动"背景完全由 canvas 层实现
	  （四象限旋转切片 + globalCompositeOperation='screen' + 重模糊），
	  原版 HTML 中 .background div 已被注释掉，不参与渲染。
	  本组件同样仅依赖 canvas 层产生该效果。
	*/
	.mp-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 0;
		pointer-events: none;
		background: #000;
		/* 与原版 .canvas 完全一致的滤镜链 */
		filter: blur(30px) saturate(2.5) brightness(0.6);
		transform: scale(1.5);
		mix-blend-mode: screen;
	}

	.mp-scrim {
		position: absolute;
		inset: 0;
		z-index: 1;
		/* 减轻遮罩，让 canvas 流动背景更明显地透出来 */
		background: linear-gradient(
			160deg,
			rgba(0, 0, 0, 0.08),
			rgba(0, 0, 0, 0.32)
		);
		pointer-events: none;
	}

	/* 全屏按钮已移除 */
	.mp-body {
		position: relative;
		z-index: 2;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		padding: 1.75rem;
	}

	@media (min-width: 900px) {
		.mp-body {
			grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
			gap: 2rem;
			padding: 2rem 2.25rem;
		}
	}

	.mp-left {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.mp-cover {
		position: relative;
		width: min(17rem, 68vw);
		aspect-ratio: 1;
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
		transition: transform 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);
		background: #2a2a2e;
	}

	.mp-cover:hover {
		transform: scale(1.03);
	}

	.mp-cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.mp-playing-badge {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 16px;
		padding: 4px 6px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.35);
		backdrop-filter: blur(6px);
	}

	.mp-playing-badge span {
		display: block;
		width: 3px;
		height: 100%;
		background: #fff;
		border-radius: 2px;
		animation: mp-bounce 0.9s ease-in-out infinite;
	}

	.mp-playing-badge span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.mp-playing-badge span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes mp-bounce {
		0%,
		100% {
			transform: scaleY(0.35);
		}
		50% {
			transform: scaleY(1);
		}
	}

	.mp-meta {
		width: min(19rem, 100%);
		margin-top: 1.5rem;
		text-align: center;
		color: #fff;
	}

	.mp-title {
		font-size: 1.05rem;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-shadow: 0 2px 14px rgba(0, 0, 0, 0.45);
	}

	.mp-author {
		margin-top: 0.25rem;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.65);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mp-progress {
		width: min(19rem, 100%);
		margin-top: 1.1rem;
		padding: 6px 0;
		cursor: pointer;
		touch-action: none;
	}

	.mp-progress:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.6);
		outline-offset: 4px;
		border-radius: 6px;
	}

	.mp-progress-track {
		height: 5px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.28);
		overflow: hidden;
		transition: height 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
	}

	.mp-progress:hover .mp-progress-track {
		height: 9px;
	}

	.mp-progress-fill {
		height: 100%;
		background: #fff;
		border-radius: 4px;
	}

	.mp-time {
		width: min(19rem, 100%);
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.75);
	}

	.mp-controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 1.1rem;
		flex-wrap: wrap;
	}

	.mp-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 999px;
		color: rgba(255, 255, 255, 0.9);
		background: transparent;
		transition: all 0.2s ease;
		cursor: pointer;
	}

	.mp-btn svg {
		width: 1.35rem;
		height: 1.35rem;
	}

	.mp-btn:hover {
		background: rgba(255, 255, 255, 0.16);
	}

	.mp-btn:active {
		transform: scale(0.88);
	}

	.mp-btn-mode svg {
		width: 1.1rem;
		height: 1.1rem;
		opacity: 0.75;
	}

	.mp-btn-main {
		width: 3rem;
		height: 3rem;
		background: rgba(255, 255, 255, 0.18);
	}

	.mp-btn-main svg {
		width: 1.9rem;
		height: 1.9rem;
	}

	.mp-volume {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.mp-volume-range {
		width: 4.5rem;
		height: 4px;
		accent-color: #fff;
		cursor: pointer;
	}

	.mp-hint {
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.85rem;
		text-align: center;
		margin: 0;
		align-self: center;
	}

	.mp-hint-error {
		margin-top: 0.9rem;
		color: rgba(255, 190, 190, 0.9);
	}

	/* -------------------------------- 歌词区 -------------------------------- */
	.mp-right {
		position: relative;
		min-height: 20rem;
		height: 26rem;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent 0%,
			black 22%,
			black 74%,
			transparent 100%
		);
		mask-image: linear-gradient(
			to bottom,
			transparent 0%,
			black 22%,
			black 74%,
			transparent 100%
		);
	}

	@media (min-width: 900px) {
		.mp-right {
			height: 30rem;
		}
	}

	.mp-lyrics {
		position: absolute;
		inset: 0;
	}

	.mp-lyric-line {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		padding: 0 0.5rem;
		box-sizing: border-box;
		color: #fff;
		opacity: 0.32;
		transform: translateY(0);
		transition:
			transform 0.7s cubic-bezier(0.19, 0.11, 0, 1),
			opacity 0.5s ease,
			filter 0.5s ease,
			scale 0.5s ease;
		will-change: transform, opacity, filter;
	}

	.mp-lyric-line p {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.4;
		word-break: break-word;
		text-shadow: 0 2px 18px rgba(0, 0, 0, 0.4);
	}

	@media (min-width: 900px) {
		.mp-lyric-line p {
			font-size: 1.75rem;
		}
	}

	.mp-lyric-line .mp-lyric-sub {
		margin-top: 0.15rem;
		font-size: 0.95rem;
		font-weight: 500;
		opacity: 0.72;
	}

	.mp-lyric-line.is-active {
		scale: 1.02;
		transform-origin: left center;
	}

	/* ------------------------------- 播放列表 ------------------------------- */
	.mp-list-card {
		padding: 1.25rem 1.5rem 1rem;
	}

	.mp-list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.mp-list-head h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--primary);
	}

	.mp-list-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.mp-count {
		font-size: 0.8rem;
		color: var(--content-muted);
	}

	.mp-refresh {
		font-size: 0.8rem;
		padding: 0.25rem 0.7rem;
		border-radius: 999px;
		color: var(--primary);
		background: var(--btn-plain-bg-hover);
		transition: background 0.2s ease;
		cursor: pointer;
	}

	.mp-refresh:hover:not(:disabled) {
		background: var(--btn-plain-bg-active);
	}

	.mp-refresh:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.mp-list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 26rem;
		overflow-y: auto;
	}

	.mp-list-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.65rem;
		border-radius: 0.6rem;
		text-align: left;
		transition: background 0.2s ease;
		cursor: pointer;
	}

	.mp-list-item:hover {
		background: var(--btn-plain-bg-hover);
	}

	.mp-list-item.is-current {
		background: var(--btn-plain-bg-hover);
	}

	.mp-list-index {
		width: 1.5rem;
		flex-shrink: 0;
		text-align: center;
		font-size: 0.8rem;
		color: var(--content-muted);
		font-variant-numeric: tabular-nums;
	}

	.mp-list-cover {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.4rem;
		object-fit: cover;
		flex-shrink: 0;
		background: var(--btn-regular-bg);
	}

	.mp-list-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.mp-list-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--content-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mp-list-item.is-current .mp-list-title {
		color: var(--primary);
	}

	.mp-list-author {
		font-size: 0.78rem;
		color: var(--content-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mp-list-state {
		flex-shrink: 0;
		font-size: 0.72rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		color: var(--primary);
		background: var(--btn-plain-bg-active);
	}

	.mp-list-empty {
		padding: 1.5rem 0;
		text-align: center;
		color: var(--content-muted);
		font-size: 0.9rem;
	}
</style>
