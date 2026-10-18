/**
 * hx-staff.js - shifts and tips. Staff clock in and out and see their tips; managers see who is on duty, schedule shifts and pay out tips.
 * API: POST /restaurant/duty/start|end, GET /restaurant/duty, GET/POST /restaurant/shifts, GET /restaurant/tips, GET /restaurant/tips/summary, POST /restaurant/tips/allocate|payout
 */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, dt, hm, ymd, addDays } = window.HX;
  let el, tab = 'duty';
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Shifts & tips'); if (!el) return; await window.AppShell.whenProfileReady?.(); paint(); }

  async function paint() {
    const tabs = [['duty', 'On duty'], ['shifts', 'Shifts']]; if (can('restaurant.tips.view')) tabs.push(['tips', 'Tips']);
    el.innerHTML = head('Shifts & tips', 'Clock in, see who is working and share the tips.') + window.HX.tabs(tabs, tab) + '<div id="sb"><div class="hx-card"><p class="hx-sub">Loading…</p></div></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
    const sb = el.querySelector('#sb'); if (tab === 'duty') return duty(sb); if (tab === 'shifts') return shifts(sb); return tips(sb);
  }

  async function duty(sb) {
    const [mine, all] = await Promise.all([get('/restaurant/shifts', { limit: 5, status: 'ON_DUTY' }), can('restaurant.shifts.view') ? get('/restaurant/duty', { branchId: window.HX.branchId() }) : null]);
    const me = window.HX.user(), mineOn = list(mine, 'shifts', 'items').find((s) => s.userId && (s.userId._id || s.userId) === (me._id || me.id));
    sb.innerHTML = `<div class="hx-card" style="margin-bottom:var(--space-4)"><div class="hx-row" style="padding:0"><div class="grow"><b>${mineOn ? 'You are on duty' : 'You are off duty'}</b><small class="hx-sub">${mineOn ? 'Since ' + hm(mineOn.clockIn) : 'Clock in to start taking tables and orders.'}</small></div><button class="btn ${mineOn ? 'btn-secondary' : 'btn-primary'}" id="clk">${mineOn ? 'Clock out' : 'Clock in'}</button></div></div>` +
      (all ? `<div class="hx-section"><h2>Working now</h2>${list(all, 'duty', 'shifts').length ? `<div class="hx-card flush">${list(all, 'duty', 'shifts').map((s) => { const u = s.userId || {}; return `<div class="hx-row"><div class="grow"><b>${E(u.name || s.userName || 'Staff')}</b><small class="hx-sub">${E(u.role || s.role || '')} · since ${hm(s.clockIn)}</small></div>${pill(s.status || 'ON_DUTY', s.status === 'BREAK' ? 'warn' : 'ok')}</div>`; }).join('')}</div>` : window.HX.empty('Nobody clocked in', 'Staff appear here once they clock in.')}</div>` : '');
    sb.querySelector('#clk').addEventListener('click', async () => { const r = mineOn ? await send('post', '/restaurant/duty/end', {}) : await send('post', '/restaurant/duty/start', { branchId: window.HX.branchId() }); if (r) paint(); });
  }

  async function shifts(sb) {
    const d = await get('/restaurant/shifts', { limit: 50, branchId: window.HX.branchId(), from: addDays(ymd(), -7), to: addDays(ymd(), 14) }); const rows = list(d, 'shifts', 'items');
    sb.innerHTML = (can('restaurant.shifts.manage') ? '<div style="margin-bottom:var(--space-3)"><button class="btn btn-primary" id="sc">Schedule a shift</button></div>' : '') + (rows.length ? `<div class="hx-card flush">${rows.map((s) => { const u = s.userId || {}; return `<div class="hx-row"><div class="grow"><b>${E(u.name || 'Staff')}</b><small class="hx-sub">${dt(s.scheduledStart)} – ${hm(s.scheduledEnd)}${s.role ? ' · ' + E(s.role) : ''}</small></div>${pill(s.status, { ON_DUTY: 'ok', COMPLETED: 'mute', ABSENT: 'bad' }[s.status] || 'plan')}</div>`; }).join('')}</div>` : window.HX.empty('No shifts', 'Scheduled and completed shifts appear here.'));
    sb.querySelector('#sc')?.addEventListener('click', async () => {
      const e = await get('/employees', { limit: 100 }), staff = list(e, 'employees');
      formModal({ title: 'Schedule a shift', fields: [{ name: 'userId', label: 'Who', type: 'select', options: staff.map((s) => [s._id, `${s.name || s.employeeCode} (${s.role})`]) }, { row: [{ name: 'scheduledStart', label: 'Starts', type: 'datetime-local', value: ymd() + 'T08:00', required: true }, { name: 'scheduledEnd', label: 'Ends', type: 'datetime-local', value: ymd() + 'T17:00', required: true }] }, { name: 'notes', label: 'Notes' }],
        onSubmit: async (v) => { if (await send('post', '/restaurant/shifts', { ...v, branchId: window.HX.branchId(), scheduledStart: new Date(v.scheduledStart).toISOString(), scheduledEnd: new Date(v.scheduledEnd).toISOString() })) { paint(); return true; } return false; } });
    });
  }

  async function tips(sb) {
    const manage = can('restaurant.tips.manage'), from = addDays(ymd(), -14);
    const [d, s] = await Promise.all([get('/restaurant/tips', { branchId: window.HX.branchId(), limit: 50 }), manage ? get('/restaurant/tips/summary', { branchId: window.HX.branchId(), from, to: ymd() }) : null]);
    const rows = list(d, 'tips', 'items'), sum = list(s, 'summary'), t = (d && d.totals) || {};
    sb.innerHTML = `<div class="hx-grid2" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:var(--space-4)">${['RECORDED', 'ALLOCATED', 'PAID_OUT'].map((k) => `<div class="hx-card"><small class="hx-sub">${k === 'RECORDED' ? 'Waiting to share' : k === 'ALLOCATED' ? 'Shared, not paid' : 'Paid out'}</small><div class="hx-money" style="font-size:var(--text-xl)">${M(t[k] || 0)}</div></div>`).join('')}</div>` +
      (manage ? `<div class="hx-actions" style="margin-bottom:var(--space-3)"><button class="btn btn-primary" id="al">Share recorded tips</button></div>` : '') +
      (sum.length ? `<div class="hx-section"><h2>Owed to staff (last 14 days)</h2><div class="hx-card flush">${sum.map((r) => `<div class="hx-row"><div class="grow"><b>${E(r.name || r.userName || r._id)}</b></div><span class="hx-money">${M(r.owing)}</span></div>`).join('')}</div></div>` : '') +
      `<div class="hx-section"><h2>Recent tips</h2>${rows.length ? `<div class="hx-card flush">${rows.map((r) => `<div class="hx-row"><div class="grow"><b>${E((r.waiterId && r.waiterId.name) || 'Pool')}</b><small class="hx-sub">${dt(r.createdAt)} · ${E(r.method || '')}</small></div>${pill(r.status, { RECORDED: 'warn', ALLOCATED: 'busy', PAID_OUT: 'ok' }[r.status])}<span class="hx-money">${M(r.amount)}</span>${manage && r.status === 'ALLOCATED' ? `<button class="btn btn-sm btn-secondary" data-po="${r._id}">Pay out</button>` : ''}</div>`).join('')}</div>` : window.HX.empty('No tips yet', 'Tips added on bills show here.')}</div>`;
    sb.querySelector('#al')?.addEventListener('click', async () => { if (await send('post', '/restaurant/tips/allocate', { branchId: window.HX.branchId(), from, to: ymd() })) { window.UI.toast.success('Tips shared'); paint(); } });
    sb.querySelectorAll('[data-po]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', '/restaurant/tips/payout', { tipIds: [b.dataset.po] })) paint(); }));
  }
})();
