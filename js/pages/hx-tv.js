/**
 * hx-tv.js - Live TV menu board console for owners / managers.
 * API: /tv/overview, /tv/options, /tv/settings, /tv/playlists(+/slides,/preview,/publish,/history,/rollback), /tv/promotions, /tv/media, /tv/screens(+/pair-code,/revoke,/disable,/enable,/command,/announce), /tv/audit.
 * Slides store WHAT to show; prices always come live from the POS menu. Drafts stay private until Publish.
 */
(function () {
  const { E, can, get, send, list, head, pill, formModal, modal, tabs, empty } = window.HX;
  const TABS = [['overview', 'Overview'], ['screens', 'Screens'], ['playlists', 'Playlists'], ['promos', 'Promotions'], ['media', 'Images'], ['settings', 'Look & feel'], ['activity', 'Activity']];
  const TYPE_LABEL = { MENU_ITEMS: 'Hand-picked items', CATEGORY: 'Whole category', PROMO: 'Promotion', MEDIA: 'Full-screen image', ROOMS: 'Rooms & suites', TEXT: 'Message' };
  const LAYOUT_LABEL = { HERO: 'Hero (one big + list)', GRID: 'Grid of cards', LIST: 'Menu-board list', COMBO: 'Combo cards', SPLIT: 'Split photo + list', FULLSCREEN: 'Full screen', BANNER: 'Banner' };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ACTION = { publish: 'Published a playlist', 'rollback.draft': 'Restored an older version', 'playlist.create': 'Created a playlist', 'playlist.update': 'Edited a playlist', 'playlist.slides': 'Saved slides', 'playlist.archive': 'Removed a playlist', 'promotion.create': 'Created a promotion', 'promotion.update': 'Edited a promotion', 'promotion.on': 'Switched a promotion on', 'promotion.off': 'Switched a promotion off', 'promotion.delete': 'Deleted a promotion', 'screen.create': 'Added a screen', 'screen.update': 'Edited a screen', 'screen.paired': 'A screen was paired', 'screen.repair': 'New pairing code', 'screen.revoked': 'Revoked a screen', 'screen.disabled': 'Switched a screen off', 'screen.paired_': '', 'screen.reload': 'Reloaded a screen', 'screen.blackout': 'Blackout toggled', 'screen.announce': 'Sent a screen message', 'screen.delete': 'Deleted a screen', 'settings.update': 'Changed look & feel', 'media.add': 'Uploaded an image', 'media.remove': 'Removed an image' };
  let el, tab = (location.hash || '').slice(1), opt = {}, screens = [], playlists = [], promos = [], media = [], settings = {}, overview = {}, audit = [], edit = null, dirty = false, timer = null;
  if (!TABS.some((t) => t[0] === tab)) tab = 'overview';
  document.addEventListener('DOMContentLoaded', init);
  const ago = (t) => { if (!t) return 'never'; const s = Math.floor((Date.now() - new Date(t)) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
  const money = (n) => window.UI.formatMoney(n);
  const idOf = (x) => String((x && (x._id || x.id)) || x);
  const tvUrl = () => window.HX.abs('tv.html');

  async function init() {
    el = window.HX.mount('Live TV menu'); if (!el) return; await window.AppShell.whenProfileReady?.();
    if (!can('tv.view')) { el.innerHTML = head('Live TV menu', '') + window.HX.empty('No access', 'Ask the owner or a manager to give you access to the Live TV menu.'); return; }
    await loadAll(); paint();
    timer = setInterval(async () => { if (document.hidden || document.querySelector('.modal-backdrop') || edit) return; if (tab === 'overview' || tab === 'screens') { await loadLive(); paint(); } }, 20000);
  }
  async function loadLive() { const [o, s] = await Promise.all([get('/tv/overview'), get('/tv/screens')]); if (o) overview = o; if (s) screens = list(s); }
  async function loadAll() {
    const [o, op, s, p, pr, m, st, a] = await Promise.all([get('/tv/overview'), get('/tv/options'), get('/tv/screens'), get('/tv/playlists'), get('/tv/promotions'), get('/tv/media'), get('/tv/settings'), get('/tv/audit')]);
    overview = o || {}; opt = op || {}; screens = list(s); playlists = list(p); promos = list(pr); media = list(m); settings = st || {}; audit = list(a);
  }
  const reload = async (what) => { const map = { screens: ['/tv/screens', (d) => { screens = list(d); }], playlists: ['/tv/playlists', (d) => { playlists = list(d); }], promos: ['/tv/promotions', (d) => { promos = list(d); }], media: ['/tv/media', (d) => { media = list(d); }], settings: ['/tv/settings', (d) => { settings = d || {}; }], audit: ['/tv/audit', (d) => { audit = list(d); }], overview: ['/tv/overview', (d) => { overview = d || {}; }] }; await Promise.all(what.map(async (k) => { const d = await get(map[k][0]); if (d !== null) map[k][1](d); })); };
  const pls = () => playlists.filter((p) => p.status !== 'archived');

  function paint() {
    const body = edit ? editorHtml() : ({ overview: overviewHtml, screens: screensHtml, playlists: playlistsHtml, promos: promosHtml, media: mediaHtml, settings: settingsHtml, activity: activityHtml }[tab])();
    el.innerHTML = head('Live TV menu', 'Show your menu, prices and offers on the restaurant TV. Prices come live from the POS.', edit ? '' : `<a class="btn btn-secondary" href="${E(tvUrl())}" target="_blank" rel="noopener">Open TV page</a>`) + (edit ? '' : tabs(TABS, tab)) + `<div class="tvc">${body}</div>`;
    el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; location.hash = tab; paint(); }; });
    bind();
  }
  const act = (label, a, cls = 'btn-secondary', extra = '') => `<button class="btn ${cls}" data-a="${a}" ${extra}>${E(label)}</button>`;

  // ------------------------------------------------------------ overview
  function overviewHtml() {
    const s = overview.screens || {}; const p = overview.promotions || {};
    const tile = (n, l) => `<div class="tvc-stat"><b>${E(n ?? 0)}</b><span>${E(l)}</span></div>`;
    const warn = screens.filter((x) => x.connection === 'OFFLINE' || x.outdated || x.lastError);
    return `<div class="tvc-stats">${tile(s.total, 'Screens')}${tile(s.online, 'Online now')}${tile(s.offline, 'Offline')}${tile(s.outdated, 'Not on latest menu')}${tile(overview.playlists, 'Playlists')}${tile(p.active, 'Live promotions')}</div>
    ${!screens.length ? window.HX.empty('No screens yet', 'Add your first TV in Screens, enter the code on the TV, then build a playlist and publish it.') : ''}
    ${warn.length ? `<div class="hx-card" style="padding:14px;margin-bottom:16px"><h3 style="margin-bottom:8px">Needs attention</h3>${warn.map((x) => `<div class="tvc-meta" style="margin:4px 0"><span class="tvc-dot ${x.connection === 'OFFLINE' ? 'bad' : 'warn'}"></span><b>${E(x.name)}</b> ${x.connection === 'OFFLINE' ? `offline (last seen ${E(ago(x.lastSeenAt))})` : ''} ${x.outdated ? 'is showing an older menu' : ''} ${x.lastError ? `· error: ${E(x.lastError.message)}` : ''}</div>`).join('')}</div>` : ''}
    <div class="hx-card" style="padding:14px"><h3 style="margin-bottom:8px">Recent activity</h3>${actRows((overview.recentActivity || []).slice(0, 8))}</div>
    <div class="hx-card" style="padding:14px;margin-top:16px"><h3>How it works</h3><ol class="hx-sub" style="margin:8px 0 0 18px;line-height:1.7"><li>Add a <b>screen</b> and type its code on the TV (open <b>${E(tvUrl())}</b> in the TV browser).</li><li>Build a <b>playlist</b>: pick items, categories, promotions or images. Preview it.</li><li>Press <b>Publish</b>. The TV updates in seconds. Price changes in the POS follow automatically.</li></ol></div>`;
  }
  function actRows(rows) {
    if (!rows.length) return '<p class="hx-sub">Nothing yet.</p>';
    return rows.map((a) => { const k = String(a.action || '').replace(/^tv\./, ''); const who = (a.userId && a.userId.name) || 'A screen'; const nv = a.newValue || {}; const det = nv.name || nv.title || (nv.version ? `version ${nv.version}` : ''); return `<div class="tvc-meta" style="margin:5px 0;justify-content:space-between"><span><b>${E(who)}</b> · ${E(ACTION[k] || k)}${det ? ` · ${E(det)}` : ''}</span><span>${E(window.HX.dt(a.timestamp))}</span></div>`; }).join('');
  }
  const activityHtml = () => `<div class="hx-card" style="padding:14px">${actRows(audit)}</div>`;

  // ------------------------------------------------------------ screens
  function screensHtml() {
    const can2 = can('tv.screens'); const add = can2 ? act('Add screen', 'screen-add', 'btn-primary') : '';
    if (!screens.length) return `<div class="hx-actions" style="margin-bottom:12px">${add}</div>${window.HX.empty('No screens yet', 'Add a screen to get a pairing code for your TV.')}`;
    const branch = (id) => (opt.branches || []).find((b) => idOf(b) === String(id));
    return `<div class="hx-actions" style="margin-bottom:12px">${add}</div><div class="tvc-grid">${screens.map((s) => {
      const tone = { ONLINE: 'ok', OFFLINE: 'bad', NEVER_CONNECTED: 'warn', PENDING: 'warn', REVOKED: 'bad', DISABLED: 'mute' }[s.connection] || 'mute';
      const dot = { ok: 'ok', bad: 'bad', warn: 'warn' }[tone] || '';
      const m = can('tv.manage'); const sc = can2; const live = s.status === 'PAIRED';
      return `<div class="tvc-card" data-id="${E(idOf(s))}"><div style="display:flex;justify-content:space-between;gap:8px"><h3><span class="tvc-dot ${dot}"></span>${E(s.name)}</h3>${pill(s.connection, tone)}</div>
      <div class="tvc-meta"><span>${E((branch(s.branchId) || {}).name || 'Branch')}</span><span>Playlist: <b>${E(s.playlistName || 'none')}</b></span>${live ? `<span>Seen ${E(ago(s.lastSeenAt))}</span>` : ''}${s.shownVersion != null ? `<span>Showing v${E(s.shownVersion)}${s.outdated ? ` <b style="color:var(--color-warning)">(latest v${E(s.publishedVersion)})</b>` : ''}</span>` : ''}${s.blackout ? '<span><b>Screen is blacked out</b></span>' : ''}</div>
      ${s.lastError ? `<div class="hx-sub" style="color:var(--color-danger)">Last error: ${E(s.lastError.message)}</div>` : ''}
      <div class="tvc-btns">${sc && s.status !== 'PAIRED' && s.status !== 'DISABLED' ? act('Pairing code', 'screen-code', 'btn-primary') : ''}${sc ? act('Edit', 'screen-edit') : ''}${m && live ? act('Reload', 'screen-reload') + act(s.blackout ? 'Show again' : 'Blackout', 'screen-black') + act('Message', 'screen-msg') : ''}${sc && live ? act('Switch off', 'screen-off') : ''}${sc && s.status === 'DISABLED' ? act('Switch on', 'screen-on', 'btn-primary') : ''}${sc && s.status !== 'REVOKED' ? act('Re-pair', 'screen-code') : ''}${sc ? act('Delete', 'screen-del', 'btn-secondary') : ''}</div></div>`;
    }).join('')}</div>`;
  }
  function pairModal(code, expiresAt, name) {
    modal({ title: `Connect “${name}”`, maxWidth: '460px', body: `<p class="hx-sub">On the TV, open this address in the browser and press <b>Full screen</b>:</p><p style="font-weight:800;word-break:break-all">${E(tvUrl())}</p><p class="hx-sub" style="margin-top:10px">Then type this code:</p><div class="tvc-code">${E(code)}</div><p class="hx-sub">The code works once and expires at ${E(window.HX.hm(expiresAt))}. Once the TV connects this screen turns Online.</p>`, footer: '<button class="btn btn-secondary" data-act="cp">Copy address</button><button class="btn btn-primary" data-act="ok">Done</button>', onMount(m, close) { m.querySelector('[data-act=cp]').onclick = () => { navigator.clipboard?.writeText(tvUrl()); window.UI.toast.success('Address copied'); }; m.querySelector('[data-act=ok]').onclick = close; } });
  }
  function screenForm(s) {
    const bo = (opt.branches || []).map((b) => [idOf(b), b.name]); const po = [['', 'No playlist yet']].concat(pls().map((p) => [idOf(p), p.name]));
    formModal({ title: s ? 'Edit screen' : 'Add screen', submitText: s ? 'Save' : 'Add and get code', fields: [{ name: 'name', label: 'Screen name', value: s && s.name, required: true, placeholder: 'Main dining room' }, { name: 'branchId', label: 'Branch', type: 'select', options: bo, value: s ? s.branchId : window.HX.branchId() || (bo[0] || [])[0], required: true }, { name: 'playlistId', label: 'Playlist', type: 'select', options: po, value: s && s.playlistId || '', keepBlank: true }],
      async onSubmit(v) {
        const body = { name: v.name, branchId: v.branchId, playlistId: v.playlistId || (s ? null : undefined) }; if (body.playlistId === undefined) delete body.playlistId;
        const r = s ? await send('put', `/tv/screens/${idOf(s)}`, body) : await send('post', '/tv/screens', body); if (!r) return false;
        await reload(['screens', 'overview']); paint(); if (!s && r.pairing) setTimeout(() => pairModal(r.pairing.code, r.pairing.expiresAt, v.name), 150); return true;
      } });
  }
  async function screenAction(a, id) {
    const s = screens.find((x) => idOf(x) === String(id)); if (!s) return;
    if (a === 'screen-edit') return screenForm(s);
    if (a === 'screen-code') { if (s.status === 'PAIRED' && !confirm('This will disconnect the TV currently using this screen. Continue?')) return; const r = await send('post', `/tv/screens/${id}/pair-code`); if (r) { await reload(['screens']); paint(); pairModal(r.pairing.code, r.pairing.expiresAt, s.name); } return; }
    if (a === 'screen-reload') { if (await send('post', `/tv/screens/${id}/command`, { type: 'RELOAD' })) window.UI.toast.success('Reload sent'); return; }
    if (a === 'screen-black') { if (await send('post', `/tv/screens/${id}/command`, { type: 'BLACKOUT', blackout: !s.blackout })) { await reload(['screens']); paint(); } return; }
    if (a === 'screen-msg') return formModal({ title: 'Message on screen', intro: 'Shows a bold banner on top of the menu, for example “Order 45 is ready”. Leave empty to clear it.', fields: [{ name: 'text', label: 'Message', maxlength: 140, keepBlank: true }, { name: 'minutes', label: 'Show for (minutes)', type: 'number', value: 10, min: 1, max: 240 }], async onSubmit(v) { const r = await send('post', `/tv/screens/${id}/announce`, { text: v.text || undefined, minutes: v.minutes || 10 }); return !!r; } });
    if (a === 'screen-off') { if (!confirm('Switch this screen off? It shows a message until you switch it on.')) return; if (await send('post', `/tv/screens/${id}/disable`)) { await reload(['screens', 'overview']); paint(); } return; }
    if (a === 'screen-on') { if (await send('post', `/tv/screens/${id}/enable`)) { await reload(['screens', 'overview']); paint(); } return; }
    if (a === 'screen-del') { if (!confirm(`Delete “${s.name}”? The TV will stop showing the menu.`)) return; if (await send('delete', `/tv/screens/${id}`)) { await reload(['screens', 'overview']); paint(); } }
  }

  // ------------------------------------------------------------ playlists list + editor
  function playlistsHtml() {
    const add = can('tv.manage') ? act('New playlist', 'pl-add', 'btn-primary') : '';
    if (!pls().length) return `<div class="hx-actions" style="margin-bottom:12px">${add}</div>${window.HX.empty('No playlists yet', 'A playlist is the sequence of slides a TV shows. Create one, add slides, preview and publish.')}`;
    return `<div class="hx-actions" style="margin-bottom:12px">${add}</div><div class="tvc-grid">${pls().map((p) => { const used = screens.filter((s) => String(s.playlistId) === idOf(p)).length;
      return `<div class="tvc-card" data-id="${E(idOf(p))}"><div style="display:flex;justify-content:space-between;gap:8px"><h3>${E(p.name)}</h3>${pill(p.publishedVersion ? `Live v${p.publishedVersion}` : 'Not published', p.publishedVersion ? 'ok' : 'warn')}</div><div class="tvc-meta"><span>${p.kind === 'GUEST' ? 'Guest services' : 'Restaurant'}</span><span>${E((p.orderType || '').replace('_', ' ').toLowerCase())} prices</span><span>${used} screen${used === 1 ? '' : 's'}</span>${p.publishedAt ? `<span>Published ${E(ago(p.publishedAt))}</span>` : ''}</div><div class="tvc-btns">${act('Open editor', 'pl-open', 'btn-primary')}${can('tv.manage') ? act('Delete', 'pl-del') : ''}</div></div>`; }).join('')}</div>`;
  }
  async function plAdd() {
    formModal({ title: 'New playlist', submitText: 'Create', fields: [{ name: 'name', label: 'Name', required: true, placeholder: 'Lunch menu' }, { name: 'kind', label: 'For', type: 'select', options: [['RESTAURANT', 'Restaurant menu'], ['GUEST', 'Guest services (rooms, breakfast)']], value: 'RESTAURANT' }, { name: 'orderType', label: 'Show prices for', type: 'select', options: [['DINE_IN', 'Dine-in'], ['TAKEAWAY', 'Takeaway'], ['DELIVERY', 'Delivery'], ['ROOM_SERVICE', 'Room service']], value: 'DINE_IN' }],
      async onSubmit(v) { const r = await send('post', '/tv/playlists', v); if (!r) return false; await reload(['playlists']); paint(); openEditor(idOf(r)); return true; } });
  }
  async function openEditor(id) {
    const p = await get(`/tv/playlists/${id}`); if (!p) return; edit = JSON.parse(JSON.stringify(p)); edit.slides = (edit.slides || []).map((s) => ({ ...s })); dirty = false; paint();
  }
  const slideSummary = (s) => {
    const n = (a) => (a || []).length; const nm = (id, arr) => ((arr || []).find((x) => idOf(x) === String(id)) || {}).name;
    if (s.type === 'MENU_ITEMS') return `${n(s.menuItemIds)} item${n(s.menuItemIds) === 1 ? '' : 's'}`;
    if (s.type === 'CATEGORY') return (s.categoryIds || []).map((c) => nm(c, opt.categories)).filter(Boolean).join(', ') || 'Pick a category';
    if (s.type === 'PROMO') return nm(s.promotionId, promos.map((p) => ({ _id: p._id, name: p.title }))) || 'Pick a promotion';
    if (s.type === 'MEDIA') return nm(s.mediaId, media) || 'Pick an image';
    if (s.type === 'ROOMS') return `${n(s.roomTypeIds)} room type(s)`; return (s.text || '').slice(0, 50) || 'Write a message';
  };
  function editorHtml() {
    const p = edit; const canM = can('tv.manage');
    return `<div class="hx-actions" style="margin-bottom:14px;flex-wrap:wrap"><button class="btn btn-secondary" data-a="ed-back">← Playlists</button>${canM ? act('Save draft', 'ed-save', dirty ? 'btn-primary' : 'btn-secondary') : ''}${act('Preview', 'ed-preview')}${can('tv.publish') ? act(p.publishedVersion ? `Publish (live v${p.publishedVersion})` : 'Publish', 'ed-publish', 'btn-primary') : ''}${act('History', 'ed-history')}</div>
    <div class="hx-card" style="padding:14px;margin-bottom:14px"><div class="tvc-two">${fld('ed-name', 'Playlist name', `<input class="input" id="ed-name" value="${E(p.name)}" ${canM ? '' : 'disabled'}>`)}${fld('ed-order', 'Prices shown', `<select class="select" id="ed-order">${[['DINE_IN', 'Dine-in'], ['TAKEAWAY', 'Takeaway'], ['DELIVERY', 'Delivery'], ['ROOM_SERVICE', 'Room service']].map(([v, l]) => `<option value="${v}" ${p.orderType === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}${fld('ed-sec', 'Default seconds per slide', `<input class="input" id="ed-sec" type="number" min="4" max="120" value="${E(p.defaultSeconds || 12)}">`)}${fld('ed-tick', 'Scrolling banner (optional)', `<input class="input" id="ed-tick" maxlength="240" value="${E(p.ticker || '')}" placeholder="Free delivery on orders above 1,500!">`)}</div>
    <div style="margin-top:8px"><b style="font-size:.85rem">Colours for this playlist</b><div class="tvc-themes" style="margin-top:6px"><div class="tvc-theme ${!(p.theme && p.theme.preset) ? 'on' : ''}" data-theme=""><span>Use business look</span></div>${Object.entries(opt.themes || {}).map(([k, t]) => `<div class="tvc-theme ${p.theme && p.theme.preset === k ? 'on' : ''}" data-theme="${k}"><i style="background:${t.primary}"></i><i style="background:${t.accent}"></i><i style="background:${t.background}"></i><span>${E(k.replace('_', ' ').toLowerCase())}</span></div>`).join('')}</div></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3>Slides (${p.slides.length})</h3>${canM ? act('Add slide', 'sl-add', 'btn-primary') : ''}</div>
    <div class="tvc-slides">${p.slides.length ? p.slides.map((s, i) => `<div class="tvc-slide ${s.enabled === false ? 'off' : ''}" data-i="${i}"><span class="tvc-num">${i + 1}</span><div class="grow"><b>${E(s.title || TYPE_LABEL[s.type])}</b><small>${E(TYPE_LABEL[s.type])} · ${E(LAYOUT_LABEL[s.layout] || s.layout)} · ${E(slideSummary(s))} · ${E(s.durationSec || p.defaultSeconds || 12)}s</small></div>${canM ? `<button class="btn btn-secondary" data-a="sl-up" title="Move up">↑</button><button class="btn btn-secondary" data-a="sl-down" title="Move down">↓</button><button class="btn btn-secondary" data-a="sl-toggle">${s.enabled === false ? 'Show' : 'Hide'}</button><button class="btn btn-secondary" data-a="sl-edit">Edit</button><button class="btn btn-secondary" data-a="sl-del">✕</button>` : ''}</div>`).join('') : '<p class="hx-sub">No slides yet. Add your first slide.</p>'}</div>
    <p class="hx-sub" style="margin-top:12px">Changes here are a private draft. The TVs keep showing the published version until you press Publish.</p>`;
  }
  const fld = (id, label, ctl) => `<div class="field"><label for="${id}">${E(label)}</label>${ctl}</div>`;
  function readMeta() { if (!edit) return; const g = (i) => el.querySelector(i); if (!g('#ed-name')) return; edit.name = g('#ed-name').value.trim() || edit.name; edit.orderType = g('#ed-order').value; edit.defaultSeconds = Number(g('#ed-sec').value) || 12; edit.ticker = g('#ed-tick').value.trim(); }
  const cleanSlide = (s) => { const o = {}; ['type', 'layout', 'title', 'subtitle', 'durationSec', 'transition', 'enabled', 'text', 'limit', 'promotionId', 'mediaId'].forEach((k) => { if (s[k] !== undefined && s[k] !== null && s[k] !== '') o[k] = s[k]; }); ['menuItemIds', 'categoryIds', 'roomTypeIds'].forEach((k) => { if ((s[k] || []).length) o[k] = s[k].map(String); }); if ((s.badges || []).length) o.badges = s.badges.map((b) => ({ menuItemId: String(b.menuItemId), badge: b.badge })); const sc = s.schedule || {}; const ks = {}; ['days', 'start', 'end', 'startDate', 'endDate'].forEach((k) => { if (sc[k] && (!Array.isArray(sc[k]) || sc[k].length)) ks[k] = sc[k]; }); if (Object.keys(ks).length) o.schedule = ks; return o; };
  async function saveDraft() {
    readMeta(); const theme = edit.theme && edit.theme.preset ? { preset: edit.theme.preset } : {};
    const a = await send('put', `/tv/playlists/${edit._id}`, { name: edit.name, orderType: edit.orderType, defaultSeconds: edit.defaultSeconds, ticker: edit.ticker || '', theme }); if (!a) return false;
    const b = await send('put', `/tv/playlists/${edit._id}/slides`, { slides: edit.slides.map(cleanSlide) }); if (!b) return false;
    edit.slides = (b.slides || []).map((s) => ({ ...s })); dirty = false; window.UI.toast.success('Draft saved'); await reload(['playlists']); paint(); return true;
  }

  // slide editor modal
  function slideForm(i) {
    const isNew = i < 0; const s = isNew ? { type: 'MENU_ITEMS', layout: 'GRID', enabled: true, menuItemIds: [], categoryIds: [], roomTypeIds: [], badges: [], schedule: {} } : JSON.parse(JSON.stringify(edit.slides[i])); s.schedule = s.schedule || {};
    const sel = (id, opts, cur) => `<select class="select" id="${id}">${opts.map(([v, l]) => `<option value="${E(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${E(l)}</option>`).join('')}</select>`;
    const badge = (id) => ((s.badges || []).find((b) => String(b.menuItemId) === String(id)) || {}).badge || '';
    const items = (opt.menuItems || []).map((m) => `<label data-n="${E(m.name.toLowerCase())}"><input type="checkbox" class="pi" value="${E(idOf(m))}" ${(s.menuItemIds || []).map(String).includes(idOf(m)) ? 'checked' : ''}> ${E(m.name)} <small class="hx-sub">${E(money(m.basePrice))}${m.soldOut ? ' · sold out' : ''}</small><select class="select sp pb">${[['', 'No tag']].concat((opt.badges || []).map((b) => [b, b.replace('_', ' ')])).map(([v, l]) => `<option value="${E(v)}" ${badge(idOf(m)) === v ? 'selected' : ''}>${E(l)}</option>`).join('')}</select></label>`).join('');
    const body = `<div class="tvc-two">${fld('s-type', 'What to show', sel('s-type', (opt.slideTypes || []).filter((t) => t !== 'ROOMS' || window.HX.feature('accommodation')).map((t) => [t, TYPE_LABEL[t]]), s.type))}${fld('s-layout', 'Layout', sel('s-layout', (opt.layouts || []).map((l) => [l, LAYOUT_LABEL[l]]), s.layout))}${fld('s-title', 'Title (optional)', `<input class="input" id="s-title" maxlength="80" value="${E(s.title || '')}">`)}${fld('s-sub', 'Subtitle (optional)', `<input class="input" id="s-sub" maxlength="160" value="${E(s.subtitle || '')}">`)}${fld('s-dur', 'Seconds on screen', `<input class="input" id="s-dur" type="number" min="4" max="120" value="${E(s.durationSec || '')}" placeholder="${E(edit.defaultSeconds || 12)}">`)}${fld('s-tr', 'Transition', sel('s-tr', (opt.transitions || []).map((t) => [t, t.toLowerCase()]), s.transition || 'FADE'))}</div>
    <div data-for="MENU_ITEMS"><div class="field"><label>Menu items (the price comes live from the POS)</label><input class="input" id="s-q" placeholder="Search…" style="margin-bottom:6px"><div class="tvc-pick" id="s-items">${items || '<p class="hx-sub" style="padding:8px">No menu items yet.</p>'}</div></div></div>
    <div data-for="CATEGORY"><div class="field"><label>Categories</label><div class="tvc-pick">${(opt.categories || []).map((c) => `<label><input type="checkbox" class="pc" value="${E(idOf(c))}" ${(s.categoryIds || []).map(String).includes(idOf(c)) ? 'checked' : ''}> ${E(c.name)}</label>`).join('')}</div></div></div>
    <div data-for="PROMO">${fld('s-promo', 'Promotion', sel('s-promo', [['', 'Choose…']].concat(promos.map((p) => [idOf(p), `${p.title}${p.active ? '' : ' (off)'}`])), s.promotionId || ''))}</div>
    <div data-for="MEDIA">${fld('s-media', 'Image', sel('s-media', [['', 'Choose…']].concat(media.map((m) => [idOf(m), m.name || 'Image'])), s.mediaId || ''))}<p class="hx-sub">Upload images in the Images tab.</p></div>
    <div data-for="ROOMS"><div class="field"><label>Room types</label><div class="tvc-pick">${(opt.roomTypes || []).map((r) => `<label><input type="checkbox" class="pr" value="${E(idOf(r))}" ${(s.roomTypeIds || []).map(String).includes(idOf(r)) ? 'checked' : ''}> ${E(r.name)} <small class="hx-sub">${E(money(r.baseRate))}/night</small></label>`).join('')}</div></div></div>
    <div data-for="TEXT">${fld('s-text', 'Message', `<textarea class="input" id="s-text" rows="3" maxlength="400">${E(s.text || '')}</textarea>`)}</div>
    <details style="margin-top:10px" ${Object.keys(s.schedule).length ? 'open' : ''}><summary><b>Only show at certain times (optional)</b></summary><div class="tvc-days" style="margin:8px 0">${DAYS.map((d, k) => `<label><input type="checkbox" class="sd" value="${k}" ${(s.schedule.days || []).includes(k) ? 'checked' : ''}>${d}</label>`).join('')}</div><div class="tvc-two">${fld('s-from', 'From time', `<input class="input" id="s-from" type="time" value="${E(s.schedule.start || '')}">`)}${fld('s-to', 'Until time', `<input class="input" id="s-to" type="time" value="${E(s.schedule.end || '')}">`)}${fld('s-d1', 'Start date', `<input class="input" id="s-d1" type="date" value="${E(s.schedule.startDate || '')}">`)}${fld('s-d2', 'End date', `<input class="input" id="s-d2" type="date" value="${E(s.schedule.endDate || '')}">`)}</div></details>
    <label class="hx-check" style="margin-top:10px"><input type="checkbox" id="s-on" ${s.enabled === false ? '' : 'checked'}> <span>Slide is on</span></label>`;
    modal({ title: isNew ? 'Add slide' : 'Edit slide', maxWidth: '640px', body, footer: '<button class="btn btn-secondary" data-act="x">Cancel</button><button class="btn btn-primary" data-act="ok">Save slide</button>', onMount(m, close) {
      const q = (x) => m.querySelector(x); const sync = () => m.querySelectorAll('[data-for]').forEach((d) => { d.style.display = d.dataset.for === q('#s-type').value ? '' : 'none'; }); q('#s-type').onchange = sync; sync();
      q('#s-q').oninput = (e) => { const t = e.target.value.toLowerCase(); m.querySelectorAll('#s-items label').forEach((l) => { l.style.display = l.dataset.n.includes(t) ? '' : 'none'; }); };
      q('[data-act=x]').onclick = close;
      q('[data-act=ok]').onclick = () => {
        const v = (x) => q(x).value.trim(); const type = v('#s-type'); const n = { ...s, type, layout: v('#s-layout'), title: v('#s-title'), subtitle: v('#s-sub'), durationSec: v('#s-dur') ? Number(v('#s-dur')) : undefined, transition: v('#s-tr'), enabled: q('#s-on').checked };
        n.menuItemIds = type === 'MENU_ITEMS' ? [...m.querySelectorAll('.pi:checked')].map((c) => c.value) : []; n.badges = type === 'MENU_ITEMS' ? [...m.querySelectorAll('#s-items label')].map((l) => ({ menuItemId: l.querySelector('.pi').value, badge: l.querySelector('.pb').value, on: l.querySelector('.pi').checked })).filter((b) => b.on && b.badge).map(({ menuItemId, badge }) => ({ menuItemId, badge })) : [];
        n.categoryIds = type === 'CATEGORY' ? [...m.querySelectorAll('.pc:checked')].map((c) => c.value) : []; n.roomTypeIds = type === 'ROOMS' ? [...m.querySelectorAll('.pr:checked')].map((c) => c.value) : [];
        n.promotionId = type === 'PROMO' ? v('#s-promo') : undefined; n.mediaId = type === 'MEDIA' ? v('#s-media') : undefined; n.text = type === 'TEXT' ? v('#s-text') : undefined;
        n.schedule = { days: [...m.querySelectorAll('.sd:checked')].map((c) => Number(c.value)), start: v('#s-from'), end: v('#s-to'), startDate: v('#s-d1'), endDate: v('#s-d2') };
        const bad = type === 'MENU_ITEMS' && !n.menuItemIds.length ? 'Pick at least one item' : type === 'CATEGORY' && !n.categoryIds.length ? 'Pick a category' : type === 'PROMO' && !n.promotionId ? 'Pick a promotion' : type === 'MEDIA' && !n.mediaId ? 'Pick an image' : type === 'ROOMS' && !n.roomTypeIds.length ? 'Pick room types' : type === 'TEXT' && !n.text ? 'Write the message' : '';
        if (bad) return window.UI.toast.warning(bad);
        if (isNew) edit.slides.push(n); else edit.slides[i] = n; dirty = true; close(); paint();
      };
    } });
  }
  function preview() {
    const brs = opt.branches || []; if (!brs.length) return window.UI.toast.warning('Add a branch first');
    let ctrl = null; let watch = null;
    const m = modal({ title: 'Preview (your draft, not live)', maxWidth: '980px', body: `<div class="field" style="max-width:280px"><label>Branch prices</label><select class="select" id="pv-b">${brs.map((b) => `<option value="${E(idOf(b))}" ${idOf(b) === String(window.HX.branchId()) ? 'selected' : ''}>${E(b.name)}</option>`).join('')}</select></div><div class="tvc-preview" id="pv"></div>`, footer: '<button class="btn btn-primary" data-act="x">Close</button>', onMount(mm, close) {
      mm.querySelector('[data-act=x]').onclick = close;
      const run = async () => { const r = await get(`/tv/playlists/${edit._id}/preview`, { branchId: mm.querySelector('#pv-b').value }); if (!r) return; if (!ctrl) ctrl = window.TVRender.create(mm.querySelector('#pv')); ctrl.setContent(r); if (r.skippedSlideIds && r.skippedSlideIds.length) window.UI.toast.info(`${r.skippedSlideIds.length} slide(s) have nothing to show right now and would be skipped`); };
      mm.querySelector('#pv-b').onchange = run; run();
      watch = setInterval(() => { if (!mm.isConnected) { clearInterval(watch); if (ctrl) ctrl.destroy(); } }, 500);
    } });
    return m;
  }
  async function publish() {
    if (dirty || true) { const ok = await saveDraft(); if (!ok) return; }
    formModal({ title: 'Publish to the screens', intro: `All screens using “${edit.name}” update within seconds.`, submitText: 'Publish now', fields: [{ name: 'note', label: 'Note (optional)', placeholder: 'Added weekend specials', keepBlank: true }], async onSubmit(v) { const r = await send('post', `/tv/playlists/${edit._id}/publish`, v.note ? { note: v.note } : {}); if (!r) return false; window.UI.toast.success(`Published v${r.version} to ${r.screens} screen${r.screens === 1 ? '' : 's'}`); edit.publishedVersion = r.version; await reload(['playlists', 'screens', 'overview', 'audit']); paint(); return true; } });
  }
  async function history() {
    const rows = list(await get(`/tv/playlists/${edit._id}/history`));
    modal({ title: 'Published versions', maxWidth: '520px', body: rows.length ? rows.map((h) => `<div class="tvc-meta" style="justify-content:space-between;margin:8px 0;align-items:center"><span><b>v${E(h.version)}</b> · ${E(window.HX.dt(h.createdAt))}${h.publishedBy ? ` · ${E(h.publishedBy.name)}` : ''}${h.note ? `<br><small>${E(h.note)}</small>` : ''}</span>${can('tv.publish') && h.version !== edit.publishedVersion ? `<button class="btn btn-secondary" data-rb="${h.version}">Roll back</button>` : '<span class="hx-sub">current</span>'}</div>`).join('') : '<p class="hx-sub">Nothing published yet.</p>', footer: '<button class="btn btn-primary" data-act="x">Close</button>', onMount(mm, close) { mm.querySelector('[data-act=x]').onclick = close; mm.querySelectorAll('[data-rb]').forEach((b) => { b.onclick = async () => { if (!confirm(`Publish version ${b.dataset.rb} again? Screens switch to it now.`)) return; const r = await send('post', `/tv/playlists/${edit._id}/rollback`, { version: Number(b.dataset.rb) }); if (r) { close(); await openEditor(edit._id); await reload(['playlists', 'screens', 'overview']); window.UI.toast.success(`Back live as v${r.version}`); } }; }); } });
  }

  // ------------------------------------------------------------ promotions
  function promosHtml() {
    const add = can('tv.manage') ? act('New promotion', 'pr-add', 'btn-primary') : '';
    if (!promos.length) return `<div class="hx-actions" style="margin-bottom:12px">${add}</div>${window.HX.empty('No promotions yet', 'Create a happy hour, combo or weekend special. It shows on the TV and the till charges the same price.')}`;
    return `<p class="hx-sub" style="margin-bottom:10px">A promotion changes the real price at the till while it runs, so customers pay what the TV shows.</p><div class="hx-actions" style="margin-bottom:12px">${add}</div><div class="tvc-grid">${promos.map((p) => `<div class="tvc-card" data-id="${E(idOf(p))}"><div style="display:flex;justify-content:space-between;gap:8px"><h3>${E(p.title)}</h3>${pill(p.active ? 'On' : 'Off', p.active ? 'ok' : 'mute')}</div><div class="tvc-meta"><span><b>${p.mode === 'PERCENT' ? `${E(p.percentOff)}% off` : 'Special prices'}</b></span><span>${(p.menuItemIds || []).length} item(s)</span>${(p.windows || []).map((w) => `<span>${E(winText(w))}</span>`).join('') || '<span>Always</span>'}</div>${can('tv.manage') ? `<div class="tvc-btns">${act(p.active ? 'Switch off' : 'Switch on', 'pr-toggle')}${act('Edit', 'pr-edit')}${act('Delete', 'pr-del')}</div>` : ''}</div>`).join('')}</div>`;
  }
  const winText = (w) => [(w.days || []).length ? (w.days || []).map((d) => DAYS[d]).join(' ') : '', w.start && w.end ? `${w.start}-${w.end}` : '', w.startDate ? `from ${w.startDate}` : '', w.endDate ? `to ${w.endDate}` : ''].filter(Boolean).join(' · ') || 'Always';
  function promoForm(p) {
    const w = (p && p.windows && p.windows[0]) || {}; const sp = new Map(((p && p.specialPrices) || []).map((x) => [String(x.menuItemId), x.price / 100])); const sel = new Set(((p && p.menuItemIds) || []).map(String));
    const body = `<div class="tvc-two">${fld('p-title', 'Name', `<input class="input" id="p-title" maxlength="80" value="${E(p ? p.title : '')}" placeholder="Happy hour">`)}${fld('p-mode', 'Discount type', `<select class="select" id="p-mode"><option value="PERCENT" ${!p || p.mode === 'PERCENT' ? 'selected' : ''}>Percent off</option><option value="SPECIAL_PRICE" ${p && p.mode === 'SPECIAL_PRICE' ? 'selected' : ''}>Special price per item</option></select>`)}</div>
    <div data-m="PERCENT">${fld('p-pct', 'Percent off (1-90)', `<input class="input" id="p-pct" type="number" min="1" max="90" value="${E(p && p.percentOff || '')}">`)}</div>${fld('p-desc', 'Short description (optional)', `<input class="input" id="p-desc" maxlength="240" value="${E(p && p.description || '')}">`)}
    <div class="field"><label>Items on offer</label><div class="tvc-pick" id="p-items">${(opt.menuItems || []).map((m) => `<label><input type="checkbox" class="pi" value="${E(idOf(m))}" ${sel.has(idOf(m)) ? 'checked' : ''}> ${E(m.name)} <small class="hx-sub">${E(money(m.basePrice))}</small><input class="input sp ps" type="number" min="0" step="any" placeholder="Offer price" data-m="SPECIAL_PRICE" value="${E(sp.get(idOf(m)) ?? '')}"></label>`).join('')}</div></div>
    <details ${p && (p.windows || []).length ? 'open' : ''}><summary><b>When it runs (empty = always)</b></summary><div class="tvc-days" style="margin:8px 0">${DAYS.map((d, k) => `<label><input type="checkbox" class="sd" value="${k}" ${(w.days || []).includes(k) ? 'checked' : ''}>${d}</label>`).join('')}</div><div class="tvc-two">${fld('p-from', 'From time', `<input class="input" id="p-from" type="time" value="${E(w.start || '')}">`)}${fld('p-to', 'Until time', `<input class="input" id="p-to" type="time" value="${E(w.end || '')}">`)}${fld('p-d1', 'Start date', `<input class="input" id="p-d1" type="date" value="${E(w.startDate || '')}">`)}${fld('p-d2', 'End date', `<input class="input" id="p-d2" type="date" value="${E(w.endDate || '')}">`)}</div></details>
    ${(opt.branches || []).length > 1 ? `<div class="field"><label>Branches (none ticked = all)</label><div class="tvc-pick">${opt.branches.map((b) => `<label><input type="checkbox" class="pb" value="${E(idOf(b))}" ${((p && p.branchIds) || []).map(String).includes(idOf(b)) ? 'checked' : ''}> ${E(b.name)}</label>`).join('')}</div></div>` : ''}
    <label class="hx-check"><input type="checkbox" id="p-on" ${!p || p.active ? 'checked' : ''}> <span>Promotion is on</span></label>`;
    modal({ title: p ? 'Edit promotion' : 'New promotion', maxWidth: '640px', body, footer: '<button class="btn btn-secondary" data-act="x">Cancel</button><button class="btn btn-primary" data-act="ok">Save promotion</button>', onMount(m, close) {
      const q = (x) => m.querySelector(x); const sync = () => m.querySelectorAll('[data-m]').forEach((d) => { d.style.display = d.dataset.m === q('#p-mode').value ? '' : 'none'; }); q('#p-mode').onchange = sync; sync(); q('[data-act=x]').onclick = close;
      q('[data-act=ok]').onclick = async () => {
        const mode = q('#p-mode').value; const ids = [...m.querySelectorAll('.pi:checked')].map((c) => c.value); if (!q('#p-title').value.trim()) return window.UI.toast.warning('Give the promotion a name'); if (!ids.length) return window.UI.toast.warning('Pick at least one item');
        const body = { title: q('#p-title').value.trim(), description: q('#p-desc').value.trim() || undefined, mode, menuItemIds: ids, active: q('#p-on').checked, branchIds: [...m.querySelectorAll('.pb:checked')].map((c) => c.value) };
        if (mode === 'PERCENT') { body.percentOff = Number(q('#p-pct').value); if (!body.percentOff) return window.UI.toast.warning('Enter the percent off'); }
        else { body.specialPrices = [...m.querySelectorAll('#p-items label')].filter((l) => l.querySelector('.pi').checked && l.querySelector('.ps').value !== '').map((l) => ({ menuItemId: l.querySelector('.pi').value, price: Number(l.querySelector('.ps').value) })); if (!body.specialPrices.length) return window.UI.toast.warning('Enter an offer price for at least one item'); }
        const win = { days: [...m.querySelectorAll('.sd:checked')].map((c) => Number(c.value)), start: q('#p-from').value, end: q('#p-to').value, startDate: q('#p-d1').value, endDate: q('#p-d2').value }; const ww = {}; Object.entries(win).forEach(([k, v]) => { if (v && (!Array.isArray(v) || v.length)) ww[k] = v; }); body.windows = Object.keys(ww).length ? [ww] : [];
        const r = p ? await send('put', `/tv/promotions/${idOf(p)}`, body) : await send('post', '/tv/promotions', body); if (r) { close(); await reload(['promos', 'overview']); paint(); window.UI.toast.success('Promotion saved. The till now uses these prices while it runs.'); }
      };
    } });
  }

  // ------------------------------------------------------------ media + settings
  function mediaHtml() {
    return `<div class="hx-actions" style="margin-bottom:12px">${can('tv.manage') ? '<label class="btn btn-primary" style="cursor:pointer">Upload image<input type="file" id="up" accept="image/jpeg,image/png,image/webp" hidden></label>' : ''}</div>${media.length ? `<div class="tvc-media">${media.map((m) => `<figure data-id="${E(idOf(m))}"><img src="${E(m.url)}" alt="" loading="lazy"><figcaption><span>${E(m.name || 'Image')}</span>${can('tv.manage') ? '<button class="btn btn-secondary" data-a="md-del" style="min-height:30px;padding:0 10px">✕</button>' : ''}</figcaption></figure>`).join('')}</div>` : window.HX.empty('No images yet', 'Upload posters, promo banners or food photos to use as full-screen slides. Best size 1920 × 1080.')}`;
  }
  function settingsHtml() {
    const s = settings; const t = s.theme || {}; const canM = can('tv.manage');
    return `<div class="hx-card" style="padding:16px;max-width:760px"><b>Colour theme</b><div class="tvc-themes" style="margin:8px 0 14px">${Object.entries(opt.themes || {}).map(([k, c]) => `<div class="tvc-theme ${t.preset === k ? 'on' : ''}" data-st="${k}"><i style="background:${c.primary}"></i><i style="background:${c.accent}"></i><i style="background:${c.background}"></i><span>${E(k.replace('_', ' ').toLowerCase())}</span></div>`).join('')}</div>
    <div class="tvc-two">${fld('st-tag', 'Tagline under the name', `<input class="input" id="st-tag" maxlength="80" value="${E(s.tagline || '')}">`)}${fld('st-tick', 'Default scrolling banner', `<input class="input" id="st-tick" maxlength="240" value="${E(s.ticker || '')}">`)}${fld('st-cur', 'Show prices as', `<select class="select" id="st-cur">${[['CODE', 'KES 450'], ['NONE', '450 (no currency)']].map(([v, l]) => `<option value="${v}" ${(s.currencyDisplay || 'CODE') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}</div>
    <div style="display:grid;gap:8px;margin:10px 0"><label class="hx-check"><input type="checkbox" id="st-logo" ${t.showLogo !== false ? 'checked' : ''}><span>Show logo</span></label><label class="hx-check"><input type="checkbox" id="st-clock" ${t.showClock !== false ? 'checked' : ''}><span>Show clock</span></label><label class="hx-check"><input type="checkbox" id="st-ticker" ${t.showTicker !== false ? 'checked' : ''}><span>Show scrolling banner</span></label><label class="hx-check"><input type="checkbox" id="st-hide" ${s.hideSoldOut ? 'checked' : ''}><span>Hide sold-out items (otherwise they show greyed out)</span></label></div>${canM ? act('Save', 'st-save', 'btn-primary') : ''}</div>`;
  }

  // ------------------------------------------------------------ events
  function bind() {
    el.querySelectorAll('[data-theme]').forEach((b) => { b.onclick = () => { readMeta(); edit.theme = b.dataset.theme ? { preset: b.dataset.theme } : {}; dirty = true; paint(); }; });
    el.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { settings.theme = { ...(settings.theme || {}), preset: b.dataset.st }; el.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('on', x === b)); }; });
    const up = el.querySelector('#up'); if (up) up.onchange = async () => { const f = up.files[0]; if (!f) return; const fd = new FormData(); fd.append('image', f); fd.append('name', f.name.replace(/\.[^.]+$/, '')); try { await window.Api.upload('/tv/media', fd); window.UI.toast.success('Image uploaded'); await reload(['media']); paint(); } catch (e) { window.UI.toast.error(e.message || 'Upload failed'); } };
    el.querySelectorAll('#ed-name,#ed-order,#ed-sec,#ed-tick').forEach((i) => { i.oninput = () => { dirty = true; }; });
    el.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => run(b.dataset.a, b); });
  }
  async function run(a, b) {
    const card = b.closest('[data-id]'); const id = card && card.dataset.id; const row = b.closest('[data-i]'); const i = row ? Number(row.dataset.i) : -1;
    if (a.startsWith('screen-')) return a === 'screen-add' ? screenForm(null) : screenAction(a, id);
    if (a === 'pl-add') return plAdd(); if (a === 'pl-open') return openEditor(id);
    if (a === 'pl-del') { if (!confirm('Delete this playlist? Screens using it will stop showing a menu.')) return; if (await send('delete', `/tv/playlists/${id}`)) { await reload(['playlists', 'screens', 'overview']); paint(); } return; }
    if (a === 'ed-back') { readMeta(); if (dirty && !confirm('Leave without saving your draft?')) return; edit = null; await reload(['playlists']); return paint(); }
    if (a === 'ed-save') return saveDraft(); if (a === 'ed-preview') { if (dirty) { if (!(await saveDraft())) return; } return preview(); } if (a === 'ed-publish') return publish(); if (a === 'ed-history') return history();
    if (a === 'sl-add') { readMeta(); return slideForm(-1); } if (a === 'sl-edit') { readMeta(); return slideForm(i); }
    if (a === 'sl-del') { readMeta(); edit.slides.splice(i, 1); dirty = true; return paint(); }
    if (a === 'sl-toggle') { readMeta(); edit.slides[i].enabled = edit.slides[i].enabled === false; dirty = true; return paint(); }
    if (a === 'sl-up' || a === 'sl-down') { readMeta(); const j = a === 'sl-up' ? i - 1 : i + 1; if (j < 0 || j >= edit.slides.length) return; [edit.slides[i], edit.slides[j]] = [edit.slides[j], edit.slides[i]]; dirty = true; return paint(); }
    if (a === 'pr-add') return promoForm(null); const pr = promos.find((x) => idOf(x) === id);
    if (a === 'pr-edit') return promoForm(pr);
    if (a === 'pr-toggle') { if (await send('post', `/tv/promotions/${id}/toggle`, { active: !pr.active })) { await reload(['promos', 'overview']); paint(); } return; }
    if (a === 'pr-del') { if (!confirm(`Delete “${pr.title}”? Its price change at the till ends too.`)) return; if (await send('delete', `/tv/promotions/${id}`)) { await reload(['promos', 'overview']); paint(); } return; }
    if (a === 'md-del') { if (!confirm('Remove this image? Slides using it are switched off.')) return; if (await send('delete', `/tv/media/${id}`)) { await reload(['media']); paint(); } return; }
    if (a === 'st-save') { const g = (x) => el.querySelector(x); const r = await send('put', '/tv/settings', { theme: { preset: (settings.theme || {}).preset || 'BOLD_RED', showLogo: g('#st-logo').checked, showClock: g('#st-clock').checked, showTicker: g('#st-ticker').checked }, tagline: g('#st-tag').value.trim(), ticker: g('#st-tick').value.trim(), currencyDisplay: g('#st-cur').value, hideSoldOut: g('#st-hide').checked }); if (r) { settings = r; window.UI.toast.success('Saved. Screens update shortly.'); } }
  }
  window.addEventListener('beforeunload', (e) => { if (edit && dirty) { e.preventDefault(); e.returnValue = ''; } });
})();
