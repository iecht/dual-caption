// Service worker: cross-origin fetches for the content script (Plex server on
// the LAN), opening the word list, and the keyboard command.

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg.type === 'fetch') {
    fetch(msg.url, { method: msg.method || 'GET', headers: msg.headers || {}, credentials: 'omit' })
      .then(async (r) => send({ ok: r.ok, status: r.status, text: await r.text() }))
      .catch((e) => send({ ok: false, status: 0, error: String(e) }));
    return true;
  }
  if (msg.type === 'openWordlist') {
    chrome.tabs.create({ url: chrome.runtime.getURL('wordlist/wordlist.html') });
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-overlay') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'toggleSite' }).catch(() => {});
});
