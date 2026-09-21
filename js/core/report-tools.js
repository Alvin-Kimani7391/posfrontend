/**
 * report-tools.js
 * Shared by dashboard.js, reports.js and audit-logs.js:
 *   - date range presets (+ the "end of day" fix, see toQuery note below)
 *   - createFilterBar(): presets, custom dates, branch + cashier selectors
 *   - small markup builders: kpi(), chartCard(), segmented(), badges
 *   - downloadCSV() (Excel-friendly, formula-injection safe), copyText()
 *
 * NOTE on dates: the backend does `to: z.coerce.date()`, so "2026-09-21"
 * becomes 00:00 that morning and would silently drop the whole day. Every
 * range built here is start-of-day .. 23:59:59.999 in the browser's local
 * time and sent as ISO strings, so "Today" really means all of today.
 */
(function (window) {
  const esc = (s) => window.UI.escapeHtml(s);

  /* ------------------------------------------------------------------ *
   * Dates
   * ------------------------------------------------------------------ */
  const PRESET_LABELS = {
    today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 days', '30d': 'Last 30 days',
    month: 'This month', lastmonth: 'Last month', year: 'This year', custom: 'Custom',
  };

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

  function rangeFor(key, now = new Date()) {
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (key) {
      case 'today': return { from: startOfDay(now), to: endOfDay(now) };
      case 'yesterday': { const d = new Date(now); d.setDate(d.getDate() - 1); return { from: startOfDay(d), to: endOfDay(d) }; }
      case '7d': { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: startOfDay(d), to: endOfDay(now) }; }
      case 'month': return { from: new Date(y, m, 1), to: endOfDay(now) };
      case 'lastmonth': return { from: new Date(y, m - 1, 1), to: endOfDay(new Date(y, m, 0)) };
      case 'year': return { from: new Date(y, 0, 1), to: endOfDay(now) };
      case '30d':
      default: { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: startOfDay(d), to: endOfDay(now) }; }
    }
  }

  /** The equally long window immediately before {from,to} - used for "vs previous" deltas. */
  function previousRange(from, to) {
    const len = to.getTime() - from.getTime();
    const pTo = new Date(from.getTime() - 1);
    return { from: new Date(pTo.getTime() - len), to: pTo };
  }

  function toDateInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function parseDateInput(str, endOfDayFlag) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    if (!y || !m || !d) return null;
    return endOfDayFlag ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  function describeRange(from, to) {
    const a = window.UI.formatDate(from);
    const b = window.UI.formatDate(to);
    return a === b ? a : `${a} – ${b}`;
  }

  function dayLabel(dateLike) {
    const d = startOfDay(new Date(dateLike));
    const today = startOfDay(new Date());
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return new Intl.DateTimeFormat('en-KE', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  }

  function timeOnly(dateLike) {
    return new Intl.DateTimeFormat('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(dateLike));
  }

  /* ------------------------------------------------------------------ *
   * Numbers & text
   * ------------------------------------------------------------------ */
  function money0(n) {
    const cur = window.APP_CONFIG?.CURRENCY || 'KES';
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n) || 0);
  }
  function fmtNum(n) { return (Number(n) || 0).toLocaleString('en-KE'); }
  function pct(n, d) { return d ? (n / d) * 100 : 0; }
  function fmtPct(x, dp = 1) { return `${(Number(x) || 0).toFixed(dp)}%`; }

  /** "CREDIT_NOTE" -> "Credit note". Mixed-case text is left alone. */
  function prettify(s) {
    const str = String(s == null ? '' : s);
    if (!/^[A-Z0-9_ ]+$/.test(str)) return str;
    const t = str.replace(/_/g, ' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  const METHODS = {
    CASH: { label: 'Cash', color: '#f59e0b' },
    MPESA: { label: 'M-PESA', color: '#10b981' },
    CARD: { label: 'Card', color: '#3b82f6' },
    BANK: { label: 'Bank transfer', color: '#8b5cf6' },
    OTHER: { label: 'Other', color: '#94a3b8' },
  };
  function methodMeta(m) { return METHODS[m] || { label: prettify(m), color: '#94a3b8' }; }

  const STATUS_COLORS = { SUCCESS: '#10b981', COMPLETED: '#10b981', APPROVED: '#10b981', PENDING: '#f59e0b', FAILED: '#ef4444', REJECTED: '#ef4444', REVERSED: '#8b5cf6', REFUNDED: '#8b5cf6' };
  function statusColor(s, i = 0) { return STATUS_COLORS[s] || window.Charts.PALETTE[(i + 3) % window.Charts.PALETTE.length]; }

  function statusBadge(status) {
    const map = { SUCCESS: 'badge-success', COMPLETED: 'badge-success', APPROVED: 'badge-success', PENDING: 'badge-warning', FAILED: 'badge-danger', REJECTED: 'badge-danger' };
    return `<span class="badge ${map[status] || 'badge-neutral'}">${esc(prettify(status))}</span>`;
  }

  function rankBadge(i) { return `<span class="rank rank-${i < 3 ? i + 1 : 'n'}">${i + 1}</span>`; }

  /* ------------------------------------------------------------------ *
   * Markup builders
   * ------------------------------------------------------------------ */
  /** value / delta are trusted HTML strings (already formatted); label and sub are escaped. */
  function kpi({ label, value, sub = '', tone = 'primary', icon = '', delta = '' }) {
    return `
      <div class="kpi kpi-${tone}">
        <div class="kpi-top"><span class="kpi-label">${esc(label)}</span>${icon ? `<span class="kpi-icon">${window.Icons.get(icon)}</span>` : ''}</div>
        <div class="kpi-value">${value}</div>
        <div class="kpi-foot">${delta}${sub ? `<span class="kpi-sub">${esc(sub)}</span>` : ''}</div>
      </div>`;
  }

  function chartCard({ id, title, subtitle = '', actions = '', className = '', bodyClass = '' }) {
    return `
      <section class="card chart-card ${className}">
        <header class="chart-card-head">
          <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
          ${actions ? `<div class="chart-card-actions">${actions}</div>` : ''}
        </header>
        <div class="chart-card-body ${bodyClass}" id="${id}"></div>
      </section>`;
  }

  /** "▲ 12.4%" pill. invert=true means "down is good" (expenses, refunds). */
  function deltaBadge(cur, prev, { invert = false } = {}) {
    if (prev == null || cur == null) return '';
    if (prev === 0 && cur === 0) return '<span class="delta flat">no change</span>';
    if (prev === 0) return '<span class="delta up">▲ new</span>';
    const p = ((cur - prev) / Math.abs(prev)) * 100;
    if (Math.abs(p) < 0.05) return '<span class="delta flat">no change</span>';
    const up = p > 0;
    const good = invert ? !up : up;
    return `<span class="delta ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%</span>`;
  }

  /** Renders a segmented toggle into el and calls onChange(key) on click. */
  function segmented(el, options, active, onChange) {
    el.classList.add('segmented');
    el.innerHTML = options.map((o) => `<button type="button" class="${o.key === active ? 'active' : ''}" data-key="${esc(o.key)}">${esc(o.label)}</button>`).join('');
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      onChange(b.dataset.key);
    }));
  }

  /** Live-filters table rows by text. */
  function tableSearch(input, tbody) {
    input.addEventListener('input', window.UI.debounce(() => {
      const q = input.value.trim().toLowerCase();
      tbody.querySelectorAll('tr').forEach((tr) => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
    }, 150));
  }

  /* ------------------------------------------------------------------ *
   * CSV + clipboard
   * ------------------------------------------------------------------ */
  /**
   * downloadCSV('sales-2026-09-21.csv', [{ title?, headers, rows }, ...])
   * Adds a BOM so Excel reads UTF-8, and prefixes text cells that start with
   * = + - @ so a product named "=HYPERLINK(...)" can't run as a formula.
   */
  function downloadCSV(filename, sections) {
    const cell = (v) => {
      let s = v == null ? '' : v;
      if (typeof s === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
      s = String(s);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [];
    sections.forEach((sec) => {
      if (sec.title) lines.push(cell(sec.title));
      if (sec.headers) lines.push(sec.headers.map(cell).join(','));
      sec.rows.forEach((r) => lines.push(r.map(cell).join(',')));
      lines.push('');
    });
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() { return toDateInput(new Date()); }

  async function copyText(text, okMessage) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
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
    return ok;
  }

  /* ------------------------------------------------------------------ *
   * Filter bar
   * ------------------------------------------------------------------ */
  /**
   * createFilterBar(container, { defaultPreset, presets, showBranch, showCashier, onChange })
   * Returns { ready, getState, getQuery, setScope, describe }.
   *
   * Branch: users with branches.view get an "All branches" selector (owners
   * usually want the whole business). Users without it are pinned to their
   * active branch so a manager never queries outside their reach.
   * Cashier list needs employees.view; if the user lacks it the selector
   * simply doesn't appear.
   */
  function createFilterBar(container, opts = {}) {
    const {
      defaultPreset = '30d',
      presets = ['today', '7d', '30d', 'month', 'lastmonth', 'year', 'custom'],
      showBranch = true,
      showCashier = false,
      onChange = () => {},
    } = opts;
    const user = window.AppShell.getUser();
    const start = rangeFor(defaultPreset === 'custom' ? '30d' : defaultPreset);
    const st = { preset: defaultPreset, from: start.from, to: start.to, branchId: '', cashierId: '', fixedBranchId: null, branches: [], cashiers: [] };
    const scope = { dates: true, branch: showBranch, cashier: showCashier };

    container.innerHTML = `
      <div class="filter-bar card">
        <div class="filter-main">
          <div class="chip-row" role="group" aria-label="Date range">
            ${presets.map((k) => `<button type="button" class="chip ${k === st.preset ? 'active' : ''}" data-preset="${k}">${PRESET_LABELS[k]}</button>`).join('')}
          </div>
          <div class="filter-custom" id="fb-custom" hidden>
            <input class="input" type="date" id="fb-from" aria-label="From date" value="${toDateInput(st.from)}" />
            <span class="text-muted text-sm">to</span>
            <input class="input" type="date" id="fb-to" aria-label="To date" value="${toDateInput(st.to)}" />
          </div>
        </div>
        <div class="filter-side">
          <label class="filter-select" id="fb-branch-wrap" hidden><span class="text-xs text-muted">Branch</span>
            <select class="select" id="fb-branch"><option value="">All branches</option></select></label>
          <label class="filter-select" id="fb-cashier-wrap" hidden><span class="text-xs text-muted">Cashier</span>
            <select class="select" id="fb-cashier"><option value="">All cashiers</option></select></label>
        </div>
      </div>`;

    const $ = (sel) => container.querySelector(sel);
    const bar = $('.filter-bar');

    function syncVisibility() {
      $('.filter-main').hidden = !scope.dates;
      $('#fb-custom').hidden = !(scope.dates && st.preset === 'custom');
      $('#fb-branch-wrap').hidden = !(scope.branch && st.branches.length > 1);
      $('#fb-cashier-wrap').hidden = !(scope.cashier && st.cashiers.length > 0);
      bar.hidden = $('.filter-main').hidden && $('#fb-branch-wrap').hidden && $('#fb-cashier-wrap').hidden;
    }

    const api = {
      el: container,
      getState: () => ({ ...st }),
      /** Query params for the active scope ({dates, branch, cashier}). */
      getQuery(sc = scope) {
        const q = {};
        if (sc.dates) { q.from = st.from.toISOString(); q.to = st.to.toISOString(); }
        if (sc.branch) { const b = st.branchId || st.fixedBranchId; if (b) q.branchId = b; }
        if (sc.cashier && st.cashierId) q.cashierId = st.cashierId;
        return q;
      },
      setScope(next) { Object.assign(scope, next); syncVisibility(); },
      branchLabel() {
        if (st.branchId) return st.branches.find((b) => b._id === st.branchId)?.name || 'Selected branch';
        return st.fixedBranchId ? 'Your branch' : 'All branches';
      },
      describe(sc = scope) {
        const parts = [];
        if (sc.dates) parts.push(describeRange(st.from, st.to));
        if (sc.branch) parts.push(api.branchLabel());
        if (sc.cashier && st.cashierId) parts.push(st.cashiers.find((c) => c._id === st.cashierId)?.name || 'One cashier');
        return parts.join(' · ');
      },
    };
    const emit = () => onChange(api);

    $('.chip-row').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      st.preset = btn.dataset.preset;
      container.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('active', x === btn));
      if (st.preset !== 'custom') {
        const r = rangeFor(st.preset);
        st.from = r.from; st.to = r.to;
        $('#fb-from').value = toDateInput(r.from);
        $('#fb-to').value = toDateInput(r.to);
      }
      syncVisibility();
      if (st.preset !== 'custom') emit();
    });

    const onDates = () => {
      const f = parseDateInput($('#fb-from').value, false);
      const t = parseDateInput($('#fb-to').value, true);
      if (!f || !t) return;
      if (f > t) { window.UI.toast.error('The "from" date must be on or before the "to" date'); return; }
      st.from = f; st.to = t;
      emit();
    };
    $('#fb-from').addEventListener('change', onDates);
    $('#fb-to').addEventListener('change', onDates);
    $('#fb-branch').addEventListener('change', (e) => { st.branchId = e.target.value; emit(); });
    $('#fb-cashier').addEventListener('change', (e) => { st.cashierId = e.target.value; emit(); });

    async function loadLookups() {
      if (showBranch) {
        if (window.Permissions.can(user, 'branches.view')) {
          try {
            const { data } = await window.Api.get('/branches', { page: 1, limit: 100, status: 'active' });
            st.branches = data.items || [];
            $('#fb-branch').innerHTML = `<option value="">All branches</option>${st.branches.map((b) => `<option value="${b._id}">${esc(b.name)}</option>`).join('')}`;
          } catch { st.fixedBranchId = window.AppShell.getActiveBranchId(); }
        } else {
          st.fixedBranchId = window.AppShell.getActiveBranchId();
        }
      }
      if (showCashier && window.Permissions.can(user, 'employees.view')) {
        try {
          const { data } = await window.Api.get('/employees', { page: 1, limit: 100 });
          st.cashiers = data.items || [];
          $('#fb-cashier').innerHTML = `<option value="">All cashiers</option>${st.cashiers.map((c) => `<option value="${c._id}">${esc(c.name)}</option>`).join('')}`;
        } catch { /* no cashier filter */ }
      }
      syncVisibility();
    }

    syncVisibility();
    api.ready = loadLookups();
    return api;
  }

  window.ReportTools = {
    PRESET_LABELS, rangeFor, previousRange, startOfDay, endOfDay, toDateInput, parseDateInput,
    describeRange, dayLabel, timeOnly,
    money0, fmtNum, pct, fmtPct, prettify, methodMeta, statusColor, statusBadge, rankBadge,
    kpi, chartCard, deltaBadge, segmented, tableSearch,
    downloadCSV, stamp, copyText, createFilterBar,
  };
})(window);