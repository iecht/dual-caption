// Styles for the overlay. Lives in a shadow root, so page CSS can't leak in.
// Visual language: macOS Live Captions — dark glass, SF Pro, soft hairlines.
(() => {
  const DC = (globalThis.DC = globalThis.DC || {});
  DC.OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  position: fixed; inset: 0; pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "PingFang SC", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
  color: #fff;
  --scale: 1;
  --glass: rgba(28, 28, 30, 0.66);
  --glass-strong: rgba(30, 30, 32, 0.84);
  --hair: rgba(255, 255, 255, 0.14);
  --label2: rgba(235, 235, 245, 0.72);
  --label3: rgba(235, 235, 245, 0.45);
  --fill: rgba(255, 255, 255, 0.10);
  --fill-hover: rgba(255, 255, 255, 0.17);
  --accent: #0a84ff;
  --star: #ffd60a;
}
button { font: inherit; color: inherit; }

/* ---------- caption card ---------- */
.card {
  position: absolute; left: 50%; bottom: 9%;
  transform: translateX(-50%);
  width: max-content; min-width: 300px; max-width: min(980px, 88vw);
  padding: 12px 24px 14px;
  border-radius: 20px;
  background: var(--glass);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  box-shadow: inset 0 0 0 0.5px var(--hair), 0 10px 36px rgba(0, 0, 0, 0.32);
  text-align: center;
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  transition: opacity 0.22s ease, box-shadow 0.2s ease;
}
/* with the side sheet open, keep a default-positioned card clear of it
   (a dragged card has an inline left that wins over this) */
.card.has-sheet { left: calc(50% - 200px); }
.card.dragging { cursor: grabbing; transition: none; box-shadow: inset 0 0 0 0.5px var(--hair), 0 18px 50px rgba(0,0,0,.45); }
.card.silent { opacity: 0; }
.card.silent:hover { opacity: 0.55; }
.card.silent.has-sheet { opacity: 0.55; }

.line { white-space: pre-line; overflow-wrap: anywhere; }
.primary {
  font-size: calc(26px * var(--scale));
  font-weight: 600; line-height: 1.5; letter-spacing: 0.01em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
.primary ruby rt { font-size: 0.48em; font-weight: 500; color: var(--label2); letter-spacing: 0; }
.secondary {
  margin-top: 3px;
  font-size: calc(19px * var(--scale));
  font-weight: 500; line-height: 1.45;
  color: var(--label2);
  transition: filter 0.2s ease, opacity 0.2s ease;
}
.primary:empty, .secondary:empty { display: none; }
.root.hide-primary .primary, .root.hide-secondary .secondary { display: none; }
.root.learn .secondary { filter: blur(7px); opacity: 0.7; }
.root.learn .card:hover .secondary { filter: none; opacity: 1; }

.mark-dot {
  position: absolute; top: 9px; right: 11px; width: 14px; height: 14px;
  color: var(--star); opacity: 0; transform: scale(0.6);
  transition: opacity 0.2s, transform 0.2s;
}
.card.marked .mark-dot { opacity: 1; transform: scale(1); }

/* empty state */
.empty { display: none; font-size: 14px; color: var(--label2); line-height: 1.6; padding: 4px 4px 2px; }
.card.no-subs .empty { display: block; }
.card.no-subs .line { display: none; }
.empty b { color: #fff; font-weight: 600; font-size: 15px; display: block; margin-bottom: 4px; }
.empty .links { display: flex; gap: 8px; justify-content: center; margin-top: 8px; }
.card.drop-target { box-shadow: inset 0 0 0 2px var(--accent), 0 10px 36px rgba(0,0,0,.32); }

/* hover toolbar (floats above the card) */
.toolbar {
  position: absolute; left: 50%; bottom: 100%;
  transform: translateX(-50%);
  padding-bottom: 8px;
  opacity: 0; pointer-events: none;
  transition: opacity 0.18s ease;
}
.card:hover .toolbar, .card.has-sheet .toolbar { opacity: 1; pointer-events: auto; }
.pill {
  display: flex; gap: 2px; padding: 4px;
  border-radius: 999px;
  background: var(--glass-strong);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  box-shadow: inset 0 0 0 0.5px var(--hair), 0 6px 20px rgba(0, 0, 0, 0.3);
}
.icon-btn {
  width: 30px; height: 30px; border: 0; border-radius: 999px;
  background: transparent; cursor: pointer;
  display: grid; place-items: center;
  color: rgba(255,255,255,.88);
  transition: background 0.15s;
}
.icon-btn:hover { background: var(--fill-hover); }
.icon-btn.on { color: var(--star); }
.icon-btn svg { width: 17px; height: 17px; }
svg { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
svg.filled { fill: currentColor; }

/* ---------- toast ---------- */
.toast {
  position: absolute; left: 50%; top: 28px;
  transform: translate(-50%, -8px);
  padding: 8px 16px; border-radius: 999px;
  background: var(--glass-strong);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px);
  box-shadow: inset 0 0 0 0.5px var(--hair), 0 8px 24px rgba(0,0,0,.3);
  font-size: 13px; font-weight: 500;
  opacity: 0; transition: opacity 0.2s, transform 0.2s;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }

/* ---------- side sheet ---------- */
.sheet {
  position: absolute; top: 20px; right: 20px;
  max-height: calc(100% - 40px);
  width: 380px; max-width: calc(100vw - 40px);
  display: none; flex-direction: column;
  border-radius: 16px;
  background: var(--glass-strong);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  box-shadow: inset 0 0 0 0.5px var(--hair), 0 20px 60px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  font-size: 13px;
  overflow: hidden;
}
.sheet.open { display: flex; }
.sheet-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px; }
.seg { flex: 1; display: flex; padding: 2px; border-radius: 8px; background: var(--fill); }
.seg button {
  flex: 1; border: 0; background: transparent; cursor: pointer;
  padding: 4px 0; border-radius: 6px; font-size: 13px; font-weight: 500; color: var(--label2);
}
.seg button.on { background: rgba(255,255,255,.22); color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
.sheet-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 16px; overscroll-behavior: contain; }
.sheet-body::-webkit-scrollbar { width: 8px; }
.sheet-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
.tab { display: none; }
.tab.on { display: block; }

.section { margin-top: 14px; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--label3); margin: 0 4px 6px; }
.group { border-radius: 10px; background: var(--fill); }
.row { display: flex; align-items: center; gap: 8px; padding: 9px 12px; min-height: 40px; }
.row + .row { box-shadow: inset 0 0.5px 0 rgba(255,255,255,.1); }
.row .grow { flex: 1; min-width: 0; }
.row .sub { color: var(--label3); font-size: 12px; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--label3); }
.hint { color: var(--label3); font-size: 12px; line-height: 1.5; margin: 8px 4px 0; }
.err { color: #ff6961; }

.btn {
  border: 0; cursor: pointer; border-radius: 7px;
  padding: 5px 11px; font-size: 13px; font-weight: 500;
  background: var(--fill-hover); color: #fff; white-space: nowrap;
}
.btn:hover { background: rgba(255,255,255,.24); }
.btn.primary { background: var(--accent); }
.btn.primary:hover { background: #2a95ff; }
.btn.small { padding: 3px 8px; font-size: 12px; }
.btn:disabled { opacity: .45; cursor: default; }
.linkish { border: 0; background: none; color: #64aaff; cursor: pointer; padding: 0; font-size: inherit; }

.stepper { display: flex; align-items: center; gap: 4px; }
.stepper .val { min-width: 54px; text-align: center; font-variant-numeric: tabular-nums; }

select {
  width: 100%; font: inherit; color: #fff;
  background: rgba(255,255,255,.12); border: 0; border-radius: 7px; padding: 6px 8px;
  outline: none;
}
select option { color: #000; }
input[type=range] { width: 140px; accent-color: var(--accent); }

.switch { appearance: none; -webkit-appearance: none; width: 38px; height: 22px; border-radius: 999px; background: rgba(255,255,255,.2); position: relative; cursor: pointer; transition: background .2s; flex: none; margin: 0; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .2s; }
.switch:checked { background: #30d158; }
.switch:checked::after { transform: translateX(16px); }

kbd {
  display: inline-block; min-width: 22px; text-align: center;
  padding: 1px 6px; border-radius: 5px; font: 600 12px ui-monospace, "SF Mono", Menlo, monospace;
  background: rgba(255,255,255,.14); box-shadow: inset 0 -1px 0 rgba(0,0,0,.3);
}

/* transcript */
.tr-item {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 8px 8px 8px 10px; border-radius: 10px; cursor: pointer;
}
.tr-item:hover { background: rgba(255,255,255,.07); }
.tr-item.active { background: rgba(10,132,255,.32); }
.tr-time { flex: none; width: 44px; padding-top: 3px; font: 11px ui-monospace, "SF Mono", Menlo, monospace; color: var(--label3); }
.tr-text { flex: 1; min-width: 0; }
.tr-p { font-size: 15px; line-height: 1.5; white-space: pre-line; }
.tr-p rt { font-size: .5em; color: var(--label2); }
.tr-s { font-size: 13px; line-height: 1.45; color: var(--label2); white-space: pre-line; margin-top: 1px; }
.root.learn .tr-s { filter: blur(5px); }
.root.learn .tr-item:hover .tr-s { filter: none; }
.tr-star { flex: none; border: 0; background: none; cursor: pointer; color: var(--label3); padding: 2px; opacity: 0; }
.tr-item:hover .tr-star { opacity: 1; }
.tr-star.on { color: var(--star); opacity: 1; }
.tr-star svg { width: 16px; height: 16px; }
`;
})();
