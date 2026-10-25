/**
 * hx-autoprint.js - turns a staff screen into a printer station.
 * Guest (QR) orders and paid receipts are queued by the server (PrintJob). A device set to "Kitchen", "Bar" and/or "Cashier" here
 * collects the jobs for its branch every few seconds, prints each on the browser's default printer and confirms it.
 * The choice is remembered on THIS device only. For printing without a dialog, run Chrome with --kiosk-printing on the printer PC.
 */
(function (window) {
  'use strict';
  const KEY = 'hx.printStation';
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  const set = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  let timer = null, busy = false;

  function paper(d) {
    const row = (a, b, s) => `<div class="r${s ? ' s' : ''}"><span>${E(a)}</span><span>${E(b)}</span></div>`;
    const bz = d.business || {};
    return `<div class="doc${d.big ? ' big' : ''}">${bz.name ? `<div class="hd"><b>${E(bz.name)}</b>${bz.address ? `<div>${E(bz.address)}</div>` : ''}${bz.phone ? `<div>Tel ${E(bz.phone)}</div>` : ''}${bz.pin ? `<div>PIN ${E(bz.pin)}</div>` : ''}</div>` : ''}
      <div class="ttl">${E(d.title)}</div>
      ${d.highlight ? `<div class="hl"><div>${E(d.highlight.label)}</div><b>${E(d.highlight.value)}</b></div>` : ''}
      <div class="meta">${(d.meta || []).filter((m) => m[1] !== '' && m[1] != null && m[1] !== false).map((m) => row(m[0], m[1])).join('')}</div>
      <div class="ln">${(d.lines || []).map((l) => `<div class="it"><span class="q">${E(l.qty != null ? l.qty : l.quantity)}x</span><span class="n">${E(l.name)}${l.sub ? `<small>${E(l.sub)}</small>` : ''}</span>${l.total != null ? `<span class="a">${E(Number(l.total).toLocaleString('en-KE', { minimumFractionDigits: 2 }))}</span>` : ''}</div>`).join('')}</div>
      ${(d.totals || []).length ? `<div class="tt">${d.totals.map((t) => row(t[0], t[1], t[2] === true)).join('')}</div>` : ''}
      ${(d.payments || []).length ? `<div class="py">${d.payments.map((p) => row(p.label, p.value) + (p.sub ? `<small>${E(p.sub)}</small>` : '')).join('')}</div>` : ''}
      ${d.footer ? `<div class="ft">${E(d.footer)}</div>` : ''}</div>`;
  }
  const CSS = '@page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{margin:0;font:12.5px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000;width:74mm}.hd{text-align:center;margin-bottom:6px}.hd b{font-size:1.25em;display:block}.ttl{text-align:center;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:3px 0;margin:6px 0}.hl{text-align:center;border:2px solid #000;padding:4px;margin:6px 0}.hl b{display:block;font-size:1.8em}.r{display:flex;justify-content:space-between;gap:8px}.r.s{font-weight:700;border-top:1px solid #000;margin-top:3px;padding-top:3px}.meta{margin-bottom:6px}.ln{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:4px 0;margin-bottom:4px}.it{display:grid;grid-template-columns:auto 1fr auto;gap:6px;padding:2px 0}.it small{display:block;font-size:.85em}.it .a{text-align:right}.big .it{font-size:1.25em;font-weight:700}.big .it small{font-weight:400}.ft{text-align:center;margin-top:8px;border-top:1px dashed #000;padding-top:6px;font-weight:700}.py{margin-top:6px}';
  function print(html) {
    return new Promise((resolve) => {
      const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(f); const d = f.contentWindow.document; d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title><style>${CSS}</style></head><body>${html}</body></html>`); d.close();
      setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* ignore */ } setTimeout(() => { f.remove(); resolve(); }, 2500); }, 300);
    });
  }
  async function tick() {
    const targets = get(); if (!targets.length || busy || document.hidden === undefined) return;
    const A = window.AppShell, Api = window.Api; if (!A || !Api || !A.getActiveBranchId) return;
    busy = true;
    try {
      const { data } = await Api.get('/restaurant/print-jobs', { targets: targets.join(','), branchId: A.getActiveBranchId(), limit: 5 }, { background: true });
      const jobs = (data && data.jobs) || [];
      for (const j of jobs) { await print(paper(j.doc || {})); await Api.post(`/restaurant/print-jobs/${j._id}/done`, {}, { background: true }); }
    } catch (e) { /* offline or no permission: try again next round */ }
    busy = false;
  }
  function start() { clearInterval(timer); if (get().length) { tick(); timer = setInterval(tick, 6000); } paintChip(); }
  function paintChip() {
    let c = document.getElementById('hx-ap'); const on = get();
    if (!c) { c = document.createElement('button'); c.id = 'hx-ap'; c.type = 'button'; c.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:900;display:flex;gap:8px;align-items:center;padding:8px 14px;border-radius:99px;border:1px solid rgba(0,0,0,.12);background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.15);font:600 13px system-ui,sans-serif;cursor:pointer;color:#10201d'; c.addEventListener('click', dialog); document.body.appendChild(c); }
    c.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/></svg><span>${on.length ? 'Auto-print: ' + on.map((t) => t[0] + t.slice(1).toLowerCase()).join(' + ') : 'Auto-print off'}</span><i style="width:8px;height:8px;border-radius:50%;background:${on.length ? '#16a34a' : '#9ca3af'}"></i>`;
  }
  async function dialog() {
    const on = get(); const U = window.UI; let pl = null;
    try { const r = await window.Api.get('/restaurant/operations/plan', {}, { background: true }); pl = r && r.data && (r.data.plan || r.data); } catch (e) { /* older server: no hints */ }
    const has = (k) => !pl || !pl.configured || (pl.printers && pl.printers[k]);
    const rows = [['KITCHEN', 'Kitchen printer', 'Kitchen tickets, waiter copies, cancellation slips'], ['BAR', 'Bar printer', 'Bar tickets'], ['CASHIER', 'Till / waiter-station printer', 'Customer bills and receipts']];
    const body = `<p class="hx-sub" style="margin:0 0 10px">Choose which printer is connected to THIS device. Keep this page open; paper prints by itself.${pl && pl.singlePrinter ? ' <b>You have one printer (' + pl.singlePrinter + '): choose it here and everything prints on it.</b>' : ''}</p>${rows.map(([k, l, d]) => `<label class="hx-check" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;${has(k) ? '' : 'opacity:.55'}"><input type="checkbox" data-k="${k}" ${on.includes(k) ? 'checked' : ''}> <span><b>${l}</b>${has(k) ? '' : ' <small>(not in your set-up)</small>'}<small style="display:block" class="hx-sub">${d}</small></span></label>`).join('')}<p class="hx-sub" style="margin:10px 0 0">For printing without a pop-up, start Chrome on that PC with <b>--kiosk-printing</b>. <a href="hx-operations.html">Change devices</a></p>`;
    if (U && U.openModal) {
      const m = U.openModal({ title: 'Auto-print on this device', maxWidth: '460px', bodyHtml: body + '<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" id="hx-ap-save">Save</button></div>' });
      m.querySelector('#hx-ap-save').addEventListener('click', () => { set([...m.querySelectorAll('[data-k]')].filter((x) => x.checked).map((x) => x.dataset.k)); start(); U.closeModal(); });
    }
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(start, 1500));
  window.HXAutoPrint = { start, dialog };
})(window);
