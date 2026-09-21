/**
 * employees.js
 * CRUD UI for /api/v1/employees. Credential (password/PIN) editing isn't
 * exposed here on purpose - the backend's employee.service only supports
 * setting a PIN/password at creation time in this phase; there's no admin
 * "reset employee password" endpoint yet, so we don't pretend there is.
 *
 * Employee onboarding flow (PIN login at the till):
 *   1. Owner sees the Business ID at the top of this page.
 *   2. Owner adds an employee (role, employee code, PIN).
 *   3. A "Login details" dialog shows Business ID + code + PIN once, with
 *      Copy / WhatsApp buttons. The PIN is hashed server-side, so it can
 *      never be shown again after this dialog is closed.
 *   4. The shared link opens login.html on the "Employee PIN" tab with the
 *      Business ID already filled in.
 */
(function () {
  const ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'STOREKEEPER', 'ACCOUNTANT'];
  const DEFAULT_NEW_ROLE = 'CASHIER';
  const state = { page: 1, limit: 10, search: '', total: 0, pages: 1 };
  let contentEl;
  let branchesCache = null;
  let businessId = '';

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Employees' });
    if (!contentEl) return;

    businessId = await ensureBusinessId();
    contentEl.innerHTML = pageSkeleton();
    bindToolbar();
    await fetchAndRender();
  }

  /* ------------------------------------------------------------------ *
   * Helpers: business id, login link, clipboard, sharing
   * ------------------------------------------------------------------ */

  // The logged-in user's record (from login) includes businessId. If for some
  // reason it doesn't, fall back to GET /auth/me.
  async function ensureBusinessId() {
    const fromUser = window.AppShell.getUser()?.businessId;
    if (fromUser) return String(fromUser);
    try {
      const { data } = await window.Api.get('/auth/me');
      return data?.user?.businessId ? String(data.user.businessId) : '';
    } catch {
      return '';
    }
  }

  function loginLink() {
    const url = new URL('login.html', window.location.href);
    url.search = '';
    url.searchParams.set('tab', 'pin');
    if (businessId) url.searchParams.set('businessId', businessId);
    return url.toString();
  }

  async function copyText(text, okMessage) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { /* fall through to legacy copy */ }

    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }

    if (ok) window.UI.toast.success(okMessage || 'Copied');
    else window.UI.toast.error('Could not copy - please select and copy it manually');
  }

  // Kenyan numbers: 0712345678 / +254712345678 / 712345678 -> 254712345678
  function whatsappNumber(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('254')) return digits;
    if (digits.startsWith('0')) return `254${digits.slice(1)}`;
    if (digits.length === 9) return `254${digits}`;
    return digits;
  }

  function buildShareMessage({ employee, pin, password }) {
    const appName = window.APP_CONFIG?.APP_NAME || 'the POS';
    const firstName = (employee.name || '').split(' ')[0] || 'there';
    const lines = [`Hi ${firstName}, here are your ${appName} login details:`];

    if (employee.employeeCode) {
      lines.push(
        '',
        `Business ID: ${businessId}`,
        `Employee code: ${employee.employeeCode}`,
        `PIN: ${pin || '(the PIN your manager gave you)'}`,
        '',
        `Log in here (Employee PIN tab): ${loginLink()}`
      );
    }
    if (password) {
      lines.push(
        '',
        employee.employeeCode ? 'Or log in with your phone number:' : 'Log in with your phone number:',
        `Phone: ${employee.phone}`,
        `Password: ${password}`
      );
      if (!employee.employeeCode) lines.push('', `Log in here: ${new URL('login.html', window.location.href).toString()}`);
    }
    return lines.join('\n');
  }

  function credRow(label, value) {
    const esc = window.UI.escapeHtml;
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:var(--space-3);
                  padding:var(--space-2) 0; border-bottom:1px solid var(--color-border)">
        <div style="min-width:0">
          <div class="text-xs text-muted">${esc(label)}</div>
          <div class="font-semibold" style="font-family:monospace; word-break:break-all">${esc(value)}</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(value)}">Copy</button>
      </div>
    `;
  }

  /**
   * Shows what an employee needs to log in.
   * - justCreated + pin/password: we still have the plain secret in memory,
   *   so we can show it (this is the ONLY time).
   * - otherwise (opened from a table row): no secrets are available; we show
   *   Business ID + employee code and explain that the PIN can't be viewed.
   */
  function openLoginDetailsModal({ employee, pin, password, justCreated = false }) {
    const esc = window.UI.escapeHtml;
    const hasCode = !!employee.employeeCode;
    const rows = [];

    if (hasCode) {
      rows.push(credRow('Business ID', businessId));
      rows.push(credRow('Employee code', employee.employeeCode));
      if (pin) rows.push(credRow('PIN', pin));
    }
    if (password) {
      rows.push(credRow('Phone (username)', employee.phone));
      rows.push(credRow('Password', password));
    }

    let notice = '';
    if (!hasCode && !password) {
      notice = `
        <div class="form-alert form-alert-error" style="margin-bottom:var(--space-4)">
          ${window.Icons.get('alert')}
          <span>${esc(employee.name)} has no employee code, so PIN login won't work. Edit the employee and add a code.</span>
        </div>`;
    } else if (justCreated && (pin || password)) {
      notice = `
        <div class="form-alert form-alert-success" style="margin-bottom:var(--space-4)">
          ${window.Icons.get('lock')}
          <span>Give these details to ${esc(employee.name)} now. The ${pin ? 'PIN' : 'password'} is stored encrypted and can't be viewed again after you close this window.</span>
        </div>`;
    } else if (hasCode) {
      notice = `
        <p class="text-sm text-muted" style="margin-bottom:var(--space-3)">
          The PIN is stored encrypted, so it can't be shown here. If ${esc(employee.name)} forgot it,
          PIN reset is coming in a later phase.
        </p>`;
    }

    const bodyHtml = `
      ${notice}
      ${rows.length ? `<div>${rows.join('')}</div>` : ''}
      ${hasCode ? `
        <div style="margin-top:var(--space-4)">
          <div class="text-xs text-muted">Login link (opens the Employee PIN tab with the Business ID filled in)</div>
          <div class="text-sm" style="word-break:break-all">${esc(loginLink())}</div>
          <button type="button" class="btn btn-ghost btn-sm" style="margin-top:var(--space-1)" data-copy="${esc(loginLink())}">Copy link</button>
        </div>` : ''}
    `;

    const canShare = hasCode || !!password;
    const modal = window.UI.openModal({
      title: justCreated ? 'Employee added - login details' : `Login details - ${employee.name}`,
      bodyHtml,
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Done</button>
        ${canShare ? `
          <button class="btn btn-secondary" data-action="copy-message">Copy message</button>
          <button class="btn btn-primary" data-action="whatsapp">Send on WhatsApp</button>` : ''}
      `,
    });

    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => copyText(btn.dataset.copy));
    });

    if (canShare) {
      const message = buildShareMessage({ employee, pin, password });
      modal.querySelector('[data-action="copy-message"]').addEventListener('click', () => {
        copyText(message, 'Message copied - paste it into WhatsApp, SMS, etc.');
      });
      modal.querySelector('[data-action="whatsapp"]').addEventListener('click', () => {
        const number = whatsappNumber(employee.phone);
        const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank', 'noopener');
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Page
   * ------------------------------------------------------------------ */

  function pageSkeleton() {
    const esc = window.UI.escapeHtml;
    return `
      <div class="page-header">
        <div>
          <h1>Employees</h1>
          <p>Manage staff accounts, roles, and branch access.</p>
        </div>
        <button class="btn btn-primary" id="add-employee-btn" data-requires-permission="employees.create">
          ${window.Icons.get('plus')} Add employee
        </button>
      </div>

      <div class="card" style="margin-bottom: var(--space-4)" data-requires-permission="employees.create">
        <div class="card-body" style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-4)">
          <div style="min-width:0">
            <div class="text-xs text-muted">Your Business ID - employees need this (plus their code and PIN) to log in at the till</div>
            <div class="font-semibold" id="business-id-value" style="font-family:monospace; word-break:break-all">${businessId ? esc(businessId) : '<span class="text-muted">Unavailable - refresh the page</span>'}</div>
          </div>
          <div style="display:flex; gap:var(--space-2); flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" id="copy-business-id" ${businessId ? '' : 'disabled'}>Copy ID</button>
            <button class="btn btn-secondary btn-sm" id="copy-login-link" ${businessId ? '' : 'disabled'}>Copy login link</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="search-input" type="text" placeholder="Search by name, phone, or code" />
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Contact</th>
                <th>Branches</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="employees-tbody">${window.UI.skeletonRows(6, 4)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  function bindToolbar() {
    document.getElementById('add-employee-btn').addEventListener('click', async () => {
      const branches = await getBranches();
      openEmployeeModal(null, branches);
    });
    document.getElementById('copy-business-id').addEventListener('click', () => copyText(businessId, 'Business ID copied'));
    document.getElementById('copy-login-link').addEventListener('click', () => copyText(loginLink(), 'Login link copied'));
    document.getElementById('search-input').addEventListener('input', window.UI.debounce((e) => {
      state.search = e.target.value.trim();
      state.page = 1;
      fetchAndRender();
    }));
  }

  async function getBranches() {
    if (branchesCache) return branchesCache;
    const { data } = await window.Api.get('/branches', { page: 1, limit: 100 });
    branchesCache = data.items;
    return branchesCache;
  }

  async function fetchAndRender() {
    const tbody = document.getElementById('employees-tbody');
    tbody.innerHTML = window.UI.skeletonRows(6, 4);

    try {
      const [{ data }, branches] = await Promise.all([
        window.Api.get('/employees', { page: state.page, limit: state.limit, search: state.search }),
        getBranches(),
      ]);
      state.total = data.total;
      state.pages = data.pages;
      renderRows(data.items, branches);
      window.UI.renderPagination(document.getElementById('pagination'), state, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load employees', message: err.message })}</td></tr>`;
    }
  }

  function branchNames(branchIds, branches) {
    if (!branchIds?.length) return '<span class="text-muted">None</span>';
    const names = branchIds
      .map((id) => branches.find((b) => b._id === id)?.name)
      .filter(Boolean);
    if (!names.length) return '<span class="text-muted">None</span>';
    if (names.length <= 2) return window.UI.escapeHtml(names.join(', '));
    return `${window.UI.escapeHtml(names.slice(0, 2).join(', '))} <span class="text-muted">+${names.length - 2}</span>`;
  }

  const STATUS_BADGE = { active: 'badge-success', inactive: 'badge-neutral', suspended: 'badge-danger' };

  function renderRows(items, branches) {
    const tbody = document.getElementById('employees-tbody');

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({
        icon: 'employees',
        title: state.search ? 'No employees match your search' : 'No employees yet',
        message: state.search ? '' : 'Add cashiers, managers, and other staff to get started.',
      })}</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((u) => `
      <tr data-id="${u._id}">
        <td>
          <div class="flex items-center gap-3">
            <div class="avatar" style="width:32px;height:32px;font-size:var(--text-xs)">${window.UI.initials(u.name)}</div>
            <div>
              <div class="cell-primary">${window.UI.escapeHtml(u.name)}</div>
              ${u.employeeCode
                ? `<div class="text-xs text-muted">Code: ${window.UI.escapeHtml(u.employeeCode)}</div>`
                : (u.role === 'OWNER' ? '' : `<div class="text-xs" style="color:var(--color-danger, #b42318)">No code - can't use PIN login</div>`)}
            </div>
          </div>
        </td>
        <td><span class="badge role-badge role-${u.role}">${u.role}</span></td>
        <td>
          <div class="text-sm">${window.UI.escapeHtml(u.phone)}</div>
          ${u.email ? `<div class="text-xs text-muted">${window.UI.escapeHtml(u.email)}</div>` : ''}
        </td>
        <td class="text-sm">${branchNames(u.branchIds, branches)}</td>
        <td><span class="badge ${STATUS_BADGE[u.status] || 'badge-neutral'}">${u.status}</span></td>
        <td class="actions">
          ${u.role === 'OWNER' ? '' : `
            <button class="btn btn-ghost btn-sm" data-action="info" data-requires-permission="employees.create" title="Show login details to share">Login info</button>
            <button class="btn btn-ghost btn-sm btn-icon" data-action="edit" data-requires-permission="employees.update" title="Edit">${window.Icons.get('edit')}</button>
            <div class="dropdown">
              <button class="btn btn-ghost btn-sm btn-icon" data-action="menu" data-requires-permission="employees.update" title="More">${window.Icons.get('dots')}</button>
            </div>
          `}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="info"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const employee = items.find((u) => u._id === btn.closest('tr').dataset.id);
        openLoginDetailsModal({ employee });
      });
    });

    tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const employee = items.find((u) => u._id === btn.closest('tr').dataset.id);
        openEmployeeModal(employee, branches);
      });
    });

    tbody.querySelectorAll('[data-action="menu"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const employee = items.find((u) => u._id === btn.closest('tr').dataset.id);
        openStatusMenu(btn, employee);
      });
    });
  }

  function openStatusMenu(triggerBtn, employee) {
    document.querySelectorAll('.dropdown-menu').forEach((m) => m.remove());

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu';
    const options = [
      { status: 'active', label: 'Set active' },
      { status: 'inactive', label: 'Deactivate' },
      { status: 'suspended', label: 'Suspend' },
    ].filter((o) => o.status !== employee.status);

    menu.innerHTML = options.map((o) => `<button data-status="${o.status}" class="${o.status !== 'active' ? 'danger' : ''}">${o.label}</button>`).join('');
    triggerBtn.closest('.dropdown').appendChild(menu);

    menu.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', async () => {
        menu.remove();
        const newStatus = b.dataset.status;
        const ok = await window.UI.confirmDialog({
          title: `${b.textContent.trim()}?`,
          message: `${employee.name} will ${newStatus === 'active' ? 'regain' : 'lose'} access to the system.`,
          confirmText: b.textContent.trim(),
          danger: newStatus !== 'active',
        });
        if (!ok) return;
        try {
          await window.Api.patch(`/employees/${employee._id}/status`, { status: newStatus });
          window.UI.toast.success('Employee status updated');
          fetchAndRender();
        } catch (err) {
          window.UI.toast.error(err.message);
        }
      });
    });

    const closeOnOutsideClick = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeOnOutsideClick);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 0);
  }

  function branchCheckboxes(branches, selectedIds = []) {
    return branches.map((b) => `
      <label class="checkbox-row" style="margin-bottom: var(--space-2)">
        <input type="checkbox" name="branchIds" data-checkbox-group="true" value="${b._id}" ${selectedIds.includes(b._id) ? 'checked' : ''} />
        <span class="text-sm">${window.UI.escapeHtml(b.name)} <span class="text-muted">(${window.UI.escapeHtml(b.code)})</span></span>
      </label>
    `).join('');
  }

  // Suggests the next code, e.g. C001, C002... The owner can overwrite it.
  // state.total includes the owner, so the first employee gets C001.
  function suggestEmployeeCode() {
    return `C${String(Math.max(state.total, 1)).padStart(3, '0')}`;
  }

  function openEmployeeModal(employee, branches) {
    const isEdit = !!employee;
    const codeValue = isEdit ? (employee.employeeCode || '') : suggestEmployeeCode();

    const bodyHtml = `
      <form id="employee-form">
        <div class="field">
          <label for="e-name">Full name</label>
          <input class="input" id="e-name" name="name" required value="${isEdit ? window.UI.escapeHtml(employee.name) : ''}" placeholder="John Kamau" />
        </div>
        <div class="form-row">
          <div class="field">
            <label for="e-phone">Phone</label>
            <input class="input" id="e-phone" name="phone" required value="${isEdit ? window.UI.escapeHtml(employee.phone) : ''}" placeholder="0712345678" />
          </div>
          <div class="field">
            <label for="e-email">Email <span class="text-muted">(optional)</span></label>
            <input class="input" id="e-email" name="email" type="email" value="${isEdit ? window.UI.escapeHtml(employee.email || '') : ''}" placeholder="john@business.com" />
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="e-role">Role</label>
            <select class="select" id="e-role" name="role" required>
              ${ROLES.map((r) => {
                const selected = isEdit ? employee.role === r : r === DEFAULT_NEW_ROLE;
                return `<option value="${r}" ${selected ? 'selected' : ''}>${r.charAt(0)}${r.slice(1).toLowerCase()}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="field">
            <label for="e-code">Employee code <span class="text-muted">(needed for PIN login)</span></label>
            <input class="input" id="e-code" name="employeeCode" autocomplete="off" autocapitalize="off" spellcheck="false" value="${window.UI.escapeHtml(codeValue)}" placeholder="C001" />
            <span class="field-hint">The employee types this at the till, together with the Business ID and PIN</span>
          </div>
        </div>

        ${!isEdit ? `
          <div class="field">
            <label>Login credential <span class="text-muted">(set at least one)</span></label>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="e-password">Password <span class="text-muted">(for app login)</span></label>
              <input class="input" id="e-password" name="password" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters" />
            </div>
            <div class="field">
              <label for="e-pin">PIN <span class="text-muted">(for till login)</span></label>
              <input class="input" id="e-pin" name="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="4-8 digits" />
            </div>
          </div>
        ` : `
          <div class="form-alert form-alert-success" style="margin-bottom: var(--space-4)">
            ${window.Icons.get('lock')}
            <span>Password/PIN reset isn't available yet - that's coming in a later phase.</span>
          </div>
        `}

        <div class="field">
          <label>Branch access</label>
          <div style="max-height:180px; overflow-y:auto; border:1px solid var(--color-border); border-radius:var(--radius-md); padding: var(--space-3)">
            ${branches.length ? branchCheckboxes(branches, isEdit ? (employee.branchIds || []) : []) : '<span class="text-sm text-muted">No branches yet - add one first.</span>'}
          </div>
        </div>
      </form>
    `;

    const modal = window.UI.openModal({
      title: isEdit ? 'Edit employee' : 'Add employee',
      bodyHtml,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="employee-save-btn">${isEdit ? 'Save changes' : 'Add employee'}</button>
      `,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#employee-form');
      if (!form.reportValidity()) return;

      const payload = window.UI.serializeForm(form);
      // serializeForm collapses a single checked checkbox to a string; normalize to array.
      if (payload.branchIds && !Array.isArray(payload.branchIds)) payload.branchIds = [payload.branchIds];
      if (!payload.branchIds) payload.branchIds = [];

      // Trim, and drop empty optional fields. Empty strings would otherwise
      // hit the sparse unique indexes (email / employeeCode) as a real value.
      ['email', 'employeeCode', 'password', 'pin'].forEach((key) => {
        if (typeof payload[key] === 'string') payload[key] = payload[key].trim();
        if (payload[key] === '') delete payload[key];
      });

      if (!isEdit) {
        if (!payload.password && !payload.pin) {
          window.UI.toast.error('Set a password or a PIN for this employee');
          return;
        }
        if (payload.pin && !/^\d{4,8}$/.test(payload.pin)) {
          window.UI.toast.error('PIN must be 4 to 8 digits');
          return;
        }
        if (payload.pin && !payload.employeeCode) {
          window.UI.toast.error('Add an employee code - it is needed for PIN login');
          return;
        }
      }

      const plainPin = payload.pin;
      const plainPassword = payload.password;

      const btn = document.getElementById('employee-save-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');

      try {
        if (isEdit) {
          await window.Api.put(`/employees/${employee._id}`, payload);
          window.UI.toast.success('Employee updated');
          window.UI.closeModal();
          fetchAndRender();
        } else {
          const { data } = await window.Api.post('/employees', payload);
          window.UI.toast.success('Employee added');
          window.UI.closeModal();
          fetchAndRender();
          // Show the credentials NOW - the PIN/password can't be retrieved later.
          openLoginDetailsModal({
            employee: data.user,
            pin: plainPin,
            password: plainPassword,
            justCreated: true,
          });
        }
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) {
          window.UI.applyFormErrors(form, err.errors);
        } else {
          window.UI.toast.error(err.message);
        }
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();