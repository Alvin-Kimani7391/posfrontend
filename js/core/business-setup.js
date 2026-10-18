/**
 * business-setup.js
 * Everything about choosing and customising the business type, and the Setup guide's step logic.
 * Used by: onboarding.html (inline picker + checklist), settings.html (change type), the dashboard
 * (progress card) and, through app-shell.js, the one-time pop-up for EXISTING businesses.
 *
 * Needs: window.Api, UI, Icons, Permissions, AppShell, BusinessTypes (js/core/business-types.js).
 *
 * Saving a type:  PUT /business { businessType, featureSettings: <every flag, explicit> }
 *                 then PUT /business/onboarding { typeConfirmed: true }
 * Every flag is sent explicitly, so what the owner sees in the switches is exactly what is stored
 * (the backend keeps locked-on features - e.g. pharmacy batch tracking - on regardless).
 */
(function (window) {
  const BT = () => window.BusinessTypes;
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);

  /* ================================================================== *
   * Saving
   * ================================================================== */
  async function saveSelection(type, flags) {
    const bt = BT();
    const full = Object.fromEntries(bt.featureKeys().map((k) => [k, !!flags[k]]));
    bt.lockedFor(type).forEach((k) => { full[k] = true; });
    await window.Api.put('/business', { businessType: type, featureSettings: full });
    await window.Api.put('/business/onboarding', { typeConfirmed: true });
    await window.AppShell.refreshBusinessProfile?.();
    // Restaurant / accommodation businesses continue in their own setup guide (stations, tables, menu, rooms).
    if ((type === 'restaurant' || full.restaurantOrdering || full.accommodation) && !/^hx-/.test((location.pathname.split('/').pop() || ''))) {
      window.location.href = 'hx-setup.html?welcome=1';
      await new Promise(() => {}); // navigating away: keep callers from drawing over the page
    }
  }

  /** "Keep the standard setup": confirm the current type/flags without changing anything. */
  async function keepCurrent() {
    await window.Api.put('/business/onboarding', { typeConfirmed: true });
    await window.AppShell.refreshBusinessProfile?.();
  }

  /* ================================================================== *
   * Type picker + customise (inline component)
   * ================================================================== */
  /**
   * mountTypePicker(container, { type, flags, saveLabel, onSaved, onCancel, showKeep })
   * Two views in one component: "choose" (cards) and "customise" (switches).
   */
  function mountTypePicker(container, opts = {}) {
    const bt = BT();
    const state = {
      view: 'choose',
      type: opts.type && bt.TYPES[opts.type] ? opts.type : 'general_shop',
      flags: opts.flags ? { ...bt.defaultsFor(opts.type), ...opts.flags } : bt.defaultsFor(opts.type || 'general_shop'),
      saving: false,
    };

    const enabledLabels = (flags) => bt.featureKeys().filter((k) => flags[k]).map((k) => bt.FEATURES[k].label);

    function render() { state.view === 'choose' ? renderChoose() : renderCustomise(); }

    function renderChoose() {
      const cards = bt.typeKeys().map((key) => {
        const info = bt.typeInfo(key);
        const inc = enabledLabels(bt.defaultsFor(key));
        return `
          <button type="button" class="bt-card ${state.type === key ? 'selected' : ''}" data-type="${key}" aria-pressed="${state.type === key}">
            <span class="bt-card-icon">${window.Icons.get(info.icon)}</span>
            <span class="bt-card-title">${esc(info.label)}</span>
            <span class="bt-card-blurb">${esc(info.blurb)}</span>
            <span class="bt-card-inc">${inc.length ? esc(inc.slice(0, 3).join(' · ')) + (inc.length > 3 ? ` +${inc.length - 3}` : '') : 'Standard features'}</span>
          </button>`;
      }).join('');
      container.innerHTML = `
        <div class="bt-picker">
          <p class="text-secondary text-sm" style="margin-bottom:var(--space-4)">
            Pick what is closest to your business. Your menu and forms will show only what fits it.
            Not listed? Choose <strong>General shop</strong> or <strong>Other</strong> - you get the standard features
            and can switch on anything extra later.
          </p>
          <div class="bt-grid">${cards}</div>
          <div class="bt-actions">
            ${opts.onCancel ? '<button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>' : ''}
            ${opts.showKeep ? '<button type="button" class="btn btn-ghost" data-act="keep">Keep standard setup</button>' : ''}
            <span style="flex:1"></span>
            <button type="button" class="btn btn-secondary" data-act="customise">${window.Icons.get('sliders')} Customise features</button>
            <button type="button" class="btn btn-primary" data-act="save">${esc(opts.saveLabel || 'Use this setup')}</button>
          </div>
        </div>`;
      container.querySelectorAll('.bt-card').forEach((c) => c.addEventListener('click', () => {
        if (state.type !== c.dataset.type) { state.type = c.dataset.type; state.flags = bt.defaultsFor(state.type); }
        renderChoose();
      }));
      bind();
    }

    function renderCustomise() {
      const info = bt.typeInfo(state.type);
      const locked = new Set(bt.lockedFor(state.type));
      const groups = {};
      bt.featureKeys().forEach((k) => { (groups[bt.FEATURES[k].group] = groups[bt.FEATURES[k].group] || []).push(k); });
      const order = [...bt.GROUP_ORDER, ...Object.keys(groups).filter((g) => !bt.GROUP_ORDER.includes(g))].filter((g) => groups[g]);
      const body = order.map((g) => `
        <div class="bt-group">
          <div class="bt-group-title">${esc(g)}</div>
          ${groups[g].map((k) => {
            const f = bt.FEATURES[k];
            const isLocked = locked.has(k);
            return `
              <label class="bt-feature ${isLocked ? 'locked' : ''}">
                <input type="checkbox" data-feature="${k}" ${state.flags[k] ? 'checked' : ''} ${isLocked ? 'disabled' : ''} />
                <span class="bt-feature-text">
                  <span class="bt-feature-name">${esc(f.label)}
                    ${isLocked ? `<span class="badge badge-neutral">Required for ${esc(info.label)}</span>` : ''}
                    ${f.ready ? '' : '<span class="badge badge-info">Screens coming soon</span>'}
                  </span>
                  <span class="bt-feature-desc">${esc(f.desc)}</span>
                </span>
              </label>`;
          }).join('')}
        </div>`).join('');
      container.innerHTML = `
        <div class="bt-picker">
          <div class="bt-custom-head">
            <div><strong>${esc(info.label)}</strong><div class="text-xs text-muted">Switch features on or off. You can change this any time in Settings.</div></div>
            <button type="button" class="btn btn-ghost btn-sm" data-act="reset">Reset to ${esc(info.label)} defaults</button>
          </div>
          ${body}
          <div class="bt-actions">
            <button type="button" class="btn btn-secondary" data-act="back">Back</button>
            <span style="flex:1"></span>
            <button type="button" class="btn btn-primary" data-act="save">${esc(opts.saveLabel || 'Save and continue')}</button>
          </div>
        </div>`;
      container.querySelectorAll('[data-feature]').forEach((cb) => cb.addEventListener('change', () => {
        state.flags = bt.applyToggle(state.flags, cb.dataset.feature, cb.checked, state.type);
        renderCustomise();
      }));
      bind();
    }

    function bind() {
      const on = (act, fn) => container.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);
      on('customise', () => { state.view = 'customise'; render(); container.scrollIntoView?.({ block: 'nearest' }); });
      on('back', () => { state.view = 'choose'; render(); });
      on('reset', () => { state.flags = bt.defaultsFor(state.type); render(); });
      on('cancel', () => opts.onCancel && opts.onCancel());
      on('keep', async (e) => {
        const btn = e.currentTarget; window.UI.setButtonLoading(btn, true, 'Saving…');
        try { await keepCurrent(); opts.onSaved && opts.onSaved({ kept: true }); }
        catch (err) { window.UI.toast.error(err.message || 'Could not save'); window.UI.setButtonLoading(btn, false); }
      });
      on('save', async (e) => {
        if (state.saving) return;
        const btn = e.currentTarget; state.saving = true; window.UI.setButtonLoading(btn, true, 'Saving…');
        try {
          await saveSelection(state.type, state.flags);
          window.UI.toast.success(`${bt.typeInfo(state.type).label} setup saved`);
          opts.onSaved && opts.onSaved({ type: state.type, flags: state.flags });
        } catch (err) {
          window.UI.toast.error(err.message || 'Could not save your business type');
          window.UI.setButtonLoading(btn, false);
        } finally { state.saving = false; }
      });
    }

    render();
    return { getState: () => state };
  }

  /** Same picker inside a modal (Settings -> Change type, and the existing-business pop-up). */
  async function openTypePickerModal(opts = {}) {
    await BT().syncWithBackend();
    const prof = window.AppShell.getBusinessProfile?.() || {};
    const modal = window.UI.openModal({
      title: opts.title || 'Business type & features',
      bodyHtml: '<div id="bt-modal-slot"></div>',
      maxWidth: '860px',
    });
    mountTypePicker(modal.querySelector('#bt-modal-slot'), {
      type: opts.type || prof.businessType || 'general_shop',
      flags: opts.flags || prof.featureSettings,
      saveLabel: 'Save',
      showKeep: !!opts.showKeep,
      onCancel: () => window.UI.closeModal(),
      onSaved: (r) => { window.UI.closeModal(); opts.onSaved && opts.onSaved(r); },
    });
  }

  /* ================================================================== *
   * Pop-up for businesses that existed before business types
   * ================================================================== */
  const SESSION_KEY = 'pos.typePromptShown';

  async function maybePromptExisting() {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      const { data } = await window.Api.get('/business/onboarding');
      const o = data.onboarding;
      if (o.typeConfirmed) return;
      if (o.typePromptSnoozedUntil && new Date(o.typePromptSnoozedUntil) > new Date()) return;
      sessionStorage.setItem(SESSION_KEY, '1');
      await BT().syncWithBackend();
      const modal = window.UI.openModal({
        title: 'Personalise your Six Star Pos',
        bodyHtml: `
          <div class="bt-existing">
            <p>Six Star Pos can now fit your kind of business: a supermarket, pharmacy, electronics shop, garage and more.
            Choose yours and your menu, forms and tools will match it. Nothing you already have is removed.</p>
            <div class="bt-existing-actions">
              <button class="btn btn-primary" data-act="choose">${window.Icons.get('sliders')} Choose my business type</button>
              <button class="btn btn-secondary" data-act="keep">Keep the standard setup</button>
              <button class="btn btn-ghost" data-act="later">Remind me later</button>
            </div>
          </div>`,
        maxWidth: '520px',
      });
      const closeIt = () => window.UI.closeModal();
      modal.querySelector('[data-act="choose"]').addEventListener('click', () => {
        closeIt();
        openTypePickerModal({ title: 'Choose your business type', showKeep: true, onSaved: () => { if (window.location.pathname.endsWith('settings.html')) window.location.reload(); } });
      });
      modal.querySelector('[data-act="keep"]').addEventListener('click', async () => {
        try { await keepCurrent(); window.UI.toast.success('Standard setup kept. You can change it in Settings.'); } catch (e) { window.UI.toast.error(e.message); }
        closeIt();
      });
      modal.querySelector('[data-act="later"]').addEventListener('click', async () => {
        try { await window.Api.put('/business/onboarding', { snoozeTypePrompt: true }); } catch { /* ignore */ }
        closeIt();
      });
    } catch { /* not allowed / offline: never block the app */ }
  }

  /* ================================================================== *
   * Setup guide: steps, detection, progress
   * ================================================================== */
  const can = (p) => window.Permissions.can(window.AppShell.getUser(), p);
  const total = async (path, query) => { const { data } = await window.Api.get(path, query); return data.total ?? (data.items || data.registers || []).length ?? 0; };

  function stepDefs(profile) {
    const f = (k) => profile?.featureSettings?.[k] === true;
    const defs = [
      { key: 'type', title: 'Choose your business type', desc: 'Tell the system what you sell so the menu and forms fit your business. You can customise every feature.', inline: true, optional: false },
      { key: 'branches', title: 'Add your branches', desc: 'Your Main Branch already exists. Add more if you sell from several shops or warehouses.', href: 'branches.html', add: true, label: 'Add a branch', permission: 'branches.create', optional: true,
        detect: async () => { const n = await total('/branches', { page: 1, limit: 1 }); return { done: n > 1, note: `${n} branch${n === 1 ? '' : 'es'} so far` }; } },
      { key: 'employees', title: 'Add your employees', desc: 'Add cashiers, managers and storekeepers. Share the Business ID, their code and PIN so they can log in.', href: 'employees.html', add: true, label: 'Add an employee', permission: 'employees.create', optional: true,
        detect: async () => { const n = Math.max(await total('/employees', { page: 1, limit: 1 }) - 1, 0); return { done: n > 0, note: `${n} employee${n === 1 ? '' : 's'} added` }; } },
      { key: 'products', title: 'Add your products', desc: 'Enter each product with its name, price and barcode. The more you add now, the faster you can start selling.', href: 'products.html', add: true, label: 'Add a product', permission: 'products.create',
        detect: async () => { const n = await total('/products', { page: 1, limit: 1 }); return { done: n > 0, count: n, note: `${n} product${n === 1 ? '' : 's'} added` }; } },
      { key: 'labels', title: 'Print shelf price list & labels', desc: 'Print a full list of your products with name, price and barcode, then cut it into small labels to stick on the shelves so customers see prices before adding to cart.', href: 'shelf-labels.html', label: 'Print list & labels', permission: 'products.view', needs: 'products', manual: true },
      { key: 'inventory', title: 'Add your opening stock', desc: 'Receive the stock you have on the shelves now so quantities are right from day one.', href: 'inventory.html', add: true, label: 'Receive stock', permission: 'inventory.receive', needs: 'products',
        detect: async () => { const n = await total('/inventory/movements', { page: 1, limit: 1 }); return { done: n > 0, note: n ? 'Stock recorded' : '' }; } },
    ];
    if (f('batchTracking') || f('expiryTracking')) defs.push({ key: 'batches', title: 'Learn batches & expiry', desc: 'Receive stock with batch numbers and expiry dates, and see what is about to expire.', href: 'batches.html', label: 'Open Batches & expiry', permission: 'batches.view', manual: true });
    if (f('serialNumberTracking')) defs.push({ key: 'serials', title: 'Track serial numbers', desc: 'Look up a unit by serial number / IMEI and see where it went.', href: 'serials.html', label: 'Open Serial numbers', permission: 'serials.view', manual: true });
    if (f('warrantyManagement')) defs.push({ key: 'warranty', title: 'Set up warranty claims', desc: 'Open and decide warranty claims on units you have sold.', href: 'warranty.html', label: 'Open Warranty claims', permission: 'warranty.view', manual: true });
    if (f('repairManagement')) defs.push({ key: 'repairs', title: 'Set up repairs', desc: 'Take items in for repair and follow each job until collection.', href: 'repairs.html', label: 'Open Repairs', permission: 'repairs.view', manual: true });
    if (f('vehicleManagement')) defs.push({ key: 'vehicles', title: 'Register your first vehicle', desc: 'Keep a register of customer vehicles and their service history.', href: 'vehicles.html', add: true, label: 'Add a vehicle', permission: 'vehicles.manage',
      detect: async () => { const n = await total('/vehicles', { page: 1, limit: 1 }); return { done: n > 0, note: `${n} vehicle${n === 1 ? '' : 's'}` }; } });
    if (f('jobCards')) defs.push({ key: 'jobcards', title: 'Open your first job card', desc: 'Record the work, parts and labour for a vehicle and follow it to payment.', href: 'job-cards.html', add: true, label: 'Open Job cards', permission: 'jobcards.view', manual: true });
    defs.push(
      { key: 'registers', title: 'Add cash registers', desc: 'A register is a till. Add one for each counter, per branch.', href: 'cash-register.html', query: { tab: 'registers' }, add: true, label: 'Add a register', permission: 'registers.manage',
        detect: async () => { const { data } = await window.Api.get('/registers'); const n = (data.registers || []).length; return { done: n > 0, note: `${n} register${n === 1 ? '' : 's'}` }; } },
      { key: 'shifts', title: 'Open your first shift', desc: 'A shift starts with the cash in the drawer and ends with a count. Open the Sales screen and start a shift to see how selling and cash control work together.', href: 'sales.html', label: 'Open Sales & start a shift', permission: 'shifts.open', needs: 'registers',
        detect: async () => { const n = await total('/shifts', { page: 1, limit: 1 }); return { done: n > 0, note: n ? 'A shift has been opened' : '' }; } },
      { key: 'settings', title: 'Review your settings', desc: 'Check receipt text, tax, payment methods (cash, M-PESA), discounts and offline mode so the system behaves the way your business does.', href: 'settings.html', label: 'Open Settings', permission: 'settings.view', manual: true },
      { key: 'stocktake', title: 'Try a stocktake (optional)', desc: 'Count what is on the shelves and compare it with the system to find losses early.', href: 'stocktakes.html', label: 'Open Stocktake', permission: 'stocktake.view', manual: true, optional: true },
    );
    return defs;
  }

  /** Link into a step's page, carrying ?from=onboarding so the page opens its form / shows the return bar. */
  function stepHref(d) {
    const q = new URLSearchParams({ from: 'onboarding', step: d.key });
    if (d.add) q.set('action', 'add');
    if (d.query) Object.entries(d.query).forEach(([k, v]) => q.set(k, v));
    return `${d.href}?${q.toString()}`;
  }

  /**
   * loadProgress() -> { steps:[{...def, done, status, note, locked}], doneCount, total, state, profile }
   * done  = detected from real data OR marked done by the owner. skipped steps count as finished.
   */
  async function loadProgress() {
    const [{ data }, profile] = await Promise.all([window.Api.get('/business/onboarding'), window.AppShell.whenProfileReady()]);
    const state = data.onboarding;
    const marks = Object.fromEntries((state.steps || []).map((s) => [s.key, s.status]));
    const defs = stepDefs(profile).filter((d) => !d.permission || can(d.permission) || d.key === 'type');

    await Promise.all(defs.map(async (d) => {
      d.status = marks[d.key] || 'pending';
      d.autoDetected = false;
      if (d.key === 'type') { d.done = !!state.typeConfirmed; return; }
      if (d.detect) {
        try { const r = await d.detect(); d.autoDetected = !!r.done; d.note = r.note; d.count = r.count; d.done = r.done; }
        catch { d.done = false; d.detectFailed = true; }
      }
      if (!d.done) d.done = d.status === 'done';
    }));
    defs.forEach((d) => { d.skipped = !d.done && d.status === 'skipped'; });
    const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
    defs.forEach((d) => { d.locked = !!(d.needs && byKey[d.needs] && !(byKey[d.needs].done || byKey[d.needs].skipped)); });

    const finished = defs.filter((d) => d.done || d.skipped).length;
    const out = { steps: defs, doneCount: finished, total: defs.length, state, profile };
    window.AppShell.setSetupProgress?.(finished, defs.length);
    return out;
  }

  const setStep = (key, status) => window.Api.put('/business/onboarding', { step: { key, status } });
  /** Fire-and-forget: record a step as done (used by the labels page after printing). */
  async function markStepDone(key) { try { if (can('settings.update')) await setStep(key, 'done'); } catch { /* ignore */ } }

  window.BusinessSetup = {
    saveSelection, keepCurrent, mountTypePicker, openTypePickerModal, maybePromptExisting,
    stepDefs, stepHref, loadProgress, setStep, markStepDone,
    updateOnboarding: (body) => window.Api.put('/business/onboarding', body),
  };
})(window);
