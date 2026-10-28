# Dual Caption 双语字幕

[English](README.md) · **中文**

一个 Chrome / Edge 浏览器扩展，在任意网页视频上**同时显示两条字幕**：上方是学习语言（比如日语），下方是母语（比如中文），用来边看剧边学语言。字幕框的外观参考 macOS 的「实时字幕」。

Plex Web 开箱即用：扩展会直接从你的 Plex 媒体服务器读取字幕轨道，包括封装在 MKV 里的内嵌字幕。

## 功能

- **实时同步**：跟随网页自己的 `<video>` 元素，暂停、拖动进度、倍速都会自动跟上。
- **双语字幕**：可以加载 SRT、WebVTT、ASS 文件（一次拖入两个，日文自动放上方、中文放下方），也可以从 Plex 读取。
- **假名注音**：Netflix 字幕里的 `轟(とどろ)` 这类读音会显示成注音。
- **逐句跳转**：上一句 / 下一句、重播这一句，或者每句结束自动暂停。
- **字幕列表**：所有台词显示在侧栏，当前这一句高亮，点任意一句跳到那里。
- **学习模式**：母语那一行先模糊，鼠标移上去才显示。
- **生词本**：看视频时收藏句子，按视频分组复习，可以跳回视频里的那一句，可以导出 CSV 或 Anki 文件。
- **自动记忆**：每个视频的字幕、字幕框的位置和字号都会被记住；在 Plex 上，下一集会自动加载相同的语言。

## 安装（Edge / Chrome）

1. 下载这个仓库（`Code` → `Download ZIP` 后解压），或者用 `git clone`。
2. 打开 `edge://extensions`（Chrome 是 `chrome://extensions`）。
3. 打开「开发人员模式」。
4. 点「加载解压缩的扩展」，选择项目文件夹。

修改代码后，在扩展卡片上点刷新按钮，再刷新视频页面即可生效。

## 使用

- **Plex Web**：自动开启。开始播放后，鼠标移到字幕框上，点「从 Plex 读取」，选好上方和下方的语言，再点「加载」。
- **其他网站**：打开扩展弹窗，打开「在此网站显示」（或按 <kbd>⌥⇧S</kbd>），然后把字幕文件拖到字幕框上。
- 拖动字幕框可以改变位置。

### 快捷键（在视频页面）

| 键 | 功能 |
|---|---|
| <kbd>A</kbd> / <kbd>D</kbd> | 上一句 / 下一句 |
| <kbd>S</kbd> | 重播这一句 |
| <kbd>Q</kbd> | 每句结束自动暂停（开 / 关） |
| <kbd>M</kbd> | 收藏这一句 |
| <kbd>T</kbd> | 字幕列表 |
| <kbd>H</kbd> | 隐藏 / 显示字幕框 |
| <kbd>⌥⇧S</kbd> | 在当前网站开启 / 关闭 |

## 怎样读取 Plex 字幕

- **外挂字幕文件**：直接从 `/library/streams/{id}` 读取。
- **内嵌字幕**：这个接口会返回 `501 Not Implemented`，所以扩展照着 Plex Web 自己的做法：先在媒体文件上选中这条字幕（`PUT /library/parts/{id}?subtitleStreamID=…`），再请求一次播放决策，然后从 `/subtitles/:/transcode/universal/start` 拿到字幕文本。读完后会把原来的字幕选择改回去。
- 图片字幕（PGS / VobSub）里没有文字，无法读取。

## 目录结构

```
manifest.json         扩展清单（MV3）
src/parser.js         SRT / VTT / ASS 解析、编码识别、按时间查找字幕
src/plex.js           Plex：识别正在播放的视频，读取字幕轨道
src/overlay-css.js    字幕框样式（在 Shadow DOM 里）
src/content.js        字幕框、同步、快捷键、收藏
src/background.js     跨域请求、快捷键命令
popup/                工具栏弹窗
wordlist/             生词本页面
ui/base.css           弹窗和生词本的公共样式（跟随系统深浅色）
dev/test.html         不安装扩展也能调试的测试页
tools/make_icons.py   生成图标
```

### 不安装扩展直接调试

`dev/test.html` 会把内容脚本和一个简单的 `chrome.*` 替身（`dev/chrome-stub.js`）一起加载。用任意静态服务器托管项目的**上一级**文件夹，再在旁边放一个视频：

```bash
python3 -m http.server 8765
```

打开 `http://localhost:8765/<项目文件夹>/dev/test.html?video=/clip.mp4`。「加载示例字幕」按钮和 `?autoload=1` 会读取 `samples/S01E01.ja.srt` 和 `samples/S01E01.zh.srt`。`samples/` 文件夹不在仓库里，需要自己提取字幕：先用 `ffprobe episode.mkv` 查看字幕流的编号，再按编号提取（这里是第 23 条流）：

```bash
ffmpeg -i episode.mkv -map 0:23 samples/S01E01.ja.srt
```

## 已知限制

- 如果网站全屏的是 `<video>` 元素本身（而不是它外面的容器），全屏时看不到字幕框。
- Netflix、YouTube 等网站暂时需要手动加载字幕文件。
- 查词功能（鼠标移到词上显示意思）计划在下一版加入。
