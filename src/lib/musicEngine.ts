/**
 * musicEngine.ts
 *
 * 共享音乐播放引擎（单例）。
 *
 * 设计目标：
 * 1. 单一 <audio> 元素挂在 document.body 上 —— 它位于 Astro + Swup 的交换容器
 *    （main / #sidebar-sticky）之外，因此页面切换（SPA 过渡）时不会被销毁，
 *    音乐可在阅读博客其他界面时后台持续播放。
 * 2. 所有播放状态集中在 svelte/store 中，/music 整页播放器与导航栏 hover 弹窗
 *    订阅同一份状态，共用同一套控制逻辑。
 *
 * 视觉相关逻辑（canvas 流动背景、Slice 旋转、歌词阶梯布局）不属于引擎，
 * 由具体组件负责；引擎只产出数据（currentSong / lyrics / activeLyric 等）。
 */

import {
	derived,
	writable,
	type Readable,
	type Subscriber,
	type Unsubscriber,
} from "svelte/store";
import type { LyricLine, PlayMode, Song } from "@/types/music";

export const PLAYLIST_API =
	"https://meting.mikus.ink/api?server=netease&type=playlist&id=18117338659";

/** 音量 / 静音 / 播放模式 的本地持久化键 */
const PREF_KEY = "mp:prefs";

export interface MusicState {
	songs: Song[];
	current: number;
	playing: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	muted: boolean;
	mode: PlayMode;
	lyrics: LyricLine[];
	activeLyric: number;
	lyricState: "idle" | "loading" | "ready" | "empty" | "error";
	audioError: string;
	listLoading: boolean;
	listError: string;
}

const DEFAULT_STATE: MusicState = {
	songs: [],
	current: 0,
	playing: false,
	currentTime: 0,
	duration: 0,
	volume: 0.8,
	muted: false,
	mode: "list",
	lyrics: [],
	activeLyric: -1,
	lyricState: "idle",
	audioError: "",
	listLoading: false,
	listError: "",
};

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

class MusicEngine {
	audio: HTMLAudioElement | null = null;
	readonly state = writable<MusicState>({ ...DEFAULT_STATE });
	private lrcCache = new Map<string, LyricLine[]>();
	private lrcToken = 0;
	private failStreak = 0;
	private apiUrl = PLAYLIST_API;
	private inited = false;

	/** 让 `music` 本身即是一个 Svelte store：组件里可直接写 `$music.playing` */
	subscribe(run: Subscriber<MusicState>): Unsubscriber {
		return this.state.subscribe(run);
	}

	/* ------------------------------- 初始化 ------------------------------- */

	init(opts?: { apiUrl?: string; initialSongs?: Song[] }) {
		if (opts?.apiUrl) this.apiUrl = opts.apiUrl;
		this.restorePrefs();
		const s = this.get();
		if (opts?.initialSongs && opts.initialSongs.length && s.songs.length === 0) {
			this.patch({
				songs: opts.initialSongs,
				current: 0,
			});
			const a = this.ensureAudio();
			if (a && opts.initialSongs[0]) a.src = opts.initialSongs[0].url;
			this.updateMediaSession(opts.initialSongs[0]);
			void this.loadLyrics(opts.initialSongs[0]);
		}
		// 无论是否已有 initialSongs，只要还没拉过歌单就拉一次（幂等）
		if (!this.inited && this.get().songs.length === 0) {
			void this.loadPlaylist();
		}
		this.inited = true;
	}

	/* ------------------------------- 音频元素 ------------------------------- */

	private ensureAudio(): HTMLAudioElement | null {
		if (this.audio) return this.audio;
		if (typeof document === "undefined") return null;
		const a = new Audio();
		a.preload = "auto";
		a.style.display = "none";
		// 状态里的音量/静音是持久化恢复来的，必须同步到真实音频元素上
		a.volume = this.stateVal.volume;
		a.muted = this.stateVal.muted;
		a.addEventListener("timeupdate", () => {
			const cur = a.currentTime;
			this.patch({ currentTime: cur });
			this.syncLyric(cur);
		});
		a.addEventListener("loadedmetadata", () => {
			this.patch({
				duration: Number.isFinite(a.duration) ? a.duration : 0,
			});
		});
		a.addEventListener("play", () => this.patch({ playing: true }));
		a.addEventListener("pause", () => this.patch({ playing: false }));
		a.addEventListener("ended", () => this.handleEnded());
		a.addEventListener("error", () => this.handleError());
		// 挂在 body 上：位于 Swup 交换容器之外，跨页面持续存活
		document.body.appendChild(a);
		this.audio = a;
		return a;
	}

	/* ------------------------------- 歌单/歌词 ------------------------------- */

