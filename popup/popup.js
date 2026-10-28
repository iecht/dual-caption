const $ = (id) => document.getElementById(id);

async function main() {
  const { marks = [] } = await chrome.storage.local.get('marks');
  $('count').textContent = marks.length ? `${marks.length} 句` : '';
  $('open-wordlist').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('wordlist/wordlist.html') });
    window.close();
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let status = null;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
  } catch (_) {}

  if (!status) {
    $('status').textContent = '这个页面不能使用';
    $('detail').textContent = '浏览器内置页面不支持；普通网页请刷新后再试';
    return;
  }

  $('host').textContent = status.host;
  const enabled = $('enabled');
  enabled.disabled = false;
  enabled.checked = status.enabled;
  enabled.addEventListener('change', async () => {
    const { sites = {} } = await chrome.storage.local.get('sites');
    sites[status.host] = enabled.checked;
    await chrome.storage.local.set({ sites });
  });

  if (!status.hasVideo) {
    $('status').textContent = '没有检测到视频';
    $('detail').textContent = '开始播放后会自动出现字幕框';
    return;
  }
  $('dot').classList.add('ok');
  const loaded = [status.primary, status.secondary].filter(Boolean);
  $('status').textContent = loaded.length ? `已加载 ${loaded.length} 条字幕` : '检测到视频，还没有加载字幕';
  $('detail').textContent = loaded.length ? loaded.join('  /  ') : status.isPlex ? '在字幕框里点「从 Plex 读取」' : '把字幕文件拖到字幕框上';
}

main();
