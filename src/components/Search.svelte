<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import { url } from "@utils/url-utils.ts";
import { onMount } from "svelte";
import { cubicIn, cubicOut } from "svelte/easing";
import { fly, scale } from "svelte/transition";
import type { SearchResult } from "@/global";

let keyword = $state("");
let result: SearchResult[] = $state([]);
let isSearching = $state(false);
let open = $state(false);
let pagefindLoaded = $state(false);
let initialized = $state(false);
let searchInput: HTMLInputElement | null = $state(null);
let selectedIndex = $state(0);

const fakeResult: SearchResult[] = [
	{
		url: url("/"),
		meta: {
			title: "This Is a Fake Search Result",
		},
		excerpt:
			"Because the search cannot work in the <mark>dev</mark> environment.",
	},
	{
		url: url("/"),
		meta: {
			title: "If You Want to Test the Search",
		},
		excerpt: "Try running <mark>npm build && npm preview</mark> instead.",
	},
];

export function openSearch() {
	open = true;
	setTimeout(() => searchInput?.focus(), 50);
}

export function closeSearch() {
	open = false;
	keyword = "";
	result = [];
	selectedIndex = 0;
}

function toggleSearch() {
	if (open) {
		closeSearch();
	} else {
		openSearch();
	}
}

const doSearch = async (kw: string): Promise<void> => {
	if (!kw) {
		result = [];
		selectedIndex = 0;
		return;
	}
	if (!initialized) return;

	isSearching = true;
	try {
		let searchResults: SearchResult[] = [];
		if (import.meta.env.PROD && pagefindLoaded && window.pagefind) {
			const response = await window.pagefind.search(kw);
			searchResults = await Promise.all(
				response.results.map((item) => item.data()),
			);
		} else if (import.meta.env.DEV) {
			searchResults = fakeResult;
		}
		result = searchResults;
		selectedIndex = 0;
	} catch (error) {
		console.error("Search error:", error);
		result = [];
		selectedIndex = 0;
	} finally {
		isSearching = false;
	}
};

function onKeydown(e: KeyboardEvent) {
	if ((e.ctrlKey || e.metaKey) && e.key === "k") {
		e.preventDefault();
		toggleSearch();
	}
	if (!open) return;

	if (e.key === "Escape") {
		closeSearch();
	} else if (e.key === "ArrowDown") {
		e.preventDefault();
		if (result.length > 0) {
			selectedIndex = (selectedIndex + 1) % result.length;
		}
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		if (result.length > 0) {
			selectedIndex = (selectedIndex - 1 + result.length) % result.length;
		}
	} else if (e.key === "Enter") {
		e.preventDefault();
		if (result.length > 0 && result[selectedIndex]) {
			window.location.href = result[selectedIndex].url;
			closeSearch();
		}
	}
}

onMount(() => {
	const initializeSearch = () => {
		initialized = true;
		pagefindLoaded =
			typeof window !== "undefined" &&
			!!window.pagefind &&
			typeof window.pagefind.search === "function";
	};

	if (import.meta.env.DEV) {
		console.log(
			"Pagefind is not available in development mode. Using mock data.",
		);
		initializeSearch();
	} else {
		document.addEventListener("pagefindready", () => initializeSearch());
		document.addEventListener("pagefindloaderror", () => initializeSearch());
		setTimeout(() => {
			if (!initialized) initializeSearch();
		}, 2000);
	}

	window.addEventListener("keydown", onKeydown);
	return () => window.removeEventListener("keydown", onKeydown);
});

$effect(() => {
	if (initialized && keyword) {
		doSearch(keyword);
	} else {
		result = [];
	}
});
</script>

<!-- Search trigger button -->
<button id="search-switch" aria-label={i18n(I18nKey.search)} onclick={toggleSearch}
        class="navbar-icon-button btn-plain scale-animation rounded-lg px-3 h-11 active:scale-90">
    <Icon class="text-[1.25rem] pointer-events-none" icon="material-symbols:search"></Icon>
    <span class="navbar-icon-button-label hidden lg:inline-flex items-center gap-1 pointer-events-none">
        {i18n(I18nKey.search)}
        <kbd class="ml-1 text-[0.65rem] font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-50">Ctrl K</kbd>
    </span>
</button>

