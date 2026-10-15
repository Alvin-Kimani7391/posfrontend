/** Stocktake: count what is on the shelf, submit, and a manager approves to adjust stock. */
(function () {
  const K = window.ModuleKit;
  let contentEl, list;

  document.addEventListener('DOMContentLoaded', () => {
    contentEl = window.AppShell.mount({ title: 'Stocktake' });
    if (!contentEl) return;
    contentEl.innerHTML = `<div class="page-header"><div><h1>Stocktake</h1><p>Count the shelves and compare with the system to find losses early.</p></div>
      <button class="btn btn-primary" id="new-st" data-requires-permission="stocktake.manage">${window.Icons.get('plus')} New stocktake</button></div><div id="mk-root"></div>`;
    document.getElementById('new-st').addEventListener('click', create);
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    window.AppShell.runUrlAction?.('new-st');
    load();
    window.AppShell.onBranchChange?.(load);
  });

  function load() {
    list = K.listPage({
      container: document.getElementById('mk-root'), endpoint: '/stocktakes', query: () => ({ branchId: K.branchId() }),
      filters: [{ key: 'status', label: 'All statuses', options: ['OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED'] }],
      columns: [
        { label: 'Number', render: (s) => K.esc(s.stocktakeNumber) }, { label: 'Name', render: (s) => K.esc(s.name || '-') },
        { label: 'Items', align: 'right', render: (s) => s.lines?.length ?? s.lineCount ?? '-' },
        { label: 'Started', render: (s) => K.date(s.createdAt) }, { label: 'Status', render: (s) => K.badge(s.status) },
      ],
      rowActions: () => K.btn('open', 'Open'), onAction: (a, s) => openOne(s._id),
      emptyText: 'No stocktakes yet', emptyMessage: 'Start one when you are ready to count the shelves.',
    });
  }

  function create() {
    K.formModal({ title: 'New stocktake', submitLabel: 'Start counting',
      intro: 'A blind count hides the system quantity from counters so they count honestly.',
      fields: [{ name: 'name', label: 'Name (optional)', placeholder: 'e.g. October shelves' }, { name: 'blind', label: 'Blind count (recommended)', type: 'checkbox', value: true }],
      onSubmit: async (d) => {
        const { data } = await window.Api.post('/stocktakes', { branchId: K.branchId(), name: d.name, blind: d.blind, scope: { type: 'ALL' } });
        window.UI.toast.success('Stocktake started'); list.reload(); setTimeout(() => openOne(data.stocktake._id), 200);
      } });
  }

  async function openOne(id) {
    let st;
    try { st = (await window.Api.get(`/stocktakes/${id}`)).data.stocktake; } catch (e) { window.UI.toast.error(e.message); return; }
    const editable = st.status === 'OPEN' && K.can('stocktake.count');
    const showSys = !st.blind || K.can('stocktake.approve');
    const modal = window.UI.openModal({
      title: `${st.stocktakeNumber}${st.name ? ` · ${st.name}` : ''}`, maxWidth: '900px',
      bodyHtml: `${K.kv([['Status', K.badge(st.status)], ['Items', st.lines.length], ['Counted', st.lines.filter((l) => l.countedQty != null).length], st.status === 'APPROVED' ? ['Net variance', K.money(st.totalVarianceValue)] : null])}
        <div class="table-wrap"><table class="table"><thead><tr><th>Product</th>${showSys ? '<th style="text-align:right">System</th>' : ''}<th style="text-align:right">Counted</th>${st.status !== 'OPEN' ? '<th style="text-align:right">Variance</th>' : ''}</tr></thead><tbody>
        ${st.lines.map((l) => `<tr><td>${K.esc(l.nameSnapshot || '')}${l.batchNumber ? ` <span class="text-xs text-muted">batch ${K.esc(l.batchNumber)}</span>` : ''}</td>
          ${showSys ? `<td style="text-align:right">${l.systemQtyAtCount ?? l.systemQtyAtStart ?? ''}</td>` : ''}
          <td style="text-align:right">${editable ? `<input class="input" type="number" min="0" step="any" data-line="${l._id}" value="${l.countedQty ?? ''}" style="width:90px;text-align:right" />` : (l.countedQty ?? '-')}</td>
          ${st.status !== 'OPEN' ? `<td style="text-align:right">${l.varianceQty || 0}</td>` : ''}</tr>`).join('')}</tbody></table></div>`,
      footerHtml: [
        editable ? '<button class="btn btn-secondary" data-a="save">Save counts</button><button class="btn btn-primary" data-a="submit">Submit for approval</button>' : '',
        st.status === 'SUBMITTED' && K.can('stocktake.approve') ? '<button class="btn btn-primary" data-a="approve">Approve &amp; adjust stock</button>' : '',
        ['OPEN', 'SUBMITTED'].includes(st.status) && K.can('stocktake.manage') ? '<button class="btn btn-ghost" data-a="cancel">Cancel stocktake</button>' : '',
        '<button class="btn btn-secondary" data-a="close">Close</button>'].join(''),
    });
    const counts = () => [...modal.querySelectorAll('[data-line]')].filter((i) => i.value !== '').map((i) => ({ lineId: i.dataset.line, countedQty: i.value }));
    const run = (a, fn, ok) => modal.querySelector(`[data-a="${a}"]`)?.addEventListener('click', async (e) => {
      window.UI.setButtonLoading(e.currentTarget, true, '…');
      try { await fn(); window.UI.toast.success(ok); window.UI.closeModal(); list.reload(); } catch (err) { window.UI.toast.error(err.message); window.UI.setButtonLoading(e.currentTarget, false); }
    });
    modal.querySelector('[data-a="close"]').addEventListener('click', () => window.UI.closeModal());
    run('save', async () => { const c = counts(); if (!c.length) throw new Error('Enter at least one count'); await window.Api.put(`/stocktakes/${id}/counts`, { counts: c }); }, 'Counts saved');
    run('submit', async () => { const c = counts(); if (c.length) await window.Api.put(`/stocktakes/${id}/counts`, { counts: c }); await window.Api.post(`/stocktakes/${id}/submit`, { skipUncounted: true }); }, 'Submitted for approval');
    run('approve', () => window.Api.post(`/stocktakes/${id}/approve`, {}), 'Approved. Stock adjusted');
    modal.querySelector('[data-a="cancel"]')?.addEventListener('click', () => {
      window.UI.closeModal();
      K.formModal({ title: 'Cancel stocktake', submitLabel: 'Cancel stocktake', fields: [{ name: 'reason', label: 'Reason', required: true }],
        onSubmit: async (d) => { await window.Api.post(`/stocktakes/${id}/cancel`, d); window.UI.toast.success('Cancelled'); list.reload(); } });
    });
  }
})();
