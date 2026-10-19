/**
 * hx-pay.js - ONE payment experience for restaurant bills and accommodation folios.
 *   HX.pay.open({kind:'bill'|'stay', id, title, reference, due, phone, customerName, depositChoice, collect, onPaid, onClose})
 *   HX.bill.open(id, opts) / HX.bill.forOrder(orderId, {pay})   bill preview modal, bill & pay
 *   HX.receipt.show(doc) / HX.billDoc / HX.stayDoc              printable receipt (auto-printed unless switched off)
 *   HX.verify.render(el) / HX.verify.open()                     manager verification of mobile-money payments
 */
(function (window) {
  'use strict';
  const HX = window.HX; if (!HX) return;
  const { E, M, can, get, list, unwrap, dt } = HX;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const toast = () => window.UI.toast;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const modal = HX.modal;
  const FALLBACK_NETWORKS = [{ code: 'SAFARICOM', label: 'Safaricom M-PESA' }, { code: 'AIRTEL', label: 'Airtel Money' }, { code: 'OTHER', label: 'Other' }];
  const ctxCache = {};
  async function payCtx(mod, fresh) {
    const k = mod + HX.branchId();
    if (!fresh && ctxCache[k] && Date.now() - ctxCache[k].t < 20000) return ctxCache[k].d;
    const d = await get(`/${mod}/pay-context`, { branchId: HX.branchId() });
    const out = d && d.flags ? d : { unknown: true, flags: {}, requireShift: false, shift: null, registers: [], networks: FALLBACK_NETWORKS, business: {}, currency: 'KES' };
    ctxCache[k] = { t: Date.now(), d: out }; return out;
  }
  const EP = {
    bill: (id) => ({ mod: 'restaurant', pay: `/restaurant/bills/${id}/pay`, stk: `/restaurant/bills/${id}/mpesa/stk`, manual: `/restaurant/bills/${id}/mpesa/manual`, shift: '/restaurant/shift/open', status: (r) => `/restaurant/mpesa/${r}/status`, claim: (r) => `/restaurant/mpesa/${r}/claim`, cancel: (r) => `/restaurant/mpesa/${r}/cancel` }),
    stay: (id) => ({ mod: 'accommodation', pay: `/accommodation/stays/${id}/payments`, stk: `/accommodation/stays/${id}/mpesa/stk`, manual: `/accommodation/stays/${id}/mpesa/manual`, shift: '/accommodation/shift/open', status: (r) => `/accommodation/mpesa/${r}/status`, claim: (r) => `/accommodation/mpesa/${r}/claim`, cancel: (r) => `/accommodation/mpesa/${r}/cancel` }),
  };
  const METHOD_META = { CASH: { label: 'Cash', hint: 'With change' }, MPESA_STK: { label: 'M-PESA', hint: 'STK push' }, MPESA_TILL: { label: 'M-PESA Till', hint: 'Customer pays till' }, MOBILE_MONEY: { label: 'Mobile money', hint: 'Network + code' }, CARD: { label: 'Card', hint: 'Card machine' }, BANK: { label: 'Bank', hint: 'Transfer / cheque' } };

  /* ---- printable paper ---- */
  const PAPER_KEY = 'hx.paper', AUTO_KEY = 'hx.autoPrint';
  const paperSize = () => { try { return localStorage.getItem(PAPER_KEY) || '80mm'; } catch (e) { return '80mm'; } };
  const autoPrint = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { return true; } };
  function paperHtml(d) {
    const row = (a, b, strong) => `<div class="r${strong ? ' s' : ''}"><span>${a}</span><span>${b}</span></div>`;
    const bz = d.business || {};
    return `<div class="hx-paper-doc"><div class="hd">${bz.name ? `<b class="nm">${E(bz.name)}</b>` : ''}${bz.address ? `<div>${E(bz.address)}</div>` : ''}${bz.phone ? `<div>Tel ${E(bz.phone)}</div>` : ''}${bz.pin ? `<div>PIN ${E(bz.pin)}</div>` : ''}</div>
      <div class="ttl">${E(d.title)}</div>
      ${d.highlight ? `<div class="hl" style="text-align:center;border:2px solid #000;border-radius:6px;padding:6px 4px;margin:6px 0"><div>${E(d.highlight.label)}</div><b style="display:block;font-size:${d.big ? '1.6' : '2.3'}em;letter-spacing:${d.big ? '.05' : '.35'}em">${E(d.highlight.value)}</b>${d.highlight.note ? `<small style="display:block">${E(d.highlight.note)}</small>` : ''}</div>` : ''}
      <div class="meta">${(d.meta || []).filter((m) => m[1] !== '' && m[1] != null).map((m) => row(E(m[0]), E(m[1]))).join('')}</div>
      <div class="ln">${(d.lines || []).map((l) => `<div class="it"><span class="q">${E(l.qty)}</span><span class="n">${E(l.name)}${l.sub ? `<small>${E(l.sub)}</small>` : ''}</span><span class="a">${M(l.total)}</span></div>`).join('') || '<div class="it"><span class="n">No items</span></div>'}</div>
      <div class="tt">${(d.totals || []).map((t) => row(E(t[0]), E(t[1]), t[2] === true)).join('')}</div>
      ${(d.payments || []).length ? `<div class="py"><div class="h">Payments</div>${d.payments.map((p) => `<div class="p">${row(E(p.label), E(p.value))}${p.sub ? `<small>${E(p.sub)}</small>` : ''}</div>`).join('')}</div>` : ''}
      <div class="ft">${E(d.footer || 'Thank you. Karibu tena!')}</div></div>`;
  }
  const PRINT_CSS = (w) => `@page{size:${w === 'a4' ? 'A4' : w + ' auto'};margin:${w === 'a4' ? '14mm' : '3mm'}}*{box-sizing:border-box}body{margin:0;font:${w === '58mm' ? '11px' : '12.5px'}/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000;width:${w === 'a4' ? '100%' : w}}
  .hx-paper-doc{width:100%}.hd{text-align:center;margin-bottom:6px}.hd .nm{font-size:1.25em;display:block}.ttl{text-align:center;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:3px 0;margin:6px 0}
  .r{display:flex;justify-content:space-between;gap:8px}.r.s{font-weight:700;font-size:1.1em;border-top:1px solid #000;margin-top:3px;padding-top:3px}.meta{margin-bottom:6px}.ln{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:4px 0;margin-bottom:4px}
  .it{display:grid;grid-template-columns:auto 1fr auto;gap:6px;padding:1px 0}.it small{display:block;font-size:.85em;opacity:.75}.it .a{text-align:right}.py{margin-top:6px;border-top:1px dashed #000;padding-top:4px}.py .h{font-weight:700}.py small{display:block;opacity:.75;font-size:.85em}
  .ft{text-align:center;margin-top:10px;border-top:1px dashed #000;padding-top:6px}`;
  function printHtml(inner) {
    const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f); const d = f.contentWindow.document; d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title><style>${PRINT_CSS(paperSize())}</style></head><body>${inner}</body></html>`); d.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast().error('Could not open the print dialog'); } setTimeout(() => f.remove(), 4000); }, 300);
  }
  const payMethodText = (p) => `${HX.payLabel(p.method)}${p.network ? ' · ' + String(p.network).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : ''}${p.kind === 'REFUND' ? ' (refund)' : p.kind === 'DEPOSIT' ? ' (deposit)' : ''}`;
  const paySub = (p) => [p.reference ? 'Ref ' + p.reference : '', p.method === 'CASH' && p.tendered ? `Given ${M(p.tendered)} · Change ${M(p.change || 0)}` : '', p.verifyStatus === 'PENDING' ? 'Awaiting manager check' : p.verifyStatus === 'REJECTED' ? 'Not verified' : ''].filter(Boolean).join(' · ');
  function billDoc(b, ctx, sale) {
    const due = b.balance != null ? b.balance : Math.max(0, (b.total || 0) - (b.paid || 0)); const paid = b.status === 'PAID';
    return { business: ctx && ctx.business, title: paid ? 'Receipt' : b.status === 'PARTIAL' ? 'Bill (part paid)' : b.status === 'VOID' ? 'Void bill' : 'Bill',
      meta: [['Bill', b.billNumber], ['Receipt', sale && sale.receiptNumber], [b.tableName ? 'Table' : 'Order', b.tableName || b.orderNumber], ['Served by', b.waiterName], ['Date', dt(b.createdAt)], ['Guests', b.guestCount || '']],
      lines: (b.lines || []).map((l) => ({ qty: l.quantity, name: `${l.name}${l.variantName ? ' · ' + l.variantName : ''}`, sub: [l.modifiersText, l.isComp ? 'Complimentary' : ''].filter(Boolean).join(' · '), total: l.total })),
      totals: [['Items', M(b.itemsTotal)], b.discount ? ['Discount', '−' + M(b.discount)] : null, b.serviceCharge ? ['Service charge' + (b.scWaived ? ' (waived)' : ''), M(b.serviceCharge)] : null, b.tax ? ['VAT included', M(b.tax)] : null, ['TOTAL', M(b.total), true], b.paid ? ['Paid', M(b.paid)] : null, !paid && b.status !== 'VOID' ? ['Balance due', M(due), true] : null].filter(Boolean),
      payments: (b.payments || []).map((p) => ({ label: payMethodText(p), value: (p.kind === 'REFUND' ? '−' : '') + M(p.amount), sub: paySub(p) })),
      footer: paid ? 'Thank you for dining with us!' : 'Please pay at the till or to your waiter.' };
  }
  function stayDoc(s, ctx) {
    const t = s.totals || {}, g = s.guest || {};
    return { business: ctx && ctx.business, title: s.status === 'CHECKED_OUT' ? 'Guest receipt' : 'Folio statement',
      meta: [['Guest', g.name], ['Room', s.roomNumber ? `${s.roomNumber}${s.roomTypeName ? ' · ' + s.roomTypeName : ''}` : ''], ['Stay', s.stayNumber || s.bookingCode], ['Dates', `${s.checkInDate} → ${s.checkOutDate}`], ['Printed', dt(new Date())]],
      lines: (s.folio || []).filter((l) => !l.voided).map((l) => ({ qty: l.quantity || 1, name: l.description, sub: l.nightDate || '', total: l.total })),
      totals: [['Charges', M(t.charges != null ? t.charges : t.total)], t.tax ? ['VAT included', M(t.tax)] : null, ['Paid', M(t.paid)], t.waived ? ['Written off', M(t.waived)] : null, ['BALANCE', M(t.balance), true]].filter(Boolean),
      payments: (s.payments || []).map((p) => ({ label: payMethodText(p), value: (p.kind === 'REFUND' ? '−' : '') + M(p.amount), sub: paySub(p) })), footer: 'Thank you for staying with us!' };
  }
  /** Booking confirmation / guest card: the folio plus the room PIN the guest types after scanning the QR code in the room. */
  function guestCardDoc(s, pin, ctx) {
    const d = stayDoc(s, ctx); const t = s.totals || {};
    return Object.assign(d, { title: 'Booking confirmation', meta: d.meta.concat([['Booking code', s.bookingCode]]),
      highlight: pin ? { label: 'YOUR ROOM PIN', value: pin, note: 'Scan the QR code in your room and enter this PIN' } : null,
      totals: [['Charges', M(t.charges != null ? t.charges : t.total)], ['Paid', M(t.paid)], ['BALANCE', M(t.balance), true]],
      footer: 'Scan the QR code in your room to order food and drinks, track your order, pay with M-PESA and request services. Keep this PIN private.' });
  }
  HX.billDoc = billDoc; HX.stayDoc = stayDoc; HX.guestCardDoc = guestCardDoc;
  const receipt = {
    print: (doc) => printHtml(paperHtml(doc)),
    show(doc, { title = 'Receipt', auto = true } = {}) {
      const m = modal({ title, maxWidth: '420px', cls: 'hx-modal-paper', body: `<div class="hx-paper">${paperHtml(doc)}</div>`,
        footer: `<label class="hx-check" style="margin-right:auto"><input type="checkbox" id="rc-auto" ${autoPrint() ? 'checked' : ''}> <span>Print automatically</span></label><select class="select" id="rc-size" style="width:auto"><option value="80mm">80 mm slip</option><option value="58mm">58 mm slip</option><option value="a4">A4</option></select><button class="btn btn-secondary" data-x>Close</button><button class="btn btn-primary" id="rc-print">Print</button>`,
        onMount(el, close) {
          const size = el.querySelector('#rc-size'); size.value = paperSize();
          size.addEventListener('change', () => { try { localStorage.setItem(PAPER_KEY, size.value); } catch (e) {} });
          el.querySelector('#rc-auto').addEventListener('change', (e) => { try { localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0'); } catch (x) {} });
          el.querySelector('[data-x]').addEventListener('click', close);
          el.querySelector('#rc-print').addEventListener('click', () => printHtml(paperHtml(doc)));
        } });
      if (auto && autoPrint()) printHtml(paperHtml(doc));
      return m;
    },
  };
  HX.receipt = receipt;

  /* ---- the payment dialog ---- */
  async function openPay(o) {
    const ep = (o.kind === 'stay' ? EP.stay : EP.bill)(o.id);
    const ctx = await payCtx(ep.mod, true);
    const S = { method: 'CASH', due: round2(num(o.due)), payKind: 'PAYMENT', busy: false, alive: true, key: window.Api.newIdempotencyKey(), paidSoFar: 0, amount: 0 };
    const methods = () => { const f = ctx.flags || {}, a = ['CASH']; if (f.mpesaStk) a.push('MPESA_STK'); if (f.mpesaTill) a.push('MPESA_TILL'); a.push('MOBILE_MONEY', 'CARD', 'BANK'); return a; };
    const needsShift = () => ctx.requireShift && !ctx.shift;
    const shiftHtml = () => (S.method !== 'CASH' ? '' : ctx.shift
      ? `<div class="hx-shiftbar ok"><span>Cash shift open${ctx.shift.registerId && ctx.shift.registerId.name ? ' · ' + E(ctx.shift.registerId.name) : ''}</span></div>`
      : needsShift() ? `<div class="hx-shiftbar warn"><div><b>Open your cash shift to take cash</b><small>Count the float in your drawer and start the shift.</small></div><div class="hx-shiftform">${ctx.registers.length ? `<select class="select" id="sh-reg">${ctx.registers.map((r) => `<option value="${r._id}">${E(r.name)}${r.code ? ' (' + E(r.code) + ')' : ''}</option>`).join('')}</select><input class="input" id="sh-cash" type="number" min="0" step="0.01" placeholder="Opening cash" value="0"><button type="button" class="btn btn-primary" id="sh-open">Open shift</button>` : '<small>No cash register is set up for this branch. Ask the manager to add one (Cash register page).</small>'}</div></div>` : '');
    const panelHtml = () => {
      const m = S.method, f = ctx.flags || {};
      if (m === 'CASH') return `<div class="field"><label>Cash received</label><input class="input hx-big" id="tn" type="number" step="0.01" min="0" inputmode="decimal" value="${S.amount}"></div><div class="hx-quick" id="quick"></div><div class="hx-change" id="chg"></div>`;
      if (m === 'MPESA_STK') return `<div class="field"><label>Customer's M-PESA phone</label><input class="input hx-big" id="phone" type="tel" inputmode="tel" placeholder="07XX XXX XXX" value="${E(o.phone || '')}"></div><button type="button" class="btn btn-primary btn-block" id="stk-go">Send STK push for <span class="am"></span></button><div class="hx-wait" id="wait" hidden></div>`;
      if (m === 'MPESA_TILL') return `<div class="hx-till"><small>Customer pays to Till number</small><b>${E(f.tillNumber || '')}</b><small>Amount <span class="am"></span></small></div><button type="button" class="btn btn-primary btn-block" id="till-go">Wait for the customer's payment</button><div class="hx-wait" id="wait" hidden></div>`;
      if (m === 'MOBILE_MONEY') return `<div class="hx-form"><div class="two"><div class="field"><label>Network</label><select class="select" id="net">${(ctx.networks || FALLBACK_NETWORKS).map((n) => `<option value="${E(n.code)}">${E(n.label)}</option>`).join('')}</select></div><div class="field"><label>Customer phone <small class="hx-sub">(optional)</small></label><input class="input" id="mm-phone" type="tel" value="${E(o.phone || '')}"></div></div><div class="field"><label>Message code</label><input class="input hx-big hx-mono" id="ref" autocapitalize="characters" autocomplete="off" placeholder="e.g. QGH7K2L9PX"><small class="hx-sub">Confirm the money message on the customer's phone first, then type the code. The manager or owner verifies it later.</small></div></div>`;
      return `<div class="field"><label>Reference <small class="hx-sub">(optional)</small></label><input class="input" id="ref" placeholder="${m === 'CARD' ? 'Approval / slip number' : 'Transfer or cheque number'}"></div>`;
    };
    const body = () => `<div class="hx-due"><small>${E(o.reference || 'Amount due')}</small><b id="due">${M(S.due)}</b></div>
      ${o.depositChoice ? '<div class="hx-seg2" id="kinds"><button type="button" data-k="PAYMENT" class="on">Payment</button><button type="button" data-k="DEPOSIT">Deposit</button></div>' : ''}
      <div class="hx-methods">${methods().map((x) => `<button type="button" class="hx-method${x === S.method ? ' on' : ''}" data-m="${x}"><b>${METHOD_META[x].label}</b><small>${METHOD_META[x].hint}</small></button>`).join('')}</div>
      ${!(ctx.flags && (ctx.flags.mpesaStk || ctx.flags.mpesaTill)) && window.Permissions.can(HX.user(), 'settings.update') ? '<p class="hx-sub hx-hintline">Tip: switch on M-PESA STK push or a Till under <a href="settings.html">Settings → Integrations</a> and it appears here.</p>' : ''}
      <div id="shift"></div><div class="hx-form"><div class="field"><label>Amount to pay now</label><input class="input hx-big" id="amt" type="number" step="0.01" min="0" inputmode="decimal" value="${S.due}"></div><div id="panel"></div></div>`;
    return modal({ title: o.title || 'Take payment', maxWidth: '500px', cls: 'hx-modal-pay', body: body(), footer: '<button class="btn btn-secondary" data-c>Cancel</button><button class="btn btn-primary" id="go">Confirm payment</button>', onMount: mount });

    function mount(el, close) {
      const $ = (s) => el.querySelector(s); S.amount = S.due;
      const observer = new MutationObserver(() => { if (!document.body.contains(el)) { S.alive = false; observer.disconnect(); if (o.onClose) o.onClose(); } });
      observer.observe(document.body, { childList: true });
      $('[data-c]').addEventListener('click', close);
      const amt = () => round2(num($('#amt').value));
      const refreshAm = () => el.querySelectorAll('.am').forEach((x) => { x.textContent = M(amt()); });
      const sync = () => {
        el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x.dataset.m === S.method));
        $('#shift').innerHTML = shiftHtml(); bindShift(); $('#panel').innerHTML = panelHtml(); bindPanel(); refreshAm();
        const go = $('#go'); go.hidden = S.method === 'MPESA_STK' || S.method === 'MPESA_TILL'; go.disabled = S.method === 'CASH' && needsShift();
      };
      function bindShift() {
        const b = $('#sh-open'); if (!b) return;
        b.addEventListener('click', async () => {
          window.UI.setButtonLoading(b, true, 'Opening…');
          try { await window.Api.post(ep.shift, { branchId: HX.branchId(), registerId: $('#sh-reg').value, openingCash: num($('#sh-cash').value) }); toast().success('Cash shift opened'); Object.assign(ctx, await payCtx(ep.mod, true)); sync(); }
          catch (e) { window.UI.setButtonLoading(b, false); toast().error((e && e.message) || 'Could not open the shift'); }
        });
      }
      function chg() {
        const t = $('#tn'), c = $('#chg'); if (!t || !c) return;
        const given = round2(num(t.value)), a = amt(), change = round2(given - a);
        c.innerHTML = given >= a && a > 0 ? `<small>Change to give</small><b>${M(change)}</b>` : given > 0 ? `<small class="bad">Short by ${M(round2(a - given))}</small>` : '';
        c.classList.toggle('on', given >= a && a > 0);
      }
      function bindPanel() {
        const quick = $('#quick');
        if (quick) {
          const a = amt(), set = [a, Math.ceil(a / 50) * 50, Math.ceil(a / 100) * 100, Math.ceil(a / 500) * 500, Math.ceil(a / 1000) * 1000].filter((v, i, arr) => v >= a && v > 0 && arr.indexOf(v) === i).slice(0, 5);
          quick.innerHTML = set.map((v) => `<button type="button" class="btn btn-sm btn-secondary" data-q="${v}">${v === a ? 'Exact ' : ''}${M(v)}</button>`).join('');
          quick.querySelectorAll('[data-q]').forEach((x) => x.addEventListener('click', () => { $('#tn').value = x.dataset.q; chg(); }));
          $('#tn').addEventListener('input', chg); chg();
        }
        const stk = $('#stk-go'); if (stk) stk.addEventListener('click', () => startPush('STK'));
        const till = $('#till-go'); if (till) till.addEventListener('click', () => startPush('MANUAL'));
        const r = $('#ref'); if (r && S.method === 'MOBILE_MONEY') r.addEventListener('input', () => { r.value = r.value.toUpperCase().replace(/\s+/g, ''); });
      }
      $('#amt').addEventListener('input', () => { S.amount = amt(); if (S.method === 'CASH') { const t = $('#tn'); if (t && num(t.value) < S.amount) t.value = S.amount; bindPanel(); } refreshAm(); });
      el.querySelectorAll('[data-m]').forEach((x) => x.addEventListener('click', () => { if (S.busy) return; S.method = x.dataset.m; sync(); }));
      el.querySelectorAll('#kinds [data-k]').forEach((x) => x.addEventListener('click', () => { S.payKind = x.dataset.k; el.querySelectorAll('#kinds [data-k]').forEach((y) => y.classList.toggle('on', y === x)); }));
      async function record(p, btn) {
        S.busy = true; if (btn) window.UI.setButtonLoading(btn, true, 'Processing…');
        try {
          let result;
          if (o.collect) { result = await o.collect(p, S.payKind); if (!result) { S.busy = false; if (btn) window.UI.setButtonLoading(btn, false); return false; } }
          else { const { data } = await window.Api.post(ep.pay, o.kind === 'stay' ? { kind: S.payKind, ...p } : { payments: [p] }, { idempotencyKey: S.key }); result = data || {}; }
          S.key = window.Api.newIdempotencyKey(); S.busy = false;
          const left = o.kind === 'stay' ? num(result.stay && result.stay.totals && result.stay.totals.balance) : num(result.bill && result.bill.balance);
          const partial = !o.collect && left > 0.004 && p.amount < S.due - 0.004 && (o.kind !== 'stay' || S.payKind === 'PAYMENT');
          if (o.onPaid) o.onPaid(result, p, { partial, balance: left });
          if (partial) { S.paidSoFar = round2(S.paidSoFar + p.amount); S.due = round2(left); S.amount = S.due; $('#due').textContent = M(S.due); $('#amt').value = S.due; toast().success(`Part payment recorded. ${M(S.due)} still to pay.`); S.method = 'CASH'; sync(); return true; }
          if (p.method === 'CASH' && p.tendered > p.amount) toast().success(`Payment received. Give change ${M(round2(p.tendered - p.amount))}`); else toast().success(o.collect ? 'Payment taken' : 'Payment received');
          close(); return true;
        } catch (e) {
          S.busy = false; if (btn) window.UI.setButtonLoading(btn, false);
          const code = e && e.code, msg = (e && e.message) || 'Payment failed';
          if (code === 'SHIFT_REQUIRED' || /cash shift|open a shift/i.test(msg)) { ctx.shift = null; ctx.requireShift = true; sync(); toast().warning('Open your cash shift first, then confirm the payment.'); } else toast().error(msg);
          return false;
        }
      }
      $('#go').addEventListener('click', async () => {
        const a = amt(); if (!(a > 0)) return toast().warning('Enter the amount');
        if (o.kind !== 'stay' && a > S.due + 0.004) return toast().warning('That is more than the amount due');
        const p = { method: S.method, amount: a };
        if (S.method === 'CASH') { const t = round2(num($('#tn').value)); if (t < a) return toast().warning('Cash received is less than the amount'); p.tendered = t; }
        else if (S.method === 'MOBILE_MONEY') { const ref = ($('#ref').value || '').trim(); if (ref.length < 4) return toast().warning('Enter the message code from the customer’s phone'); p.reference = ref; p.network = $('#net').value; const ph = ($('#mm-phone').value || '').trim(); if (ph) p.payerPhone = ph; }
        else { const r = ($('#ref').value || '').trim(); if (r) p.reference = r; }
        await record(p, $('#go'));
      });
      let current = null;
      function waitUi(html, tone) { const w = $('#wait'); if (!w) return null; w.hidden = false; w.className = 'hx-wait ' + (tone || ''); w.innerHTML = html; return w; }
      async function startPush(channel) {
        const a = amt(); if (!(a > 0)) return toast().warning('Enter the amount');
        if (o.kind !== 'stay' && a > S.due + 0.004) return toast().warning('That is more than the amount due');
        const btn = $(channel === 'STK' ? '#stk-go' : '#till-go'); let txn;
        try {
          if (channel === 'STK') { const phone = ($('#phone').value || '').trim(); if (phone.replace(/\D/g, '').length < 9) return toast().warning('Enter the customer’s phone number'); window.UI.setButtonLoading(btn, true, 'Sending…'); txn = (await window.Api.post(ep.stk, { phone, amountCents: a, ...(o.customerName ? { customerName: o.customerName } : {}) })).data; }
          else { window.UI.setButtonLoading(btn, true, 'Starting…'); txn = (await window.Api.post(ep.manual, { amountCents: a })).data; }
        } catch (e) { window.UI.setButtonLoading(btn, false); return toast().error((e && e.message) || 'Could not start the M-PESA payment'); }
        const reference = txn && (txn.reference || (txn.txn && txn.txn.reference));
        if (!reference) { window.UI.setButtonLoading(btn, false); return toast().error('M-PESA did not return a reference'); }
        current = { reference, channel }; btn.hidden = true; S.busy = true;
        waitUi(`<div class="hx-spin"></div><div><b>${channel === 'STK' ? 'Waiting for the customer to enter their M-PESA PIN…' : 'Waiting for the customer to pay to the till…'}</b><small>Keep this window open. It confirms automatically.</small></div><button type="button" class="btn btn-sm btn-secondary" id="wait-cancel">Cancel request</button>`);
        $('#wait-cancel').addEventListener('click', cancelPush);
        const done = await poll(reference);
        if (done === 'SUCCESS') {
          waitUi('<div class="hx-ok">✔</div><div><b>M-PESA payment confirmed</b><small>Recording it now…</small></div>', 'ok');
          const ok = await record({ method: 'MPESA', amount: a, reference }, null);
          if (!ok && S.alive) { btn.hidden = false; window.UI.setButtonLoading(btn, false); waitUi('<div><b>Money received but not yet recorded</b><small>Press the button again to retry.</small></div>', 'bad'); }
          else if (S.alive && $('#wait')) { $('#wait').hidden = true; btn.hidden = false; window.UI.setButtonLoading(btn, false); }
        } else if (done && S.alive) { S.busy = false; btn.hidden = false; window.UI.setButtonLoading(btn, false); }
      }
      async function poll(reference) {
        const t0 = Date.now();
        while (S.alive && Date.now() - t0 < 150000) {
          let st = null; try { st = (await window.Api.get(ep.status(reference), undefined, { background: true })).data; } catch (e) { st = null; }
          if (!S.alive) return null;
          if (st) {
            if (st.status === 'SUCCESS') return 'SUCCESS';
            if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(st.status)) { S.busy = false; waitUi(`<div class="hx-bad">✖</div><div><b>Payment not completed</b><small>${E(st.message || 'The customer did not complete the payment.')}</small></div>`, 'bad'); return st.status; }
            if (st.needsCode) { const r = await askCode(reference); if (r === 'SUCCESS') return 'SUCCESS'; }
          }
          await sleep(3000);
        }
        if (S.alive) { S.busy = false; waitUi('<div class="hx-bad">✖</div><div><b>Timed out</b><small>No payment was received. You can try again.</small></div>', 'bad'); }
        return 'TIMEOUT';
      }
      function askCode(reference) {
        return new Promise((resolve) => {
          const w = waitUi(`<div style="flex:1"><b>Enter the customer's M-PESA code</b><small>More than one payment of this amount arrived. Type the code from the customer's message.</small><div class="hx-codeform"><input class="input hx-mono" id="claim" autocapitalize="characters" maxlength="10" placeholder="10-character code"><button type="button" class="btn btn-primary" id="claim-go">Confirm</button></div></div>`);
          w.querySelector('#claim-go').addEventListener('click', async () => {
            const code = (w.querySelector('#claim').value || '').trim().toUpperCase();
            if (!/^[A-Z][A-Z0-9]{9}$/.test(code)) return toast().warning('The code is 10 letters and numbers');
            try { await window.Api.post(ep.claim(reference), { receiptCode: code }); resolve('SUCCESS'); } catch (e) { toast().error((e && e.message) || 'That code did not match'); }
          });
        });
      }
      async function cancelPush() { const c = current; current = null; S.alive = false; try { if (c && c.channel === 'MANUAL') await window.Api.post(ep.cancel(c.reference), {}); } catch (e) {} close(); }
      sync();
    }
  }
  HX.pay = { open: openPay, ctx: payCtx };

  /* ---- bill preview ---- */
  const BILL_TONE = { OPEN: 'warn', PARTIAL: 'busy', PAID: 'ok', VOID: 'mute', WRITTEN_OFF: 'mute' };
  const dueOf = (b) => (b.balance != null ? b.balance : Math.max(0, (b.total || 0) - (b.paid || 0)));
  async function openBill(id, opts = {}) {
    const [d, ctx] = await Promise.all([get('/restaurant/bills/' + id), payCtx('restaurant')]); if (!d) { toast().error('Could not open that bill'); return null; }
    let bill = unwrap(d, 'bill'), sale = d.sale || (d.data && d.data.sale) || null;
    const reload = async () => { const r = await get('/restaurant/bills/' + id); if (r) { bill = unwrap(r, 'bill'); sale = r.sale || (r.data && r.data.sale) || null; } if (opts.onChange) opts.onChange(bill); paint(); };
    let el = null;
    const mm = modal({ title: `Bill ${bill.billNumber}`, maxWidth: '560px', cls: 'hx-modal-bill', body: '<div class="hx-billbody"></div>', footer: '<div class="hx-foot"></div>', onMount: (m) => { el = m; setTimeout(() => { paint(); if (opts.autoPay && payable()) setTimeout(takePayment, 150); }, 0); } });
    function payable() { return (bill.status === 'OPEN' || bill.status === 'PARTIAL') && can('restaurant.bills.pay') && dueOf(bill) > 0; }
    function paint() {
      if (!el || !el.isConnected) return;
      const b = bill, open = b.status === 'OPEN' || b.status === 'PARTIAL';
      const act = (k, label, show) => (show ? `<button type="button" class="btn btn-sm btn-secondary" data-a="${k}">${label}</button>` : '');
      const more = [act('disc', 'Discount', open && can('restaurant.orders.discount')), act('split', 'Split bill', open && can('restaurant.bills.split')), act('sc', b.scWaived ? 'Restore service charge' : 'Waive service charge', open && b.serviceCharge > 0 && can('restaurant.bills.waive_service_charge')), act('tip', 'Add tip', ['PAID', 'PARTIAL', 'OPEN'].includes(b.status) && can('restaurant.bills.pay')), act('refund', 'Refund', b.status === 'PAID' && can('restaurant.bills.refund')), act('void', 'Void bill', open && can('restaurant.bills.generate'))].join('');
      el.querySelector('.hx-billbody').innerHTML = `<div class="hx-paper">${paperHtml(billDoc(b, ctx, sale))}</div><div class="hx-billstat">${HX.pill(b.status, BILL_TONE[b.status])}${open ? `<span>Amount due <b>${M(dueOf(b))}</b></span>` : ''}</div>${more ? `<details class="hx-more"><summary>More actions</summary><div class="hx-morerow">${more}</div></details>` : ''}`;
      el.querySelector('.hx-foot').innerHTML = `<button type="button" class="btn btn-secondary" data-a="close">Close</button><button type="button" class="btn btn-secondary" data-a="print">${open ? 'Print bill' : 'Print receipt'}</button>${payable() ? `<button type="button" class="btn btn-primary" data-a="pay">${b.status === 'PARTIAL' ? 'Pay balance' : 'Take payment'}</button>` : ''}`;
      const H = { close: () => mm && mm.close(), print: () => receipt.print(billDoc(bill, ctx, sale)), pay: () => takePayment(), disc: () => discount(), split: () => split(), sc: () => waive(), tip: () => tip(), refund: () => refund(), void: () => voidIt() };
      el.querySelectorAll('[data-a]').forEach((x) => x.addEventListener('click', () => (H[x.dataset.a] || (() => {}))()));
    }
    function takePayment() {
      openPay({ kind: 'bill', id: bill._id, title: `Pay ${bill.billNumber}`, reference: `${bill.tableName ? 'Table ' + bill.tableName : (bill.orderType || '').replace('_', ' ').toLowerCase()} · ${bill.billNumber}`, due: dueOf(bill), phone: opts.phone,
        onPaid: async (r, p, info) => { await reload(); if (!info.partial && bill.status === 'PAID') receipt.show(billDoc(bill, ctx, sale), { title: 'Payment receipt' }); } });
    }
    const F = HX.formModal;
    const discount = () => F({ title: 'Discount', maxWidth: '400px', fields: [{ name: 'type', label: 'Type', type: 'select', options: [['PERCENT', 'Percent'], ['AMOUNT', 'Amount']] }, { name: 'value', label: 'Value', type: 'number', min: 0, step: '0.01', required: true }, { name: 'reason', label: 'Reason', required: true }], onSubmit: async (v) => { if (await HX.send('post', `/restaurant/bills/${bill._id}/discount`, v)) { reload(); return true; } return false; } });
    const split = () => F({ title: 'Split bill equally', maxWidth: '380px', submitText: 'Split', fields: [{ name: 'ways', label: 'Split between how many people?', type: 'number', value: 2, min: 2, max: 20, required: true }], onSubmit: async (v) => { if (await HX.send('post', `/restaurant/bills/${bill._id}/split`, { mode: 'EQUAL', ways: v.ways })) { toast().success('Bill split into separate bills'); mm.close(); if (opts.onChange) opts.onChange(null); if (opts.orderId) forOrder(opts.orderId, { onChange: opts.onChange }); return true; } return false; } });
    const waive = async () => { if (await HX.send('post', `/restaurant/bills/${bill._id}/service-charge`, { waive: !bill.scWaived })) reload(); };
    const tip = () => F({ title: 'Add a tip', maxWidth: '400px', fields: [{ name: 'amount', label: 'Tip amount', type: 'number', min: 0, step: '0.01', required: true }, { name: 'method', label: 'Paid by', type: 'select', options: ['CASH', 'MPESA', 'CARD', 'MOBILE_MONEY', 'BANK'].map((x) => [x, HX.payLabel(x)]) }, { name: 'reference', label: 'Reference (optional)' }], onSubmit: async (v) => { if (await HX.send('post', `/restaurant/bills/${bill._id}/tips`, v)) { toast().success('Tip recorded'); reload(); return true; } return false; } });
    const refund = () => F({ title: 'Refund', maxWidth: '400px', fields: [{ name: 'amount', label: 'Amount', type: 'number', value: bill.paid, step: '0.01', required: true }, { name: 'method', label: 'Refund by', type: 'select', options: ['CASH', 'MPESA', 'CARD', 'BANK'].map((x) => [x, HX.payLabel(x)]) }, { name: 'reason', label: 'Reason', required: true }], onSubmit: async (v) => { if (await HX.send('post', `/restaurant/bills/${bill._id}/refund`, v)) { reload(); return true; } return false; } });
    const voidIt = async () => { const r = await HX.ask('Void this bill', 'Reason'); if (r && await HX.send('post', `/restaurant/bills/${bill._id}/void`, { reason: r })) reload(); };
    return { close: () => mm.close(), reload };
  }
  async function forOrder(orderId, opts = {}) {
    try { await window.Api.post(`/restaurant/orders/${orderId}/bills`, {}); } catch (e) { /* use existing bills */ }
    const l = await get('/restaurant/bills', { orderId, limit: 20 }); const bills = list(l, 'bills').filter((b) => b.status === 'OPEN' || b.status === 'PARTIAL');
    if (!bills.length) { toast().error('Nothing to bill yet. Send some items to the kitchen first.'); return null; }
    if (bills.length === 1) return openBill(bills[0]._id, { ...opts, orderId, autoPay: !!opts.pay });
    return modal({ title: 'Choose a bill', maxWidth: '440px', body: `<div class="hx-card flush">${bills.map((b) => `<button type="button" class="hx-row hx-pickrow" data-b="${b._id}"><div class="grow"><b>${E(b.billNumber)}${b.label ? ' · ' + E(b.label) : ''}</b></div><span class="hx-money">${M(dueOf(b))}</span></button>`).join('')}</div>`,
      onMount(el, close) { el.querySelectorAll('[data-b]').forEach((x) => x.addEventListener('click', () => { close(); openBill(x.dataset.b, { ...opts, orderId, autoPay: !!opts.pay }); })); } });
  }
  HX.bill = { open: openBill, forOrder };

  /* ---- manager verification ---- */
  const verify = {
    async load() {
      const jobs = [];
      if (can('restaurant.payments.verify') && HX.feature('restaurantOrdering')) jobs.push(get('/restaurant/payments/unverified', { branchId: HX.branchId() }));
      if (can('accommodation.folio.verify') && HX.feature('accommodation')) jobs.push(get('/accommodation/payments/unverified', { branchId: HX.branchId() }));
      const out = []; (await Promise.all(jobs)).forEach((d) => out.push(...list(d, 'payments')));
      return out.sort((a, b) => new Date(b.at) - new Date(a.at));
    },
    async render(box, onChange) {
      box.innerHTML = window.HX.skel('rows');
      const rows = await verify.load();
      box.innerHTML = rows.length ? `<div class="hx-card flush">${rows.map((r, i) => `<div class="hx-row hx-verifyrow"><div class="grow"><b>${E(r.number)} · ${E(r.label)}</b><small class="hx-sub">${E(String(r.network || 'Mobile money').replace(/_/g, ' '))} · code <span class="hx-mono">${E(r.reference || '')}</span>${r.payerPhone ? ' · ' + E(r.payerPhone) : ''} · ${dt(r.at)}</small></div><span class="hx-money">${M(r.amount)}</span><button class="btn btn-sm btn-primary" data-ok="${i}">Verified</button><button class="btn btn-sm btn-secondary" data-no="${i}">Not found</button></div>`).join('')}</div>` : HX.empty('Nothing to verify', 'Mobile-money payments recorded by staff appear here for you to check against your phone or statement.');
      const call = async (r, approve, note) => {
        const path = r.kind === 'BILL' ? `/restaurant/bills/${r.docId}/payments/${r.entryId}/verify` : `/accommodation/stays/${r.docId}/payments/${r.entryId}/verify`;
        if (await HX.send('post', path, { approve, ...(note ? { note } : {}) })) { toast().success(approve ? 'Marked as verified' : 'Flagged and the floor lead was told'); verify.render(box, onChange); if (onChange) onChange(); }
      };
      box.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => call(rows[+b.dataset.ok], true)));
      box.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', async () => { const n = await HX.ask('Payment not found', 'What did you find? (e.g. code not in the statement)'); if (n) call(rows[+b.dataset.no], false, n); }));
    },
    open() { modal({ title: 'Verify mobile-money payments', maxWidth: '720px', body: '<div id="vbox"></div>', onMount: (el) => verify.render(el.querySelector('#vbox')) }); },
  };
  HX.verify = verify;
})(window);