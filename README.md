# Dual Caption

**English** · [中文](README.zh-CN.md)

A Chrome / Edge extension that overlays **two subtitle tracks at once** on any web video — your target language on top (e.g. Japanese) and your native language below (e.g. Chinese). Built for learning languages from TV shows and films. The caption card is styled after macOS Live Captions.

Plex Web is supported out of the box: the extension reads subtitle tracks (including subtitles embedded in MKV files) straight from your Plex Media Server.

## Features

- **Real-time sync** — follows the page's own `<video>` element, so pause, seek and playback speed changes are picked up automatically.
- **Dual subtitles** — load SRT, WebVTT or ASS files (drop two at once; Japanese goes on top, Chinese below), or read them from Plex.
- **Furigana** — Netflix-style readings such as `轟(とどろ)` are rendered as ruby text.
- **Sentence navigation** — jump to the previous / next line, replay the current line, or auto-pause at the end of every line.
- **Transcript panel** — every line in a side panel; the current one is highlighted, click any line to jump there.
- **Learning mode** — the native-language line stays blurred until you hover it.
- **Word list** — bookmark lines while watching, review them grouped by video, jump back to the moment in the video, export to CSV or Anki.
- **Remembers things** — subtitles per video, card position and size; on Plex, the next episode loads the same languages automatically.

## Install (Edge / Chrome)

1. Download this repository (`Code` → `Download ZIP`, then unzip) or `git clone` it.
2. Open `edge://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the project folder.

After changing the code, click the reload button on the extension card and refresh the video page.

## Usage

- **Plex Web**: enabled automatically. Start playback, hover the caption card, click **从 Plex 读取** (Read from Plex), choose the top and bottom languages, then **加载** (Load).
- **Other sites**: open the extension popup and switch on **在此网站显示** (Show on this site), or press <kbd>⌥⇧S</kbd>, then drop subtitle files onto the caption card.
- Drag the caption card to move it.

### Keyboard shortcuts (on the video page)

| Key | Action |
|---|---|
| <kbd>A</kbd> / <kbd>D</kbd> | Previous / next line |
| <kbd>S</kbd> | Replay current line |
| <kbd>Q</kbd> | Toggle auto-pause after each line |
| <kbd>M</kbd> | Bookmark current line |
| <kbd>T</kbd> | Transcript panel |
| <kbd>H</kbd> | Hide / show the caption card |
| <kbd>⌥⇧S</kbd> | Turn the extension on / off for this site |

## How Plex subtitles are read

- **Sidecar files** are fetched from `/library/streams/{id}`.
- **Embedded tracks** return `501 Not Implemented` from that endpoint, so the extension does what Plex Web itself does: select the stream on the media part (`PUT /library/parts/{id}?subtitleStreamID=…`), request a playback decision, then fetch the text from `/subtitles/:/transcode/universal/start`. The part's original subtitle selection is restored afterwards.
- Image-based subtitles (PGS / VobSub) contain no text and can't be read.

## Project layout

```
manifest.json         Extension manifest (MV3)
src/parser.js         SRT / VTT / ASS parsing, encoding detection, cue lookup
src/plex.js           Plex: detect the playing item, read subtitle tracks
src/overlay-css.js    Caption card styles (inside a Shadow DOM)
src/content.js        Caption card, sync loop, shortcuts, bookmarks
src/background.js     Cross-origin requests, keyboard command
popup/                Toolbar popup
wordlist/             Word list page
ui/base.css           Shared styles for popup and word list (light / dark)
dev/test.html         Test page that runs the content script without installing
tools/make_icons.py   Generates the icons
```

### Developing without installing

`dev/test.html` loads the content script together with a small `chrome.*` stub (`dev/chrome-stub.js`). Serve the project's **parent** folder with any static server and put a video next to it:

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/<project-folder>/dev/test.html?video=/clip.mp4`. The **加载示例字幕** (Load sample subtitles) button and `?autoload=1` look for `samples/S01E01.ja.srt` and `samples/S01E01.zh.srt`. The `samples/` folder isn't in the repository; extract your own tracks. List the subtitle streams with `ffprobe episode.mkv`, then extract one by its index (here stream 23):

```bash
ffmpeg -i episode.mkv -map 0:23 samples/S01E01.ja.srt
```

## Known limitations

- If a site puts the `<video>` element itself into fullscreen (instead of its container), the caption card isn't visible in fullscreen.
- Netflix, YouTube and other sites need subtitle files loaded by hand for now.
- Word lookup (hover a word to see its meaning) is planned for the next version.