<!-- Search centered box with smooth enter & exit transitions -->
{#if open}
<div class="fixed inset-x-0 top-[15vh] z-[999] mx-auto w-[90vw] max-w-[42rem] card-base rounded-2xl shadow-2xl overflow-hidden
            bg-[var(--card-bg)] border border-[var(--line-divider)] flex flex-col max-h-[75vh]"
     in:scale={{ duration: 250, start: 0.95, easing: cubicOut }}
     out:scale={{ duration: 200, start: 0.95, easing: cubicIn }}>
    
    <!-- Search input header -->
    <div class="flex items-center gap-3 px-5 h-16 border-b border-[var(--line-divider)] shrink-0 bg-white/40 dark:bg-white/5">
        <Icon class="text-[1.5rem] text-[var(--primary)] shrink-0" icon="material-symbols:search"></Icon>
        <input bind:this={searchInput} bind:value={keyword}
               placeholder={i18n(I18nKey.search) + "..."}
               class="flex-1 bg-transparent outline-0 text-base font-medium text-90 placeholder:text-black/30 dark:placeholder:text-white/30"
               autocomplete="off" spellcheck="false" />
        
        {#if keyword}
            <button class="btn-plain rounded-lg p-2 active:scale-90 text-50 hover:text-90 transition" 
                    onclick={() => { keyword = ""; result = []; searchInput?.focus(); }}
                    title="Clear">
                <Icon class="text-lg" icon="material-symbols:backspace-outline-rounded"></Icon>
            </button>
        {/if}

        <div class="h-5 w-[1px] bg-[var(--line-divider)] mx-0.5"></div>

        <button class="btn-plain rounded-lg px-2 py-1 text-xs font-mono bg-black/5 dark:bg-white/10 text-50 active:scale-95" 
                onclick={closeSearch}>
            ESC
        </button>
    </div>

    <!-- Search results & status container -->
    <div class="flex-1 overflow-y-auto p-3 space-y-1.5">
        {#if isSearching}
            <div class="flex flex-col items-center justify-center py-16 text-sm text-50 gap-3">
                <Icon class="animate-spin text-3xl text-[var(--primary)]" icon="material-symbols:progress-activity"></Icon>
                <span>Searching articles...</span>
            </div>
        {:else if result.length > 0}
            <div class="text-xs font-bold text-black/30 dark:text-white/30 px-3 py-1 uppercase tracking-wider">
                Found {result.length} results
            </div>
            {#each result as item, i}
                <a href={item.url} onclick={closeSearch}
                   onmouseenter={() => selectedIndex = i}
                   class="transition-all group block rounded-xl px-4 py-3.5 border border-transparent
                          {selectedIndex === i ? 'bg-[var(--primary)]/10 border-[var(--primary)]/30 shadow-sm' : 'hover:bg-[var(--btn-plain-bg-hover)]'}">
                    <div class="transition text-90 flex items-center justify-between font-bold text-base group-hover:text-[var(--primary)]">
                        <span class="flex items-center gap-2">
                            <Icon class="text-lg text-[var(--primary)] shrink-0" icon="material-symbols:article-outline-rounded"></Icon>
                            {item.meta.title}
                        </span>
                        <Icon class="transition text-[0.7rem] text-[var(--primary)] opacity-0 group-hover:opacity-100 transform -translate-x-2 group-hover:translate-x-0" icon="fa6-solid:chevron-right"></Icon>
                    </div>
                    <div class="transition text-sm text-50 mt-1.5 line-clamp-2 pl-7 leading-relaxed">
                        {@html item.excerpt}
                    </div>
                </a>
            {/each}
        {:else if keyword}
            <div class="flex flex-col items-center justify-center py-16 text-sm text-50 gap-2">
                <Icon class="text-5xl mb-1 text-black/20 dark:text-white/20 animate-bounce" icon="material-symbols:search-off-rounded"></Icon>
                <span class="font-medium text-base text-90">No results found for "{keyword}"</span>
                <span class="text-xs">Try checking your spelling or using different keywords</span>
            </div>
        {:else}
            <div class="flex flex-col items-center justify-center py-16 text-sm text-50 gap-2">
                <Icon class="text-5xl mb-1 text-black/20 dark:text-white/20" icon="material-symbols:keyboard-outline"></Icon>
                <span class="font-medium text-base text-90">搜点什么吗喵？</span>
                <span class="text-xs">Use <kbd class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">↑</kbd> <kbd class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">↓</kbd> to navigate, <kbd class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">Enter</kbd> to select</span>
            </div>
        {/if}
    </div>

    <!-- Footer hint -->
    <div class="px-5 py-2.5 bg-black/[0.02] dark:bg-white/[0.02] border-t border-[var(--line-divider)] flex items-center justify-between text-xs text-50 shrink-0">
        <div class="flex items-center gap-3">
            <span class="flex items-center gap-1"><kbd class="px-1 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">↑↓</kbd> Navigate</span>
            <span class="flex items-center gap-1"><kbd class="px-1 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">↵</kbd> Open</span>
        </div>
        <span>Powered by Pagefind</span>
    </div>
</div>
{/if}