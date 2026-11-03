/**
 * mobile-tables.js - makes every data table readable as app-style cards on phones.
 *
 * It only adds attributes/classes (data-label, .mc, .mc-first ...). The look is in css/mobile-app.css
 * and applies only at <=720px, so desktop tables are untouched. Tables re-rendered later
 * (filters, pages, tabs, modals) are picked up automatically through a MutationObserver.
 *
 * Opt out for one table:  <table data-mc="off">   or wrap it in  <div data-no-cards>.
 */
(function () {
  'use strict';
  const SKIP = '.rcpt-items, .diff-table, .hw-t, .cc-breakdown, .hx-chk, .vf-items, .mg-tbl, .cx-table, [data-mc="off"]';

  function headerLabels(table) {
    const row = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    if (!row) return null;
    const labels = [];
    Array.from(row.cells).forEach((th) => {
      const span = th.colSpan || 1;
      const text = (th.textContent || '').replace(/\s+/g, ' ').trim();
      for (let i = 0; i < span; i++) labels.push(text);
    });
    return labels;
  }

  function prepRow(tr, labels) {
    if (tr.dataset.mc === '1') return;
    tr.dataset.mc = '1';
    const cells = Array.from(tr.cells);
    if (cells.length === 1 && cells[0].colSpan > 1) { cells[0].classList.add('mc-empty'); return; }
    let col = 0, firstDone = false;
    cells.forEach((td, i) => {
      const label = labels[col] || '';
      col += td.colSpan || 1;
      const onlyControls = !!td.querySelector('button, .btn') && td.textContent.replace(/\s+/g, '').length <= 30 && !label && i === cells.length - 1;
      if (td.classList.contains('actions') || onlyControls) { td.classList.add('mc-act'); return; }
      if (label === '#') { td.classList.add('mc-rank'); return; }
      if (!label) { td.classList.add('mc-nolabel'); if (!firstDone && i === 0 && label === '#') return; }
      else td.setAttribute('data-label', label);
      // first meaningful cell is the card title (skip rank "#" and checkbox columns)
      if (!firstDone && label && label !== '#' && !td.querySelector('input[type="checkbox"]')) { td.classList.add('mc-first'); firstDone = true; }
      else if (!firstDone && !label && td.textContent.trim() && i === 0 && cells.length > 1) { td.classList.add('mc-first'); firstDone = true; }
      // long free text should take the whole row
      if (td.textContent.trim().length > 38 || td.querySelector('.badge + .badge, .text-xs + .text-xs')) td.classList.add('mc-full');
    });
  }

  function prepTable(table) {
    if (table.matches(SKIP) || table.closest('[data-no-cards]')) return;
    if (!(table.classList.contains('table') || table.classList.contains('crm-table') || table.classList.contains('pl-table'))) return;
    const labels = headerLabels(table);
    if (!labels) return;
    table.classList.add('mc');
    Array.from(table.tBodies).forEach((tb) => Array.from(tb.rows).forEach((tr) => prepRow(tr, labels)));
    if (table.tFoot) Array.from(table.tFoot.rows).forEach((tr) => prepRow(tr, labels));
  }

  function scan(root) {
    (root || document).querySelectorAll('table').forEach(prepTable);
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }

  function init() {
    scan();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.MobileTables = { scan };
})();
