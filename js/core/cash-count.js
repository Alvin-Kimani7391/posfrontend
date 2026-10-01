/**
 * cash-count.js
 * Shared cash-count helpers:
 *   CashCount.openCountModal({...})  - the "count your drawer by note/coin" window used when closing a shift
 *   CashCount.breakdownHtml(list)    - read-only denomination table (shift summary, owner's shift detail)
 *
 * Denominations are whole KES values. Amounts from the API are already decimal KES.
 */
(function (window) {
  const DENOMINATIONS = [1000, 500, 200, 100, 50, 40, 20, 10, 5, 1];
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const fm = (n) => window.UI.formatMoney(n);
  const label = (d) => `KES ${Number(d).toLocaleString('en-KE')}`;

  function totalOf(list) {
    return (list || []).reduce((s, l) => s + (Number(l.denomination) || 0) * (Number(l.count) || 0), 0);
  }

  /** Read-only breakdown table: only lines with a count, highest first, plus a total row. */
  function breakdownHtml(list) {
    const lines = (list || []).filter((l) => l.count > 0).sort((a, b) => b.denomination - a.denomination);
    if (!lines.length) {
      return '<p class="text-xs text-muted" style="margin-top:var(--space-3)">No denomination breakdown was recorded for this shift.</p>';
    }
    const units = lines.reduce((s, l) => s + l.count, 0);
    return `
      <div class="cc-breakdown">
        <div class="cc-breakdown-title">Cash counted by denomination</div>
        <table>
          <thead><tr><th>Note / coin</th><th class="num">Count</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${lines.map((l) => `<tr><td>${label(l.denomination)}</td><td class="num">${l.count}</td><td class="num">${fm(l.denomination * l.count)}</td></tr>`).join('')}
          </tbody>
          <tfoot><tr><td>Total</td><td class="num">${units}</td><td class="num">${fm(totalOf(lines))}</td></tr></tfoot>
        </table>
      </div>`;
  }

  /**
   * openCountModal({ title, intro, confirmText, confirmClass, onSubmit })
   * onSubmit({ denominations: [{denomination,count} x10], notes }) must return a promise.
   * If it rejects, the error is toasted and the window stays open; on success the CALLER closes it.
   */
  function openCountModal({ title = 'Count the cash', intro = '', confirmText = 'Confirm', confirmClass = 'btn-primary', onSubmit }) {
    const modal = window.UI.openModal({
      title,
      maxWidth: '520px',
      bodyHtml: `
        ${intro ? `<p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">${esc(intro)}</p>` : ''}
        <div class="cc-list" id="cc-list">
          ${DENOMINATIONS.map((d) => `
            <div class="cc-row">
              <label class="cc-label" for="cc-${d}">${label(d)}</label>
              <span class="cc-x" aria-hidden="true">×</span>
              <input class="input cc-input" id="cc-${d}" data-denom="${d}" type="number" inputmode="numeric" min="0" step="1" placeholder="0" />
              <span class="cc-sub" data-sub="${d}">${fm(0)}</span>
            </div>`).join('')}
        </div>
        <div class="cc-total"><span>Total counted <small id="cc-units">0 notes &amp; coins</small></span><strong id="cc-total">${fm(0)}</strong></div>
        <div class="field" style="margin-top:var(--space-3)">
          <label for="cc-notes">Notes <span class="text-muted">(optional)</span></label>
          <textarea class="textarea" id="cc-notes" style="min-height:64px"></textarea>
        </div>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn ${confirmClass}" data-action="save" id="cc-save">${esc(confirmText)}</button>`,
    });

    const inputs = [...modal.querySelectorAll('.cc-input')];
    const notesEl = modal.querySelector('#cc-notes');
    const saveBtn = modal.querySelector('#cc-save');

    const countOf = (inp) => Math.max(Math.floor(Number(inp.value)) || 0, 0);

    function update() {
      let total = 0;
      let units = 0;
      inputs.forEach((inp) => {
        const d = Number(inp.dataset.denom);
        const c = countOf(inp);
        total += d * c;
        units += c;
        modal.querySelector(`[data-sub="${d}"]`).textContent = fm(d * c);
      });
      modal.querySelector('#cc-total').textContent = fm(total);
      modal.querySelector('#cc-units').textContent = `${units} note${units === 1 ? '' : 's'} & coins`;
    }

    inputs.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        if (inp.value !== '' && Number(inp.value) < 0) inp.value = '0';
        update();
      });
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        (inputs[i + 1] || notesEl).focus();
      });
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    saveBtn.addEventListener('click', async () => {
      const denominations = inputs.map((inp) => ({ denomination: Number(inp.dataset.denom), count: countOf(inp) }));
      window.UI.setButtonLoading(saveBtn, true, 'Saving…');
      try {
        await onSubmit({ denominations, notes: notesEl.value.trim() || undefined });
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(saveBtn, false);
      }
    });

    setTimeout(() => inputs[0].focus(), 50);
    return modal;
  }

  window.CashCount = { DENOMINATIONS, totalOf, breakdownHtml, openCountModal };
})(window);