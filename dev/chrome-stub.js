// Minimal chrome.* stand-in so the content script can run on a plain page
// (dev/test.html) without installing the extension.
(() => {
  const data = { sites: { [location.host]: true } };
  const listeners = [];
  const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  const local = {
    async get(keys) {
      const ks = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      const out = {};
      ks.forEach((k) => k in data && (out[k] = clone(data[k])));
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: clone(v) };
        data[k] = clone(v);
      }
      listeners.forEach((l) => l(changes, 'local'));
    },
    async remove(k) {
      delete data[k];
    },
  };
  window.chrome = {
    storage: { local, onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        if (msg.type === 'fetch') {
          fetch(msg.url, { method: msg.method || 'GET', headers: msg.headers || {} })
            .then(async (r) => cb && cb({ ok: r.ok, status: r.status, text: await r.text() }))
            .catch((e) => cb && cb({ ok: false, status: 0, error: String(e) }));
        } else if (msg.type === 'openWordlist') window.open('../wordlist/wordlist.html');
      },
      onMessage: { addListener() {} },
    },
  };
  window.__stubData = data;
})();
