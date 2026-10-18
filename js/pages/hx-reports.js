/**
 * hx-reports.js - one reports page for restaurant and rooms. Pick a report and a date range; the table is built from whatever columns the API returns.
 * Restaurant: /restaurant/reports/summary|sales|food-cost|staff|waste|stock-variance|reconciliation|delivery
 * Rooms:      /accommodation/reports/occupancy|revenue|guest-register
 */
(function () {
  const { E, M, can, get, list, head, feature, ymd, addDays } = window.HX;
  let el, key = '', from = addDays(ymd(), -6), to = ymd(), groupBy = 'day';
  const R = [
    ['sum', 'Sales summary', '/restaurant/reports/summary', 'restaurant.reports.view', 'restaurantOrdering'],
    ['sales', 'Sales breakdown', '/restaurant/reports/sales', 'restaurant.reports.view', 'restaurantOrdering', true],
    ['food', 'Food cost', '/restaurant/reports/food-cost', 'restaurant.reports.view', 'restaurantOrdering'],
    ['staff', 'Staff performance', '/restaurant/reports/staff', 'restaurant.reports.staff', 'restaurantOrdering'],
    ['waste', 'Waste', '/restaurant/reports/waste', 'restaurant.reports.view', 'restaurantOrdering'],
    ['var', 'Stock variance', '/restaurant/reports/stock-variance', 'restaurant.reports.view', 'restaurantOrdering'],
    ['rec', 'Payment reconciliation', '/restaurant/reports/reconciliation', 'restaurant.reports.view', 'restaurantOrdering'],
    ['del', 'Delivery', '/restaurant/reports/delivery', 'restaurant.reports.view', 'restaurantOrdering'],
    ['occ', 'Occupancy', '/accommodation/reports/occupancy', 'accommodation.reports.view', 'accommodation'],
    ['rev', 'Room revenue', '/accommodation/reports/revenue', 'accommodation.reports.view', 'accommodation'],
    ['reg', 'Guest register', '/accommodation/reports/guest-register', 'accommodation.reports.view', 'accommodation'],
  ];
  const MONEY = /revenue|total|cost|price|amount|profit|contribution|adr|revpar|value|tips?$|owing|paid/i, PCT = /percent|rate$/i;
  const nice = (k) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Reports'); if (!el) return; await window.AppShell.whenProfileReady?.(); const a = avail(); if (!a.length) { el.innerHTML = head('Reports') + window.HX.empty('No reports for you', 'Ask the owner for report access.'); return; } key = a[0][0]; paint(); }
  const avail = () => R.filter((r) => feature(r[4]) && can(r[3]));

  function paint() {
    const a = avail(), cur = R.find((r) => r[0] === key);
    el.innerHTML = head('Reports', 'Pick a report and a date range.', '<button class="btn btn-secondary" id="pr">Print</button>') +
      `<div class="hx-card" style="margin-bottom:var(--space-4)"><div class="hx-actions" style="align-items:flex-end"><div class="field" style="margin:0"><label>Report</label><select class="select" id="rp">${a.map((r) => `<option value="${r[0]}" ${r[0] === key ? 'selected' : ''}>${r[1]}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>From</label><input class="input" type="date" id="fr" value="${from}"></div><div class="field" style="margin:0"><label>To</label><input class="input" type="date" id="to" value="${to}"></div>
      ${cur[5] ? `<div class="field" style="margin:0"><label>Group by</label><select class="select" id="gb">${['day', 'hour', 'dow', 'item', 'category', 'waiter', 'orderType', 'table'].map((g) => `<option ${g === groupBy ? 'selected' : ''}>${g}</option>`).join('')}</select></div>` : ''}<button class="btn btn-primary" id="go">Run</button></div></div><div id="rb"></div>`;
    el.querySelector('#rp').onchange = (e) => { key = e.target.value; paint(); };
    el.querySelector('#pr').onclick = () => window.print();
    el.querySelector('#go').onclick = () => { from = el.querySelector('#fr').value; to = el.querySelector('#to').value; groupBy = el.querySelector('#gb')?.value || groupBy; run(); };
    run();
  }

  async function run() {
    const cur = R.find((r) => r[0] === key), rb = el.querySelector('#rb'); rb.innerHTML = '<div class="hx-card"><p class="hx-sub">Running report…</p></div>';
    const d = await get(cur[2], { branchId: window.HX.branchId(), from, to, ...(cur[5] ? { groupBy } : {}) });
    if (!d) { rb.innerHTML = window.HX.empty('Could not load this report', 'Try another range or report.'); return; }
    const root = d.report || d.data || d, blocks = [];
    const scalars = Object.entries(root).filter(([, v]) => v == null || ['number', 'string', 'boolean'].includes(typeof v));
    if (scalars.length) blocks.push(`<div class="hx-grid2" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:var(--space-4)">${scalars.map(([k, v]) => `<div class="hx-card"><small class="hx-sub">${E(nice(k))}</small><div class="hx-money" style="font-size:var(--text-xl)">${fmt(k, v)}</div></div>`).join('')}</div>`);
    const arrays = Array.isArray(root) ? [['Results', root]] : Object.entries(root).filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object');
    arrays.forEach(([k, rows]) => blocks.push(table(nice(k), rows)));
    rb.innerHTML = blocks.join('') || window.HX.empty('No data', 'Nothing was recorded in this range.');
  }
  function fmt(k, v) { if (v == null) return '-'; if (typeof v !== 'number') return E(v); return PCT.test(k) ? v + '%' : MONEY.test(k) ? M(v) : v.toLocaleString(); }
  function table(title, rows) {
    const cols = Object.keys(rows[0]).filter((k) => !/^_?id$|Id$/.test(k) && !['object'].includes(typeof rows[0][k]));
    return `<div class="hx-section"><h2>${E(title)}</h2><div class="hx-card flush hx-scroll-x"><table class="table"><thead><tr>${cols.map((c) => `<th>${E(nice(c))}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td${typeof r[c] === 'number' ? ' class="hx-money"' : ''}>${fmt(c, r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }
})();
