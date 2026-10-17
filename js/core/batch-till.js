/**
 * batch-till.js - shows the cashier WHICH BATCH each cart line will sell from (earliest expiry first, "FEFO"),
 * colours short-dated stock, and lets the cashier pick a different batch for a line.
 *
 * Display + one optional field only: the server still decides and enforces everything (expired / held batches can
 * never be sold, FEFO is applied when no batch is picked). If anything here fails, the till works exactly as before.
 *
 *   BatchTill.ensure(items)  -> Promise; loads the sellable batches for retail lines of batch / expiry tracked products
 *   BatchTill.tag(item, idx) -> html placed under the product name (batch line + picker)
 *   BatchTill.clear()        -> forget cached batches (after a sale, so the next sale sees fresh quantities)
 */
(function (window) {
  const TTL_MS = 30 * 1000;
  const cache = new Map(); // "product|variant|branch" -> { at, batches: [] | null }
  let thresholds = { criticalDays: 30, warningDays: 90, at: 0 };

  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);
  const needs = (item) => !!(item && !item.ws && item.product && (item.product.trackBatch || item.product.trackExpiry));
  const branch = () => window.AppShell.getActiveBranchId();
  const keyOf = (item) => `${item.product._id}|${item.variantId || item.variant?._id || ''}|${branch() || ''}`;
  const expDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : 'no expiry');

  async function loadThresholds() {
    if (Date.now() - thresholds.at < 10 * 60 * 1000) return;
    thresholds.at = Date.now(); // set first so a failure is not retried on every line
    try {
      const { data } = await window.Api.get('/batches/alert-settings', undefined, { background: true });
      thresholds = { criticalDays: data.criticalDays || 30, warningDays: data.warningDays || 90, at: Date.now() };
    } catch { /* defaults */ }
  }

  async function ensure(items) {
    const list = (items || []).filter(needs);
    if (!list.length || !branch() || navigator.onLine === false) return;
    await loadThresholds();
    await Promise.all(list.map(async (item) => {
      const k = keyOf(item);
      const hit = cache.get(k);
      if (hit && Date.now() - hit.at < TTL_MS) return;
      try {
        const { data } = await window.Api.get('/batches/available', {
          branchId: branch(), productId: item.product._id, variantId: item.variantId || item.variant?._id || undefined,
        });
        cache.set(k, { at: Date.now(), batches: data.batches || [] });
      } catch { cache.set(k, { at: Date.now(), batches: null }); } // no permission / offline: show nothing
    }));
  }

  function toneOf(days) {
    if (days == null) return 'var(--color-text-secondary)';
    if (days <= thresholds.criticalDays) return 'var(--color-danger)';
    if (days <= thresholds.warningDays) return 'var(--color-warning)';
    return 'var(--color-text-secondary)';
  }
  const daysText = (d) => (d == null ? '' : d === 0 ? 'expires today' : `${d} day${d === 1 ? '' : 's'} left`);
  const piece = (b) => `<span style="color:${toneOf(b.daysLeft)}">Batch ${esc(b.batchNumber)} &middot; exp ${esc(expDate(b.expiryDate))}${b.daysLeft != null ? ` (${daysText(b.daysLeft)})` : ''}</span>`;

  /** Which batches this line will take from, in order, for its current quantity. */
  function plan(item, batches) {
    if (item.batchId) {
      const b = batches.find((x) => String(x._id) === String(item.batchId));
      return b ? { picked: true, parts: [b], short: Math.max(0, Number(item.quantity) - b.quantity) } : { picked: true, parts: [], short: Number(item.quantity), missing: true };
    }
    let left = Number(item.quantity) || 0;
    const parts = [];
    for (const b of batches) { if (left <= 0) break; parts.push(b); left -= b.quantity; }
    return { picked: false, parts, short: Math.max(0, left) };
  }

  function tag(item, idx) {
    if (!needs(item)) return '';
    const hit = cache.get(keyOf(item));
    if (!hit || hit.batches === null) return '';
    const batches = hit.batches;
    if (!batches.length) {
      return '<small style="color:var(--color-warning)">No in-date batch on record for this product</small>';
    }
    const p = plan(item, batches);
    const lines = [];
    if (p.missing) lines.push('<small class="pz-bad">The chosen batch is no longer available. Pick another.</small>');
    else lines.push(`<small>${p.parts.map(piece).join(' &rarr; ')}</small>`);
    if (p.short > 0 && !p.missing) lines.push(`<small class="pz-bad">${p.picked ? 'This batch has' : 'Batches hold'} only ${esc(String(Number(item.quantity) - p.short))} of ${esc(String(item.quantity))}</small>`);
    if (p.picked && !p.missing && String(batches[0]._id) !== String(item.batchId)) {
      lines.push(`<small style="color:var(--color-warning)">Batch ${esc(batches[0].batchNumber)} expires sooner (${esc(expDate(batches[0].expiryDate))})</small>`);
    }
    const select = batches.length > 1 || item.batchId
      ? `<select class="select" data-action="batch" data-idx="${idx}" aria-label="Batch" style="margin-top:2px;max-width:100%;font-size:var(--text-xs);height:28px;padding:0 6px">
          <option value="">Auto: earliest expiry first</option>
          ${batches.map((b, n) => `<option value="${esc(b._id)}" ${String(b._id) === String(item.batchId) ? 'selected' : ''}>${esc(b.batchNumber)} &middot; ${esc(expDate(b.expiryDate))} &middot; ${esc(String(b.quantity))} left${n === 0 ? ' (sells first)' : ''}</option>`).join('')}
        </select>` : '';
    return lines.join('') + select;
  }

  window.BatchTill = { ensure, tag, clear: () => cache.clear() };
})(window);
