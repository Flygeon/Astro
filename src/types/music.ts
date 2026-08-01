export type Song = {
	title: string;
	author: string;
	pic: string;
	url: string;
	lrc: string;
};

export type LyricLine = {
	time: number;
	text: string;
	sub: string;
};

export type PlayMode = "list" | "single" | "shuffle";
