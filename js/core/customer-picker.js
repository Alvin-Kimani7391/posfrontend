/**
 * customer-picker.js
 * CustomerPicker.open({ onSelect }) opens a search modal listing customers
 * and lets the user pick one, or quick-create a new one inline if the
 * search finds nothing. Mirrors product-picker.js's shape deliberately so
 * both feel the same inside the POS screen.
 */
(function (window) {
  async function search(term) {
    const { data } = await window.Api.get('/customers', { search: term, limit: 20 });
    return data.items;
  }

  function open({ onSelect } = {}) {
    const modal = window.UI.openModal({
      title: 'Select a customer',
      bodyHtml: `
        <div class="field" style="margin-bottom: var(--space-3)">
          <div class="input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="cust-picker-search" type="text" placeholder="Search by name or phone" autofocus />
          </div>
        </div>
        <div id="cust-picker-results" style="max-height: 320px; overflow-y: auto; border:1px solid var(--color-border); border-radius: var(--radius-md)"></div>
        <div id="cust-picker-create" style="margin-top: var(--space-3)"></div>
      `,
    });

    const resultsEl = modal.querySelector('#cust-picker-results');
    const createEl = modal.querySelector('#cust-picker-create');
    const searchInput = modal.querySelector('#cust-picker-search');

    function selectCustomer(customer) {
      window.UI.closeModal();
      onSelect(customer);
    }

    async function runSearch(term) {
      resultsEl.innerHTML = `<div style="padding: var(--space-4)">${window.UI.skeletonRows(1, 3)}</div>`;
      createEl.innerHTML = '';
      try {
        const items = await search(term);
        renderResults(items, term);
      } catch (err) {
        resultsEl.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Search failed', message: err.message });
      }
    }

    function renderResults(items, term) {
      if (!items.length) {
        resultsEl.innerHTML = window.UI.emptyStateHtml({ icon: 'employees', title: 'No customers found' });
      } else {
        resultsEl.innerHTML = items.map((c) => `
          <button type="button" class="product-picker-row" data-id="${c._id}"
            style="display:flex; align-items:center; justify-content:space-between; width:100%; text-align:left; padding: var(--space-3);
                   border:none; border-bottom:1px solid var(--color-border); background:none; cursor:pointer;">
            <span>
              <div class="text-sm font-semibold">${window.UI.escapeHtml(c.name)}</div>
              <div class="text-xs text-muted">${window.UI.escapeHtml(c.phone || '')}</div>
            </span>
            ${c.outstandingBalance > 0 ? `<span class="badge badge-warning">${window.UI.formatMoney(c.outstandingBalance)} owed</span>` : ''}
          </button>
        `).join('');
        resultsEl.querySelectorAll('[data-id]').forEach((btn) => {
          btn.addEventListener('click', () => selectCustomer(items.find((c) => c._id === btn.dataset.id)));
        });
      }

      if (term && term.trim().length >= 2) {
        createEl.innerHTML = `
          <button type="button" class="btn btn-secondary btn-block" id="cust-picker-quickcreate">
            ${window.Icons.get('plus')} Add "${window.UI.escapeHtml(term)}" as a new customer
          </button>
        `;
        createEl.querySelector('#cust-picker-quickcreate').addEventListener('click', async () => {
          try {
            const { data } = await window.Api.post('/customers', { name: term.trim() });
            selectCustomer(data.customer);
          } catch (err) {
            window.UI.toast.error(err.message);
          }
        });
      } else {
        createEl.innerHTML = '';
      }
    }

    searchInput.addEventListener('input', window.UI.debounce((e) => runSearch(e.target.value.trim()), 300));
    runSearch('');
  }

  window.CustomerPicker = { open };
})(window);
