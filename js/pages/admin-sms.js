/**
 * admin-sms.js - Six Star Technologies SMS admin.
 * Tabs: Overview | Sender ID applications | Payments | SMS offers | Pricing & settings | Wallets
 * PayHero credentials are NOT here: they live in Admin > Billing > Settings and are shared.
 */
(function () {
  const Api = window.Api;
  const esc = window.UI.escapeHtml;
  const RT = window.ReportTools;
  const $ = (id) => document.getElementById(id);
  const kes = (c) => window.UI.formatMoney((Number(c) || 0) / 100);
  const num = (n) => Number(n || 0).toLocaleString('en-KE');
  const when = (d) => (d ? window.UI.formatDateTime(d) : '-');
  const GOOD = /approved|paid|active/i; const BAD = /reject|fail|cancel|revoked/i;
  const badge = (s) => `<span class="badge ${GOOD.test(s) ? 'badge-success' : BAD.test(s) ? 'badge-danger' : 'badge-warning'}">${esc(String(s).replace(/_/g, ' '))}</span>`;
  const toastErr = (e) => window.UI.toast.error((e && e.message) || 'Something went wrong');
  const TABS = [['overview', 'Overview'], ['apps', 'Sender ID applications'], ['payments', 'Payments'], ['offers', 'SMS offers'], ['settings', 'Pricing & settings'], ['wallets', 'Wallets']];
  const S = { tab: 'overview', appFilter: '', payFilter: 'AWAITING_VERIFICATION' };
  let el;

  document.addEventListener('DOMContentLoaded', () => {
    el = window.AdminShell.mount({ title: 'SMS' });
    if (!el) return;
    const w = new URLSearchParams(window.location.search).get('tab');
    if (TABS.some((t) => t[0] === w)) S.tab = w;
    el.innerHTML = `
      <div class="page-header"><div><h1>SMS Marketing</h1><p>Sender ID registrations, SMS credit sales and shop wallets.</p></div></div>
      <div class="tabs" id="as-tabs" style="margin-bottom:var(--space-5)">${TABS.map(([k, l]) => `<button class="tab-btn" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="as-body"></div>`;
    $('as-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
    show(S.tab);
  });

  function show(t) {
    S.tab = t;
    document.querySelectorAll('#as-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    const body = $('as-body'); body.innerHTML = window.UI.skeletonRows(3, 1);
    ({ overview, apps, payments, offers, settings, wallets }[t])(body).catch((err) => {
      body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load this section', message: err.message })}</div>`;
    });
  }

  /* ------------------------------ overview ------------------------------ */
  async function overview(b) {
    const { data: o } = await Api.get('/admin/sms/overview');
    b.innerHTML = `<div class="kpi-grid">
      ${RT.kpi({ label: 'Payments to verify', value: num(o.awaitingVerification), icon: 'alert', tone: o.awaitingVerification ? 'warning' : 'neutral', sub: 'Manual M-PESA waiting' })}
      ${RT.kpi({ label: 'Sender IDs to submit', value: num(o.applicationsToProcess), icon: 'tag', tone: o.applicationsToProcess ? 'warning' : 'neutral', sub: 'Paid, not fully approved' })}
      ${RT.kpi({ label: 'SMS credit sales', value: kes(o.revenue.smsCents), icon: 'wallet', tone: 'success' })}
      ${RT.kpi({ label: 'SMS margin', value: kes(o.revenue.smsMarginCents), icon: 'reports', tone: 'success', sub: 'After wholesale cost' })}
      ${RT.kpi({ label: 'Sender ID fees', value: kes(o.revenue.senderIdCents), icon: 'wallet', tone: 'primary' })}
      ${RT.kpi({ label: 'Credits owed to shops', value: num(o.customerCreditsOutstanding), icon: 'bell', tone: 'primary', sub: 'Keep TalkSasa topped up to cover this' })}
      ${RT.kpi({ label: 'Messages sent', value: num(o.totalSent), icon: 'check' })}
      ${RT.kpi({ label: 'Active campaigns', value: num(o.activeCampaigns), icon: 'sales' })}
    </div>`;
  }

  /* ------------------------------ applications ------------------------------ */
  async function openDoc(id, kind) {
    try {
      const { data: d } = await Api.get(`/admin/sms/applications/${id}/document/${kind}`);
      const bin = atob(d.base64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      window.open(URL.createObjectURL(new Blob([u8], { type: d.mime })), '_blank');
    } catch (err) { toastErr(err); }
  }

  async function apps(b) {
    const { data: list } = await Api.get('/admin/sms/applications', S.appFilter ? { status: S.appFilter } : {});
    b.innerHTML = `<div class="card"><div class="card-header"><h2>Applications</h2>
      <select class="select" id="af" style="max-width:200px">${[['', 'All'], ['pending', 'To process'], ['partial', 'Partly approved'], ['needs_info', 'Needs info'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['draft', 'Draft (unpaid)']].map(([v, l]) => `<option value="${v}" ${S.appFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="table-wrap flat"><table class="table"><thead><tr><th>Business</th><th>Sender ID</th><th class="num">Fee</th><th>Payment</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
      ${list.map((a) => `<tr class="drilldown-row" data-o="${a._id}"><td class="cell-primary">${esc(a.businessName || '-')}</td><td><b>${esc(a.senderId)}</b><div class="bl-muted">${esc(a.reference)}</div></td><td class="num">${kes(a.totalCents)}</td><td>${badge(a.paymentStatus)}</td><td>${badge(a.approvalStatus)}</td><td class="text-sm">${window.UI.timeAgo(a.createdAt)}</td></tr>`).join('') || '<tr><td colspan="6" class="text-muted">Nothing here.</td></tr>'}
      </tbody></table></div></div>`;
    $('af').addEventListener('change', (e) => { S.appFilter = e.target.value; show('apps'); });
    b.querySelectorAll('[data-o]').forEach((r) => r.addEventListener('click', () => appDetail(r.dataset.o).catch(toastErr)));
  }

  async function appDetail(id) {
    const { data: a } = await Api.get(`/admin/sms/applications/${id}`);
    const fields = [['Sender ID', a.senderId], ['Purpose', a.purpose], ['Sample message 1', a.samples[0]], ['Sample message 2', a.samples[1]], ['Legal / registered name', a.legalName], ['Trading name', a.tradingName], ['KRA PIN', a.kraPin], ['Signatory title', a.signatoryTitle], ['Signatory name', a.signatoryName], ['Phone', a.phone], ['Email', a.email], ['Networks', a.networks.map((n) => n.name).join(', ')], ['Our reference', a.reference]];
    const modal = window.UI.openModal({
      title: `${a.businessName || ''} · ${a.senderId}`, maxWidth: '860px',
      bodyHtml: `
        <p>${badge(a.approvalStatus)} Payment ${badge(a.paymentStatus)} ${a.payment ? `<span class="text-sm text-muted">${esc(a.payment.method)} ${esc(a.payment.mpesaCode || a.payment.reference)}</span>` : ''}</p>
        <p class="text-sm text-secondary">Copy these into TalkSasa exactly as listed.</p>
        ${fields.map(([k, v]) => `<div class="sms-copy"><span><b>${esc(k)}:</b> ${esc(v || '-')}</span><button class="btn btn-ghost btn-sm" data-c="${esc(v || '')}">Copy</button></div>`).join('')}
        <div class="sms-row-actions" style="margin:12px 0"><button class="btn btn-secondary btn-sm" id="ad-all">Copy all details</button>
          ${a.documentKinds.map((k) => `<button class="btn btn-secondary btn-sm" data-d="${k}">Open ${k === 'legal' ? 'legal document' : k}</button>`).join('')}</div>
        <h3 class="sms-h">Networks</h3>
        ${a.networks.map((n) => `<div class="sms-copy"><span><b>${esc(n.name)}</b> ${badge(n.status)}<div class="bl-muted">${kes(n.providerCostCents)} provider + ${kes(n.serviceFeeCents)} service</div></span>
          <span class="sms-row-actions"><select class="select" data-ns="${n.key}">${['pending', 'submitted', 'approved', 'rejected', 'needs_info'].map((s) => `<option value="${s}" ${n.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select>
          <input class="input" data-nn="${n.key}" placeholder="Note to owner" value="${esc(n.note || '')}" /><button class="btn btn-primary btn-sm" data-sv="${n.key}">Save</button></span></div>`).join('')}
        ${a.paymentStatus !== 'paid' ? '<p class="bl-muted">Verify the payment first (Payments tab). Network statuses unlock once it is paid.</p>' : ''}`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button>',
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('click', () => { navigator.clipboard.writeText(x.dataset.c); window.UI.toast.success('Copied'); }));
    modal.querySelector('#ad-all').addEventListener('click', () => { navigator.clipboard.writeText(fields.map(([k, v]) => `${k}: ${v || ''}`).join('\n')); window.UI.toast.success('All details copied'); });
    modal.querySelectorAll('[data-d]').forEach((x) => x.addEventListener('click', () => openDoc(id, x.dataset.d)));
    modal.querySelectorAll('[data-sv]').forEach((x) => x.addEventListener('click', async () => {
      const k = x.dataset.sv;
      try { await Api.put(`/admin/sms/applications/${id}/network/${k}`, { status: modal.querySelector(`[data-ns="${k}"]`).value, note: modal.querySelector(`[data-nn="${k}"]`).value }); window.UI.toast.success('Updated. The owner sees the new status.'); window.UI.closeModal(); show('apps'); } catch (err) { toastErr(err); }
    }));
  }

  /* ------------------------------ payments ------------------------------ */
  async function payments(b) {
    const { data: list } = await Api.get('/admin/sms/payments', S.payFilter ? { status: S.payFilter } : {});
    b.innerHTML = `<div class="card"><div class="card-header"><h2>SMS &amp; Sender ID payments</h2>
      <select class="select" id="pf" style="max-width:220px">${[['', 'All'], ['AWAITING_VERIFICATION', 'To verify'], ['PENDING', 'Waiting (STK)'], ['PAID', 'Received'], ['FAILED', 'Failed'], ['REJECTED', 'Rejected']].map(([v, l]) => `<option value="${v}" ${S.payFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="table-wrap flat"><table class="table"><thead><tr><th>Date</th><th>Business</th><th>For</th><th class="num">Amount</th><th>Method</th><th>M-PESA code</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td class="text-sm">${when(p.createdAt)}</td><td class="cell-primary">${esc(p.businessName || '-')}</td>
        <td class="text-sm"><span class="badge ${p.purpose === 'SENDER_ID' ? 'badge-info' : 'badge-neutral'}">${p.purpose === 'SENDER_ID' ? 'Sender ID' : 'SMS credits'}</span> ${esc(p.label)}<div class="bl-muted">${esc(p.reference)}</div></td>
        <td class="num"><b>${kes(p.amountCents)}</b>${p.claimedCents != null && p.claimedCents !== p.amountCents ? `<div class="bl-muted">claimed ${kes(p.claimedCents)}</div>` : ''}</td>
        <td class="text-sm">${p.method === 'STK' ? 'M-PESA prompt' : 'M-PESA manual'}</td>
        <td class="text-sm">${esc(p.mpesaCode || '-')}${(p.flags || []).length ? `<div><span class="badge badge-warning">${esc(p.flags.join('; '))}</span></div>` : ''}</td><td>${badge(p.status)}</td>
        <td>${p.status === 'AWAITING_VERIFICATION' ? `<div class="sms-row-actions"><button class="btn btn-primary btn-sm" data-v="${p._id}" data-f="${esc((p.flags || []).join('; '))}">Verify</button><button class="btn btn-ghost btn-sm" data-r="${p._id}">Reject</button></div>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="text-muted">Nothing here.</td></tr>'}
      </tbody></table></div></div>`;
    $('pf').addEventListener('change', (e) => { S.payFilter = e.target.value; show('payments'); });
    b.querySelectorAll('[data-v]').forEach((x) => x.addEventListener('click', async () => {
      const ok = await window.UI.confirmDialog({ title: 'Verify this payment?', message: `Confirm the money is in your M-PESA statement.${x.dataset.f ? ` Flags: ${x.dataset.f}.` : ''} Credits or the Sender ID application are released immediately.`, confirmText: 'Verify & release' });
      if (!ok) return;
      try { await Api.post(`/admin/sms/payments/${x.dataset.v}/verify`, {}); window.UI.toast.success('Payment verified'); show('payments'); } catch (err) { toastErr(err); }
    }));
    b.querySelectorAll('[data-r]').forEach((x) => x.addEventListener('click', async () => {
      const note = window.prompt('Reason for rejecting (the owner will see this)?'); if (note === null) return;
      try { await Api.post(`/admin/sms/payments/${x.dataset.r}/reject`, { note }); show('payments'); } catch (err) { toastErr(err); }
    }));
  }

  /* ------------------------------ offers ------------------------------ */
  async function offers(b) {
    const { data: list } = await Api.get('/admin/sms/offers');
    b.innerHTML = `
      <div class="card bl-card-gap"><div class="card-header"><h2>Create an offer</h2></div><div class="card-body">
        <div class="form-row">
          <div class="field"><label>Name</label><input class="input" id="o-n" placeholder="Weekend Booster" /></div>
          <div class="field"><label>Badge <span class="text-muted">(optional)</span></label><input class="input" id="o-l" placeholder="BEST VALUE" /></div>
          <div class="field"><label>Credits</label><input class="input" id="o-c" type="number" min="1" /></div>
          <div class="field"><label>Bonus credits</label><input class="input" id="o-b" type="number" min="0" value="0" /></div>
          <div class="field"><label>Price (KES)</label><input class="input" id="o-p" type="number" min="1" /></div>
          <div class="field"><label>Sort order</label><input class="input" id="o-s" type="number" value="0" /></div>
          <div class="field"><label>Starts <span class="text-muted">(optional)</span></label><input class="input" id="o-st" type="datetime-local" /></div>
          <div class="field"><label>Ends <span class="text-muted">(optional)</span></label><input class="input" id="o-en" type="datetime-local" /></div>
        </div>
        <div class="field"><label>Description</label><input class="input" id="o-d" /></div>
        <button class="btn btn-primary" id="o-go">Publish offer</button>
      </div></div>
      <div class="card"><div class="table-wrap flat"><table class="table"><thead><tr><th>Offer</th><th class="num">Credits</th><th class="num">Price</th><th>Window</th><th>Live</th><th></th></tr></thead><tbody>
      ${list.map((o) => `<tr><td class="cell-primary">${esc(o.name)} ${o.label ? `<span class="badge badge-warning">${esc(o.label)}</span>` : ''}</td><td class="num">${num(o.credits)}${o.bonusCredits ? ` +${num(o.bonusCredits)}` : ''}</td><td class="num">${kes(o.priceCents)}</td>
        <td class="text-sm">${o.startsAt ? window.UI.formatDate(o.startsAt) : 'Now'} to ${o.endsAt ? window.UI.formatDate(o.endsAt) : 'no end'}</td><td>${o.active ? badge('active') : badge('off')}</td>
        <td><div class="sms-row-actions"><button class="btn btn-secondary btn-sm" data-t="${o._id}">${o.active ? 'Disable' : 'Enable'}</button><button class="btn btn-ghost btn-sm" data-x="${o._id}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="text-muted">No offers yet. Shops can still buy at the standard price.</td></tr>'}
      </tbody></table></div></div>`;
    const g = (i) => $(i).value; const iso = (i) => (g(i) ? new Date(g(i)).toISOString() : null);
    $('o-go').addEventListener('click', async () => {
      if (!g('o-n').trim() || !Number(g('o-c')) || !Number(g('o-p'))) return window.UI.toast.error('Name, credits and price are required');
      try { await Api.post('/admin/sms/offers', { name: g('o-n'), label: g('o-l'), description: g('o-d'), credits: g('o-c'), bonusCredits: g('o-b'), price: g('o-p'), sortOrder: g('o-s'), startsAt: iso('o-st'), endsAt: iso('o-en') }); window.UI.toast.success('Offer published'); show('offers'); } catch (err) { toastErr(err); }
    });
    b.querySelectorAll('[data-t]').forEach((x) => x.addEventListener('click', async () => { const o = list.find((y) => y._id === x.dataset.t); try { await Api.put(`/admin/sms/offers/${o._id}`, { ...o, price: o.priceCents / 100, active: !o.active }); show('offers'); } catch (err) { toastErr(err); } }));
    b.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', async () => {
      const ok = await window.UI.confirmDialog({ title: 'Delete this offer?', message: 'Shops will no longer see it. Past purchases are not affected.', confirmText: 'Delete', danger: true });
      if (ok) { try { await Api.delete(`/admin/sms/offers/${x.dataset.x}`); show('offers'); } catch (err) { toastErr(err); } }
    }));
  }

  /* ------------------------------ settings ------------------------------ */
  async function settings(b) {
    const { data: s } = await Api.get('/admin/sms/settings');
    b.innerHTML = `
      <div class="card bl-card-gap"><div class="card-header"><div><h2>Sender ID fees (KES per network)</h2><p class="text-sm text-muted">Shops pay provider cost + your service fee. Keep them separate so margins stay clear.</p></div></div><div class="card-body">
        ${s.networks.map((n) => `<div class="form-row" data-n="${n.key}"><div class="field"><label>${esc(n.name)}: TalkSasa / network cost</label><input class="input" data-f="p" type="number" min="0" value="${n.providerCostCents / 100}" /></div>
          <div class="field"><label>Your service fee</label><input class="input" data-f="s" type="number" min="0" value="${n.serviceFeeCents / 100}" /></div>
          <div class="field"><label>Offered to shops</label><select class="select" data-f="e"><option value="1" ${n.enabled ? 'selected' : ''}>Yes</option><option value="0" ${n.enabled ? '' : 'selected'}>No</option></select></div></div>`).join('')}
      </div></div>
      <div class="card bl-card-gap"><div class="card-header"><h2>SMS credit pricing (KES per credit)</h2></div><div class="card-body"><div class="form-row">
        <div class="field"><label>Retail price (what shops pay)</label><input class="input" id="s-r" type="number" step="0.01" value="${s.retailPriceCents / 100}" /></div>
        <div class="field"><label>Wholesale cost (TalkSasa)</label><input class="input" id="s-w" type="number" step="0.01" value="${s.wholesaleCostCents / 100}" /></div>
        <div class="field"><label>Minimum top-up (KES)</label><input class="input" id="s-m" type="number" value="${s.minTopupCents / 100}" /></div></div></div></div>
      <div class="card bl-card-gap"><div class="card-header"><div><h2>Payment methods for SMS</h2><p class="text-sm text-muted">Payments use the same PayHero account and till as Billing. Set those in <a class="bl-link" href="admin-billing-settings.html">Billing settings</a>.</p></div></div><div class="card-body"><div class="form-row">
        <div class="field"><label>M-PESA prompt (STK)</label><select class="select" id="s-stk"><option value="1" ${s.stkEnabled ? 'selected' : ''}>Enabled</option><option value="0" ${s.stkEnabled ? '' : 'selected'}>Disabled</option></select></div>
        <div class="field"><label>Manual payment (paste message)</label><select class="select" id="s-man"><option value="1" ${s.manualEnabled ? 'selected' : ''}>Enabled</option><option value="0" ${s.manualEnabled ? '' : 'selected'}>Disabled</option></select></div></div></div>
        <div class="card-footer" style="display:flex;justify-content:flex-end"><button class="btn btn-primary btn-sm" id="s-go">Save settings</button></div></div>`;
    $('s-go').addEventListener('click', async (ev) => {
      const networks = s.networks.map((n) => { const r = b.querySelector(`[data-n="${n.key}"]`); return { key: n.key, name: n.name, providerCostCents: Math.round(r.querySelector('[data-f=p]').value * 100), serviceFeeCents: Math.round(r.querySelector('[data-f=s]').value * 100), enabled: r.querySelector('[data-f=e]').value === '1' }; });
      window.UI.setButtonLoading(ev.currentTarget, true, 'Saving…');
      try {
        await Api.put('/admin/sms/settings', { networks, retailPriceCents: Math.round($('s-r').value * 100), wholesaleCostCents: Math.round($('s-w').value * 100), minTopupCents: Math.round($('s-m').value * 100), stkEnabled: $('s-stk').value === '1', manualEnabled: $('s-man').value === '1' });
        window.UI.toast.success('Settings saved');
      } catch (err) { toastErr(err); } finally { window.UI.setButtonLoading($('s-go'), false); }
    });
  }

  /* ------------------------------ wallets ------------------------------ */
  async function wallets(b) {
    const { data: list } = await Api.get('/admin/sms/wallets');
    b.innerHTML = `<div class="card"><div class="table-wrap flat"><table class="table"><thead><tr><th>Business</th><th class="num">Available</th><th class="num">Purchased</th><th class="num">Sent</th><th></th></tr></thead><tbody>
      ${list.map((w) => `<tr><td class="cell-primary">${esc(w.businessName || '-')}</td><td class="num">${num(w.availableCredits)}</td><td class="num">${num(w.totalPurchased)}</td><td class="num">${num(w.totalSent)}</td><td><button class="btn btn-secondary btn-sm" data-a="${w.businessId}">Adjust</button></td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">No wallets yet.</td></tr>'}
      </tbody></table></div></div>`;
    b.querySelectorAll('[data-a]').forEach((x) => x.addEventListener('click', async () => {
      const c = window.prompt('Credits to add (use a minus sign to deduct)?'); if (!c || Number.isNaN(Number(c))) return;
      const note = window.prompt('Reason (kept in the ledger)?') || '';
      try { await Api.post(`/admin/sms/wallets/${x.dataset.a}/adjust`, { credits: Number(c), note }); window.UI.toast.success('Wallet adjusted'); show('wallets'); } catch (err) { toastErr(err); }
    }));
  }
})();