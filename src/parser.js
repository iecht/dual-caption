// Subtitle parsing (SRT / WebVTT / ASS), text decoding and cue lookup.
// Shared by the content script, the word list page and the dev test page.
(() => {
  const DC = (globalThis.DC = globalThis.DC || {});

  // "00:01:02,345" | "01:02.345" | "0:01:02.34" -> seconds
  function parseTime(s) {
    let sec = 0;
    for (const p of s.trim().replace(',', '.').split(':')) sec = sec * 60 + parseFloat(p);
    return sec;
  }

  const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&lrm;': '', '&rlm;': '' };

  function cleanText(t) {
    return t
      .replace(/\{\\[^}]*\}/g, '') // ASS override tags
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/<[^>]+>/g, '') // html-ish tags: <i>, <font>, <v Speaker>, <c.yellow>
      .replace(/&[a-z#0-9]+;/gi, (m) => (m.toLowerCase() in ENTITIES ? ENTITIES[m.toLowerCase()] : m))
      .replace(/[‎‏‪-‮]/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
  }

  const TIME_RE = /((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

  function parseSrtVtt(text) {
    const cues = [];
    for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const ti = lines.findIndex((l) => TIME_RE.test(l));
      if (ti < 0) continue; // WEBVTT header, NOTE, STYLE, REGION
      const m = lines[ti].match(TIME_RE);
      const body = cleanText(lines.slice(ti + 1).join('\n'));
      if (body) cues.push({ start: parseTime(m[1]), end: parseTime(m[2]), text: body });
    }
    return cues;
  }

  function parseAss(text) {
    const cues = [];
    let fields = null;
    let inEvents = false;
    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trim();
      if (/^\[.*\]$/.test(line)) {
        inEvents = /^\[events\]$/i.test(line);
        continue;
      }
      if (!inEvents) continue;
      if (/^format\s*:/i.test(line)) {
        fields = line.replace(/^format\s*:/i, '').split(',').map((f) => f.trim().toLowerCase());
        continue;
      }
      if (!/^dialogue\s*:/i.test(line)) continue;
      const f = fields || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const parts = line.replace(/^dialogue\s*:/i, '').split(',');
      const head = parts.slice(0, f.length - 1);
      const body = parts.slice(f.length - 1).join(',');
      if (/\\p[1-9]/.test(body)) continue; // vector drawings
      const rec = {};
      f.slice(0, -1).forEach((k, i) => (rec[k] = (head[i] || '').trim()));
      const t = cleanText(body);
      if (t) cues.push({ start: parseTime(rec.start), end: parseTime(rec.end), text: t });
    }
    return cues;
  }

  DC.parseSubtitles = function parseSubtitles(text) {
    text = text.replace(/^﻿/, '');
    const isAss = /^\s*\[script info\]/im.test(text) || /^\s*dialogue\s*:/im.test(text);
    const cues = (isAss ? parseAss(text) : parseSrtVtt(text))
      .filter((c) => c.end > c.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    // Merge exact duplicates (ASS files often stack the same line in several styles)
    const out = [];
    for (const c of cues) {
      const prev = out[out.length - 1];
      if (prev && prev.start === c.start && prev.end === c.end) {
        if (prev.text !== c.text) prev.text += '\n' + c.text;
      } else out.push(c);
    }
    return out;
  };

  // Decode bytes from a user file. Most subtitles are UTF-8; older Chinese and
  // Japanese releases are often GBK / Big5 / Shift_JIS.
  DC.decodeText = function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (_) {}
    try {
      const sj = new TextDecoder('shift_jis', { fatal: true }).decode(u8);
      if ((sj.match(/[぀-ヿ]/g) || []).length > 20) return sj;
    } catch (_) {}
    for (const enc of ['gb18030', 'big5']) {
      try {
        return new TextDecoder(enc, { fatal: true }).decode(u8);
      } catch (_) {}
    }
    return new TextDecoder('gb18030').decode(u8);
  };

  // 'ja' | 'zh' | 'other' — used to put dropped files into the right slot.
  DC.guessLang = function guessLang(name, text) {
    const n = (name || '').toLowerCase();
    if (/(^|[.\-_ \[(])(ja|jp|jpn|japanese)([.\-_ \])]|$)|日本語|日语|日文/.test(n)) return 'ja';
    if (/(^|[.\-_ \[(])(zh|chs|cht|chi|zho|sc|tc|chinese)([.\-_ \])]|$)|中文|简体|繁體|繁体|简中|繁中/.test(n)) return 'zh';
    const sample = (text || '').slice(0, 20000);
    const kana = (sample.match(/[぀-ヿ]/g) || []).length;
    const han = (sample.match(/[一-鿿]/g) || []).length;
    if (kana > 30) return 'ja';
    if (han > 30) return 'zh';
    return 'other';
  };

  // Index of the last cue whose start <= t, or -1.
  DC.lastStartIndex = function lastStartIndex(cues, t) {
    let lo = 0;
    let hi = cues.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };

  // Indices of all cues visible at time t (overlapping cues are allowed).
  DC.activeCues = function activeCues(cues, t) {
    const out = [];
    const last = DC.lastStartIndex(cues, t);
    for (let i = last; i >= 0 && i > last - 8; i--) {
      if (cues[i].end > t) out.unshift(i);
    }
    return out;
  };

  // Text of cues in `cues` overlapping [start, end] by a meaningful amount.
  DC.overlapText = function overlapText(cues, start, end) {
    const out = [];
    const from = Math.max(0, DC.lastStartIndex(cues, start) - 3);
    for (let i = from; i < cues.length && cues[i].start < end; i++) {
      const c = cues[i];
      const ov = Math.min(end, c.end) - Math.max(start, c.start);
      if (ov > 0.3 * Math.min(end - start, c.end - c.start)) out.push(c.text);
    }
    return out.join('\n');
  };

  DC.escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Netflix-style readings "轟(とどろ)け" -> <ruby>轟<rt>とどろ</rt></ruby>け
  const RUBY_RE = /([㐀-鿿豈-﫿々〆ヵヶ]+)[(（]([぀-ゟー]+)[)）]/g;
  DC.toRubyHTML = function toRubyHTML(text, furigana) {
    const esc = DC.escapeHTML(text);
    return furigana ? esc.replace(RUBY_RE, '<ruby>$1<rt>$2</rt></ruby>') : esc.replace(RUBY_RE, '$1');
  };
  DC.stripRuby = (text) => text.replace(RUBY_RE, '$1');

  DC.formatTime = function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0');
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  };
})();
