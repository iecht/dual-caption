const $ = (id) => document.getElementById(id);
const esc = DC.escapeHTML;

const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';

let marks = [];

async function load() {
  marks = (await chrome.storage.local.get('marks')).marks || [];
  render();
}

function groups(list) {
  const map = new Map();
  for (const m of list) {
    if (!map.has(m.key)) map.set(m.key, { key: m.key, title: m.title, url: m.url, items: [], latest: 0 });
    const g = map.get(m.key);
    g.items.push(m);
    g.latest = Math.max(g.latest, m.createdAt);
    if (m.title) g.title = m.title;
  }
  const out = [...map.values()].sort((a, b) => b.latest - a.latest);
  out.forEach((g) => g.items.sort((a, b) => a.start - b.start));
  return out;
}

function render() {
  const q = $('q').value.trim().toLowerCase();
  const list = q ? marks.filter((m) => `${m.primary}\n${m.secondary}\n${m.title}`.toLowerCase().includes(q)) : marks;
  $('summary').textContent = marks.length ? `${marks.length} 句` : '';

  if (!marks.length) {
    $('list').innerHTML = `
      <div class="empty">
        <h2>还没有收藏</h2>
        <p>看视频时按 <kbd>M</kbd> 或点字幕框上的 ☆，这一句就会出现在这里。</p>
      </div>`;
    return;
  }
  if (!list.length) {
    $('list').innerHTML = '<div class="empty"><p>没有匹配的句子</p></div>';
    return;
  }

  $('list').innerHTML = groups(list)
    .map(
      (g) => `
      <div class="video-title">${esc(g.title || '未命名视频')} <span class="muted">${g.items.length} 句</span></div>
      <div class="group">
        ${g.items
          .map(
            (m) => `
          <div class="item" data-id="${m.id}">
            <div class="time">${DC.formatTime(m.start)}</div>
            <div class="text">
              ${m.primary ? `<div class="p">${DC.toRubyHTML(m.primary, true)}</div>` : ''}
              ${m.secondary ? `<div class="s">${esc(m.secondary)}</div>` : ''}
            </div>
            <div class="actions">
              <button class="icon-btn" data-act="jump" title="回到视频中的这一句">${ICON_PLAY}</button>
              <button class="icon-btn danger" data-act="delete" title="删除">${ICON_TRASH}</button>
            </div>
          </div>`
          )
          .join('')}
      </div>`
    )
    .join('');
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

// Ask every open tab; the one playing this video seeks and gets focus.
async function jump(m) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'seekTo', key: m.key, time: m.start });
      if (r && r.ok) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
      }
    } catch (_) {}
  }
  toast(`视频没有打开，请先播放后再跳转（${DC.formatTime(m.start)}）`);
  if (m.url) chrome.tabs.create({ url: m.url });
}

$('list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('.item').dataset.id;
  const m = marks.find((x) => x.id === id);
  if (!m) return;
  if (b.dataset.act === 'jump') jump(m);
  if (b.dataset.act === 'delete') {
    marks = marks.filter((x) => x.id !== id);
    await chrome.storage.local.set({ marks });
    render();
  }
});

$('q').addEventListener('input', render);

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

$('export-csv').addEventListener('click', () => {
  const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['学习语言', '母语', '时间', '视频', '链接', '收藏时间']];
  for (const g of groups(marks))
    for (const m of g.items) rows.push([m.primary, m.secondary, DC.formatTime(m.start), g.title, m.url, new Date(m.createdAt).toLocaleString()]);
  // BOM so Excel / Numbers open it as UTF-8
  download(`生词本-${stamp()}.csv`, '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n'), 'text/csv');
});

// Anki: Front = sentence (furigana as Anki ruby: 漢字[かな]), Back = translation + source.
$('export-anki').addEventListener('click', () => {
  const clean = (s) => String(s || '').replace(/\t/g, ' ').replace(/\n/g, '<br>');
  const ankiRuby = (s) => s.replace(/([㐀-鿿豈-﫿々〆ヵヶ]+)[(（]([぀-ゟー]+)[)）]/g, ' $1[$2]');
  const lines = ['#separator:tab', '#html:true', '#columns:Front\tBack\tSource'];
  for (const g of groups(marks))
    for (const m of g.items) lines.push([clean(ankiRuby(m.primary || '')), clean(m.secondary), clean(`${g.title} ${DC.formatTime(m.start)}`)].join('\t'));
  download(`anki-${stamp()}.txt`, lines.join('\n'), 'text/plain');
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.marks) {
    marks = c.marks.newValue || [];
    render();
  }
});

load();
