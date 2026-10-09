/**
 * sms.js - SMS Marketing for shop owners. Tabs: Overview | Sender ID | Buy SMS | New campaign | Campaigns.
 * Customers/segments come from the CRM; payments go through the same PayHero account as Billing.
 */
(function () {
  const Api = window.Api;
  const esc = window.UI.escapeHtml;
  const RT = window.ReportTools;
  const $ = (id) => document.getElementById(id);
  const kes = (c) => window.UI.formatMoney((Number(c) || 0) / 100);
  const num = (n) => Number(n || 0).toLocaleString('en-KE');
  const PHONE_KEY = 'sixstar.billing.phone';
  const GOOD = /approved|paid|delivered|completed|sent|active/i;
  const BAD = /reject|fail|cancel|revoked/i;
  const badge = (s) => `<span class="badge ${GOOD.test(s) ? 'badge-success' : BAD.test(s) ? 'badge-danger' : 'badge-warning'}">${esc(String(s).replace(/_/g, ' '))}</span>`;
  const when = (d) => (d ? window.UI.formatDateTime(d) : '-');
  const toastErr = (e) => window.UI.toast.error((e && e.message) || 'Something went wrong');

  const TABS = [['overview', 'Overview'], ['senderid', 'Sender ID'], ['buy', 'Buy SMS'], ['compose', 'New campaign'], ['history', 'Campaigns']];
  const S = { tab: 'overview', data: null, segments: [], templates: [], offer: null, poll: null, segment: '' };
  let el; let user; let can = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.AppShell.mount({ title: 'SMS Marketing' });
    if (!el) return;
    user = window.AppShell.getUser();
    const P = (k) => window.Permissions.can(user, k);
    can = { view: P('reports.view'), send: P('customers.update'), pay: P('billing.pay') };
    if (!can.view) {
      el.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'No access', message: 'SMS marketing is limited to managers and owners.' })}</div>`;
      return;
    }
    const q = new URLSearchParams(window.location.search);
    if (TABS.some((t) => t[0] === q.get('tab'))) S.tab = q.get('tab');
    S.segment = q.get('segment') || '';

    el.innerHTML = `
      <div class="page-header">
        <div><h1>SMS Marketing</h1><p>Register your Sender ID, buy SMS credits and message your CRM customers.</p></div>
        <div class="page-actions"><button class="btn btn-secondary btn-sm" id="sms-refresh">Refresh</button></div>
      </div>
      <div class="tabs" id="sms-tabs" style="margin-bottom:var(--space-5)">${TABS.map(([k, l]) => `<button class="tab-btn" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="sms-body"></div>`;
    $('sms-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
    $('sms-refresh').addEventListener('click', load);
    window.addEventListener('beforeunload', stopPoll);
    await load();
  }

  async function load() {
    stopPoll();
    $('sms-body').innerHTML = window.UI.skeletonRows(3, 1);
    try {
      const [ov, seg, tpl] = await Promise.all([
        Api.get('/sms/overview'),
        Api.get('/crm/segments').catch(() => ({ data: { items: [] } })),
        Api.get('/sms/templates').catch(() => ({ data: [] })),
      ]);
      S.data = ov.data; S.segments = (seg.data && seg.data.items) || []; S.templates = tpl.data || [];
      show(S.tab);
    } catch (err) {
      $('sms-body').innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load SMS', message: err.message });
    }
  }

  function show(t) {
    stopPoll(); S.tab = t;
    document.querySelectorAll('#sms-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    if (!S.data) return;
    ({ overview: vOverview, senderid: vSender, buy: vBuy, compose: vCompose, history: vHistory }[t])($('sms-body'));
  }

  /* ------------------------------ overview ------------------------------ */
  function vOverview(b) {
    const d = S.data; const w = d.wallet;
    const sids = [...new Set(d.senderIds.map((s) => s.senderId))];
    const step = (n, done, title, text, go) => `<div class="bl-kv"><span><b>${done ? '✓' : n}.</b> ${esc(title)}<div class="bl-muted">${esc(text)}</div></span><span>${done ? badge('approved') : `<button class="btn btn-secondary btn-sm" data-go="${go}">Open</button>`}</span></div>`;
    b.innerHTML = `
      <div class="kpi-grid">
        ${RT.kpi({ label: 'SMS credits', value: num(w.availableCredits), icon: 'wallet', tone: w.availableCredits ? 'success' : 'warning', sub: '1 credit = one 160-character SMS' })}
        ${RT.kpi({ label: 'Messages sent', value: num(w.totalSent), icon: 'check', tone: 'primary' })}
        ${RT.kpi({ label: 'Approved Sender IDs', value: num(sids.length), icon: 'tag', tone: sids.length ? 'primary' : 'warning', sub: sids.join(', ') || 'Apply for one first' })}
      </div>
      <div class="card bl-card-gap"><div class="card-header"><h2>Get started</h2></div><div class="card-body">
        ${step(1, sids.length > 0, 'Register your Sender ID', 'The name customers see as the sender.', 'senderid')}
        ${step(2, w.availableCredits > 0 || w.totalPurchased > 0, 'Buy SMS credits', 'Pick a bundle or a custom amount.', 'buy')}
        ${step(3, d.campaigns.length > 0, 'Send your first campaign', 'Choose a CRM segment and write your message.', 'compose')}
      </div></div>
      <div class="card"><div class="card-header"><h2>Recent credit activity</h2></div>
        <div class="table-wrap flat"><table class="table"><thead><tr><th>Date</th><th>Type</th><th class="num">Credits</th><th>Note</th></tr></thead><tbody>
        ${d.ledger.map((l) => `<tr><td class="text-sm">${when(l.createdAt)}</td><td>${esc(String(l.type).replace(/_/g, ' '))}</td><td class="num">${l.credits > 0 ? '+' : ''}${num(l.credits)}</td><td class="text-sm">${esc(l.note || l.reference || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">No activity yet.</td></tr>'}
        </tbody></table></div></div>`;
    b.querySelectorAll('[data-go]').forEach((x) => x.addEventListener('click', () => show(x.dataset.go)));
  }

  /* ------------------------------ payment box ------------------------------ */
  function payOpts() {
    const p = S.data.pricing; const po = S.data.payment || {};
    return {
      stk: !!(po.stk && po.stk.available) && p.stkEnabled,
      man: !!(po.manual && po.manual.available) && p.manualEnabled,
      m: po.manual || {},
    };
  }
  const payStatus = (tone, label, msg) => {
    const x = $('pb-status'); if (!x) return;
    const c = { pending: 'badge-info', error: 'badge-danger', warning: 'badge-warning', success: 'badge-success' }[tone];
    x.innerHTML = `<div class="bl-status"><span class="badge ${c}">${esc(label)}</span><span class="text-sm text-secondary" style="flex:1">${esc(msg)}</span></div>`;
  };
  function stopPoll() { if (S.poll) { clearInterval(S.poll); S.poll = null; } }
  function pollPay(id, ctx) {
    stopPoll(); payStatus('pending', 'Waiting', 'Enter your M-PESA PIN on the phone.');
    const t0 = Date.now();
    S.poll = setInterval(async () => {
      if (!$('pb-status')) return stopPoll();
      try {
        const { data: p } = await Api.get(`/sms/payments/${id}`);
        if (p.status === 'PAID') { stopPoll(); payStatus('success', 'Confirmed', 'Payment received. Thank you!'); window.UI.toast.success('Payment received'); setTimeout(() => { if (ctx.onDone) ctx.onDone(); load(); }, 1200); return; }
        if (p.status === 'FAILED') { stopPoll(); payStatus('error', 'Payment failed', p.failureReason || 'Please try again.'); return; }
      } catch { /* keep polling */ }
      if (Date.now() - t0 > 150000) { stopPoll(); payStatus('warning', 'Still waiting', 'If money was deducted it is applied automatically. Refresh shortly, or pay manually.'); }
    }, 3000);
  }

  /** ctx: { purpose:'SENDER_ID'|'SMS_TOPUP', applicationId?, offerId?, amount?(KES), totalCents } */
  function payBox(host, ctx) {
    if (!can.pay) { host.innerHTML = '<div class="card"><div class="card-body text-sm text-secondary">Only the business owner can make payments.</div></div>'; return; }
    const o = payOpts();
    if (!o.stk && !o.man) { host.innerHTML = '<div class="card"><div class="card-body text-sm text-secondary">Online payment is not available right now. Please contact support.</div></div>'; return; }
    let saved = ''; try { saved = localStorage.getItem(PHONE_KEY) || ''; } catch { /* ignore */ }
    const m = o.m || {};
    host.innerHTML = `
      <div class="card bl-card-gap" id="pb"><div class="card-header"><h2>Pay ${kes(ctx.totalCents)}</h2></div><div class="card-body">
        <div class="tabs" id="pb-methods" style="margin-bottom:var(--space-4)">
          ${o.stk ? '<button class="tab-btn active" data-m="stk">M-PESA prompt (STK)</button>' : ''}
          ${o.man ? `<button class="tab-btn ${o.stk ? '' : 'active'}" data-m="manual">Pay manually & paste the M-PESA message</button>` : ''}
        </div>
        ${o.stk ? `<div id="pb-stk"><div class="field" style="max-width:320px"><label for="pb-phone">M-PESA phone number</label><input class="input" id="pb-phone" inputmode="tel" placeholder="07XXXXXXXX" value="${esc(saved)}" /></div>
          <button class="btn btn-success" id="pb-stk-go">Send payment prompt</button></div>` : ''}
        ${o.man ? `<div id="pb-man" style="${o.stk ? 'display:none' : ''}">
          <div class="bl-instr">
            <div><span>${esc(m.label || 'Pay to')}</span><strong>${esc(m.number || '-')}</strong></div>
            ${m.accountName ? `<div><span>Name</span><strong>${esc(m.accountName)}</strong></div>` : ''}
            ${m.accountReference ? `<div><span>Account / reference</span><strong>${esc(m.accountReference)}</strong></div>` : ''}
            <div><span>Amount to pay</span><strong>${kes(ctx.totalCents)}</strong></div>
            ${m.instructions ? `<p>${esc(m.instructions)}</p>` : ''}
          </div>
          <div class="field"><label for="pb-msg">Paste the full M-PESA confirmation message</label><textarea class="textarea" id="pb-msg" rows="4" placeholder="e.g. UJK1A2B3C4 Confirmed. Ksh6,950.00 paid to ..."></textarea></div>
          <button class="btn btn-primary" id="pb-man-go">Submit for verification</button>
          <p class="bl-muted" style="margin-top:var(--space-2)">We check it against our M-PESA statement. Your payment is recorded as <b>${ctx.purpose === 'SENDER_ID' ? 'Sender ID registration' : 'SMS credits'}</b>.</p></div>` : ''}
        <div id="pb-status"></div>
      </div></div>`;
    host.querySelectorAll('#pb-methods [data-m]').forEach((b) => b.addEventListener('click', () => {
      host.querySelectorAll('#pb-methods .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
      if ($('pb-stk')) $('pb-stk').style.display = b.dataset.m === 'stk' ? '' : 'none';
      if ($('pb-man')) $('pb-man').style.display = b.dataset.m === 'manual' ? '' : 'none';
    }));
    const base = { purpose: ctx.purpose, applicationId: ctx.applicationId, offerId: ctx.offerId, amount: ctx.amount };
    $('pb-stk-go')?.addEventListener('click', async (ev) => {
      const phone = $('pb-phone').value.trim();
      if (phone.replace(/\D/g, '').length < 9) return window.UI.toast.error('Enter the M-PESA phone number');
      window.UI.setButtonLoading(ev.currentTarget, true, 'Sending…'); payStatus('pending', 'Sending', 'Sending the prompt to the phone…');
      try {
        const { data } = await Api.post('/sms/payments', { ...base, method: 'STK', phone });
        try { localStorage.setItem(PHONE_KEY, phone); } catch { /* ignore */ }
        pollPay(data._id, ctx);
      } catch (err) { payStatus('error', 'Could not send the prompt', err.message); toastErr(err); }
      finally { if ($('pb-stk-go')) window.UI.setButtonLoading($('pb-stk-go'), false); }
    });
    $('pb-man-go')?.addEventListener('click', async (ev) => {
      const msg = $('pb-msg').value.trim();
      if (msg.length < 20) return window.UI.toast.error('Paste the full M-PESA confirmation message');
      window.UI.setButtonLoading(ev.currentTarget, true, 'Submitting…');
      try {
        await Api.post('/sms/payments', { ...base, method: 'MANUAL', mpesaMessage: msg });
        window.UI.toast.success('Submitted. We will verify it shortly.');
        if (ctx.onDone) ctx.onDone();
        await load();
      } catch (err) { toastErr(err); if ($('pb-man-go')) window.UI.setButtonLoading($('pb-man-go'), false); }
    });
  }

  /* ------------------------------ buy SMS ------------------------------ */
  function vBuy(b) {
    const d = S.data; const p = d.pricing;
    b.innerHTML = `
      <div class="card bl-card-gap"><div class="card-header"><h2>Buy SMS credits</h2><span class="text-sm text-muted">Standard price ${kes(p.retailPriceCents)} per credit</span></div><div class="card-body">
        <div class="sms-grid">
          ${d.offers.map((o) => `<div class="sms-offer ${S.offer === o._id ? 'sel' : ''}" data-o="${o._id}">
            ${o.label ? `<span class="tag">${esc(o.label)}</span>` : ''}<h4>${esc(o.name)}</h4>
            <div class="pr">${kes(o.priceCents)}</div>
            <div>${num(o.credits)} credits${o.bonusCredits ? ` <b style="color:var(--color-success,#16a34a)">+ ${num(o.bonusCredits)} bonus</b>` : ''}</div>
            <div class="bl-muted">${esc(o.description || '')}${o.endsAt ? ` Ends ${window.UI.formatDate(o.endsAt)}.` : ''}</div></div>`).join('')}
          <div class="sms-offer ${S.offer === 'custom' ? 'sel' : ''}" data-o="custom"><h4>Custom amount</h4>
            <input class="input" id="by-cust" type="number" min="${p.minTopupCents / 100}" step="1" placeholder="KES (min ${p.minTopupCents / 100})" />
            <div class="bl-muted" id="by-credits"></div></div>
        </div>
      </div></div><div id="by-pay"></div>`;
    const slot = $('by-pay');
    const go = () => {
      if (!S.offer) { slot.innerHTML = ''; return; }
      if (S.offer === 'custom') {
        const amt = Math.floor(Number($('by-cust').value || 0));
        $('by-credits').textContent = amt ? `≈ ${num(Math.floor((amt * 100) / p.retailPriceCents))} credits` : '';
        if (amt * 100 < p.minTopupCents) { slot.innerHTML = ''; return; }
        payBox(slot, { purpose: 'SMS_TOPUP', amount: amt, totalCents: amt * 100 });
      } else {
        const o = d.offers.find((x) => x._id === S.offer);
        if (o) payBox(slot, { purpose: 'SMS_TOPUP', offerId: o._id, totalCents: o.priceCents });
      }
    };
    const pick = (id) => { S.offer = id; b.querySelectorAll('.sms-offer').forEach((x) => x.classList.toggle('sel', x.dataset.o === id)); go(); };
    b.querySelectorAll('[data-o]').forEach((c) => c.addEventListener('click', (e) => { if (e.target.id !== 'by-cust') pick(c.dataset.o); }));
    $('by-cust').addEventListener('focus', () => { if (S.offer !== 'custom') pick('custom'); });
    $('by-cust').addEventListener('input', window.UI.debounce(go, 600));
    if (S.offer) go();
  }

  /* ------------------------------ sender ID ------------------------------ */
   function vSender(b) {
    const d = S.data;
    const stage = (a) => (a.approvalStatus === 'approved' ? 4 : a.paymentStatus === 'paid' ? 3 : a.paymentStatus === 'awaiting_verification' ? 2 : 1);
    const STEPS = ['Application', 'Payment', 'Network review', 'Live'];
    const track = (a) => { const s = stage(a); return `<div class="sa-track">${STEPS.map((l, i) => { const n = i + 1; const cls = n < s || (s === 4 && n === 4) ? 'done' : n === s ? 'now' : ''; return `<div class="st ${cls}"><i>${cls === 'done' ? '✓' : n}</i>${l}</div>`; }).join('')}</div>`; };
    b.innerHTML = `
      <div class="card bl-card-gap"><div class="card-header"><div><h2>My Sender IDs</h2><p class="text-sm text-muted">The name your customers see when you text them.</p></div>${can.send ? '<button class="btn btn-primary btn-sm" id="sid-new">+ New Sender ID</button>' : ''}</div>
        <div class="card-body"><div class="sa-list">
        ${d.applications.map((a) => `<div class="sa-card">
          <div class="sa-top"><div><div class="sa-name">${esc(a.senderId)}</div><div class="sa-meta">${esc(a.reference)} · ${esc(a.purpose)} · ${when(a.createdAt)}</div></div>
            <div style="text-align:right"><div style="font-weight:700">${kes(a.totalCents)}</div>${badge(a.approvalStatus)}</div></div>
          ${track(a)}
          <div class="sa-nets">${a.networks.map((n) => `<div class="sa-net"><b>${esc(n.name)}</b> ${badge(n.status)}${n.note ? `<small>${esc(n.note)}</small>` : ''}</div>`).join('')}</div>
          ${a.adminNote ? `<p class="text-sm" style="margin-top:10px"><b>Note from Six Star:</b> ${esc(a.adminNote)}</p>` : ''}
          <div class="sms-row-actions" style="margin-top:12px">
            ${a.approvalStatus === 'draft' && a.paymentStatus === 'unpaid' ? `<button class="btn btn-success btn-sm" data-pay="${a._id}">Pay ${kes(a.totalCents)}</button>` : ''}
            ${can.send && ['draft', 'needs_info'].includes(a.approvalStatus) ? `<button class="btn btn-secondary btn-sm" data-edit="${a._id}">${a.approvalStatus === 'draft' ? 'Edit application' : 'Update details'}</button>` : ''}
          </div></div>`).join('') || `<div class="sa-empty"><h3>No Sender ID yet</h3><p class="text-sm text-muted">Register your business name so customers know who is texting them.</p>${can.send ? '<button class="btn btn-primary" id="sid-new2">Apply for a Sender ID</button>' : ''}</div>`}
        </div></div></div>
      <div id="sid-form"></div><div id="sid-pay"></div>`;
    const open = () => { $('sid-pay').innerHTML = ''; sidForm($('sid-form'), null); $('sid-form').scrollIntoView({ behavior: 'smooth' }); };
    $('sid-new')?.addEventListener('click', open); $('sid-new2')?.addEventListener('click', open);
    b.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => { $('sid-pay').innerHTML = ''; sidForm($('sid-form'), d.applications.find((a) => a._id === x.dataset.edit)); $('sid-form').scrollIntoView({ behavior: 'smooth' }); }));
    b.querySelectorAll('[data-pay]').forEach((x) => x.addEventListener('click', () => {
      const a = d.applications.find((y) => y._id === x.dataset.pay);
      $('sid-form').innerHTML = ''; payBox($('sid-pay'), { purpose: 'SENDER_ID', applicationId: a._id, totalCents: a.totalCents }); $('sid-pay').scrollIntoView({ behavior: 'smooth' });
    }));
  }

  const blob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
  function stampCanvas(name, pin) {
    const c = document.createElement('canvas'); c.width = c.height = 300; const x = c.getContext('2d');
    x.strokeStyle = x.fillStyle = '#1d4ed8'; x.lineWidth = 6; x.beginPath(); x.arc(150, 150, 140, 0, 7); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.arc(150, 150, 120, 0, 7); x.stroke(); x.textAlign = 'center'; x.font = 'bold 20px sans-serif';
    const t = String(name).toUpperCase().slice(0, 28);
    for (let i = 0; i < t.length; i++) { const a = Math.PI * 1.15 + (i / Math.max(t.length - 1, 1)) * Math.PI * 0.7; x.save(); x.translate(150 + 100 * Math.cos(a), 150 + 100 * Math.sin(a)); x.rotate(a + Math.PI / 2); x.fillText(t[i], 0, 0); x.restore(); }
    x.font = 'bold 22px sans-serif'; x.fillText(String(pin).toUpperCase(), 150, 160); x.font = '14px sans-serif'; x.fillText('OFFICIAL STAMP', 150, 195);
    return c;
  }
  function sigPad(c) {
    c.width = 420; c.height = 140; const x = c.getContext('2d'); x.lineWidth = 2.5; x.lineCap = 'round'; x.strokeStyle = '#111'; let down = false; c._dirty = false;
    const pos = (e) => { const r = c.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return [(t.clientX - r.left) * (c.width / r.width), (t.clientY - r.top) * (c.height / r.height)]; };
    const st = (e) => { down = true; const [a, b] = pos(e); x.beginPath(); x.moveTo(a, b); e.preventDefault(); };
    const mv = (e) => { if (!down) return; const [a, b] = pos(e); x.lineTo(a, b); x.stroke(); c._dirty = true; e.preventDefault(); };
    ['mousedown', 'touchstart'].forEach((v) => c.addEventListener(v, st)); ['mousemove', 'touchmove'].forEach((v) => c.addEventListener(v, mv));
    ['mouseup', 'mouseleave', 'touchend'].forEach((v) => c.addEventListener(v, () => { down = false; }));
  }
  const USE = { transactional: 'sending notifications and OTPs', promotional: 'sending promotional messages', informational: 'sending informational messages' };

  function sidForm(host, app) {
    const nets = S.data.pricing.networks;
    const v = (k) => esc((app && app[k]) || '');
    const has = (k) => !!(app && app.networks.some((n) => n.key === k));
    const PURP = [['transactional', 'Transactional', 'OTPs, receipts, order and payment alerts'], ['promotional', 'Promotional', 'Offers, discounts and marketing'], ['informational', 'Informational', 'Updates, reminders and announcements']];
    const STEP_NAMES = ['Sender ID', 'Business', 'Documents', 'Sign & submit'];
    const drop = (id, title, hint) => `<label class="sx-drop" id="${id}-d"><span class="ic">⬆</span><span><span class="t">${title}</span><br/><span class="n" id="${id}-n">${hint}</span></span><input type="file" id="${id}" accept=".pdf,.png,.jpg,.jpeg" hidden /></label>`;

    host.innerHTML = `
      <div class="card bl-card-gap">
        <div class="sx-head"><h2>${app ? `Update ${esc(app.reference)}` : 'Apply for a Sender ID'}</h2>
          <div class="sx-steps" id="sx-steps">${STEP_NAMES.map((n, i) => `<div class="s" data-s="${i + 1}"><b>${i + 1}</b><span>${n}</span></div>`).join('')}</div></div>
        <div class="sx-layout"><div class="sx-main">

          <section class="sx-step" data-step="1">
            <h3>Choose networks and your Sender ID</h3><p>Each network is a separate registration with its own fee.</p>
            <div class="sx-nets">${nets.map((n) => `<label class="sx-net ${has(n.key) ? 'on' : ''}"><input type="checkbox" name="net" value="${n.key}" ${has(n.key) ? 'checked' : ''} /><div class="nm">${esc(n.name)}</div><div class="pr">${kes(n.totalCents)}</div><small>one-time fee</small></label>`).join('')}</div>
            <div class="field" style="margin-top:18px"><label for="sf-sid">Sender ID</label>
              <div class="sx-idbox"><input class="input" id="sf-sid" maxlength="11" placeholder="e.g. SIXSTAR" value="${v('senderId')}" /><span class="sx-count" id="sf-cnt">0 / 11</span></div>
              <span class="field-hint">Letters only, no digits, max 11 characters. Words may be separated by a space, hyphen, underscore or full stop.</span></div>
            <label style="font-weight:600;font-size:13px">What will you use it for?</label>
            <div class="sx-purp" style="margin:6px 0 16px">${PURP.map(([k, t, d]) => `<div class="sx-p" data-p="${k}"><b>${t}</b><small>${d}</small></div>`).join('')}</div>
            <input type="hidden" id="sf-purpose" value="${app ? esc(app.purpose) : 'transactional'}" />
            <div class="sx-grid2">
              <div class="field"><label for="sf-s1">Sample message 1</label><textarea class="textarea" id="sf-s1" rows="3" placeholder="Hi John, your order #1234 is ready for pickup.">${esc((app && app.samples && app.samples[0]) || '')}</textarea></div>
              <div class="field"><label for="sf-s2">Sample message 2</label><textarea class="textarea" id="sf-s2" rows="3" placeholder="Your payment of KES 500 was received. Thank you!">${esc((app && app.samples && app.samples[1]) || '')}</textarea></div>
            </div>
          </section>

          <section class="sx-step" data-step="2">
            <h3>Business details</h3><p>These must match your registration documents exactly. The network checks them.</p>
            <div class="sx-grid2">
              <div class="field"><label for="sf-legal">Legal / registered name</label><input class="input" id="sf-legal" value="${v('legalName')}" /></div>
              <div class="field"><label for="sf-trade">Trading name <span class="text-muted">(optional)</span></label><input class="input" id="sf-trade" value="${v('tradingName')}" /></div>
              <div class="field"><label for="sf-kra">KRA PIN</label><input class="input" id="sf-kra" value="${v('kraPin')}" placeholder="P051234567X" style="text-transform:uppercase" /></div>
              <div class="field"><label for="sf-st">Signatory title</label><input class="input" id="sf-st" value="${v('signatoryTitle')}" placeholder="Director" /></div>
              <div class="field"><label for="sf-sn">Signatory full name</label><input class="input" id="sf-sn" value="${v('signatoryName')}" /></div>
              <div class="field"><label for="sf-ph">Signatory phone</label><input class="input" id="sf-ph" inputmode="tel" value="${v('phone')}" placeholder="07XXXXXXXX" /></div>
              <div class="field"><label for="sf-em">Email</label><input class="input" id="sf-em" type="email" value="${v('email')}" /></div>
            </div>
          </section>

          <section class="sx-step" data-step="3">
            <h3>Upload your documents</h3><p>PDF, PNG or JPG, max 5 MB each. Files are stored privately and only Six Star staff can open them.</p>
            ${drop('sf-doc', 'Business registration certificate or certificate of incorporation', app ? 'Already uploaded. Choose a file only to replace it.' : 'Click to choose a file')}
            <div class="sx-grid2" style="margin-top:16px">
              <div class="sx-box"><h4>Company stamp</h4>
                <div id="sf-stamp" class="sa-meta" style="margin-bottom:8px">Generated from your legal name and KRA PIN.</div>
                <div class="sms-row-actions"><button type="button" class="btn btn-secondary btn-sm" id="sf-gen">Generate stamp</button></div>
                <div style="margin-top:10px">${drop('sf-stf', 'Or upload your own stamp', 'PNG or JPG')}</div></div>
              <div class="sx-box"><h4>Signature</h4>
                <canvas class="sms-sig" id="sf-sig"></canvas>
                <div class="sms-row-actions" style="margin-top:8px"><button type="button" class="btn btn-secondary btn-sm" id="sf-sigclr">Clear</button></div>
                <div style="margin-top:10px">${drop('sf-sigf', 'Or upload a signature image', 'PNG or JPG')}</div></div>
            </div>
          </section>

          <section class="sx-step" data-step="4">
            <h3>Review and authorise</h3><p>Check everything, then confirm. You will pay on the next screen.</p>
            <div class="sx-auth" id="sf-auth"></div>
            <div class="sx-review" id="sf-review"></div>
            <label class="checkbox-row"><input type="checkbox" id="sf-acc" ${app ? 'checked' : ''} /> I accept the statements above and confirm the details are correct</label>
          </section>

          <div class="sx-err" id="sf-err"></div>
          <div class="sx-nav"><button class="btn btn-secondary" id="sf-back" type="button">Back</button><button class="btn btn-primary" id="sf-next" type="button">Continue</button><button class="btn btn-success" id="sf-save" type="button" style="display:none">${app ? 'Save changes' : 'Save & continue to payment'}</button></div>
        </div>

        <aside class="sx-side">
          <div class="sx-ph"><div class="bar">Message preview</div><div class="from" id="sx-from">SENDER ID</div><div class="bub" id="sx-bub">Your sample message appears here.</div></div>
          <div class="sx-sum"><h4>Your order</h4><div id="sx-lines"><div class="sa-meta">No network selected</div></div><div class="row tot"><span>Total</span><span id="sx-total">${kes(0)}</span></div></div>
        </aside></div>
      </div>`;

    const q = (s) => host.querySelector(s);
    const g = (id) => $(id).value.trim();
    const picked = () => [...host.querySelectorAll('[name=net]:checked')].map((c) => nets.find((n) => n.key === c.value));
    let stamp = null; let cur = 1; let done = 0;
    sigPad($('sf-sig'));

    const setPurpose = (k) => { $('sf-purpose').value = k; host.querySelectorAll('.sx-p').forEach((p) => p.classList.toggle('on', p.dataset.p === k)); refresh(); };
    host.querySelectorAll('.sx-p').forEach((p) => p.addEventListener('click', () => setPurpose(p.dataset.p)));
    host.querySelectorAll('.sx-net').forEach((l) => l.querySelector('input').addEventListener('change', (e) => { l.classList.toggle('on', e.target.checked); refresh(); }));
    ['sf-doc', 'sf-stf', 'sf-sigf'].forEach((id) => $(id).addEventListener('change', (e) => { const f = e.target.files[0]; $(`${id}-n`).textContent = f ? `${f.name} (${Math.round(f.size / 1024)} KB)` : ''; $(`${id}-d`).classList.toggle('has', !!f); }));

    function refresh() {
      const sel = picked(); const sid = g('sf-sid'); const purpose = $('sf-purpose').value;
      $('sf-cnt').textContent = `${sid.length} / 11`;
      $('sx-from').textContent = sid || 'SENDER ID';
      $('sx-bub').textContent = g('sf-s1') || 'Your sample message appears here.';
      $('sx-lines').innerHTML = sel.length ? sel.map((n) => `<div class="row"><span>${esc(n.name)}</span><span>${kes(n.totalCents)}</span></div>`).join('') : '<div class="sa-meta">No network selected</div>';
      $('sx-total').textContent = kes(sel.reduce((a, n) => a + n.totalCents, 0));
      $('sf-auth').innerHTML = `We the undersigned duly authorize Six Star Technologies and Talksasa Limited to register the Sender ID <b>${esc(sid || '…')}</b> with the following Mobile Network Operator(s): <b>${esc(sel.map((n) => n.name).join(', ') || '…')}</b>, and to set it up as a <b>${esc(purpose)}</b> ID for the purpose of ${USE[purpose]}.`;
      const rows = [['Sender ID', sid], ['Purpose', purpose], ['Networks', sel.map((n) => n.name).join(', ')], ['Legal name', g('sf-legal')], ['KRA PIN', g('sf-kra').toUpperCase()], ['Signatory', `${g('sf-sn')} (${g('sf-st')})`], ['Phone', g('sf-ph')], ['Email', g('sf-em')], ['Total fee', kes(sel.reduce((a, n) => a + n.totalCents, 0))]];
      $('sf-review').innerHTML = rows.map(([k, val]) => `<div><span>${k}</span><b>${esc(val || '-')}</b></div>`).join('');
    }
    host.addEventListener('input', refresh);

    function check(n) {
      if (n === 1) {
        if (!picked().length) return 'Select at least one network.';
        if (!/^[A-Za-z]+([ .\-_][A-Za-z]+)*$/.test(g('sf-sid')) || g('sf-sid').length > 11) return 'Sender ID: letters only (no digits), max 11 characters.';
        if (!g('sf-s1') || !g('sf-s2')) return 'Provide both sample messages.';
      }
      if (n === 2) {
        if (!g('sf-legal')) return 'Enter the legal / registered name.';
        if (!/^[AP]\d{9}[A-Z]$/i.test(g('sf-kra'))) return 'Enter a valid KRA PIN, e.g. P051234567X.';
        if (!g('sf-st') || !g('sf-sn')) return 'Enter the signatory title and name.';
        if (g('sf-ph').replace(/\D/g, '').length < 9) return 'Enter a valid signatory phone.';
        if (!/\S+@\S+\.\S+/.test(g('sf-em'))) return 'Enter a valid email.';
      }
      if (n === 3 && !app) {
        if (!$('sf-doc').files[0]) return 'Upload your registration certificate.';
        if (!($('sf-sigf').files[0] || $('sf-sig')._dirty)) return 'Add your signature (draw or upload).';
        if (!($('sf-stf').files[0] || stamp)) return 'Generate or upload a company stamp.';
      }
      if (n === 4 && !$('sf-acc').checked) return 'Please accept the statements to continue.';
      return '';
    }

    async function autoStamp() {
      if (stamp || $('sf-stf').files[0] || !g('sf-legal') || !g('sf-kra')) return;
      const c = stampCanvas(g('sf-legal'), g('sf-kra')); stamp = await blob(c);
      $('sf-stamp').innerHTML = `<img src="${c.toDataURL()}" width="120" alt="Stamp" />`;
    }
    function go(n) {
      cur = n; done = Math.max(done, n - 1);
      host.querySelectorAll('.sx-step').forEach((s) => s.classList.toggle('on', Number(s.dataset.step) === n));
      host.querySelectorAll('#sx-steps .s').forEach((s) => { const i = Number(s.dataset.s); s.classList.toggle('on', i === n); s.classList.toggle('ok', i < n); });
      $('sf-back').style.visibility = n === 1 ? 'hidden' : 'visible';
      $('sf-next').style.display = n === 4 ? 'none' : '';
      $('sf-save').style.display = n === 4 ? '' : 'none';
      $('sf-err').textContent = '';
      if (n === 3) autoStamp();
      refresh();
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    $('sf-next').addEventListener('click', () => { const e = check(cur); if (e) { $('sf-err').textContent = e; return; } go(cur + 1); });
    $('sf-back').addEventListener('click', () => go(cur - 1));
    host.querySelectorAll('#sx-steps .s').forEach((s) => s.addEventListener('click', () => { const t = Number(s.dataset.s); if (t < cur) go(t); }));
    $('sf-sigclr').addEventListener('click', () => { const c = $('sf-sig'); c.getContext('2d').clearRect(0, 0, c.width, c.height); c._dirty = false; });
    $('sf-gen').addEventListener('click', async () => {
      if (!g('sf-legal') || !g('sf-kra')) return window.UI.toast.error('Fill in the legal name and KRA PIN on the Business step first');
      stamp = null; await autoStamp();
    });

    $('sf-save').addEventListener('click', async (ev) => {
      for (let n = 1; n <= 4; n++) { const e = check(n); if (e) { go(n); $('sf-err').textContent = e; return; } }
      const btn = ev.currentTarget; window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        const fd = new FormData();
        picked().forEach((n) => fd.append('networks', n.key));
        fd.append('samples', g('sf-s1')); fd.append('samples', g('sf-s2'));
        [['senderId', 'sf-sid'], ['purpose', 'sf-purpose'], ['legalName', 'sf-legal'], ['tradingName', 'sf-trade'], ['kraPin', 'sf-kra'], ['signatoryTitle', 'sf-st'], ['signatoryName', 'sf-sn'], ['phone', 'sf-ph'], ['email', 'sf-em']].forEach(([k, i]) => fd.append(k, g(i)));
        fd.append('accepted', $('sf-acc').checked);
        const doc = $('sf-doc').files[0]; if (doc) fd.append('legal', doc);
        const sig = $('sf-sigf').files[0] || ($('sf-sig')._dirty ? await blob($('sf-sig')) : null); if (sig) fd.append('signature', sig, 'signature.png');
        const st = $('sf-stf').files[0] || stamp; if (st) fd.append('stamp', st, 'stamp.png');
        const { data: saved } = app
          ? await Api.upload(`/sms/sender-id/applications/${app._id}`, fd, 'PUT')
          : await Api.upload('/sms/sender-id/applications', fd, 'POST');
        window.UI.toast.success('Application saved');
        if (saved.paymentStatus === 'unpaid' && saved.approvalStatus === 'draft') {
          host.innerHTML = ''; payBox($('sid-pay'), { purpose: 'SENDER_ID', applicationId: saved._id, totalCents: saved.totalCents }); $('sid-pay').scrollIntoView({ behavior: 'smooth' });
        } else await load();
      } catch (err) { toastErr(err); window.UI.setButtonLoading(btn, false); }
    });

    setPurpose($('sf-purpose').value);
    go(1);
  }





  

  /* ------------------------------ compose ------------------------------ */
  function vCompose(b) {
    const d = S.data; const ids = [...new Set(d.senderIds.map((s) => s.senderId))];
    if (!ids.length) { b.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'No approved Sender ID yet', message: 'You can send once a Sender ID is approved.', actionHtml: '<button class="btn btn-primary" id="cp-go">Apply for Sender ID</button>' })}</div>`; $('cp-go').addEventListener('click', () => show('senderid')); return; }
    if (!can.send) { b.innerHTML = '<div class="card"><div class="card-body text-sm text-secondary">You do not have permission to send campaigns.</div></div>'; return; }
    b.innerHTML = `
      <div class="sms-two"><div class="card"><div class="card-body">
        <div class="field"><label for="cp-name">Campaign name</label><input class="input" id="cp-name" placeholder="e.g. Weekend offer" /></div>
        <div class="form-row">
          <div class="field"><label for="cp-sid">Send as</label><select class="select" id="cp-sid">${ids.map((i) => `<option>${esc(i)}</option>`).join('')}</select></div>
          <div class="field"><label for="cp-type">Type</label><select class="select" id="cp-type"><option value="promotional">Promotional</option><option value="transactional">Transactional</option><option value="informational">Informational</option></select></div>
        </div>
        <div class="field"><label for="cp-aud">Who should get it? <span class="text-muted">(CRM segment)</span></label><select class="select" id="cp-aud"><option value="">Choose a segment…</option>${S.segments.map((s) => `<option value="${esc(s.id)}" ${s.id === S.segment ? 'selected' : ''}>${esc(s.name)} (${num(s.memberCount)})</option>`).join('')}</select></div>
        <div class="field"><label for="cp-nums">Extra numbers <span class="text-muted">(optional, comma or new line)</span></label><textarea class="textarea" id="cp-nums" rows="2" placeholder="0712345678, 0722…"></textarea></div>
        <div class="field"><label for="cp-tpl">Template</label><select class="select" id="cp-tpl"><option value="">Start from scratch</option>${S.templates.map((t) => `<option value="${t._id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="cp-msg">Message</label><textarea class="textarea" id="cp-msg" rows="5" placeholder="Hi {firstName|there}, thanks for shopping at {shop}! {offer}"></textarea></div>
        <div style="margin-bottom:var(--space-3)">${d.placeholders.map((p) => `<span class="sms-chip" data-ph="${p.key}" title="${esc(p.label)}">{${p.key}}</span>`).join('')}<div class="bl-muted">Tip: {firstName|there} uses "there" when a name is missing.</div></div>
        <div class="form-row">
          <div class="field"><label for="cp-offer">Offer text <span class="text-muted">(fills {offer})</span></label><input class="input" id="cp-offer" placeholder="e.g. Get 10% off until Sunday!" /></div>
          <div class="field"><label for="cp-when">Schedule <span class="text-muted">(optional)</span></label><input class="input" id="cp-when" type="datetime-local" /></div>
        </div>
        <label class="checkbox-row" id="cp-consent-w" style="margin-bottom:var(--space-3)"><input type="checkbox" id="cp-consent" /> I confirm these customers agreed to receive marketing messages from my business.</label>
        <div class="text-sm" id="cp-q" style="margin-bottom:var(--space-3)"></div>
        <div class="sms-row-actions"><button class="btn btn-secondary" id="cp-quote">Check cost</button><button class="btn btn-primary" id="cp-send">Send / schedule</button><button class="btn btn-secondary" id="cp-save">Save as template</button></div>
      </div></div>
      <div><div class="sms-phone"><div id="cp-prev">Your message preview appears here</div></div><p class="bl-muted" id="cp-count" style="margin-top:8px"></p></div></div>`;
    const msg = $('cp-msg');
    const body = () => ({ name: $('cp-name').value, senderId: $('cp-sid').value, type: $('cp-type').value, segmentId: $('cp-aud').value || undefined, numbers: $('cp-nums').value, message: msg.value, offerText: $('cp-offer').value, scheduledAt: $('cp-when').value ? new Date($('cp-when').value).toISOString() : undefined, consentConfirmed: $('cp-consent').checked });
    const SAMPLE = { name: 'John Kamau', firstName: 'John', phone: '0712345678', shop: 'Your Shop', totalSpent: '12,500', visits: '8', lastPurchase: '3 Oct' };
    const prev = () => {
      const t = msg.value.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (m, k, fb) => (k === 'offer' ? $('cp-offer').value : SAMPLE[k]) || fb || '');
      $('cp-prev').textContent = t || 'Your message preview appears here';
      const uni = /[^\x00-\x7F]/.test(t); const len = [...t].length; const segs = len <= (uni ? 70 : 160) ? 1 : Math.ceil(len / (uni ? 67 : 153));
      $('cp-count').textContent = `${len} characters · ${segs} SMS per customer${uni ? ' (special characters lower the limit)' : ''}`;
    };
    msg.addEventListener('input', prev); $('cp-offer').addEventListener('input', prev);
    b.querySelectorAll('[data-ph]').forEach((c) => c.addEventListener('click', () => { const p = msg.selectionStart || msg.value.length; msg.value = `${msg.value.slice(0, p)}{${c.dataset.ph}}${msg.value.slice(msg.selectionEnd || p)}`; msg.focus(); prev(); }));
    $('cp-tpl').addEventListener('change', (e) => { const t = S.templates.find((x) => x._id === e.target.value); if (t) { msg.value = t.body; prev(); } });
    $('cp-type').addEventListener('change', () => { $('cp-consent-w').style.display = $('cp-type').value === 'promotional' ? '' : 'none'; });
    $('cp-quote').addEventListener('click', async () => {
      try { const { data: q } = await Api.post('/sms/campaigns/quote', body()); $('cp-q').innerHTML = `<b>${num(q.recipients)}</b> recipients · <b>${num(q.credits)}</b> credits needed · balance ${num(q.balance)} ${q.enough ? '' : '<span style="color:var(--color-danger)">- not enough, buy more credits</span>'}<br/>First message: <i>${esc(q.sample)}</i>`; } catch (err) { toastErr(err); }
    });
    $('cp-send').addEventListener('click', async (ev) => {
      window.UI.setButtonLoading(ev.currentTarget, true, 'Sending…');
      try { const { data: c } = await Api.post('/sms/campaigns', body()); window.UI.toast.success(c.status === 'scheduled' ? 'Campaign scheduled' : 'Campaign queued for sending'); S.tab = 'history'; await load(); }
      catch (err) { toastErr(err); window.UI.setButtonLoading($('cp-send'), false); }
    });
    $('cp-save').addEventListener('click', async () => {
      const name = window.prompt('Template name?'); if (!name || !msg.value.trim()) return;
      try { await Api.post('/sms/templates', { name, body: msg.value }); const r = await Api.get('/sms/templates'); S.templates = r.data || []; window.UI.toast.success('Template saved'); vCompose(b); } catch (err) { toastErr(err); }
    });
  }

  /* ------------------------------ history ------------------------------ */
  function vHistory(b) {
    b.innerHTML = `<div class="card"><div class="table-wrap flat"><table class="table"><thead><tr><th>Campaign</th><th>Sender</th><th class="num">Recipients</th><th class="num">Credits</th><th>Status</th><th></th></tr></thead><tbody>
      ${S.data.campaigns.map((c) => `<tr>
        <td class="cell-primary">${esc(c.name)}<div class="bl-muted">${when(c.createdAt)}${c.scheduledAt ? ` · scheduled ${when(c.scheduledAt)}` : ''}</div></td>
        <td>${esc(c.senderId)}</td><td class="num">${num(c.recipients)}</td>
        <td class="num">${num(c.credits)}${c.refundedCredits ? `<div class="bl-muted">${num(c.refundedCredits)} refunded</div>` : ''}</td><td>${badge(c.status)}</td>
        <td><div class="sms-row-actions"><button class="btn btn-secondary btn-sm" data-v="${c._id}">View</button>${can.send && ['scheduled', 'queued', 'sending'].includes(c.status) ? `<button class="btn btn-ghost btn-sm" data-x="${c._id}">Cancel</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="6" class="text-muted">No campaigns yet.</td></tr>'}
      </tbody></table></div></div>`;
    b.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', async () => {
      const ok = await window.UI.confirmDialog({ title: 'Cancel this campaign?', message: 'Messages not yet sent are cancelled and their credits are refunded.', confirmText: 'Cancel campaign', danger: true });
      if (!ok) return;
      try { await Api.post(`/sms/campaigns/${x.dataset.x}/cancel`, {}); await load(); } catch (err) { toastErr(err); }
    }));
    b.querySelectorAll('[data-v]').forEach((x) => x.addEventListener('click', async () => {
      try {
        const { data: r } = await Api.get(`/sms/campaigns/${x.dataset.v}`);
        const modal = window.UI.openModal({
          title: r.campaign.name, maxWidth: '820px',
          bodyHtml: `<p>${Object.entries(r.stats).map(([k, v]) => `${badge(k)} ${num(v)}`).join(' &nbsp; ') || 'No messages'}</p>
            <div class="table-wrap flat"><table class="table"><thead><tr><th>To</th><th>Message</th><th>Status</th></tr></thead><tbody>
            ${r.messages.map((m) => `<tr><td class="text-sm">${esc(m.name || '')}<div class="bl-muted">${esc(m.phone)}</div></td><td class="text-sm">${esc(m.text)}</td><td>${badge(m.status)}${m.error ? `<div class="bl-muted">${esc(m.error)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
            ${r.messages.length >= 200 ? '<p class="bl-muted">Showing the first 200 messages.</p>' : ''}`,
          footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button>',
        });
        modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
      } catch (err) { toastErr(err); }
    }));
  }
})();