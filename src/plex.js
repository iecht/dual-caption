// Plex Web integration: figure out which item is playing and pull its subtitle
// streams straight from the Plex Media Server, using the page's own login.
(() => {
  const DC = (globalThis.DC = globalThis.DC || {});

  const P = (DC.plex = {
    token: null,
    accountToken: null,
    origin: null,
    ratingKey: null,
    ratingKeyAt: 0,
    playerSubtitleUrl: null,
    seen: false,
    itemCache: new Map(),
  });

  const PMS_PATH = /^\/(:\/|library\/|video\/|status\/|photo\/|playQueues|hubs\/|transcode\/)/;

  // Every request the Plex page makes passes through here (Resource Timing).
  function consider(url) {
    let u;
    try {
      u = new URL(url, location.href);
    } catch (_) {
      return;
    }
    const tk = u.searchParams.get('X-Plex-Token');
    if (/(^|\.)plex\.tv$/.test(u.hostname)) {
      if (tk) P.accountToken = tk;
      return;
    }
    if (!PMS_PATH.test(u.pathname)) return;
    P.seen = true;
    if (tk) {
      P.token = tk;
      P.origin = u.origin;
    } else if (!P.origin) P.origin = u.origin;

    let rk = null;
    if (u.pathname === '/:/timeline') rk = u.searchParams.get('ratingKey');
    if (!rk && /\/transcode\/universal\/(start|decision)/.test(u.pathname)) {
      const m = (u.searchParams.get('path') || '').match(/\/library\/metadata\/(\d+)/);
      if (m) rk = m[1];
    }
    if (rk) {
      P.ratingKey = rk;
      P.ratingKeyAt = Date.now();
    }
    if (/\/transcode\/universal\/subtitles/.test(u.pathname)) P.playerSubtitleUrl = u.href;
  }

  P.init = function init() {
    try {
      performance.setResourceTimingBufferSize(5000);
    } catch (_) {}
    try {
      for (const e of performance.getEntriesByType('resource')) consider(e.name);
      new PerformanceObserver((list) => list.getEntries().forEach((e) => consider(e.name))).observe({ type: 'resource', buffered: true });
    } catch (_) {}
  };

  P.isPlexPage = function isPlexPage() {
    return (location.port === '32400' && location.pathname.startsWith('/web')) || location.hostname === 'app.plex.tv' || P.seen;
  };

  P.getToken = function getToken() {
    if (P.token) return P.token;
    try {
      const t = localStorage.getItem('myPlexAccessToken');
      if (t) return t;
      const users = JSON.parse(localStorage.getItem('users') || 'null');
      const u = (users && users.users && users.users[0]) || (Array.isArray(users) && users[0]);
      if (u && u.authToken) return u.authToken;
    } catch (_) {}
    return P.accountToken;
  };

  P.getOrigin = () => P.origin || (location.port === '32400' ? location.origin : null);

  // Servers that allow LAN access without auth work with no token at all.
  function withToken(url) {
    const tk = P.getToken();
    return tk ? url + (url.includes('?') ? '&' : '?') + 'X-Plex-Token=' + encodeURIComponent(tk) : url;
  }

  async function api(path) {
    const origin = P.getOrigin();
    if (!origin) throw new Error('还没找到 Plex 服务器地址，请先开始播放');
    const r = await DC.bgFetch(withToken(origin + path), { ...CLIENT, Accept: 'application/json' });
    if (r.status === 401) throw new Error('Plex 需要登录信息，请刷新 Plex 页面后重试');
    if (!r.ok) throw new Error(`Plex 返回错误 ${r.status || r.error}`);
    return JSON.parse(r.text).MediaContainer;
  }

  // Fallback when the page's requests didn't reveal the ratingKey:
  // pick the Plex Web session whose position is closest to the <video>.
  P.resolveFromSessions = async function resolveFromSessions(videoTime) {
    const mc = await api('/status/sessions');
    const items = (mc.Metadata || []).filter((m) => m.Player && /web/i.test(m.Player.product || ''));
    if (!items.length) return null;
    items.sort((a, b) => Math.abs((a.viewOffset || 0) / 1000 - videoTime) - Math.abs((b.viewOffset || 0) / 1000 - videoTime));
    P.ratingKey = String(items[0].ratingKey);
    P.ratingKeyAt = Date.now();
    return P.ratingKey;
  };

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  P.getItem = async function getItem(rk) {
    if (P.itemCache.has(rk)) return P.itemCache.get(rk);
    const mc = await api('/library/metadata/' + rk);
    const md = (mc.Metadata || [])[0];
    if (!md) throw new Error('找不到这个视频的信息');
    const part = md.Media && md.Media[0] && md.Media[0].Part && md.Media[0].Part[0];
    const streams = ((part && part.Stream) || []).filter((s) => s.streamType === 3);
    const title =
      md.type === 'episode'
        ? `${md.grandparentTitle} S${pad(md.parentIndex)}E${pad(md.index)}${md.title ? ' · ' + md.title : ''}`
        : md.title;
    const item = { rk, title, streams, partId: part && part.id, key: md.key || '/library/metadata/' + rk };
    P.itemCache.set(rk, item);
    return item;
  };

  P.streamLabel = function streamLabel(s) {
    const name = s.title || s.language || s.languageCode || '未知';
    const flags = [s.forced && 'Forced', s.hearingImpaired && 'SDH', (s.codec || '').toUpperCase(), s.key ? '外挂' : '内嵌'].filter(Boolean);
    return `${name}  ·  ${flags.join(' · ')}`;
  };

  function looksLikeSubtitles(text) {
    return /-->/.test(text) || /^\s*dialogue\s*:/im.test(text);
  }

  // Headers Plex's transcoder expects from a client (it answers 400 without
  // a platform/device profile).
  const CLIENT = {
    'X-Plex-Client-Identifier': 'dual-caption-extension',
    'X-Plex-Product': 'Plex Web',
    'X-Plex-Platform': 'Chrome',
    'X-Plex-Device': 'OSX',
    'X-Plex-Version': '4.146.0',
  };

  function qs(o) {
    return new URLSearchParams(o).toString();
  }

  async function pms(path, method) {
    const r = await DC.bgFetch(withToken(P.getOrigin() + path), { ...CLIENT, Accept: 'application/json' }, method);
    return r;
  }

  // Sidecar files are served as-is by /library/streams/{id}. Embedded tracks
  // return 501 there, so they go through the subtitle transcoder the same way
  // Plex Web does it: select the stream on the part, ask for a playback
  // decision, then fetch the sidecar from /subtitles/:/transcode/universal/start.
  // The part's original subtitle selection is restored afterwards.
  let queue = Promise.resolve();
  P.fetchStream = function fetchStream(stream, item) {
    const run = () => fetchStreamNow(stream, item);
    queue = queue.then(run, run);
    return queue;
  };

  async function fetchStreamNow(stream, item) {
    if (/pgs|vobsub|dvd_subtitle|hdmv/i.test(stream.codec || '')) throw new Error('这是图片字幕（PGS/VobSub），无法读取文字');

    if (stream.key) {
      const r = await pms(stream.key);
      if (r.ok && looksLikeSubtitles(r.text)) return r.text;
      throw new Error(`读取外挂字幕失败（${r.status || r.error}）`);
    }

    // Current selection, re-read so we restore what the user actually has now.
    P.itemCache.delete(item.rk);
    const fresh = await P.getItem(item.rk);
    const prev = (fresh.streams.find((s) => s.selected) || {}).id || 0;
    const partPath = `/library/parts/${fresh.partId}?`;
    const sess = 'dualcaption-' + Math.random().toString(36).slice(2, 10);
    const params = {
      hasMDE: 1,
      path: fresh.key,
      mediaIndex: 0,
      partIndex: 0,
      protocol: 'http',
      fastSeek: 1,
      directPlay: 1,
      directStream: 1,
      directStreamAudio: 1,
      subtitleSize: 100,
      audioBoost: 100,
      location: 'lan',
      subtitles: 'sidecar',
      copyts: 1,
      session: sess,
      'X-Plex-Session-Identifier': sess,
      'X-Plex-Client-Identifier': CLIENT['X-Plex-Client-Identifier'],
      'X-Plex-Product': CLIENT['X-Plex-Product'],
      'X-Plex-Platform': CLIENT['X-Plex-Platform'],
    };
    try {
      const sel = await pms(partPath + qs({ allParts: 1, subtitleStreamID: stream.id }), 'PUT');
      if (!sel.ok) throw new Error(`Plex 拒绝切换字幕轨道（${sel.status || sel.error}）`);
      await pms('/video/:/transcode/universal/decision?' + qs(params));
      const r = await pms('/subtitles/:/transcode/universal/start?' + qs({ ...params, offset: 0 }));
      if (r.ok && looksLikeSubtitles(r.text)) return r.text;
      throw new Error(`Plex 没有返回这条字幕的文字内容（${r.status || r.error}）`);
    } finally {
      // Awaited: the next queued fetch reads the selection to restore, so this
      // one must land first.
      await pms(partPath + qs({ allParts: 1, subtitleStreamID: prev }), 'PUT').catch(() => {});
      await pms('/video/:/transcode/universal/stop?' + qs({ session: sess })).catch(() => {});
    }
  }

  // The subtitle file the Plex player itself is showing right now (if any).
  P.fetchPlayerSubtitle = async function fetchPlayerSubtitle() {
    if (!P.playerSubtitleUrl) throw new Error('Plex 播放器当前没有显示字幕');
    const r = await DC.bgFetch(P.playerSubtitleUrl, {});
    if (!r.ok || !looksLikeSubtitles(r.text)) throw new Error('读取 Plex 当前字幕失败');
    return r.text;
  };

  // Pick the streams matching remembered preferences (same language + same title).
  P.matchPrefs = function matchPrefs(streams, pref) {
    if (!pref) return null;
    const same = streams.filter((s) => s.languageCode === pref.languageCode);
    return same.find((s) => (s.title || '') === (pref.title || '')) || same.find((s) => !s.forced && !s.hearingImpaired) || same[0] || null;
  };

  // Default guess: Japanese on top, Simplified Chinese below.
  P.defaultPick = function defaultPick(streams) {
    const plain = (s) => !s.forced && !s.hearingImpaired && !/forced|sdh/i.test(s.title || '');
    const ja = streams.find((s) => s.languageCode === 'jpn' && plain(s)) || streams.find((s) => s.languageCode === 'jpn');
    const zh =
      streams.find((s) => /^(zho|chi)$/.test(s.languageCode) && /简|簡|simplified|chs|hans/i.test(s.title || '') && plain(s)) ||
      streams.find((s) => /^(zho|chi)$/.test(s.languageCode) && plain(s));
    return { primary: ja || null, secondary: zh || null };
  };
})();
