<script lang="ts">
import { AUTO_MODE, DARK_MODE, LIGHT_MODE } from "@constants/constants.ts";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import {
	applyThemeToDocument,
	getBannerHidden,
	getDefaultHue,
	getHue,
	getStoredTheme,
	setBannerHidden,
	setHue,
	setTheme,
} from "@utils/setting-utils";
import { onMount } from "svelte";
import type { LIGHT_DARK_MODE } from "@/types/config.ts";

let hue = $state(getHue());
const defaultHue = getDefaultHue();
const modes: LIGHT_DARK_MODE[] = [LIGHT_MODE, DARK_MODE, AUTO_MODE];
let mode: LIGHT_DARK_MODE = $state(AUTO_MODE);
let layout = $state<"single" | "double">("single");
let listLayout = $state<"card" | "list">("card");
let bannerHidden = $state(false);
let open = $state(false);

onMount(() => {
	mode = getStoredTheme();
	layout =
		localStorage.getItem("post-layout") === "double" ? "double" : "single";
	document.documentElement.dataset.postLayout = layout;
	listLayout =
		localStorage.getItem("post-list-layout") === "list" ? "list" : "card";
	document.documentElement.dataset.postListLayout = listLayout;
	bannerHidden = getBannerHidden();
	const preference = window.matchMedia("(prefers-color-scheme: dark)");
	const updateTheme = () => applyThemeToDocument(mode);
	preference.addEventListener("change", updateTheme);
	return () => preference.removeEventListener("change", updateTheme);
});

function resetHue() {
	hue = getDefaultHue();
}

function switchMode(nextMode: LIGHT_DARK_MODE) {
	mode = nextMode;
	setTheme(nextMode);
}

function toggleBannerHidden() {
	bannerHidden = !bannerHidden;
	setBannerHidden(bannerHidden);
}

function switchLayout() {
	const nextLayout = layout === "double" ? "single" : "double";
	const postList = document.getElementById("post-list");
	postList?.classList.add("layout-switching");
	requestAnimationFrame(() => {
		layout = nextLayout;
		document.documentElement.dataset.postLayout = nextLayout;
		localStorage.setItem("post-layout", nextLayout);
		window.setTimeout(
			() => postList?.classList.remove("layout-switching"),
			320,
		);
	});
}

function switchListLayout() {
	const next = listLayout === "list" ? "card" : "list";
	const postList = document.getElementById("post-list");
	postList?.classList.add("layout-switching");
	requestAnimationFrame(() => {
		listLayout = next;
		document.documentElement.dataset.postListLayout = next;
		localStorage.setItem("post-list-layout", next);
		window.setTimeout(
			() => postList?.classList.remove("layout-switching"),
			320,
		);
	});
}

$effect(() => {
	if (hue || hue === 0) {
		setHue(hue);
	}
});
</script>

