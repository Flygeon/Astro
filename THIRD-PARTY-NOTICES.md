# 第三方开源组件声明 / Third-Party Notices

本项目包含以下第三方开源代码，其版权归原作者所有，使用方式遵循相应开源许可协议。

---

## MusicPlayer (AM-Like Music Player With Lyrics)

- 原项目地址 / Repository: <https://github.com/Mengobs/MusicPlayer>
- 原作者 / Author: Meng Xinhong (Mengobs)
- 许可协议 / License: MIT License
- 本仓库中的位置 / Location in this repository:
  - `MusicPlayer/` —— 上游原始代码副本（保持原样，含原始 LICENSE）
  - `src/components/music/MusicPlayer.svelte` —— 基于原项目改造的 Svelte 组件
  - `src/pages/music.astro` —— 承载该组件的博客页面
  - `public/music/default.svg` —— 取自原项目的默认封面占位图

### 修改说明 / Modifications

在遵循 MIT 协议的前提下，本站对原项目做了如下修改：

1. 将原生 HTML/CSS/JS 单页重写为 Svelte 5 组件，以便嵌入 Astro 博客并适配站点主题；
2. 移除本地文件选择（`<input type="file">` + jsmediatags 读取本地音频标签）逻辑；
3. 改为通过 Meting API 拉取网易云歌单，自动获取标题、歌手、封面、音频与歌词地址，并渲染播放列表；
4. 歌词由本地 `.lrc` 文件解析改为远程拉取解析，新增多时间戳、译文分行的处理；
5. 新增上一首/下一首、播放模式（列表循环 / 单曲循环 / 随机）、音量与静音、进度条拖拽、
   Media Session 系统媒体控制、加载失败自动跳过等能力；
6. 保留原项目的核心视觉实现：封面主色提取、四象限旋转模糊流动背景、阶梯式歌词滚动动画，
   并将全屏布局改造为可嵌入卡片的自适应布局。

### 许可证全文 / License Text

```text
MIT License

Copyright (c) 2025 Meng Xinhong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 其他说明 / Notes

- 原项目 `MusicPlayer/TestAudio/` 目录下的音频、封面与歌词文件版权归各自原作者所有，
  仅供测试使用，本站页面未引用这些文件。
- `/music` 页面的音频与歌词数据来自第三方 Meting API（网易云音乐源），仅供个人在线试听，
  音乐版权归各自权利人所有。
