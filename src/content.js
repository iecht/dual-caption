// Dual Caption — overlay that follows the page's <video> element.
// Sync works by reading video.currentTime every frame, so pause / seek / speed
// changes made in the site's own player are reflected automatically.
(() => {
  if (window.__dualCaption) return;
  window.__dualCaption = true;

  const DC = globalThis.DC;
  DC.plex.init();

  const store = chrome.storage.local;
  const DEFAULTS = {
    scale: 1,
    showPrimary: true,
    showSecondary: true,
    learnMode: false,
    furigana: true,
    autoPause: false,
    pos: null, // { cx, by } as fractions of the viewport
    plexPrefs: null, // { primary: {languageCode,title}, secondary: {...} }
  };

  const S = {
    settings: { ...DEFAULTS },
    sites: {},
    marks: [],
    video: null,
    key: null,
    title: '',
    tracks: { primary: null, secondary: null }, // { name, text, cues }
    offsets: { primary: 0, secondary: 0 },
    ui: null,
    sheetTab: null,
    hidden: false,
    last: { primary: null, secondary: null },
    baseIdx: -1,
    autoPausedIdx: -1,
    lastResolve: 0,
    userScrollAt: 0,
  };

  const SLOT_LABEL = { primary: '上方 · 学习语言', secondary: '下方 · 母语' };

  // ---------- helpers ----------

  DC.bgFetch = (url, headers, method) =>
    new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'fetch', url, headers, method }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      } catch (e) {
        reject(e);
      }
    });

  const topHost = (() => {
    if (window === top) return location.host;
    try {
      const a = location.ancestorOrigins;
      if (a && a.length) return new URL(a[a.length - 1]).host;
    } catch (_) {}
    return location.host;
  })();

  const isPlex = () => DC.plex.isPlexPage();

  function isEnabled() {
    const v = S.sites[topHost];
    return v === undefined ? isPlex() : v;
  }

  async function save(obj) {
    try {
      await store.set(obj);
    } catch (_) {
      // extension was reloaded; this page's script is orphaned
    }
  }

  function el(tag, attrs = {}, html) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  const ICON = {
    captions: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M7 11h4M14 11h3M7 15h6M16 15h1"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="17.5" r=".6"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.55 5.2 5.75.83-4.16 4.06.98 5.72L12 16.71l-5.12 2.7.98-5.72L3.7 9.63l5.75-.83z"/></svg>',
    starFill: '<svg class="filled" viewBox="0 0 24 24"><path d="M12 3.6l2.55 5.2 5.75.83-4.16 4.06.98 5.72L12 16.71l-5.12 2.7.98-5.72L3.7 9.63l5.75-.83z"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    hide: '<svg viewBox="0 0 24 24"><path d="M3.5 3.5l17 17"/><path d="M10.4 5.6A9 9 0 0 1 12 5.5c5 0 8.4 4.4 9.4 6.5-.5 1-1.4 2.4-2.8 3.7M6.5 7.2C4.5 8.6 3.2 10.6 2.6 12c1 2.1 4.4 6.5 9.4 6.5 1.6 0 3-.4 4.3-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  };

  // ---------- UI ----------

  function ensureUI() {
    if (S.ui) return S.ui;
    const host = el('div', { id: 'dual-caption-overlay' });
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(el('style', {}, DC.OVERLAY_CSS));
    const root = el('div', { class: 'root' });
    shadow.appendChild(root);

    // Keep clicks/keys/wheel on our UI from reaching the site's player
    // (e.g. Plex toggles play/pause when its container is clicked).
    for (const t of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu', 'keydown', 'keyup', 'keypress', 'touchstart']) {
      host.addEventListener(t, (e) => e.stopPropagation());
    }

    const card = el('div', { class: 'card no-subs' });
    card.innerHTML = `
      <div class="toolbar"><div class="pill">
        <button class="icon-btn" data-act="subs" title="加载字幕">${ICON.captions}</button>
        <button class="icon-btn" data-act="list" title="字幕列表 (T)">${ICON.list}</button>
        <button class="icon-btn" data-act="mark" title="收藏这一句 (M)">${ICON.star}</button>
        <button class="icon-btn" data-act="settings" title="设置">${ICON.sliders}</button>
        <button class="icon-btn" data-act="hide" title="隐藏 (H)">${ICON.hide}</button>
      </div></div>
      <div class="mark-dot">${ICON.starFill}</div>
      <div class="line primary"></div>
      <div class="line secondary"></div>
      <div class="empty">
        <b>双语字幕</b>
        把字幕文件拖到这里（可一次拖入两个）
        <div class="links">
          <button class="btn small" data-act="pick">选择文件</button>
          <button class="btn small primary plex-only" data-act="plex">从 Plex 读取</button>
        </div>
      </div>`;
    root.appendChild(card);

    const toast = el('div', { class: 'toast' });
    root.appendChild(toast);

    const sheet = el('div', { class: 'sheet' });
    sheet.innerHTML = `
      <div class="sheet-head">
        <div class="seg">
          <button data-tab="subs">字幕</button>
          <button data-tab="list">列表</button>
          <button data-tab="settings">设置</button>
        </div>
        <button class="icon-btn" data-act="close-sheet" title="关闭">${ICON.close}</button>
      </div>
      <div class="sheet-body">
        <div class="tab" data-tab="subs"></div>
        <div class="tab" data-tab="list"></div>
        <div class="tab" data-tab="settings"></div>
      </div>`;
    root.appendChild(sheet);

    const fileInput = el('input', { type: 'file', multiple: '', accept: '.srt,.vtt,.ass,.ssa,.txt' });
    fileInput.style.display = 'none';
    root.appendChild(fileInput);

    S.ui = {
      host,
      root,
      card,
      toast,
      sheet,
      fileInput,
      primary: card.querySelector('.primary'),
      secondary: card.querySelector('.secondary'),
      body: sheet.querySelector('.sheet-body'),
      tabs: {
        subs: sheet.querySelector('.tab[data-tab=subs]'),
        list: sheet.querySelector('.tab[data-tab=list]'),
        settings: sheet.querySelector('.tab[data-tab=settings]'),
      },
    };

    root.addEventListener('click', onClick);
    fileInput.addEventListener('change', () => {
      loadFiles([...fileInput.files], fileInput.dataset.slot || 'auto');
      fileInput.value = '';
    });
    setupDrag(card);
    setupDrop(card, 'auto');
    S.ui.body.addEventListener('wheel', () => (S.userScrollAt = Date.now()), { passive: true });
    window.addEventListener('resize', applyPosition);

    placeHost();
    applySettings();
    renderSubsTab();
    renderSettingsTab();
    return S.ui;
  }

  // Inside fullscreen only the fullscreen element's subtree is painted, so the
  // overlay has to move in there.
  function placeHost() {
    if (!S.ui) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const target = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (target && S.ui.host.parentNode !== target) target.appendChild(S.ui.host);
  }
  document.addEventListener('fullscreenchange', placeHost);
  document.addEventListener('webkitfullscreenchange', placeHost);

  function updateVisibility() {
    if (!S.ui) return;
    const show = !!S.video && isEnabled() && !S.hidden;
    S.ui.host.style.display = show ? 'block' : 'none';
    S.ui.root.querySelectorAll('.plex-only').forEach((b) => (b.style.display = isPlex() ? '' : 'none'));
  }

  function toast(msg) {
    if (!S.ui) return;
    S.ui.toast.textContent = msg;
    S.ui.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => S.ui.toast.classList.remove('show'), 1600);
  }

  function onClick(e) {
    const b = e.target.closest('[data-act],[data-tab]');
    if (!b) return;
    if (b.dataset.tab && b.closest('.seg')) return openSheet(b.dataset.tab);
    const act = b.dataset.act;
    switch (act) {
      case 'subs':
      case 'list':
      case 'settings':
        return S.sheetTab === act ? closeSheet() : openSheet(act);
      case 'close-sheet':
        return closeSheet();
      case 'mark':
        return toggleMark(S.baseIdx >= 0 ? S.baseIdx : currentBaseIndex());
      case 'hide':
        S.hidden = true;
        updateVisibility();
        return;
      case 'pick':
        S.ui.fileInput.dataset.slot = b.dataset.slot || 'auto';
        return S.ui.fileInput.click();
      case 'plex':
        openSheet('subs');
        return loadPlexStreams();
      case 'clear':
        S.tracks[b.dataset.slot] = null;
        onTracksChanged();
        return;
      case 'offset': {
        const slot = b.dataset.slot;
        const d = parseFloat(b.dataset.d);
        S.offsets[slot] = d === 0 ? 0 : Math.round((S.offsets[slot] + d) * 10) / 10;
        S.last[slot] = null;
        saveRecord();
        renderSubsTab();
        return;
      }
      case 'plex-load':
        return loadPlexSelected();
      case 'plex-player':
        return loadPlexPlayerSubtitle(b.dataset.slot);
      case 'reset-pos':
        setSetting('pos', null);
        return;
      case 'wordlist':
        chrome.runtime.sendMessage({ type: 'openWordlist' });
        return;
      case 'seek': {
        const i = +b.dataset.i;
        const base = baseTrack();
        if (e.target.closest('.tr-star')) return toggleMark(i);
        if (base) seekTo(base.cues[i].start + S.offsets[base.slot]);
        return;
      }
    }
  }

  function openSheet(tab) {
    ensureUI();
    S.sheetTab = tab;
    S.ui.sheet.classList.add('open');
    S.ui.card.classList.add('has-sheet');
    S.ui.sheet.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    Object.entries(S.ui.tabs).forEach(([k, t]) => t.classList.toggle('on', k === tab));
    if (tab === 'subs') renderSubsTab();
    if (tab === 'settings') renderSettingsTab();
    if (tab === 'list') {
      renderTranscript();
      S.userScrollAt = 0;
      highlightTranscript(true);
    }
  }

  function closeSheet() {
    S.sheetTab = null;
    if (!S.ui) return;
    S.ui.sheet.classList.remove('open');
    S.ui.card.classList.remove('has-sheet');
  }

  // ---------- drag & position ----------

  function setupDrag(card) {
    let start = null;
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button,select,input,a')) return;
      const r = card.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, cx: r.left + r.width / 2, bottom: innerHeight - r.bottom, moved: false };
      card.setPointerCapture(e.pointerId);
    });
    card.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 4) return;
      start.moved = true;
      card.classList.add('dragging');
      setCardPos(start.cx + dx, start.bottom - dy);
    });
    const end = () => {
      if (start && start.moved) {
        const r = card.getBoundingClientRect();
        setSetting('pos', { cx: (r.left + r.width / 2) / innerWidth, by: (innerHeight - r.bottom) / innerHeight });
      }
      start = null;
      card.classList.remove('dragging');
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  function setCardPos(cx, bottom) {
    const card = S.ui.card;
    const half = card.offsetWidth / 2;
    cx = Math.min(Math.max(cx, half + 8), innerWidth - half - 8);
    bottom = Math.min(Math.max(bottom, 8), innerHeight - card.offsetHeight - 8);
    card.style.left = cx + 'px';
    card.style.bottom = bottom + 'px';
  }

  function applyPosition() {
    if (!S.ui) return;
    const p = S.settings.pos;
    if (!p) {
      S.ui.card.style.left = '';
      S.ui.card.style.bottom = '';
      return;
    }
    setCardPos(p.cx * innerWidth, p.by * innerHeight);
  }

  // ---------- drop / file loading ----------

  function setupDrop(target, slot) {
    target.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      target.classList.add('drop-target');
    });
    target.addEventListener('dragleave', () => target.classList.remove('drop-target'));
    target.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      target.classList.remove('drop-target');
      loadFiles([...e.dataTransfer.files], slot);
    });
  }

  async function loadFiles(files, slot) {
    files = files.filter((f) => /\.(srt|vtt|ass|ssa|txt)$/i.test(f.name));
    if (!files.length) return toast('请选择 .srt / .vtt / .ass 字幕文件');
    const loaded = [];
    for (const f of files.slice(0, 2)) {
      const text = DC.decodeText(await f.arrayBuffer());
      const cues = DC.parseSubtitles(text);
      if (!cues.length) {
        toast(`${f.name} 里没有找到字幕`);
        continue;
      }
      loaded.push({ name: f.name, text, cues, lang: DC.guessLang(f.name, text) });
    }
    if (!loaded.length) return;

    if (slot !== 'auto') {
      setTrack(slot, loaded[0]);
    } else if (loaded.length === 2) {
      // Japanese (or anything non-Chinese) on top, Chinese below.
      const [a, b] = loaded;
      const aBottom = a.lang === 'zh' && b.lang !== 'zh';
      setTrack('primary', aBottom ? b : a);
      setTrack('secondary', aBottom ? a : b);
    } else {
      const t = loaded[0];
      const target = t.lang === 'zh' ? 'secondary' : t.lang === 'ja' ? 'primary' : !S.tracks.primary ? 'primary' : 'secondary';
      setTrack(target, t);
    }
    onTracksChanged();
    toast('字幕已加载');
  }

  function setTrack(slot, { name, text, cues }) {
    S.tracks[slot] = { name, text, cues: cues || DC.parseSubtitles(text) };
  }

  DC.app = {
    // used by the dev test page
    loadText(slot, name, text) {
      setTrack(slot, { name, text });
      onTracksChanged();
    },
    state: S,
  };

  function onTracksChanged() {
    S.last = { primary: null, secondary: null };
    S.baseIdx = -1;
    saveRecord();
    if (S.ui) {
      S.ui.card.classList.toggle('no-subs', !S.tracks.primary && !S.tracks.secondary);
      renderSubsTab();
      if (S.sheetTab === 'list') renderTranscript();
    }
  }

  // ---------- per-video persistence ----------

  function recordKey() {
    return 'subs:' + S.key;
  }

  function saveRecord() {
    if (!S.key) return;
    const t = (x) => (x ? { name: x.name, text: x.text } : null);
    if (!S.tracks.primary && !S.tracks.secondary) {
      store.remove(recordKey()).catch(() => {});
      return;
    }
    save({
      [recordKey()]: { primary: t(S.tracks.primary), secondary: t(S.tracks.secondary), offsets: S.offsets, title: S.title, updatedAt: Date.now() },
    });
  }

  function computeKey() {
    const v = S.video;
    if (isPlex()) {
      const rk = DC.plex.ratingKey;
      if (!rk && Date.now() - S.lastResolve > 5000 && DC.plex.getOrigin()) {
        S.lastResolve = Date.now();
        DC.plex.resolveFromSessions(v.currentTime).catch(() => {});
      }
      return rk ? 'plex:' + rk : null;
    }
    if (!v.duration || !isFinite(v.duration)) return null;
    const search = location.search.replace(/([?&])t=[^&]*&?/, '$1').replace(/[?&]$/, '');
    return location.origin + location.pathname + search + '|' + Math.round(v.duration);
  }

  async function onNewVideo(key) {
    // Subtitles loaded before the video could be identified stay with it.
    const carry = S.key === null && (S.tracks.primary || S.tracks.secondary) ? { tracks: S.tracks, offsets: S.offsets } : null;
    S.key = key;
    S.tracks = { primary: null, secondary: null };
    S.offsets = { primary: 0, secondary: 0 };
    S.title = isPlex() ? '' : document.title;
    S.plexItem = null;
    let rec = null;
    try {
      rec = (await store.get(recordKey()))[recordKey()];
    } catch (_) {}
    if (key !== S.key) return;
    if (rec) {
      if (rec.primary) setTrack('primary', rec.primary);
      if (rec.secondary) setTrack('secondary', rec.secondary);
      S.offsets = { primary: 0, secondary: 0, ...(rec.offsets || {}) };
      if (rec.title) S.title = rec.title;
    } else if (carry) {
      S.tracks = carry.tracks;
      S.offsets = carry.offsets;
    }
    onTracksChanged();
    if (isPlex()) {
      try {
        const item = await DC.plex.getItem(DC.plex.ratingKey);
        if (key !== S.key) return;
        S.plexItem = item;
        S.title = item.title;
        if (!rec && !carry && S.settings.plexPrefs) await autoLoadPlex(item);
        saveRecord();
        renderSubsTab();
      } catch (e) {
        S.plexError = e.message;
        renderSubsTab();
      }
    }
  }

  // ---------- Plex ----------

  async function loadPlexStreams() {
    S.plexError = null;
    S.plexLoading = true;
    renderSubsTab();
    try {
      let rk = DC.plex.ratingKey;
      if (!rk) rk = await DC.plex.resolveFromSessions(S.video ? S.video.currentTime : 0);
      if (!rk) throw new Error('没有识别到正在播放的视频，请先开始播放');
      S.plexItem = await DC.plex.getItem(rk);
      if (!S.plexItem.streams.length) throw new Error('这个视频在 Plex 里没有字幕轨道');
    } catch (e) {
      S.plexError = e.message;
    }
    S.plexLoading = false;
    renderSubsTab();
  }

  async function fetchPlexTrack(stream, item) {
    const text = await DC.plex.fetchStream(stream, item);
    return { name: 'Plex · ' + (stream.title || stream.language || stream.languageCode), text };
  }

  async function loadPlexSelected() {
    const tab = S.ui.tabs.subs;
    const ids = { primary: tab.querySelector('select[data-slot=primary]').value, secondary: tab.querySelector('select[data-slot=secondary]').value };
    const prefs = {};
    S.plexError = null;
    S.plexLoading = true;
    renderSubsTab();
    try {
      for (const slot of ['primary', 'secondary']) {
        const s = S.plexItem.streams.find((x) => String(x.id) === ids[slot]);
        if (!s) {
          S.tracks[slot] = null;
          continue;
        }
        setTrack(slot, await fetchPlexTrack(s, S.plexItem));
        prefs[slot] = { languageCode: s.languageCode, title: s.title || '' };
      }
      setSetting('plexPrefs', prefs);
      onTracksChanged();
      toast('已从 Plex 加载字幕');
    } catch (e) {
      S.plexError = e.message;
    }
    S.plexLoading = false;
    renderSubsTab();
  }

  async function autoLoadPlex(item) {
    const prefs = S.settings.plexPrefs;
    let any = false;
    for (const slot of ['primary', 'secondary']) {
      const s = DC.plex.matchPrefs(item.streams, prefs[slot]);
      if (!s) continue;
      try {
        setTrack(slot, await fetchPlexTrack(s, item));
        any = true;
      } catch (_) {}
    }
    if (any) {
      onTracksChanged();
      toast('已自动加载上次的字幕语言');
    }
  }

  async function loadPlexPlayerSubtitle(slot) {
    try {
      const text = await DC.plex.fetchPlayerSubtitle();
      setTrack(slot, { name: 'Plex 播放器当前字幕', text });
      onTracksChanged();
      toast('已载入');
    } catch (e) {
      S.plexError = e.message;
      renderSubsTab();
    }
  }

  // ---------- sheet tabs ----------

  function fmtOffset(v) {
    return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1) + 's';
  }

  function renderSubsTab() {
    if (!S.ui) return;
    const slotRow = (slot) => {
      const t = S.tracks[slot];
      return `
        <div class="section">
          <div class="section-title">${SLOT_LABEL[slot]}</div>
          <div class="group drop-${slot}">
            <div class="row">
              <div class="grow">
                <div>${t ? DC.escapeHTML(t.name) : '<span class="muted">未加载</span>'}</div>
                <div class="sub">${t ? t.cues.length + ' 句' : '拖入文件到这里，或点右侧选择'}</div>
              </div>
              <button class="btn small" data-act="pick" data-slot="${slot}">选择…</button>
              ${t ? `<button class="btn small" data-act="clear" data-slot="${slot}">清除</button>` : ''}
            </div>
            <div class="row">
              <div class="grow" title="正数 = 字幕延后显示，负数 = 提前">时间偏移</div>
              <div class="stepper">
                <button class="btn small" data-act="offset" data-slot="${slot}" data-d="-0.5">−.5</button>
                <button class="btn small" data-act="offset" data-slot="${slot}" data-d="-0.1">−.1</button>
                <span class="val">${fmtOffset(S.offsets[slot])}</span>
                <button class="btn small" data-act="offset" data-slot="${slot}" data-d="0.1">+.1</button>
                <button class="btn small" data-act="offset" data-slot="${slot}" data-d="0.5">+.5</button>
              </div>
            </div>
          </div>
        </div>`;
    };

    let plex = '';
    if (isPlex()) {
      const item = S.plexItem;
      let inner;
      if (S.plexLoading) inner = '<div class="row muted">正在读取…</div>';
      else if (item && item.streams.length) {
        const pick = {
          primary: DC.plex.matchPrefs(item.streams, S.settings.plexPrefs && S.settings.plexPrefs.primary),
          secondary: DC.plex.matchPrefs(item.streams, S.settings.plexPrefs && S.settings.plexPrefs.secondary),
        };
        const def = DC.plex.defaultPick(item.streams);
        const sel = (slot) => {
          const chosen = pick[slot] || def[slot];
          const opts = item.streams
            .map((s) => `<option value="${s.id}" ${chosen && chosen.id === s.id ? 'selected' : ''}>${DC.escapeHTML(DC.plex.streamLabel(s))}</option>`)
            .join('');
          return `<select data-slot="${slot}"><option value="">（不显示）</option>${opts}</select>`;
        };
        inner = `
          <div class="row"><div class="grow"><div class="sub">${DC.escapeHTML(item.title)}</div></div></div>
          <div class="row"><span style="width:34px" class="muted">上方</span><div class="grow">${sel('primary')}</div></div>
          <div class="row"><span style="width:34px" class="muted">下方</span><div class="grow">${sel('secondary')}</div></div>
          <div class="row"><div class="grow muted">之后的剧集会自动加载相同语言</div><button class="btn primary" data-act="plex-load">加载</button></div>`;
      } else {
        inner = `<div class="row"><div class="grow">读取当前视频在 Plex 里的字幕轨道</div><button class="btn primary" data-act="plex">读取</button></div>`;
      }
      const playerSub = DC.plex.playerSubtitleUrl
        ? `<div class="hint">也可以使用 Plex 播放器当前显示的字幕：<button class="linkish" data-act="plex-player" data-slot="primary">放到上方</button> · <button class="linkish" data-act="plex-player" data-slot="secondary">放到下方</button></div>`
        : '';
      plex = `
        <div class="section">
          <div class="section-title">从 Plex 读取</div>
          <div class="group">${inner}</div>
          ${S.plexError ? `<div class="hint err">${DC.escapeHTML(S.plexError)}</div>` : ''}
          ${playerSub}
        </div>`;
    }

    S.ui.tabs.subs.innerHTML =
      plex +
      slotRow('primary') +
      slotRow('secondary') +
      `<div class="hint">支持 SRT、WebVTT、ASS。可以把两个文件一起拖到字幕框上，会自动把日文放上方、中文放下方。<br>时间偏移：字幕比声音早就点 +，晚就点 −。</div>`;
    setupDrop(S.ui.tabs.subs.querySelector('.drop-primary'), 'primary');
    setupDrop(S.ui.tabs.subs.querySelector('.drop-secondary'), 'secondary');
  }

  function renderSettingsTab() {
    if (!S.ui) return;
    const st = S.settings;
    const sw = (key, label, sub) => `
      <div class="row">
        <div class="grow"><div>${label}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
        <input type="checkbox" class="switch" data-set="${key}" ${st[key] ? 'checked' : ''}>
      </div>`;
    const keys = [
      ['A', '上一句'],
      ['D', '下一句'],
      ['S', '重播这一句'],
      ['Q', '每句自动暂停 开/关'],
      ['M', '收藏这一句'],
      ['T', '字幕列表'],
      ['H', '隐藏 / 显示'],
    ];
    S.ui.tabs.settings.innerHTML = `
      <div class="section">
        <div class="section-title">显示</div>
        <div class="group">
          ${sw('showPrimary', '显示上方字幕')}
          ${sw('showSecondary', '显示下方字幕')}
          ${sw('learnMode', '学习模式', '下方字幕模糊，鼠标移上去才显示')}
          ${sw('furigana', '假名注音', '显示字幕自带的读音，如 轟(とどろ)')}
          <div class="row"><div class="grow">字号</div><input type="range" min="0.7" max="1.8" step="0.05" value="${st.scale}" data-set="scale"></div>
          <div class="row"><div class="grow">字幕位置</div><button class="btn small" data-act="reset-pos">恢复默认</button></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">学习</div>
        <div class="group">
          ${sw('autoPause', '每句结束自动暂停', '听完一句停一下，按 D 继续下一句')}
          <div class="row"><div class="grow">生词本</div><button class="btn small" data-act="wordlist">打开</button></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">快捷键</div>
        <div class="group">
          ${keys.map(([k, d]) => `<div class="row"><div class="grow">${d}</div><kbd>${k}</kbd></div>`).join('')}
          <div class="row"><div class="grow">在此网站开启 / 关闭</div><kbd>⌥⇧S</kbd></div>
        </div>
      </div>`;
    S.ui.tabs.settings.querySelectorAll('[data-set]').forEach((input) => {
      input.addEventListener('input', () => {
        const k = input.dataset.set;
        setSetting(k, input.type === 'checkbox' ? input.checked : parseFloat(input.value));
      });
    });
  }

  function setSetting(k, v) {
    S.settings = { ...S.settings, [k]: v };
    applySettings();
    save({ settings: S.settings });
  }

  function applySettings() {
    if (!S.ui) return;
    const st = S.settings;
    const r = S.ui.root;
    r.style.setProperty('--scale', st.scale);
    r.classList.toggle('learn', !!st.learnMode);
    r.classList.toggle('hide-primary', !st.showPrimary);
    r.classList.toggle('hide-secondary', !st.showSecondary);
    S.last = { primary: null, secondary: null };
    applyPosition();
  }

  // ---------- transcript ----------

  function baseTrack() {
    if (S.tracks.primary) return { ...S.tracks.primary, slot: 'primary' };
    if (S.tracks.secondary) return { ...S.tracks.secondary, slot: 'secondary' };
    return null;
  }

  // Text from the other track that lines up with base cue i.
  function pairFor(i) {
    const base = baseTrack();
    const c = base.cues[i];
    const absStart = c.start + S.offsets[base.slot];
    const absEnd = c.end + S.offsets[base.slot];
    let other = '';
    if (base.slot === 'primary' && S.tracks.secondary) {
      const off = S.offsets.secondary;
      other = DC.overlapText(S.tracks.secondary.cues, absStart - off, absEnd - off);
    }
    return base.slot === 'primary'
      ? { start: absStart, end: absEnd, primary: c.text, secondary: other }
      : { start: absStart, end: absEnd, primary: '', secondary: c.text };
  }

  function isMarked(start) {
    return S.marks.some((m) => m.key === (S.key || location.href) && Math.abs(m.start - start) < 0.05);
  }

  function renderTranscript() {
    const tab = S.ui.tabs.list;
    const base = baseTrack();
    if (!base) {
      tab.innerHTML = '<div class="hint">还没有加载字幕。</div>';
      return;
    }
    const fur = S.settings.furigana;
    const parts = [];
    for (let i = 0; i < base.cues.length; i++) {
      const p = pairFor(i);
      parts.push(`
        <div class="tr-item" data-act="seek" data-i="${i}">
          <div class="tr-time">${DC.formatTime(p.start)}</div>
          <div class="tr-text">
            ${p.primary ? `<div class="tr-p">${DC.toRubyHTML(p.primary, fur)}</div>` : ''}
            ${p.secondary ? `<div class="tr-s">${DC.escapeHTML(p.secondary)}</div>` : ''}
          </div>
          <button class="tr-star ${isMarked(p.start) ? 'on' : ''}" title="收藏">${isMarked(p.start) ? ICON.starFill : ICON.star}</button>
        </div>`);
    }
    tab.innerHTML = parts.join('');
    tab.dataset.active = '';
  }

  function highlightTranscript(force) {
    if (!S.ui || S.sheetTab !== 'list') return;
    const tab = S.ui.tabs.list;
    const prev = tab.querySelector('.tr-item.active');
    const cur = S.baseIdx >= 0 ? tab.querySelector(`.tr-item[data-i="${S.baseIdx}"]`) : null;
    if (prev === cur && !force) return;
    if (prev) prev.classList.remove('active');
    if (cur) {
      cur.classList.add('active');
      if (force || Date.now() - S.userScrollAt > 3000) cur.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
    }
  }

  // ---------- marks ----------

  function currentBaseIndex() {
    const base = baseTrack();
    if (!base || !S.video) return -1;
    return DC.lastStartIndex(base.cues, S.video.currentTime - S.offsets[base.slot]);
  }

  async function toggleMark(i) {
    const base = baseTrack();
    if (!base || i < 0) return toast('当前没有字幕可以收藏');
    const p = pairFor(i);
    const key = S.key || location.href;
    const existing = S.marks.findIndex((m) => m.key === key && Math.abs(m.start - p.start) < 0.05);
    let marks;
    if (existing >= 0) {
      marks = S.marks.filter((_, j) => j !== existing);
      toast('已从生词本移除');
    } else {
      marks = [
        ...S.marks,
        {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          key,
          title: S.title || document.title,
          url: location.href,
          ...p,
          createdAt: Date.now(),
        },
      ];
      toast('★ 已加入生词本');
    }
    S.marks = marks;
    await save({ marks });
    refreshMarks();
  }

  function refreshMarks() {
    if (!S.ui) return;
    const base = baseTrack();
    const on = !!base && S.baseIdx >= 0 && isMarked(pairFor(S.baseIdx).start);
    S.ui.card.classList.toggle('marked', on);
    const btn = S.ui.card.querySelector('[data-act=mark]');
    btn.classList.toggle('on', on);
    btn.innerHTML = on ? ICON.starFill : ICON.star;
    if (S.sheetTab === 'list') {
      S.ui.tabs.list.querySelectorAll('.tr-item').forEach((item) => {
        const m = isMarked(pairFor(+item.dataset.i).start);
        const star = item.querySelector('.tr-star');
        if (star.classList.contains('on') !== m) {
          star.classList.toggle('on', m);
          star.innerHTML = m ? ICON.starFill : ICON.star;
        }
      });
    }
  }

  // ---------- playback control ----------

  function seekTo(sec) {
    if (!S.video) return;
    S.video.currentTime = Math.max(0, sec + 0.001);
    S.autoPausedIdx = -1;
  }

  function navigate(dir) {
    const base = baseTrack();
    if (!base || !S.video) return;
    const off = S.offsets[base.slot];
    const cues = base.cues;
    const t = S.video.currentTime - off;
    const i = DC.lastStartIndex(cues, t);
    let target;
    if (dir === 0) target = Math.max(i, 0);
    else if (dir > 0) target = Math.min(i + 1, cues.length - 1);
    else {
      const inside = i >= 0 && t < cues[i].end;
      target = inside && t - cues[i].start < 1 ? i - 1 : i;
      target = Math.max(target, 0);
    }
    seekTo(cues[target].start + off);
    if (dir === 0 && S.video.paused) S.video.play().catch(() => {});
  }

  // ---------- render loop ----------

  function activeIn(slot, t) {
    const tr = S.tracks[slot];
    return tr ? DC.activeCues(tr.cues, t - S.offsets[slot]) : [];
  }

  function paint(slot, sig, text) {
    if (sig === S.last[slot]) return;
    S.last[slot] = sig;
    S.ui[slot].innerHTML = slot === 'primary' ? DC.toRubyHTML(text, S.settings.furigana) : DC.escapeHTML(text);
  }

  // Each track follows its own timing. Two refinements:
  // - the two files rarely start a line at the exact same instant, so while the
  //   top line is showing and the bottom track is between cues, the bottom shows
  //   whatever translation overlaps the top line instead of a stale one;
  // - when neither track has a line, the card fades out but keeps the last text,
  //   so hovering still shows something and the card doesn't jump in size.
  function renderSlots(t) {
    const a = activeIn('primary', t);
    const b = activeIn('secondary', t);
    const text = (slot, idxs) => idxs.map((i) => S.tracks[slot].cues[i].text).join('\n');
    if (!a.length && !b.length) return false;
    if (a.length) paint('primary', 'p' + a.join(','), text('primary', a));
    else paint('primary', '', '');
    if (b.length) paint('secondary', 's' + b.join(','), text('secondary', b));
    else if (S.tracks.secondary) {
      const c = S.tracks.primary.cues[a[a.length - 1]];
      const shift = S.offsets.primary - S.offsets.secondary;
      paint('secondary', 'o' + a.join(','), DC.overlapText(S.tracks.secondary.cues, c.start + shift, c.end + shift));
    } else paint('secondary', '', '');
    return true;
  }

  function frame() {
    requestAnimationFrame(frame);
    update();
  }

  function update() {
    const v = S.video;
    if (!v || !S.ui || S.ui.host.style.display === 'none') return;
    if (!S.tracks.primary && !S.tracks.secondary) return;
    const t = v.currentTime;
    const any = renderSlots(t);
    const visible =
      any && ((S.settings.showPrimary && S.ui.primary.textContent) || (S.settings.showSecondary && S.ui.secondary.textContent));
    S.ui.card.classList.toggle('silent', !visible);

    const base = baseTrack();
    const off = S.offsets[base.slot];
    const tt = t - off;
    const i = DC.lastStartIndex(base.cues, tt);
    const active = i >= 0 && tt < base.cues[i].end ? i : -1;
    if (active !== S.baseIdx) {
      S.baseIdx = active;
      refreshMarks();
      highlightTranscript(false);
    }
    if (S.settings.autoPause && !v.paused && i >= 0) {
      const c = base.cues[i];
      if (tt >= c.end - 0.06 && tt < c.end + 0.5 && S.autoPausedIdx !== i) {
        S.autoPausedIdx = i;
        v.pause();
      }
    }
  }

  // ---------- video discovery ----------

  function pickVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 160 && r.height > 90) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  function onSeeking() {
    S.autoPausedIdx = -1;
  }

  // requestAnimationFrame stops while the page isn't painted; these events
  // keep the captions correct in that case too.
  const VIDEO_EVENTS = { seeking: onSeeking, seeked: update, timeupdate: update, pause: update };

  function scan() {
    const v = pickVideo();
    if (v !== S.video) {
      for (const [t, f] of Object.entries(VIDEO_EVENTS)) {
        if (S.video) S.video.removeEventListener(t, f);
        if (v) v.addEventListener(t, f);
      }
      S.video = v;
    }
    if (S.video && isEnabled()) {
      ensureUI();
      placeHost();
      const key = computeKey();
      if (key && key !== S.key) onNewVideo(key);
    }
    updateVisibility();
  }

  // ---------- keyboard ----------

  function isEditable(node) {
    if (!node || !node.tagName) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable;
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !S.video || !isEnabled()) return;
      if (isEditable(e.composedPath()[0])) return;
      const hasSubs = !!(S.tracks.primary || S.tracks.secondary);
      let handled = true;
      switch (e.code) {
        case 'KeyH':
          S.hidden = !S.hidden;
          updateVisibility();
          break;
        case 'KeyA':
          hasSubs ? navigate(-1) : (handled = false);
          break;
        case 'KeyD':
          hasSubs ? navigate(1) : (handled = false);
          break;
        case 'KeyS':
          hasSubs ? navigate(0) : (handled = false);
          break;
        case 'KeyQ':
          if (!hasSubs) {
            handled = false;
            break;
          }
          setSetting('autoPause', !S.settings.autoPause);
          toast(S.settings.autoPause ? '每句自动暂停：开' : '每句自动暂停：关');
          renderSettingsTab();
          break;
        case 'KeyM':
          hasSubs ? toggleMark(S.baseIdx >= 0 ? S.baseIdx : currentBaseIndex()) : (handled = false);
          break;
        case 'KeyT':
          if (S.hidden) {
            S.hidden = false;
            updateVisibility();
          }
          S.sheetTab === 'list' ? closeSheet() : openSheet('list');
          break;
        case 'Escape':
          if (S.sheetTab) closeSheet();
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // ---------- messages & storage sync ----------

  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (msg.type === 'status') {
      const reply = () =>
        send({
          hasVideo: !!S.video,
          enabled: isEnabled(),
          host: topHost,
          isPlex: isPlex(),
          primary: S.tracks.primary && S.tracks.primary.name,
          secondary: S.tracks.secondary && S.tracks.secondary.name,
          title: S.title,
        });
      if (S.video) reply();
      else if (window === top) setTimeout(reply, 250); // let a frame with a video answer first
      else return false;
      return true;
    }
    if (msg.type === 'toggleSite') {
      if (window !== top) return false;
      const sites = { ...S.sites, [topHost]: !isEnabled() };
      S.sites = sites;
      save({ sites });
      S.hidden = false;
      return false;
    }
    if (msg.type === 'seekTo') {
      if (!S.video || msg.key !== (S.key || location.href)) return false;
      seekTo(msg.time);
      send({ ok: true });
      return false;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      S.settings = { ...DEFAULTS, ...changes.settings.newValue };
      applySettings();
      if (S.sheetTab === 'settings') renderSettingsTab();
    }
    if (changes.sites) {
      S.sites = changes.sites.newValue || {};
      if (isEnabled()) S.hidden = false;
      updateVisibility();
    }
    if (changes.marks) {
      S.marks = changes.marks.newValue || [];
      refreshMarks();
    }
  });

  // ---------- boot ----------

  store
    .get(['settings', 'sites', 'marks'])
    .then((r) => {
      S.settings = { ...DEFAULTS, ...(r.settings || {}) };
      S.sites = r.sites || {};
      S.marks = r.marks || [];
      applySettings();
    })
    .catch(() => {})
    .finally(() => {
      setInterval(scan, 1000);
      scan();
      requestAnimationFrame(frame);
    });
})();
