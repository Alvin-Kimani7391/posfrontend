/** offline-review.js - managers/owner: approve offline M-PESA, review flagged sales, held sales, shifts. */
(function () {
  const esc = window.UI.escapeHtml;
  const fm = (n) => window.UI.formatMoney(n);
  const $ = (id) => document.getElementById(id);
  const TABS = [['mpesa', 'M-PESA payments'], ['sales', 'Sales to review'], ['quarantine', 'Held sales'], ['shifts', 'Shifts']];
  const COUNT = { mpesa: 'pendingMpesa', sales: 'pendingSales', quarantine: 'heldItems', shifts: 'pendingShifts' };
  const URLS = { mpesa: '/offline/review/mpesa', sales: '/offline/review/sales', quarantine: '/offline/review/quarantine', shifts: '/offline/review/shifts' };
  const state = { tab: 'mpesa', page: 1 };
  let el; let summary = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    el = window.AppShell.mount({ title: 'Offline review' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Offline review</h1><p>Things the tills recorded offline that need a manager's decision. Nothing here is lost: the server keeps a full copy.</p></div></div>
      <div id="or-alert"></div><div class="tabs" id="or-tabs" style="margin-bottom:var(--space-4)"></div><div id="or-body"></div>`;
    window.AppShell.onBranchChange(() => { state.page = 1; refresh(); });
    refresh();
  }

  async function refresh() {
    try { summary = (await window.Api.get('/offline/review/summary')).data; } catch { summary = {}; }
    $('or-alert').innerHTML = summary.staleTills ? `<div class="form-alert form-alert-error" style="margin-bottom:var(--space-3)">${summary.staleTills} till(s) hold unsynced sales and have not contacted the server for 6+ hours. Check they are online, or block a lost till under Settings.</div>` : '';
    $('or-tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab-btn ${k === state.tab ? 'active' : ''}" data-t="${k}">${l}${summary[COUNT[k]] ? ` <span class="badge badge-danger">${summary[COUNT[k]]}</span>` : ''}</button>`).join('');
    $('or-tabs').querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.t; state.page = 1; refresh(); }));
    load();
  }

  const flags = (list) => (list || []).filter((f) => f.severity !== 'INFO').map((f) => `<span class="badge ${f.severity === 'HIGH' ? 'badge-danger' : 'badge-warning'}" title="${esc(f.detail || '')}">${esc(f.code)}</span>`).join(' ');

  /** Asks for a note (and optional extra). Resolves { note, extra } or null. */
  function ask({ title, required, confirmText, danger, extraHtml }) {
    return new Promise((resolve) => {
      let done = false;
      const m = window.UI.openModal({
        title, maxWidth: '460px',
        bodyHtml: `<div class="field"><label>Note ${required ? '' : '<span class="text-muted">(optional)</span>'}</label><textarea class="textarea" id="or-note" maxlength="300" style="min-height:70px"></textarea></div>${extraHtml || ''}`,
        footerHtml: `<button class="btn btn-secondary" data-c>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-s>${esc(confirmText)}</button>`,
      });
      m.querySelector('[data-c]').addEventListener('click', () => { window.UI.closeModal(); if (!done) resolve(null); done = true; });
      m.querySelector('[data-s]').addEventListener('click', () => {
        const note = m.querySelector('#or-note').value.trim();
        if (required && note.length < 3) return window.UI.toast.error('Please write a short note (3+ characters).');
        done = true; const extra = m.querySelector('#or-extra') ? m.querySelector('#or-extra').checked : false;
        window.UI.closeModal(); resolve({ note, extra });
      });
    });
  }

  async function post(url, body, ok) {
    try { await window.Api.post(url, body); window.UI.toast.success(ok); refresh(); } catch (e) { window.UI.toast.error(e.message); }
  }

  const COLS = {
    mpesa: {
      head: ['Code', 'Amount', 'Customer', 'Sale', 'Cashier', 'Why it needs you', 'Recorded', ''],
      row: (c) => `<td class="cell-primary pz-mono">${esc(c.mpesaCode)}</td><td>${fm(c.amountCents / 100)}</td><td class="text-sm">${esc(c.payerPhone || '')}<br>${esc(c.payerName || '')}</td>
        <td class="text-sm">${esc(c.saleId?.receiptNumber || '')}</td><td class="text-sm">${esc(c.cashierId?.name || '')}</td>
        <td class="text-sm">${esc(c.reason || '')}<br>${flags(c.flags)}</td><td class="text-sm">${window.UI.formatDateTime(c.createdAt)}</td>
        <td class="actions">${c.status === 'PENDING_REVIEW' ? '<button class="btn btn-primary btn-sm" data-a="approve">Approve</button><button class="btn btn-danger btn-sm" data-a="reject">Reject</button>' : `<span class="badge badge-neutral">${esc(c.status)}</span>`}</td>`,
      act: async (a, c) => {
        if (a === 'approve') { const r = await ask({ title: `Approve M-PESA ${c.mpesaCode}?`, confirmText: 'Approve payment' }); if (r) post(`/offline/review/mpesa/${c._id}/approve`, { note: r.note || undefined }, 'Payment approved'); }
        if (a === 'reject') {
          const r = await ask({ title: `Reject M-PESA ${c.mpesaCode}?`, required: true, confirmText: 'Reject payment', danger: true,
            extraHtml: '<div class="checkbox-row"><input type="checkbox" id="or-extra" /><label for="or-extra" class="text-sm">Charge this amount to the cashier as a shortage</label></div>' });
          if (r) post(`/offline/review/mpesa/${c._id}/reject`, { note: r.note, chargeCashier: r.extra }, 'Payment rejected');
        }
      },
    },
    sales: {
      head: ['Receipt', 'Total', 'Cashier', 'Branch', 'Sold', 'Flags', ''],
      row: (s) => `<td class="cell-primary">${esc(s.receiptNumber)}</td><td>${fm(s.total)}</td><td class="text-sm">${esc(s.cashierId?.name || '')}</td><td class="text-sm">${esc(s.branchId?.name || '')}</td>
        <td class="text-sm">${window.UI.formatDateTime(s.soldAt)}</td><td>${flags(s.reviewFlags)}</td><td class="actions"><button class="btn btn-primary btn-sm" data-a="resolve">Mark reviewed</button></td>`,
      act: async (a, s) => { const r = await ask({ title: `Review ${s.receiptNumber}`, confirmText: 'Mark reviewed' }); if (r) post(`/offline/review/sales/${s._id}/resolve`, { note: r.note || undefined }, 'Marked reviewed'); },
    },
    quarantine: {
      head: ['Till', 'Type', 'Sold', 'Reason', 'Message', ''],
      row: (q) => `<td class="cell-primary">${esc(q.deviceCode || '')}</td><td>${esc(q.eventType)}</td><td class="text-sm">${q.soldAt ? window.UI.formatDateTime(q.soldAt) : '-'}</td>
        <td><span class="badge ${q.status === 'HELD' ? 'badge-warning' : 'badge-danger'}">${esc(q.code)}</span></td><td class="text-sm" style="white-space:normal;max-width:320px">${esc(q.message || '')}</td>
        <td class="actions"><button class="btn btn-secondary btn-sm" data-a="view">Details</button>${q.releasable ? '<button class="btn btn-primary btn-sm" data-a="release">Accept</button>' : ''}<button class="btn btn-danger btn-sm" data-a="discard">Discard</button></td>`,
      act: async (a, q) => {
        if (a === 'view') {
          const { data } = await window.Api.get(`/offline/review/quarantine/${q._id}`);
          const m = window.UI.openModal({ title: 'Held item', maxWidth: '640px', bodyHtml: `<pre style="white-space:pre-wrap;font-size:12px;max-height:60vh;overflow:auto">${esc(JSON.stringify(data.rejection.payload, null, 2))}</pre>`, footerHtml: '<button class="btn btn-primary" data-c>Close</button>' });
          m.querySelector('[data-c]').addEventListener('click', window.UI.closeModal);
        }
        if (a === 'release') { const r = await ask({ title: 'Accept this sale?', required: true, confirmText: 'Accept (flagged)' }); if (r) post(`/offline/review/quarantine/${q._id}/release`, { note: r.note }, 'Sale accepted'); }
        if (a === 'discard') { const r = await ask({ title: 'Discard this sale?', required: true, confirmText: 'Discard', danger: true }); if (r) post(`/offline/review/quarantine/${q._id}/discard`, { note: r.note }, 'Discarded (kept as evidence)'); }
      },
    },
    shifts: {
      head: ['Register', 'Cashier', 'Opened', 'Closed', 'Difference', 'Flags', ''],
      row: (s) => `<td class="cell-primary">${esc(s.registerId?.name || '')}</td><td class="text-sm">${esc(s.cashierId?.name || '')}</td><td class="text-sm">${window.UI.formatDateTime(s.openedAt)}</td>
        <td class="text-sm">${s.closedAt ? window.UI.formatDateTime(s.closedAt) : 'Open'}</td><td>${s.status === 'CLOSED' ? fm(s.cashDifference) : '-'}</td><td>${flags(s.offlineFlags)}</td>
        <td class="actions"><button class="btn btn-primary btn-sm" data-a="resolve">Mark reviewed</button></td>`,
      act: async (a, s) => { const r = await ask({ title: 'Review this shift', confirmText: 'Mark reviewed' }); if (r) post(`/offline/review/shifts/${s._id}/resolve`, { note: r.note || undefined }, 'Marked reviewed'); },
    },
  };

  async function load() {
    const body = $('or-body'); const cfg = COLS[state.tab];
    body.innerHTML = `<div class="card"><div class="table-wrap"><table class="table" style="min-width:900px"><thead><tr>${cfg.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody id="or-tb">${window.UI.skeletonRows(cfg.head.length, 4)}</tbody></table></div><div class="pagination" id="or-pg"></div></div>`;
    try {
      const { data } = await window.Api.get(URLS[state.tab], { page: state.page, limit: 20, branchId: window.AppShell.getActiveBranchId() || undefined });
      const tb = $('or-tb');
      tb.innerHTML = data.items.length ? data.items.map((x, i) => `<tr data-i="${i}">${cfg.row(x)}</tr>`).join('')
        : `<tr><td colspan="${cfg.head.length}">${window.UI.emptyStateHtml({ icon: 'check', title: 'Nothing waiting', message: 'All caught up.' })}</td></tr>`;
      tb.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => cfg.act(b.dataset.a, data.items[Number(b.closest('tr').dataset.i)]).catch((e) => window.UI.toast.error(e.message))));
      window.UI.renderPagination($('or-pg'), data, (p) => { state.page = p; load(); });
    } catch (e) { $('or-tb').innerHTML = `<tr><td colspan="${cfg.head.length}">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load', message: e.message })}</td></tr>`; }
  }
})();
