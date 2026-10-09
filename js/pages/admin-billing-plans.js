/**
 * admin-billing-plans.js - view, edit and create plans. A plan is an ordered list of phases:
 *   TRIAL (free days) | INSTALLMENTS (total split into N monthly parts) | RECURRING (FLAT or TIERED monthly fee).
 * Money is typed in KES and sent as cents. For TIERED + SALES_VALUE the tier limits are also KES.
 * Editing a plan only changes FUTURE invoices; invoices already issued keep their amounts.
 */
(function () {
  const AB = window.AdminBilling;
  const { esc, kes, formModal, val } = AB;
  let el;
  let plans = [];

  document.addEventListener('DOMContentLoaded', () => {
    el = window.AdminShell.mount({ title: 'Billing plans' });
    if (!el) return;
    el.innerHTML = `
      <div class="page-header">
        <div><h1>Plans & prices</h1><p>Change amounts any time, or add a new subscription type.</p></div>
        <div class="page-actions"><button class="btn btn-primary btn-sm" id="pl-new">New plan</button></div>
      </div>
      ${AB.subnav('plans')}
      <div id="pl-list"></div>`;
    document.getElementById('pl-new').addEventListener('click', () => openEditor(null));
    load();
  });

  async function load() {
    const host = document.getElementById('pl-list');
    host.innerHTML = window.UI.skeletonRows(3, 1);
    try {
      ({ data: { items: plans } } = await window.Api.get('/admin/billing/plans'));
      host.innerHTML = plans.map(planCard).join('') || window.UI.emptyStateHtml({ icon: 'reports', title: 'No plans yet' });
      host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(plans.find((p) => p._id === b.dataset.edit))));
      host.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggle(plans.find((p) => p._id === b.dataset.toggle), b)));
    } catch (err) {
      host.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load plans', message: err.message })}</div>`;
    }
  }

  const unit = (m) => (m === 'SALES_VALUE' ? 'in sales' : 'sales');
  function phaseLine(ph) {
    if (ph.type === 'TRIAL') return `<b>${esc(ph.name)}</b>: ${ph.durationDays} days free`;
    if (ph.type === 'INSTALLMENTS') return `<b>${esc(ph.name)}</b>: ${kes(ph.totalAmountCents)} over ${ph.durationMonths} month(s) in ${ph.installments || ph.durationMonths} monthly instalment(s)`;
    const every = ph.intervalMonths > 1 ? `every ${ph.intervalMonths} months` : 'monthly';
    const length = ph.durationMonths ? `for ${ph.durationMonths} months` : 'ongoing';
    if (ph.pricingMode === 'TIERED') {
      const tiers = (ph.tiers || []).map((t) => `${t.upTo == null ? 'above' : `up to ${ph.tierMetric === 'SALES_VALUE' ? kes(t.upTo) : Number(t.upTo).toLocaleString()}`} ${unit(ph.tierMetric)} → ${kes(t.amountCents)}`).join('; ');
      return `<b>${esc(ph.name)}</b>: ${every}, ${length}, by usage (${tiers})`;
    }
    return `<b>${esc(ph.name)}</b>: ${kes(ph.amountCents)} ${every}, ${length}`;
  }

  function planCard(p) {
    return `
      <section class="card bl-card-gap">
        <div class="card-header">
          <div><h2>${esc(p.name)} <span class="badge ${p.isActive ? 'badge-success' : 'badge-neutral'}">${p.isActive ? 'Active' : 'Inactive'}</span></h2>
            <p class="text-sm text-muted">Key: <code>${esc(p.key)}</code> · ${p.subscribers} business(es)${p.description ? ` · ${esc(p.description)}` : ''}</p></div>
          <div style="display:flex;gap:var(--space-2)">
            <button class="btn btn-secondary btn-sm" data-edit="${esc(p._id)}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-toggle="${esc(p._id)}">${p.isActive ? 'Deactivate' : 'Activate'}</button>
          </div>
        </div>
        <div class="card-body"><ol class="bl-plan-lines">${p.phases.map((ph) => `<li>${phaseLine(ph)}</li>`).join('')}</ol></div>
      </section>`;
  }

  async function toggle(p, btn) {
    window.UI.setButtonLoading(btn, true, '…');
    try { await window.Api.patch(`/admin/billing/plans/${p._id}/active`, { isActive: !p.isActive }); window.UI.toast.success('Plan updated'); load(); }
    catch (err) { window.UI.toast.error(AB.errText(err)); window.UI.setButtonLoading(btn, false); }
  }

  /* -------------------------------- editor -------------------------------- */
  const blank = (type = 'RECURRING') => ({
    type, key: '', name: '', existing: false, durationDays: 7,
    totalKES: '', instMonths: 3, installments: '', dueAfterDays: 0,
    intervalMonths: 1, recurMonths: '', pricingMode: 'TIERED', amountKES: '', tierMetric: 'TRANSACTION_COUNT',
    tiers: [{ label: '', upTo: '', amountKES: '' }],
  });

  function fromApi(ph) {
    const sv = ph.tierMetric === 'SALES_VALUE';
    return {
      ...blank(ph.type), type: ph.type, key: ph.key, name: ph.name, existing: true,
      durationDays: ph.durationDays || 7,
      totalKES: (ph.totalAmountCents || 0) / 100, instMonths: ph.durationMonths || 3, installments: ph.installments || '', dueAfterDays: ph.dueAfterDays || 0,
      intervalMonths: ph.intervalMonths || 1, recurMonths: ph.durationMonths || '', pricingMode: ph.pricingMode || 'FLAT',
      amountKES: (ph.amountCents || 0) / 100, tierMetric: ph.tierMetric || 'TRANSACTION_COUNT',
      tiers: (ph.tiers && ph.tiers.length ? ph.tiers : [{}]).map((t) => ({ label: t.label || '', upTo: t.upTo == null ? '' : sv ? t.upTo / 100 : t.upTo, amountKES: (t.amountCents || 0) / 100 })),
    };
  }

  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const num = (x, label) => { const n = Number(x); if (x === '' || !Number.isFinite(n)) throw new Error(`Check the numbers in ${label}`); return n; };
  const inp = (i, f, v, attrs = '') => `<input class="input" data-i="${i}" data-f="${f}" value="${esc(v)}" ${attrs} />`;

  function phaseHtml(ph, i, total) {
    const lock = ph.existing ? 'readonly' : '';
    let body = '';
    if (ph.type === 'TRIAL') {
      body = `<div class="field"><label>Free days</label>${inp(i, 'durationDays', ph.durationDays, 'type="number" min="1" max="365"')}</div>`;
    } else if (ph.type === 'INSTALLMENTS') {
      body = `
        <div class="form-row">
          <div class="field"><label>Total to pay (KES)</label>${inp(i, 'totalKES', ph.totalKES, 'type="number" min="0" step="1"')}</div>
          <div class="field"><label>Spread over (months)</label>${inp(i, 'instMonths', ph.instMonths, 'type="number" min="1" max="60"')}</div>
        </div>
        <div class="form-row">
          <div class="field"><label>Number of instalments <span class="text-muted">(blank = one per month)</span></label>${inp(i, 'installments', ph.installments, 'type="number" min="1" max="60"')}</div>
          <div class="field"><label>Due after issue (days)</label>${inp(i, 'dueAfterDays', ph.dueAfterDays, 'type="number" min="0" max="60"')}</div>
        </div>`;
    } else {
      const sv = ph.tierMetric === 'SALES_VALUE';
      body = `
        <div class="form-row">
          <div class="field"><label>Bill every (months)</label>${inp(i, 'intervalMonths', ph.intervalMonths, 'type="number" min="1" max="12"')}</div>
          <div class="field"><label>Runs for (months) <span class="text-muted">(blank = ongoing)</span></label>${inp(i, 'recurMonths', ph.recurMonths, 'type="number" min="1" max="120"')}</div>
        </div>
        <div class="form-row">
          <div class="field"><label>Pricing</label>
            <select class="select" data-i="${i}" data-f="pricingMode" data-rerender="1"><option value="FLAT" ${ph.pricingMode === 'FLAT' ? 'selected' : ''}>Flat amount</option><option value="TIERED" ${ph.pricingMode === 'TIERED' ? 'selected' : ''}>By usage (tiers)</option></select></div>
          <div class="field"><label>Due after issue (days)</label>${inp(i, 'dueAfterDays', ph.dueAfterDays, 'type="number" min="0" max="60"')}</div>
        </div>
        ${ph.pricingMode === 'FLAT'
          ? `<div class="field"><label>Amount (KES)</label>${inp(i, 'amountKES', ph.amountKES, 'type="number" min="0" step="1"')}</div>`
          : `<div class="field"><label>Usage measured by (previous month)</label>
              <select class="select" data-i="${i}" data-f="tierMetric" data-rerender="1"><option value="TRANSACTION_COUNT" ${!sv ? 'selected' : ''}>Number of sales</option><option value="SALES_VALUE" ${sv ? 'selected' : ''}>Total sales value (KES)</option></select></div>
            <label class="text-sm" style="font-weight:600">Tiers <span class="text-muted">(lowest first; the LAST tier must have no limit)</span></label>
            ${ph.tiers.map((t, k) => `
              <div class="bl-tier">
                <input class="input" data-i="${i}" data-t="${k}" data-f="label" value="${esc(t.label)}" placeholder="Label" />
                <input class="input" data-i="${i}" data-t="${k}" data-f="upTo" value="${esc(t.upTo)}" type="number" min="0" step="${sv ? 1 : 1}" placeholder="${sv ? 'Up to (KES)' : 'Up to (sales)'} - blank = no limit" />
                <input class="input" data-i="${i}" data-t="${k}" data-f="amountKES" value="${esc(t.amountKES)}" type="number" min="0" step="1" placeholder="Fee (KES)" />
                <button type="button" class="btn btn-ghost btn-sm" data-act="rm-tier" data-i="${i}" data-t="${k}" ${ph.tiers.length <= 1 ? 'disabled' : ''}>&times;</button>
              </div>`).join('')}
            <button type="button" class="btn btn-secondary btn-sm" data-act="add-tier" data-i="${i}">Add tier</button>`}`;
    }
    return `
      <div class="bl-phase">
        <div class="bl-phase-head">
          <b>Phase ${i + 1}</b>
          <span style="display:flex;gap:4px">
            <button type="button" class="btn btn-ghost btn-sm" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="down" data-i="${i}" ${i === total - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="rm-phase" data-i="${i}" ${total <= 1 || ph.existing ? 'disabled title="Phases in use cannot be removed - move businesses to another plan first"' : ''}>Remove</button>
          </span>
        </div>
        <div class="form-row">
          <div class="field"><label>Name</label>${inp(i, 'name', ph.name, 'maxlength="60"')}</div>
          <div class="field"><label>Type</label>
            <select class="select" data-i="${i}" data-f="type" data-rerender="1" ${ph.existing ? 'disabled' : ''}>
              <option value="TRIAL" ${ph.type === 'TRIAL' ? 'selected' : ''}>Free trial</option>
              <option value="INSTALLMENTS" ${ph.type === 'INSTALLMENTS' ? 'selected' : ''}>Instalments (fixed total)</option>
              <option value="RECURRING" ${ph.type === 'RECURRING' ? 'selected' : ''}>Recurring fee</option>
            </select></div>
        </div>
        <div class="field"><label>Key <span class="text-muted">(internal id${ph.existing ? ', fixed because businesses use it' : ''})</span></label>${inp(i, 'key', ph.key, `${lock} maxlength="40" placeholder="auto from name"`)}</div>
        ${body}
      </div>`;
  }

  function openEditor(plan) {
    const isEdit = !!plan;
    const phases = isEdit ? plan.phases.map(fromApi) : [blank('TRIAL'), blank('INSTALLMENTS'), blank('RECURRING')];
    if (!isEdit) { phases[0].name = 'Free trial'; phases[1].name = 'Setup'; phases[2].name = 'Monthly maintenance'; phases[1].dueAfterDays = 0; }

    const modal = formModal({
      title: isEdit ? `Edit plan - ${plan.name}` : 'New plan', submitText: isEdit ? 'Save plan' : 'Create plan', maxWidth: '760px',
      bodyHtml: `
        ${isEdit ? '<div class="bl-alert info"><div class="grow">Changes apply to <b>future</b> invoices only. Invoices already issued keep their amounts - edit those on the business page.</div></div>' : ''}
        <div class="form-row">
          <div class="field"><label>Plan name</label><input class="input" name="name" required minlength="2" maxlength="80" value="${esc(plan ? plan.name : '')}" /></div>
          <div class="field"><label>Key ${isEdit ? '<span class="text-muted">(fixed)</span>' : ''}</label><input class="input" name="key" ${isEdit ? 'readonly' : 'required'} pattern="[a-z0-9][a-z0-9_-]{1,39}" placeholder="e.g. premium" value="${esc(plan ? plan.key : '')}" /></div>
        </div>
        <div class="field"><label>Description <span class="text-muted">(optional)</span></label><input class="input" name="description" maxlength="300" value="${esc(plan ? plan.description : '')}" /></div>
        <div id="pl-phases"></div>
        <button type="button" class="btn btn-secondary btn-sm" data-act="add-phase">Add phase</button>`,
      onSubmit: async (f) => {
        collect();
        let body;
        try { body = build(f); } catch (e) { window.UI.toast.error(e.message); return false; }
        if (isEdit) await window.Api.put(`/admin/billing/plans/${plan._id}`, { ...body, isActive: plan.isActive });
        else await window.Api.post('/admin/billing/plans', { ...body, key: val(f, 'key') });
        window.UI.toast.success(isEdit ? 'Plan saved' : 'Plan created');
        load();
      },
    });

    const host = modal.querySelector('#pl-phases');
    const draw = () => { host.innerHTML = phases.map((ph, i) => phaseHtml(ph, i, phases.length)).join(''); };

    function collect() {
      host.querySelectorAll('[data-f]').forEach((x) => {
        const ph = phases[Number(x.dataset.i)];
        if (!ph) return;
        if (x.dataset.t !== undefined) ph.tiers[Number(x.dataset.t)][x.dataset.f] = x.value;
        else if (!x.disabled) ph[x.dataset.f] = x.value;
      });
    }

    function build(f) {
      if (!phases.length) throw new Error('Add at least one phase');
      return {
        name: val(f, 'name'),
        description: val(f, 'description') || undefined,
        phases: phases.map((ph, i) => {
          const label = `phase ${i + 1}`;
          if (!ph.name.trim()) throw new Error(`Give ${label} a name`);
          const key = (ph.key || slug(ph.name)).trim();
          const base = { type: ph.type, key, name: ph.name.trim() };
          if (ph.type === 'TRIAL') return { ...base, durationDays: num(ph.durationDays, label) };
          if (ph.type === 'INSTALLMENTS') {
            return {
              ...base, totalAmountCents: Math.round(num(ph.totalKES, label) * 100), durationMonths: num(ph.instMonths, label),
              ...(ph.installments !== '' ? { installments: num(ph.installments, label) } : {}), dueAfterDays: num(ph.dueAfterDays === '' ? 0 : ph.dueAfterDays, label),
            };
          }
          const rec = { ...base, intervalMonths: num(ph.intervalMonths, label), durationMonths: ph.recurMonths === '' ? null : num(ph.recurMonths, label), pricingMode: ph.pricingMode, dueAfterDays: num(ph.dueAfterDays === '' ? 0 : ph.dueAfterDays, label) };
          if (ph.pricingMode === 'FLAT') return { ...rec, amountCents: Math.round(num(ph.amountKES, label) * 100) };
          const sv = ph.tierMetric === 'SALES_VALUE';
          return {
            ...rec, tierMetric: ph.tierMetric,
            tiers: ph.tiers.map((t) => ({
              label: t.label.trim() || undefined,
              upTo: t.upTo === '' ? null : Math.round(num(t.upTo, label) * (sv ? 100 : 1)),
              amountCents: Math.round(num(t.amountKES, label) * 100),
            })),
          };
        }),
      };
    }

    modal.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.rerender) { collect(); draw(); } });
    modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const i = Number(b.dataset.i);
      collect();
      switch (b.dataset.act) {
        case 'add-phase': phases.push(blank('RECURRING')); break;
        case 'rm-phase': if (!phases[i].existing) phases.splice(i, 1); break;
        case 'up': if (i > 0) [phases[i - 1], phases[i]] = [phases[i], phases[i - 1]]; break;
        case 'down': if (i < phases.length - 1) [phases[i + 1], phases[i]] = [phases[i], phases[i + 1]]; break;
        case 'add-tier': phases[i].tiers.push({ label: '', upTo: '', amountKES: '' }); break;
        case 'rm-tier': phases[i].tiers.splice(Number(b.dataset.t), 1); break;
        default: return;
      }
      draw();
    });
    draw();
  }
})();