<div class="relative z-50">
    <button id="display-settings-switch" aria-label="Display settings" aria-expanded={open} aria-controls="display-settings-panel" class="btn-plain scale-animation rounded-lg w-11 h-11 active:scale-90" onclick={() => (open = !open)}>
        <Icon icon="material-symbols:tune-rounded" class="text-[1.25rem]"></Icon>
    </button>
    <div id="display-settings-panel" class:float-panel-closed={!open} class="absolute top-12 right-0 w-80 transition-all">
        <div class="card-base float-panel p-4">
            <div class="flex flex-row gap-2 mb-3 items-center justify-between">
                <div class="flex gap-2 font-bold text-lg text-neutral-900 dark:text-neutral-100 transition relative ml-3
            before:w-1 before:h-4 before:rounded-md before:bg-[var(--primary)]
            before:absolute before:-left-3 before:top-[0.33rem]"
                >
                    {i18n(I18nKey.themeColor)}
                    <button aria-label="Reset to Default" class="btn-regular w-7 h-7 rounded-md active:scale-90 will-change-transform" class:opacity-0={hue === defaultHue} class:pointer-events-none={hue === defaultHue} onclick={resetHue}>
                        <Icon icon="fa6-solid:arrow-rotate-left" class="text-[0.875rem]"></Icon>
                    </button>
                </div>
                <div id="hueValue" class="transition bg-[var(--btn-regular-bg)] w-10 h-7 rounded-md flex justify-center
            font-bold text-sm items-center text-[var(--btn-content)]">
                    {hue}
                </div>
            </div>
            <div class="w-full h-6 rounded select-none">
                <input aria-label={i18n(I18nKey.themeColor)} type="range" min="0" max="360" bind:value={hue} class="slider" id="colorSlider" step="5" style="width: 100%">
            </div>
            <div class="border-t border-[var(--line-divider)] my-4"></div>
            <button class="flex items-center justify-between w-full btn-plain scale-animation rounded-lg h-11 px-3" onclick={() => { const seq = [LIGHT_MODE, DARK_MODE, AUTO_MODE]; const i = seq.indexOf(mode); switchMode(seq[(i + 1) % seq.length]); }}>
                <span class="flex items-center gap-3">
                    <Icon icon={mode === LIGHT_MODE ? "material-symbols:wb-sunny-outline-rounded" : mode === DARK_MODE ? "material-symbols:dark-mode-outline-rounded" : "material-symbols:radio-button-partial-outline"} class="text-xl"></Icon>
                    {mode === LIGHT_MODE ? i18n(I18nKey.lightMode) : mode === DARK_MODE ? i18n(I18nKey.darkMode) : i18n(I18nKey.systemMode)}
                </span>
                <Icon icon="material-symbols:chevron-right-rounded" class="text-lg"></Icon>
            </button>
            <button class="flex items-center justify-between w-full btn-plain scale-animation rounded-lg h-11 px-3" onclick={switchLayout}>
                <span class="flex items-center gap-3">
                    <Icon icon={layout === "double" ? "material-symbols:view-list-outline-rounded" : "material-symbols:view-module-outline-rounded"} class="text-xl"></Icon>
                    {layout === "double" ? "切换为单栏" : "切换为双栏"}
                </span>
                <Icon icon="material-symbols:chevron-right-rounded" class="text-lg"></Icon>
            </button>
            <button class="flex items-center justify-between w-full btn-plain scale-animation rounded-lg h-11 px-3" onclick={switchListLayout}>
                <span class="flex items-center gap-3">
                    <Icon icon={listLayout === "list" ? "material-symbols:view-agenda-outline-rounded" : "material-symbols:format-list-bulleted-rounded"} class="text-xl"></Icon>
                    列表式布局（实验性）
                </span>
                <span class="text-sm text-black/50 dark:text-white/50">{listLayout === "list" ? "开" : "关"}</span>
            </button>
            <button class="flex items-center justify-between w-full btn-plain scale-animation rounded-lg h-11 px-3" onclick={toggleBannerHidden}>
                <span class="flex items-center gap-3">
                    <Icon icon={bannerHidden ? "material-symbols:image-outline" : "material-symbols:hide-image-outline"} class="text-xl"></Icon>
                    {bannerHidden ? "显示头图" : "隐藏头图"}
                </span>
                <Icon icon="material-symbols:chevron-right-rounded" class="text-lg"></Icon>
            </button>
        </div>
    </div>
</div>


<style lang="stylus">
    #display-settings-panel
      input[type="range"]
        -webkit-appearance none
        height 1.5rem
        border-radius 0.375rem
        background-image var(--color-selection-bar)
        transition background-image 0.15s ease-in-out

        &::-webkit-slider-runnable-track
          height 1.5rem
          border-radius 0.375rem

        &::-moz-range-track
          height 1.5rem
          border-radius 0.375rem
          background transparent

        /* Input Thumb */
        &::-webkit-slider-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          margin-top 0.25rem
          border-radius 0.375rem
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

        &::-moz-range-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.375rem
          border-width 0
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

        &::-ms-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.375rem
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

</style>
