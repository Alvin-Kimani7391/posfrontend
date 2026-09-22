/**
 * customer-picker.js
 * CustomerPicker.open({ onSelect }) opens a search modal listing customers,
 * lets the user pick one, or add a brand-new customer with a real form
 * (name, phone, email, address) without leaving the modal.
 *
 * The "Add new customer" button only appears for users with
 * customers.create (Owner/Admin/Manager/Cashier by default) - it's a UI
 * courtesy, the backend still enforces it on POST /customers regardless.
 */
(function (window) {
  async function search(term) {
    const { data } = await window.Api.get('/customers', { search: term, limit: 20 });
    return data.items;
  }

  function open({ onSelect } = {}) {
    const user = window.AppShell.getUser();
    const canCreate = window.Permissions.can(user, 'customers.create');

    const modal = window.UI.openModal({
      title: 'Select a customer',
      bodyHtml: `
        <div class="field" style="margin-bottom: var(--space-3)">
          <div class="input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="cust-picker-search" type="text" placeholder="Search by name or phone" autofocus />
          </div>
        </div>
        <div id="cust-picker-body"></div>
      `,
    });

    const bodyEl = modal.querySelector('#cust-picker-body');
    const searchInput = modal.querySelector('#cust-picker-search');
    let lastTerm = '';

    function selectCustomer(customer) {
      window.UI.closeModal();
      onSelect(customer);
    }

    function renderResultsView(items, term) {
      const rowsHtml = items.length
        ? items.map((c) => `
          <button type="button" class="product-picker-row" data-id="${c._id}"
            style="display:flex; align-items:center; justify-content:space-between; width:100%; text-align:left; padding: var(--space-3);
                   border:none; border-bottom:1px solid var(--color-border); background:none; cursor:pointer;">
            <span>
              <div class="text-sm font-semibold">${window.UI.escapeHtml(c.name)}</div>
              <div class="text-xs text-muted">${c.phone ? window.UI.escapeHtml(c.phone) : 'No phone on file'}</div>
            </span>
            ${c.outstandingBalance > 0 ? `<span class="badge badge-warning">${window.UI.formatMoney(c.outstandingBalance)} owed</span>` : ''}
          </button>
        `).join('')
        : window.UI.emptyStateHtml({ icon: 'employees', title: term ? 'No customers match your search' : 'No customers yet' });

      bodyEl.innerHTML = `
        <div id="cust-picker-results" style="max-height: 300px; overflow-y: auto; border:1px solid var(--color-border); border-radius: var(--radius-md)">
          ${rowsHtml}
        </div>
        ${canCreate ? `
          <button type="button" class="btn btn-secondary btn-block" id="cust-picker-add-btn" style="margin-top: var(--space-3)">
            ${window.Icons.get('plus')} Add new customer${term ? ` "${window.UI.escapeHtml(term)}"` : ''}
          </button>
        ` : ''}
      `;

      bodyEl.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => selectCustomer(items.find((c) => c._id === btn.dataset.id)));
      });
      bodyEl.querySelector('#cust-picker-add-btn')?.addEventListener('click', () => renderCreateForm(term));
    }

    function renderCreateForm(prefillName = '') {
      bodyEl.innerHTML = `
        <form id="cust-create-form">
          <div class="field">
            <label for="cc-name">Full name</label>
            <input class="input" id="cc-name" name="name" required value="${window.UI.escapeHtml(prefillName)}" placeholder="Jane Wanjiru" />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="cc-phone">Phone <span class="text-muted">(optional)</span></label>
              <input class="input" id="cc-phone" name="phone" placeholder="0712345678" />
            </div>
            <div class="field">
              <label for="cc-email">Email <span class="text-muted">(optional)</span></label>
              <input class="input" id="cc-email" name="email" type="email" placeholder="jane@email.com" />
            </div>
          </div>
          <div class="field">
            <label for="cc-address">Address <span class="text-muted">(optional)</span></label>
            <input class="input" id="cc-address" name="address" placeholder="Shop 12, Moi Avenue" />
          </div>
        </form>
        <div style="display:flex; gap: var(--space-2); margin-top: var(--space-2)">
          <button type="button" class="btn btn-secondary btn-block" id="cust-create-back">Back to search</button>
          <button type="button" class="btn btn-primary btn-block" id="cust-create-save">Save customer</button>
        </div>
      `;

      bodyEl.querySelector('#cust-create-back').addEventListener('click', () => runSearch(lastTerm));
      bodyEl.querySelector('#cust-create-save').addEventListener('click', async () => {
        const form = bodyEl.querySelector('#cust-create-form');
        if (!form.reportValidity()) return;

        const raw = window.UI.serializeForm(form);
        ['phone', 'email', 'address'].forEach((k) => {
          if (typeof raw[k] === 'string') raw[k] = raw[k].trim();
          if (!raw[k]) delete raw[k]; // drop empty optionals so sparse unique indexes aren't hit with ''
        });
        raw.name = (raw.name || '').trim();

        const saveBtn = bodyEl.querySelector('#cust-create-save');
        window.UI.setButtonLoading(saveBtn, true, 'Saving…');
        try {
          const { data } = await window.Api.post('/customers', raw);
          window.UI.toast.success('Customer added');
          selectCustomer(data.customer);
        } catch (err) {
          if (err.code === 'VALIDATION_ERROR' && err.errors?.length) {
            window.UI.applyFormErrors(form, err.errors);
          } else {
            window.UI.toast.error(err.message);
          }
          window.UI.setButtonLoading(saveBtn, false);
        }
      });
    }

    async function runSearch(term) {
      lastTerm = term;
      bodyEl.innerHTML = `<div style="padding: var(--space-4)">${window.UI.skeletonRows(1, 3)}</div>`;
      try {
        const items = await search(term);
        renderResultsView(items, term);
      } catch (err) {
        bodyEl.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Search failed', message: err.message });
      }
    }

    searchInput.addEventListener('input', window.UI.debounce((e) => runSearch(e.target.value.trim()), 300));
    runSearch('');
  }

  window.CustomerPicker = { open };
})(window);