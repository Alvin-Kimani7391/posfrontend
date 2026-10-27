/**
 * admin-addons.js - platform admin: Premium features (add-ons).
 * Tabs: Features (add / edit / price / on-off / free for existing) | Base plans (per business type) | Promote (in-app + email) | Businesses (grant / revoke / special price).
 * API money is integer cents; forms use whole currency units.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const fm = (c, cur) => window.UI.formatMoney((Number(c) || 0) / 100, cur || 'KES');
  const fdate = (d) => (d ? window.UI.formatDate(d) : '-');
  const TYPES = ['restaurant', 'supermarket', 'electronics', 'clothing', 'hardware', 'cosmetics', 'general_shop', 'wholesale', 'garage', 'pharmacy', 'wines_spirits', 'other'];
  const CROWN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="#d9a406"><path d="M3 7l4.6 4.1L12 4l4.4 7.1L21 7l-1.8 11H4.8L3 7zm2 13h14v2H5v-2z"/></svg>';
  const SB = { ACTIVE: 'badge-success', TRIAL: 'badge-info', GRACE: 'badge-warning', CANCELLING: 'badge-warning', COMPLIMENTARY: 'badge-info', PENDING_PAYMENT: 'badge-warning', LOCKED: 'badge-neutral' };
  const SL = { ACTIVE: 'Active', TRIAL: 'Trial', GRACE: 'Grace period', CANCELLING: 'Cancelling', COMPLIMENTARY: 'Free (granted)', PENDING_PAYMENT: 'Awaiting payment', LOCKED: 'Locked' };
  const st = { tab: 'features', cat: null, bizList: null, bizId: null };
  const err = (e) => window.UI.toast.error(e.message || 'Something went wrong');
  const closeBtn = (m) => m.querySelector('[data-action="close"]').addEventListener('click', () => window.UI.closeModal());

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AdminShell.mount({ title: 'Premium features' });
    if (!el) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('business')) { st.tab = 'business'; st.bizId = q.get('business'); }
    el.innerHTML = `<div class="page-header"><div><h1>Premium features</h1><p>Sell extra features on top of the base subscription. Owners upgrade, cancel and renew on their own.</p></div></div>
      <div class="tabs" id="ad-tabs" style="margin-bottom:var(--space-4)"><button class="tab-btn" data-tab="features">Features</button><button class="tab-btn" data-tab="plans">Base plans</button><button class="tab-btn" data-tab="promote">Promote</button><button class="tab-btn" data-tab="business">Businesses</button></div><div id="ad-body"></div>`;
    $('ad-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { st.tab = b.dataset.tab; show(); } });
    show();
  });
  async function show() {
    document.querySelectorAll('#ad-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === st.tab));
    const body = $('ad-body'); body.innerHTML = window.UI.skeletonRows(4, 1);
    try { await ({ features: tabFeatures, plans: tabPlans, promote: tabPromote, business: tabBusiness }[st.tab])(body); }
    catch (e) { body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load', message: e.message }); }
  }

  /* ---------------- FEATURES ---------------- */
  async function loadCat() { const { data } = await window.Api.get('/admin/billing/addons'); st.cat = data; return data; }
  const priceText = (a) => (a.prices || []).map((p) => fm(p.amountCents, p.currency)).join(' · ') || '<span class="text-secondary">No price</span>';
  async function tabFeatures(body) {
    const d = await loadCat();
    const rows = d.addons.map((a) => `<tr>
      <td class="cell-primary">${CROWN} ${esc(a.name)}<div class="text-sm text-secondary">${esc(a.key)}${(a.pages || []).length ? ` · ${esc(a.pages.join(', '))}` : ''}</div></td>
      <td class="text-sm">${a.businessTypes && a.businessTypes.length ? esc(a.businessTypes.join(', ')) : 'All types'}</td>
      <td class="text-sm">${priceText(a)}<div class="text-secondary">${a.billingType === 'ONE_TIME' ? 'one-time' : `per ${a.intervalMonths === 1 ? 'month' : `${a.intervalMonths} months`}`}${a.trialDays ? ` · ${a.trialDays}d trial` : ''}</div></td>
      <td><span class="badge ${a.isActive ? 'badge-success' : 'badge-neutral'}">${a.isActive ? 'On sale · locked' : 'Off · free for all'}</span></td>
      <td class="text-sm">${a.stats.active} active · ${a.stats.pending} pending · ${a.stats.complimentary} free</td>
      <td class="actions" style="white-space:nowrap"><button class="btn btn-secondary btn-sm" data-edit="${esc(a.key)}">Edit</button>
        <button class="btn btn-secondary btn-sm" data-toggle="${esc(a.key)}" data-on="${a.isActive ? 1 : 0}">${a.isActive ? 'Switch off' : 'Switch on'}</button>
        <button class="btn btn-secondary btn-sm" data-grand="${esc(a.key)}">Free for existing</button>
        <button class="btn btn-ghost btn-sm" data-del="${esc(a.key)}">Delete</button></td></tr>`).join('');
    body.innerHTML = `<div class="bl-alert info" style="margin-bottom:var(--space-4)"><div class="grow"><b>How it works.</b> A feature is <b>free for everyone</b> until you switch it <b>on</b>. When on, businesses of the chosen types pay (base charge + this add-on) to use it; their pages stay visible with a crown. Before switching a feature on, use <b>Free for existing</b> so current customers keep it.</div></div>
      <div class="card"><div class="card-header"><h2>Catalogue</h2><div style="display:flex;gap:var(--space-2)">${d.starterAvailable ? '<button class="btn btn-secondary btn-sm" id="ad-seed">Load starter features</button>' : ''}<button class="btn btn-primary btn-sm" id="ad-new">Add feature</button></div></div>
      <div class="card-body"><div class="table-wrap flat"><table class="table"><thead><tr><th>Feature</th><th>Sold to</th><th>Price</th><th>Status</th><th>Businesses</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="text-secondary" style="padding:var(--space-4)">No features yet. Load the starter features or add your own.</td></tr>'}</tbody></table></div></div></div>`;
    $('ad-new').addEventListener('click', () => editModal(null));
    $('ad-seed')?.addEventListener('click', async () => { try { const { data } = await window.Api.post('/admin/billing/addons/seed', {}); window.UI.toast.success(`${data.added} feature(s) added (switched off)`); show(); } catch (e) { err(e); } });
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editModal(d.addons.find((a) => a.key === b.dataset.edit))));
    body.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.toggle, b.dataset.on !== '1')));
    body.querySelectorAll('[data-grand]').forEach((b) => b.addEventListener('click', () => grandModal(b.dataset.grand)));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => remove(b.dataset.del)));
  }
  async function toggle(key, on) {
    if (!(await window.UI.confirmDialog({ title: on ? 'Switch this feature on?' : 'Switch this feature off?', message: on ? 'Businesses of the selected types will be locked out of it until they pay. Use "Free for existing" first if current customers should keep it.' : 'It becomes free for everyone again. Paid subscriptions stop renewing.', confirmText: on ? 'Switch on' : 'Switch off', danger: on }))) return;
    try { await window.Api.patch(`/admin/billing/addons/${key}/active`, { isActive: on }); window.UI.toast.success(on ? 'Feature is now premium' : 'Feature is free again'); show(); } catch (e) { err(e); }
  }
  async function remove(key) {
    if (!(await window.UI.confirmDialog({ title: 'Delete feature?', message: 'Only possible if no business has ever used it. Otherwise switch it off.', confirmText: 'Delete', danger: true }))) return;
    try { await window.Api.delete(`/admin/billing/addons/${key}`); show(); } catch (e) { err(e); }
  }
  function grandModal(key) {
    const m = window.UI.openModal({ title: 'Keep it free for existing customers', maxWidth: '460px',
      bodyHtml: '<p class="text-secondary" style="margin-bottom:var(--space-3)">Every existing business this feature is sold to gets it free. New businesses will have to pay.</p><div class="field"><label>Free until (optional)</label><input class="input" type="date" id="gx-until" /><div class="text-sm text-secondary">Leave empty for no end date.</div></div>',
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="gx-go">Grant</button>' });
    closeBtn(m);
    m.querySelector('#gx-go').addEventListener('click', async () => {
      const until = m.querySelector('#gx-until').value;
      try { const { data } = await window.Api.post(`/admin/billing/addons/${key}/grant-existing`, { ...(until ? { until } : {}), note: 'existing customer' }); window.UI.closeModal(); window.UI.toast.success(`${data.granted} business(es) updated`); show(); } catch (e) { err(e); }
    });
  }
  function editModal(a) {
    const isNew = !a; a = a || { key: '', name: '', tagline: '', benefits: [], businessTypes: ['restaurant'], pages: [], prices: [], intervalMonths: 1, trialDays: 0, graceDays: 3, sortOrder: 100 };
    const pr = (c) => { const p = (a.prices || []).find((x) => x.currency === c); return p ? p.amountCents / 100 : ''; };
    const m = window.UI.openModal({ title: isNew ? 'Add premium feature' : `Edit ${a.name}`, maxWidth: '640px',
      bodyHtml: `<div class="field"><label>Key ${isNew ? '' : '(fixed)'}</label><input class="input" id="ef-key" value="${esc(a.key)}" ${isNew ? '' : 'disabled'} placeholder="e.g. loyaltyapp" /><div class="text-sm text-secondary">Used in code as requireAddon('${esc(a.key || 'key')}'). Letters, numbers, - or _.</div></div>
        <div class="field"><label>Name</label><input class="input" id="ef-name" value="${esc(a.name)}" /></div>
        <div class="field"><label>One-line pitch</label><input class="input" id="ef-tag" value="${esc(a.tagline)}" /></div>
        <div class="field"><label>Benefits (one per line)</label><textarea class="input" id="ef-ben" rows="4">${esc((a.benefits || []).join('\n'))}</textarea></div>
        <div class="field"><label>Sold to business types (none ticked = all)</label><div style="display:flex;flex-wrap:wrap;gap:8px">${TYPES.map((t) => `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-type="${t}" ${(a.businessTypes || []).includes(t) ? 'checked' : ''}/> ${t}</label>`).join('')}</div></div>
        <div class="field"><label>Pages it unlocks (comma separated)</label><input class="input" id="ef-pages" value="${esc((a.pages || []).join(', '))}" placeholder="hx-live.html" /><div class="text-sm text-secondary">These menu links get a crown and show the upgrade panel. Server routes are protected in code with requireAddon(key).</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="field"><label>Price KES</label><input class="input" type="number" min="0" id="ef-kes" value="${pr('KES')}" /></div>
          <div class="field"><label>Price TZS</label><input class="input" type="number" min="0" id="ef-tzs" value="${pr('TZS')}" /></div>
          <div class="field"><label>Billing</label><select class="select" id="ef-bt"><option value="RECURRING" ${a.billingType !== 'ONE_TIME' ? 'selected' : ''}>Subscription (renews)</option><option value="ONE_TIME" ${a.billingType === 'ONE_TIME' ? 'selected' : ''}>One-time payment (keep forever)</option></select></div>
          <div class="field"><label>Billed every (months, subscription only)</label><input class="input" type="number" min="1" max="24" id="ef-int" value="${a.intervalMonths}" /></div>
          <div class="field"><label>Free trial (days)</label><input class="input" type="number" min="0" max="90" id="ef-trial" value="${a.trialDays}" /></div>
          <div class="field"><label>Grace after due date (days)</label><input class="input" type="number" min="0" max="30" id="ef-grace" value="${a.graceDays}" /></div>
          <div class="field"><label>Sort order</label><input class="input" type="number" id="ef-sort" value="${a.sortOrder}" /></div></div>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="ef-save">Save</button>' });
    closeBtn(m);
    m.querySelector('#ef-save').addEventListener('click', async () => {
      const v = (id) => m.querySelector(id).value.trim(); const prices = [];
      if (v('#ef-kes') !== '') prices.push({ currency: 'KES', amountCents: Math.round(Number(v('#ef-kes')) * 100) });
      if (v('#ef-tzs') !== '') prices.push({ currency: 'TZS', amountCents: Math.round(Number(v('#ef-tzs')) * 100) });
      const body = { name: v('#ef-name'), tagline: v('#ef-tag'), benefits: v('#ef-ben').split('\n').map((s) => s.trim()).filter(Boolean),
        businessTypes: [...m.querySelectorAll('[data-type]:checked')].map((x) => x.dataset.type), pages: v('#ef-pages').split(',').map((s) => s.trim()).filter(Boolean), prices,
        billingType: m.querySelector('#ef-bt').value, intervalMonths: Number(v('#ef-int')) || 1, trialDays: Number(v('#ef-trial')) || 0, graceDays: Number(v('#ef-grace')) || 0, sortOrder: Number(v('#ef-sort')) || 100 };
      try {
        if (isNew) await window.Api.post('/admin/billing/addons', { key: v('#ef-key').toLowerCase(), ...body }); else await window.Api.put(`/admin/billing/addons/${a.key}`, body);
        window.UI.closeModal(); window.UI.toast.success('Saved'); show();
      } catch (e) { err(e); }
    });
  }

  /* ---------------- BASE PLANS ---------------- */
  async function tabPlans(body) {
    const { data } = await window.Api.get('/admin/billing/addons/base-plans'); const plans = data.plans || [];
    const sel = (type, cur) => { const opts = plans.filter((p) => (p.currency || 'KES') === cur && p.isActive); const chosen = opts.find((p) => (p.businessTypes || []).includes(type));
      return `<select class="select" data-type="${type}" data-cur="${cur}"><option value="">Platform default plan</option>${opts.map((p) => `<option value="${p._id}" ${chosen && String(chosen._id) === String(p._id) ? 'selected' : ''}>${esc(p.name)} (${esc(p.key)})</option>`).join('')}</select>`; };
    body.innerHTML = `<div class="bl-alert info" style="margin-bottom:var(--space-4)"><div class="grow"><b>Base charge.</b> A business's base charge is its subscription plan (Billing &gt; Plans). Pick the plan new businesses of each type start on; premium features are charged on top. Existing subscriptions are not moved.</div></div>
      <div class="card"><div class="card-body"><div class="table-wrap flat"><table class="table"><thead><tr><th>Business type</th><th>Base plan (KES)</th><th>Base plan (TZS)</th></tr></thead><tbody>${TYPES.map((t) => `<tr><td class="cell-primary">${t}</td><td>${sel(t, 'KES')}</td><td>${sel(t, 'TZS')}</td></tr>`).join('')}</tbody></table></div></div></div>`;
    body.querySelectorAll('select[data-type]').forEach((s) => s.addEventListener('change', async () => {
      try { await window.Api.put('/admin/billing/addons/base-plans', { businessType: s.dataset.type, planId: s.value || null, currency: s.dataset.cur }); window.UI.toast.success('Saved'); } catch (e) { err(e); show(); }
    }));
  }

  /* ---------------- PROMOTE ---------------- */
  async function tabPromote(body) {
    const d = st.cat || (await loadCat()); const list = d.addons.filter((a) => a.isActive);
    body.innerHTML = `<div class="card"><div class="card-header"><h2>Encourage owners to upgrade</h2></div><div class="card-body">${list.length ? `
      <p class="text-secondary" style="margin-bottom:var(--space-3)">Sends an in-app notification and/or email to owners of every business that could use the feature but has not paid for it. Price, benefits and an upgrade button are added automatically. (For banners/pop-ups on a page use Announcements.)</p>
      <div class="field"><label>Feature</label><select class="select" id="pr-key">${list.map((a) => `<option value="${esc(a.key)}">${esc(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Subject (optional)</label><input class="input" id="pr-sub" maxlength="120" /></div>
      <div class="field"><label>Message (optional)</label><textarea class="input" id="pr-msg" rows="3" maxlength="800"></textarea></div>
      <div style="display:flex;gap:var(--space-4);margin-bottom:var(--space-3)"><label><input type="checkbox" id="pr-app" checked /> In-app notification</label><label><input type="checkbox" id="pr-mail" checked /> Email</label></div>
      <div style="display:flex;gap:var(--space-2);align-items:center"><button class="btn btn-secondary" id="pr-prev">Preview audience</button><button class="btn btn-primary" id="pr-send">Send now</button><span class="text-sm text-secondary" id="pr-out"></span></div>`
      : '<p class="text-secondary">Switch at least one feature on first (Features tab). Features still free for everyone cannot be promoted.</p>'}</div></div>`;
    if (!list.length) return;
    const payload = (dryRun) => ({ addonKey: $('pr-key').value, inApp: $('pr-app').checked, email: $('pr-mail').checked, subject: $('pr-sub').value.trim() || undefined, message: $('pr-msg').value.trim() || undefined, dryRun });
    $('pr-prev').addEventListener('click', async () => { try { const { data } = await window.Api.post('/admin/billing/addons/promote', payload(true)); $('pr-out').textContent = `${data.targeted} of ${data.eligible} eligible businesses would receive it.`; } catch (e) { err(e); } });
    $('pr-send').addEventListener('click', async () => {
      const p = payload(false); if (!p.inApp && !p.email) return window.UI.toast.error('Pick at least one channel');
      if (!(await window.UI.confirmDialog({ title: 'Send to all eligible owners?', message: 'This sends real notifications and emails now.', confirmText: 'Send' }))) return;
      try { const { data } = await window.Api.post('/admin/billing/addons/promote', p); $('pr-out').textContent = `Sent to ${data.sent} of ${data.targeted} businesses.`; window.UI.toast.success('Promotion sent'); } catch (e) { err(e); }
    });
  }

  /* ---------------- BUSINESSES ---------------- */
  async function tabBusiness(body) {
    st.bizList = st.bizList || (await window.AdminShell.loadBusinesses());
    const opts = st.bizList.map((b) => { const id = b._id || b.id; return `<option value="${id}" ${String(id) === String(st.bizId) ? 'selected' : ''}>${esc(b.name)}${b.businessType ? ` · ${esc(b.businessType)}` : ''}</option>`; }).join('');
    body.innerHTML = `<div class="card" style="margin-bottom:var(--space-4)"><div class="card-body"><div class="field" style="margin:0"><label>Business</label><select class="select" id="bz-pick"><option value="">Choose a business…</option>${opts}</select></div></div></div><div id="bz-body"></div>`;
    $('bz-pick').addEventListener('change', () => { st.bizId = $('bz-pick').value; loadBiz(); });
    if (st.bizId) loadBiz();
  }
  async function loadBiz() {
    const host = $('bz-body'); if (!st.bizId) { host.innerHTML = ''; return; }
    host.innerHTML = window.UI.skeletonRows(3, 1);
    try {
      const { data } = await window.Api.get(`/admin/billing/addons/business/${st.bizId}`);
      const rows = data.addons.map((a) => `<tr><td class="cell-primary">${CROWN} ${esc(a.name)}<div class="text-sm text-secondary">${esc(a.key)}${a.enforced ? '' : ' · not on sale (free)'}</div></td>
        <td><span class="badge ${SB[a.state] || 'badge-neutral'}">${esc(SL[a.state] || a.state)}</span>${a.until ? `<div class="text-sm text-secondary">until ${fdate(a.until)}</div>` : ''}</td>
        <td class="text-sm">${a.priceCents != null ? fm(a.priceCents, data.currency) : '-'}${a.priceOverrideCents != null ? ' <span class="badge badge-info">special</span>' : ''}</td>
        <td class="text-sm">${a.pendingInvoice ? `${esc(a.pendingInvoice.number)}: ${fm(a.pendingInvoice.balanceCents, data.currency)} due` : '-'}</td>
        <td class="actions" style="white-space:nowrap"><button class="btn btn-secondary btn-sm" data-grant="${esc(a.key)}">Grant free</button> <button class="btn btn-secondary btn-sm" data-price="${esc(a.key)}">Special price</button> <button class="btn btn-ghost btn-sm" data-revoke="${esc(a.key)}">Remove access</button></td></tr>
        ${(a.history || []).length ? `<tr><td colspan="5" class="text-sm text-secondary" style="padding-top:0">${a.history.slice(-4).reverse().map((h) => `${fdate(h.at)} ${esc(h.type)}${h.note ? ` (${esc(h.note)})` : ''}`).join(' · ')}</td></tr>` : ''}`).join('');
      host.innerHTML = `<div class="card"><div class="card-header"><h2>Features of this business</h2><div class="text-sm text-secondary">${esc(data.currency)} · ${esc(data.businessType)} · ${fm(data.monthlyCents, data.currency)} / month in add-ons</div></div><div class="card-body"><div class="table-wrap flat"><table class="table"><thead><tr><th>Feature</th><th>Status</th><th>Price</th><th>Open invoice</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="text-secondary" style="padding:var(--space-4)">No features apply to this business type.</td></tr>'}</tbody></table></div></div></div>`;
      host.querySelectorAll('[data-grant]').forEach((b) => b.addEventListener('click', () => grantBiz(b.dataset.grant)));
      host.querySelectorAll('[data-price]').forEach((b) => b.addEventListener('click', () => priceBiz(b.dataset.price, data.addons.find((x) => x.key === b.dataset.price))));
      host.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await window.UI.confirmDialog({ title: 'Remove access now?', message: 'Access ends immediately (no refund) and any unpaid add-on invoice is voided.', confirmText: 'Remove', danger: true }))) return;
        try { await window.Api.post(`/admin/billing/addons/business/${st.bizId}/${b.dataset.revoke}/revoke`, {}); loadBiz(); } catch (e) { err(e); }
      }));
    } catch (e) { host.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load', message: e.message }); }
  }
  function grantBiz(key) {
    const m = window.UI.openModal({ title: 'Grant for free', maxWidth: '440px', bodyHtml: '<div class="field"><label>Free until (optional)</label><input class="input" type="date" id="gb-until" /></div><div class="field"><label>Note (optional)</label><input class="input" id="gb-note" maxlength="200" /></div>', footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="gb-go">Grant</button>' });
    closeBtn(m);
    m.querySelector('#gb-go').addEventListener('click', async () => {
      const until = m.querySelector('#gb-until').value; const note = m.querySelector('#gb-note').value.trim();
      try { await window.Api.post(`/admin/billing/addons/business/${st.bizId}/${key}/grant`, { ...(until ? { until } : {}), ...(note ? { note } : {}) }); window.UI.closeModal(); loadBiz(); } catch (e) { err(e); }
    });
  }
  function priceBiz(key, a) {
    const m = window.UI.openModal({ title: 'Special price for this business', maxWidth: '440px', bodyHtml: `<div class="field"><label>Price per billing period (whole currency units)</label><input class="input" type="number" min="0" id="pb-price" value="${a && a.priceOverrideCents != null ? a.priceOverrideCents / 100 : ''}" /><div class="text-sm text-secondary">Applies from the next invoice. Empty = catalogue price. 0 = free.</div></div>`, footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="pb-go">Save</button>' });
    closeBtn(m);
    m.querySelector('#pb-go').addEventListener('click', async () => {
      const v = m.querySelector('#pb-price').value.trim();
      try { await window.Api.put(`/admin/billing/addons/business/${st.bizId}/${key}/price`, { priceCents: v === '' ? null : Math.round(Number(v) * 100) }); window.UI.closeModal(); loadBiz(); } catch (e) { err(e); }
    });
  }
})();