	async loadPlaylist(force = false): Promise<void> {
		const s = this.get();
		if (s.listLoading) return;
		if (!force && s.songs.length > 0) return;
		this.patch({ listLoading: true, listError: "" });
		try {
			const res = await fetch(this.apiUrl, {
				signal: AbortSignal.timeout(15000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as Song[];
			if (!Array.isArray(data) || data.length === 0)
				throw new Error("歌单为空或格式异常");
			// 请求期间若已被 initialSongs（同一 API 的构建期快照）填充，就不再覆盖，
			// 否则会重设 audio.src 打断正在进行的播放
			if (!force && this.get().songs.length > 0) return;
			this.patch({ songs: data, current: 0 });
			const a = this.ensureAudio();
			if (a) a.src = data[0].url;
			this.updateMediaSession(data[0]);
			await this.loadLyrics(data[0]);
		} catch (err) {
			this.patch({
				listError: err instanceof Error ? err.message : "未知错误",
			});
		} finally {
			this.patch({ listLoading: false });
		}
	}

	async loadLyrics(target: Song | undefined): Promise<void> {
		const token = ++this.lrcToken;
		this.patch({ lyrics: [], lyricState: "loading" });
		if (!target?.lrc) {
			this.patch({ lyricState: "empty" });
			return;
		}
		const cached = this.lrcCache.get(target.lrc);
		if (cached) {
			this.patch({
				lyrics: cached,
				lyricState: cached.length ? "ready" : "empty",
			});
			return;
		}
		try {
			const res = await fetch(target.lrc, {
				signal: AbortSignal.timeout(15000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const text = await res.text();
			if (token !== this.lrcToken) return;
			const parsed = this.parseLrc(text);
			this.lrcCache.set(target.lrc, parsed);
			this.patch({
				lyrics: parsed,
				lyricState: parsed.length ? "ready" : "empty",
			});
		} catch {
			if (token !== this.lrcToken) return;
			this.patch({ lyrics: [], lyricState: "error" });
		}
	}

	private parseLrc(text: string): LyricLine[] {
		const result: LyricLine[] = [];
		for (const raw of text.split("\n")) {
			TIME_TAG.lastIndex = 0;
			const stamps = [...raw.matchAll(TIME_TAG)];
			if (stamps.length === 0) continue;
			let content = raw.replace(TIME_TAG, "").trim();
			if (!content) continue;

			// 网易云常见格式：原文 (译文) / 原文 (【译文】)，拆成主副两行显示
			let sub = "";
			const paired = content.match(/^(.+?)\s*[（(]\s*【?(.+?)】?\s*[)）]\s*$/);
			if (
				paired &&
				paired[1].trim().length >= 2 &&
				paired[2].trim().length >= 2 &&
				/[\u4e00-\u9fa5]/.test(paired[2])
			) {
				content = paired[1].trim();
				sub = paired[2].trim();
			}

			for (const st of stamps) {
				const ms = st[3] ? Number.parseInt(st[3].padEnd(3, "0"), 10) : 0;
				const time =
					Number.parseInt(st[1], 10) * 60 +
					Number.parseInt(st[2], 10) +
					ms / 1000;
				result.push({ time, text: content, sub });
			}
		}
		result.sort((a, b) => a.time - b.time);
		return result;
	}

	/* ------------------------------- 播放控制 ------------------------------- */

	async playCurrent(): Promise<void> {
		const a = this.ensureAudio();
		if (!a) return;
		try {
			await a.play();
			this.patch({ playing: true, audioError: "" });
		} catch {
			this.patch({ playing: false });
		}
	}

	togglePlay(): void {
		const s = this.get();
		const a = this.ensureAudio();
		if (!a || !s.songs[s.current]) return;
		if (s.playing) {
			a.pause();
			this.patch({ playing: false });
		} else {
			if (!a.src) a.src = s.songs[s.current].url;
			void this.playCurrent();
		}
	}

	async selectSong(index: number, autoplay = true): Promise<void> {
		const s = this.get();
		if (index < 0 || index >= s.songs.length) return;
		const target = s.songs[index];
		this.patch({
			current: index,
			currentTime: 0,
			duration: 0,
			audioError: "",
			activeLyric: -1,
		});
		const a = this.ensureAudio();
		if (a) {
			a.src = target.url;
			a.load();
		}
		this.updateMediaSession(target);
		await this.loadLyrics(target);
		if (autoplay) await this.playCurrent();
	}

	private nextIndex(step: number): number {
		const s = this.get();
		if (s.songs.length === 0) return 0;
		if (s.mode === "shuffle" && s.songs.length > 1) {
			let n = s.current;
			while (n === s.current) n = Math.floor(Math.random() * s.songs.length);
			return n;
		}
		return (s.current + step + s.songs.length) % s.songs.length;
	}

	playNext(step = 1): void {
		void this.selectSong(this.nextIndex(step), true);
	}

	private handleEnded(): void {
		this.failStreak = 0;
		const s = this.get();
		if (s.mode === "single") {
			const a = this.ensureAudio();
			if (a) {
				a.currentTime = 0;
				void this.playCurrent();
			}
			return;
		}
		this.playNext(1);
	}

	private handleError(): void {
		const s = this.get();
		const a = this.audio;
		const song = s.songs[s.current];
		if (!song || !a?.getAttribute("src")) return;
		this.patch({
			audioError: `《${song.title}》加载失败，可能是版权限制`,
			playing: false,
		});
		this.failStreak += 1;
		// 播放中出错时自动跳过，但避免整张歌单不可用时无限循环
		if (this.failStreak < s.songs.length && s.songs.length > 1) {
			setTimeout(() => this.playNext(1), 900);
		}
	}

	cycleMode(): void {
		const s = this.get();
		const mode: PlayMode =
			s.mode === "list" ? "single" : s.mode === "single" ? "shuffle" : "list";
		this.patch({ mode });
		this.savePrefs();
	}

	toggleMute(): void {
		const s = this.get();
		const muted = !s.muted;
		const a = this.ensureAudio();
		if (a) a.muted = muted;
		this.patch({ muted });
		this.savePrefs();
	}

	setVolume(v: number): void {
		const vol = Math.min(1, Math.max(0, v));
		const a = this.ensureAudio();
		if (a) {
			a.volume = vol;
			if (vol > 0 && a.muted) a.muted = false;
		}
		this.patch({ volume: vol, muted: vol > 0 ? false : this.get().muted });
		this.savePrefs();
	}

	/* ------------------------------- 偏好持久化 ------------------------------- */

	private prefsRestored = false;

	private restorePrefs(): void {
		if (this.prefsRestored || typeof localStorage === "undefined") return;
		this.prefsRestored = true;
		try {
			const raw = localStorage.getItem(PREF_KEY);
			if (!raw) return;
			const p = JSON.parse(raw) as Partial<
				Pick<MusicState, "volume" | "muted" | "mode">
			>;
			const next: Partial<MusicState> = {};
			if (typeof p.volume === "number" && p.volume >= 0 && p.volume <= 1)
				next.volume = p.volume;
			if (typeof p.muted === "boolean") next.muted = p.muted;
			if (p.mode === "list" || p.mode === "single" || p.mode === "shuffle")
				next.mode = p.mode;
			if (Object.keys(next).length) this.patch(next);
			const a = this.audio;
			if (a) {
				if (next.volume !== undefined) a.volume = next.volume;
				if (next.muted !== undefined) a.muted = next.muted;
			}
		} catch {
			// 隐私模式 / 存储被禁用时忽略
		}
	}

	private savePrefs(): void {
		if (typeof localStorage === "undefined") return;
		const s = this.get();
		try {
			localStorage.setItem(
				PREF_KEY,
				JSON.stringify({ volume: s.volume, muted: s.muted, mode: s.mode }),
			);
		} catch {
			// 忽略写入失败
		}
	}

	seek(ratio: number): void {
		const a = this.ensureAudio();
		const s = this.get();
		if (!a || !Number.isFinite(s.duration) || s.duration <= 0) return;
		const t = Math.min(Math.max(ratio, 0), 1) * s.duration;
		a.currentTime = t;
		this.patch({ currentTime: t });
		this.syncLyric(t);
	}

	seekBy(seconds: number): void {
		const s = this.get();
		if (s.duration <= 0) return;
		this.seek((s.currentTime + seconds) / s.duration);
	}

	/* ------------------------------- 歌词高亮 ------------------------------- */

	private syncLyric(time: number): void {
		const s = this.get();
		if (s.lyrics.length === 0) return;
		let index = -1;
		for (let i = 0; i < s.lyrics.length; i++) {
			if (time >= s.lyrics[i].time) index = i;
			else break;
		}
		if (index !== s.activeLyric) this.patch({ activeLyric: index });
	}

	/* ------------------------------- Media Session ------------------------------- */

	private updateMediaSession(target: Song | undefined): void {
		if (
			!target ||
			typeof navigator === "undefined" ||
			!("mediaSession" in navigator)
		)
			return;
		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: target.title,
				artist: target.author,
				artwork: target.pic ? [{ src: target.pic, sizes: "512x512" }] : [],
			});
			navigator.mediaSession.setActionHandler("previoustrack", () =>
				this.playNext(-1),
			);
			navigator.mediaSession.setActionHandler("nexttrack", () =>
				this.playNext(1),
			);
			navigator.mediaSession.setActionHandler("play", () =>
				void this.playCurrent(),
			);
			navigator.mediaSession.setActionHandler("pause", () => {
				this.ensureAudio()?.pause();
				this.patch({ playing: false });
			});
		} catch {
			// 部分浏览器不支持，忽略
		}
	}

	/* ------------------------------- 工具 ------------------------------- */

	private get(): MusicState {
		return this.stateVal;
	}
	private stateVal: MusicState = { ...DEFAULT_STATE };
	private patch(p: Partial<MusicState>): void {
		this.state.update((prev) => {
			this.stateVal = { ...prev, ...p };
			return this.stateVal;
		});
	}
}

export const music = new MusicEngine();

export const currentSong: Readable<Song | undefined> = derived(
	music.state,
	($s) => $s.songs[$s.current],
);

export const musicProgress: Readable<number> = derived(
	music.state,
	($s) => ($s.duration > 0 ? ($s.currentTime / $s.duration) * 100 : 0),
);

export function formatTime(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "0:00";
	const m = Math.floor(value / 60);
	const s = Math.floor(value % 60);
	return `${m}:${s < 10 ? "0" : ""}${s}`;
}
