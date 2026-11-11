/**
 * admin-infra.js - Platform infrastructure: health, releases, deploy history, live logs, backups, controls.
 *
 * Backend contract (all under /admin/infra, SUPER_ADMIN only; read endpoints = monitoring, POST = operator):
 *   GET  /overview     -> { permissions:{canOperate}, maintenance, github:{pendingApprovalUrl}, server, release:{active,standby}, services[], database, backup, jobs }
 *   GET  /deployments  -> { items:[{release,sha,by,previous,status,reason,ts,tests,health,env,outcome,promotable}], promote:{available,reason} }
 *   POST /promote      -> { release }   (staging server only; starts the production deploy of that tested release)
 *   GET  /logs?service&level&q&after -> { lines:[{id,ts,level,service,msg}] }
 *   POST /rollback | /restart {service} | /backup | /maintenance {enabled}
 * Preview with no backend: admin-infra.html?demo=1
 */
(function () {
  const DEMO = new URLSearchParams(location.search).has('demo');
  const api = DEMO ? window.InfraDemo : window.Api;
  const esc = window.UI.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const S = { tab: 'overview', ov: null, logs: [], live: true, lastId: 0, timers: [] };

  const dur = (s) => { s = Math.floor(s || 0); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const ago = (iso) => (iso ? window.UI.timeAgo(iso) : 'never');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const tone = (p) => (p >= 90 ? 'bad' : p >= 75 ? 'warn' : '');
  const bar = (p) => `<div class="inf-bar"><i class="${tone(p)}" style="width:${Math.min(p, 100)}%"></i></div>`;
  const toast = (m, t) => { try { (t === 'error' ? window.UI.toast.error : window.UI.toast.success)(m); } catch (e) { /* cosmetic */ } };
  const dot = (ok) => `<span class="inf-dot ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}"></span>`;
  const STATUS = {
    success: ['badge-success', 'Live'], failed_before_switch: ['badge-danger', 'Failed - production untouched'],
    aborted_before_start: ['badge-danger', 'Failed - nothing changed'], staging_failed: ['badge-danger', 'Failed on staging'],
    rolled_back_verified: ['badge-danger', 'Failed - rolled back automatically'], ROLLBACK_FAILED_MANUAL_ACTION: ['badge-danger', 'ROLLBACK FAILED - act now'],
    WORKER_DOWN_MANUAL_ACTION: ['badge-danger', 'Worker down - act now'], ROLLBACK_UNVERIFIED: ['badge-danger', 'Rollback not verified'],
    rollback_verified: ['badge-warning', 'Manual rollback (verified)'], candidate_verified_not_switched: ['badge-warning', 'Verified, not switched'],
  };
  // green circle + tick = success, red circle + cross = failed, amber circle + ! = other (manual rollback ...)
  const ICON = {
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bad: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M12 7v6.2M12 16.6v.4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
  };
  const labelFor = (d, st) => (d.env === 'staging' && d.status === 'success' ? 'Passed on staging' : st[1]);
  const outcome = (d) => d.outcome || (d.status === 'success' ? 'success' : /fail|abort|FAILED/i.test(d.status) ? 'failed' : 'info');
  const statusIcon = (d) => { const o = outcome(d), k = o === 'success' ? 'ok' : o === 'failed' ? 'bad' : 'warn';
    return `<span class="inf-ic ${k}" role="img" aria-label="${o === 'success' ? 'Succeeded' : o === 'failed' ? 'Failed' : 'Notice'}">${ICON[k]}</span>`; };

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AdminShell.mount({ title: 'Infrastructure' });
    if (!el) return;
    el.innerHTML = `
      <div class="page-header"><div><h1>Infrastructure</h1><p>Releases, servers, logs and backups for the Six Star POS platform.</p></div>
        <div class="page-actions"><button class="btn btn-secondary btn-sm" id="inf-refresh">Refresh</button></div></div>
      ${DEMO ? '<div class="inf-demo"><b>Demo mode</b> - sample data only. Nothing here touches your servers.</div>' : ''}
      <div class="inf-top" id="inf-top"></div>
      <div class="tabs" id="inf-tabs">
        ${[['overview', 'Overview'], ['deployments', 'Deployments'], ['logs', 'Logs'], ['backups', 'Database & backups'], ['controls', 'Controls']]
          .map(([k, l]) => `<button class="tab-btn ${k === 'overview' ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}
      </div>
      <div id="inf-body" style="margin-top:var(--space-4)"></div>`;
    $('inf-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
    $('inf-refresh').addEventListener('click', () => loadTab(true));
    setTab('overview');
    setInterval(() => { if (!document.hidden && S.tab !== 'logs') loadOverview(true); }, 15000);
  });

  function setTab(t) {
    S.tab = t; S.timers.forEach(clearInterval); S.timers = [];
    document.querySelectorAll('#inf-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    loadTab();
  }
  function loadTab() {
    $('inf-body').innerHTML = '<div class="inf-card"><div class="skeleton" style="height:14px;width:40%"></div><div class="skeleton" style="height:90px;margin-top:14px"></div></div>';
    if (S.tab === 'deployments') return renderDeployments();
    if (S.tab === 'logs') return renderLogs();
    return loadOverview();
  }
  function fail(err) {
    const notWired = /404|not found/i.test(err.message || '');
    $('inf-body').innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert',
      title: notWired ? 'Infrastructure API not connected yet' : 'Could not load', message: notWired ? 'The /admin/infra endpoints are not on the backend yet. Preview the design with ?demo=1.' : err.message,
      actionHtml: `<a class="btn btn-secondary" href="admin-infra.html?demo=1">Open demo</a>` })}</div>`;
  }

  async function loadOverview(silent) {
    try {
      const { data } = await api.get('/admin/infra/overview');
      S.ov = data; topStrip();
      if (silent && S.tab === 'logs') return;
      if (S.tab === 'overview') renderOverview(); else if (S.tab === 'backups') renderBackups(); else if (S.tab === 'controls') renderControls();
    } catch (e) { if (!silent) fail(e); }
  }

  function topStrip() {
    const o = S.ov, a = o.release.active, allUp = o.services.every((s) => s.status === 'online');
    $('inf-top').innerHTML = `
      <span class="inf-pill">${dot(allUp)} ${allUp ? 'All systems operational' : 'Degraded'}</span>
      <span class="inf-pill">Live: <b style="text-transform:capitalize">${esc(a.slot)}</b> · <span class="inf-mono">${esc(a.sha)}</span></span>
      <span class="inf-pill">Uptime ${dur(o.server.uptimeSec)}</span>
      ${o.maintenance ? '<span class="inf-pill" style="background:var(--color-warning-bg)">Maintenance mode ON</span>' : ''}`;
  }

  function renderOverview() {
    const o = S.ov, sv = o.server, mp = pct(sv.memUsedMb, sv.memTotalMb), dp = pct(sv.diskUsedGb, sv.diskTotalGb), cp = Math.round(sv.cpuPct);
    const slot = (r, live) => `<div class="inf-slot ${live ? 'active' : ''}">
        <div class="name"><span>${esc(r.slot)}</span><span class="badge ${live ? 'badge-success' : 'badge-neutral'}">${live ? 'LIVE' : 'Standby'}</span></div>
        <dl class="inf-kv"><dt>Release</dt><dd class="inf-mono">${esc(r.releaseId)}</dd><dt>Commit</dt><dd class="inf-mono">${esc(r.sha)}</dd>
        <dt>Health</dt><dd>${dot(r.healthy)} ${r.healthy ? 'Ready' : 'Unhealthy'}</dd>${r.since ? `<dt>Live since</dt><dd>${ago(r.since)}</dd>` : ''}</dl></div>`;
    $('inf-body').innerHTML = `
      <div class="inf-grid">
        <div class="inf-card"><h3>CPU</h3><div class="inf-big">${cp}%</div><div class="inf-sub">Load ${sv.load.join(' · ')}</div>${bar(cp)}</div>
        <div class="inf-card"><h3>Memory</h3><div class="inf-big">${mp}%</div><div class="inf-sub">${sv.memUsedMb} / ${sv.memTotalMb} MB</div>${bar(mp)}</div>
        <div class="inf-card"><h3>Disk</h3><div class="inf-big">${dp}%</div><div class="inf-sub">${sv.diskUsedGb} / ${sv.diskTotalGb} GB</div>${bar(dp)}</div>
        <div class="inf-card"><h3>Network</h3><div class="inf-big">${sv.netOutKbps}<small> KB/s out</small></div><div class="inf-sub">${sv.netInKbps} KB/s in</div></div>
      </div>
      <div class="inf-card" style="margin-bottom:var(--space-4)"><h3>Blue / Green release</h3><div class="inf-slots">${slot(o.release.active, true)}${slot(o.release.standby, false)}</div></div>
      <div class="inf-card"><h3>Processes</h3><div class="table-wrap"><table class="table"><thead><tr><th>Service</th><th>Status</th><th>Port</th><th>Release</th><th class="num">Memory</th><th class="num">Restarts</th><th>Uptime</th></tr></thead><tbody>
        ${o.services.map((s) => `<tr><td class="cell-primary">${esc(s.name)}<div class="text-xs text-muted">${esc(s.role)}</div></td>
          <td>${dot(s.status === 'online')} ${esc(s.status)}</td><td>${s.port || '-'}</td><td class="inf-mono">${esc(s.release || '-')}</td>
          <td class="num">${s.memMb} MB</td><td class="num">${s.restarts}</td><td>${dur(s.uptimeSec)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  async function renderDeployments() {
    try {
      const [{ data }, ov] = await Promise.all([api.get('/admin/infra/deployments'), S.ov ? null : api.get('/admin/infra/overview')]);
      if (ov) { S.ov = ov.data; topStrip(); }
      const pend = S.ov.github && S.ov.github.pendingApprovalUrl;
      const pr = data.promote || {}, isStg = !!(window.APP_CONFIG && window.APP_CONFIG.IS_STAGING), canPromote = isStg && S.ov.permissions.canPromote;
      const next = data.items.find((d) => d.promotable);
      const promoCard = isStg ? `<div class="inf-card inf-promo" style="margin-bottom:var(--space-4)"><div><b>Push to production</b>
          <div class="inf-sub">${next ? `Staging release <span class="inf-mono">${esc(next.release)}</span> (${esc(next.sha)}) passed on staging and is not live yet. Production receives this exact tested build.`
            : pr.available === false && pr.reason ? esc(pr.reason) : 'Nothing waiting: the newest tested staging release is already live (or has not passed yet).'}</div></div>
          ${next && canPromote ? `<button class="btn btn-primary btn-sm" data-promote="${esc(next.release)}">Push to production…</button>` : ''}</div>` : '';
      $('inf-body').innerHTML = `
        ${promoCard}
        ${pend ? `<div class="inf-card" style="margin-bottom:var(--space-4);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><b>GitHub approvals</b><div class="inf-sub">Runs waiting for review are shown in GitHub.</div></div><a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${esc(pend)}">Open GitHub</a></div>` : ''}
        <div class="inf-card"><h3>Deployment history</h3>
        ${data.items.length ? `<ul class="inf-tl">${data.items.map((d) => {
          const st = STATUS[d.status] || [outcome(d) === 'failed' ? 'badge-danger' : 'badge-neutral', d.status];
          const envName = d.env === 'staging' ? 'STAGING' : 'PRODUCTION';
          return `<li><div class="rail">${statusIcon(d)}</div>
            <div><div class="ttl">${esc(d.release)} <span class="inf-env ${d.env === 'staging' ? 'stg' : 'prd'}">${envName}</span> <span class="badge ${st[0]}">${esc(labelFor(d, st))}</span></div>
              <div class="meta"><span class="inf-mono">${esc(d.sha)}</span> · by ${esc(d.by)}${d.env === 'staging' ? '' : ` · from ${esc(d.previous || '-')}`} · tests: ${esc(d.tests || '-')} · health: ${esc(d.health || '-')}</div>
              ${d.reason ? `<div class="why">${esc(d.reason)}</div>` : ''}
              ${d.promotable && canPromote ? `<div style="margin-top:8px"><button class="btn btn-primary btn-sm" data-promote="${esc(d.release)}">Push to production…</button></div>` : ''}</div>
            <div class="text-xs text-muted" title="${esc(window.UI.formatDateTime(d.ts))}">${ago(d.ts)}</div></li>`; }).join('')}</ul>`
        : window.UI.emptyStateHtml({ icon: 'alert', title: 'No deployments recorded yet' })}</div>`;
      $('inf-body').onclick = (e) => { const b = e.target.closest('[data-promote]'); if (b) confirmPromote(b.dataset.promote); };
    } catch (e) { fail(e); }
  }

  function renderLogs() {
    $('inf-body').innerHTML = `
      <div class="inf-term">
        <div class="inf-term-bar">
          <select id="lg-svc"><option value="">All services</option><option>sixstar-blue</option><option>sixstar-green</option><option>sixstar-worker</option><option>sixstar-staging</option></select>
          <select id="lg-lvl"><option value="">All levels</option><option value="error">Errors</option><option value="warn">Warnings+</option><option value="info">Info+</option></select>
          <input id="lg-q" placeholder="Search logs..." />
          <button class="btn btn-secondary btn-sm" id="lg-live"></button>
          <button class="btn btn-secondary btn-sm" id="lg-dl">Download</button>
        </div>
        <div class="inf-term-body" id="lg-body"></div>
        <div class="inf-term-foot"><span id="lg-count"></span><span id="lg-state" class="inf-live"></span></div>
      </div>`;
    S.logs = []; S.lastId = 0;
    ['lg-svc', 'lg-lvl'].forEach((id) => $(id).addEventListener('change', () => { S.logs = []; S.lastId = 0; $('lg-body').innerHTML = ''; pull(); }));
    $('lg-q').addEventListener('input', paintLogs);
    $('lg-live').addEventListener('click', () => { S.live = !S.live; liveBtn(); });
    $('lg-dl').addEventListener('click', downloadLogs);
    liveBtn(); pull();
    S.timers.push(setInterval(() => { if (S.live && !document.hidden) pull(); }, 3000));
  }
  const RANK = { debug: 0, info: 1, warn: 2, error: 3 };
  function liveBtn() { $('lg-live').textContent = S.live ? 'Pause' : 'Resume'; const s = $('lg-state'); s.textContent = S.live ? '● Live' : '❚❚ Paused'; s.classList.toggle('off', !S.live); }
  async function pull() {
    try {
      const { data } = await api.get('/admin/infra/logs', { service: $('lg-svc').value, level: $('lg-lvl').value, after: S.lastId || undefined });
      if (data.lines.length) { S.logs = S.logs.concat(data.lines).slice(-1500); S.lastId = S.logs[S.logs.length - 1].id; paintLogs(); }
      else if (!S.logs.length) $('lg-body').innerHTML = '<div class="inf-line"><span class="t">No log lines yet.</span></div>';
    } catch (e) { $('lg-state').textContent = 'Log stream unavailable: ' + e.message; }
  }
  function visibleLogs() {
    const q = ($('lg-q').value || '').toLowerCase(), min = RANK[$('lg-lvl').value] ?? -1;
    return S.logs.filter((l) => (RANK[l.level] ?? 1) >= min && (!q || (l.msg + l.service).toLowerCase().includes(q)));
  }
  function paintLogs() {
    const body = $('lg-body'), stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40, v = visibleLogs();
    body.innerHTML = v.map((l) => `<div class="inf-line ${esc(l.level)}"><span class="t">${new Date(l.ts).toLocaleTimeString()}</span><span class="l">${esc(l.level)}</span><span class="s">${esc(l.service)}</span><span>${esc(l.msg)}</span></div>`).join('');
    if (stick) body.scrollTop = body.scrollHeight;
    $('lg-count').textContent = `${v.length} lines shown`;
  }
  function downloadLogs() {
    const txt = visibleLogs().map((l) => `${l.ts} ${l.level.toUpperCase()} [${l.service}] ${l.msg}`).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = `sixstar-logs-${Date.now()}.txt`; a.click(); URL.revokeObjectURL(a.href);
  }

  function renderBackups() {
    const { database: d, backup: b, jobs } = S.ov, cp = pct(d.connections, d.maxConnections);
    const nc = b.lastStatus === 'not_configured', bOk = nc ? null : b.lastStatus === 'success', rOk = b.restoreTestStatus === 'passed' ? true : b.restoreTestStatus === 'not run' ? null : false;
    $('inf-body').innerHTML = `
      <div class="inf-grid two">
        <div class="inf-card"><h3>Database</h3>
          <div class="inf-big">${dot(d.status === 'connected')} ${esc(d.engine)}</div>
          <dl class="inf-kv"><dt>Status</dt><dd>${esc(d.status)}</dd><dt>Size</dt><dd>${d.sizeGb} GB</dd>
          <dt>Connections</dt><dd>${d.connections} / ${d.maxConnections}</dd><dt>PostgreSQL</dt><dd>${d.pgReady ? 'Ready' : 'Migration not started'}</dd></dl>${bar(cp)}</div>
        <div class="inf-card"><h3>Backups (Cloudflare R2)</h3>
          <div class="inf-big">${dot(bOk)} ${nc ? 'Not set up yet' : bOk ? 'Healthy' : 'Failing'}</div>
          <dl class="inf-kv"><dt>Last success</dt><dd>${ago(b.lastSuccess)}</dd><dt>Encrypted</dt><dd>${b.encrypted ? 'Yes' : 'NO'}</dd>
          <dt>Objects in R2</dt><dd>${b.r2Objects} (${b.r2SizeGb} GB)</dd><dt>Retention</dt><dd>${b.retentionDays} days</dd>
          <dt>Restore test</dt><dd>${dot(rOk)} ${esc(b.restoreTestStatus)} · ${ago(b.lastRestoreTest)}</dd><dt>WAL archive</dt><dd>${esc(b.walStatus)}</dd></dl></div>
        <div class="inf-card"><h3>Background jobs</h3><div class="inf-big">${jobs.running} running</div>
          <dl class="inf-kv"><dt>Runs in</dt><dd>${esc(jobs.lockedBy)}</dd><dt>Last failure</dt><dd>${jobs.lastFailure ? esc(jobs.lastFailure) : 'None'}</dd></dl></div>
      </div>`;
  }

  function renderControls() {
    const o = S.ov;
    if (!o.permissions.canOperate) { $('inf-body').innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'View-only access', message: 'Your account can monitor but not operate infrastructure.' })}</div>`; return; }
    const row = (t, d, btn) => `<div class="inf-ctl"><div><b>${t}</b><p>${d}</p></div>${btn}</div>`;
    $('inf-body').innerHTML = `<div class="inf-card"><h3>Operator controls</h3>
      ${row('Roll back to standby release', `Switch live traffic to <b>${esc(o.release.standby.slot)}</b> (${esc(o.release.standby.sha)}). Checked healthy first. The database is never changed.`, '<button class="btn btn-danger btn-sm" data-act="rollback" data-word="ROLLBACK">Roll back…</button>')}
      ${row('Restart a service', 'Restarts one process only. The live API slot is protected: roll back first, then restart the idle slot.', `<span style="display:flex;gap:8px"><select class="select" id="rs-svc" style="width:auto">${o.services.filter((s) => s.name.startsWith('sixstar-')).map((s) => `<option>${esc(s.name)}</option>`).join('')}</select><button class="btn btn-secondary btn-sm" data-act="restart" data-word="RESTART">Restart…</button></span>`)}
      ${row('Back up database now', 'Starts an encrypted backup to Cloudflare R2.', '<button class="btn btn-secondary btn-sm" data-act="backup" data-word="">Run backup</button>')}
      ${row('Maintenance mode', o.maintenance ? 'Currently ON. Customers see a maintenance message.' : 'Shows customers a maintenance message. M-Pesa callbacks are still accepted.', `<button class="btn ${o.maintenance ? 'btn-success' : 'btn-secondary'} btn-sm" data-act="maintenance" data-word="MAINTENANCE">${o.maintenance ? 'Turn off…' : 'Turn on…'}</button>`)}
      </div><p class="inf-sub" style="margin-top:12px">Every action is recorded in the audit log with your name. New releases are approved in GitHub, not here.</p>`;
    $('inf-body').onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) confirmAct(b.dataset.act, b.dataset.word); };
  }

  function confirmPromote(release) {
    const m = document.createElement('div'); m.className = 'inf-modal';
    m.innerHTML = `<div><h3>Push to production</h3><div class="text-sm text-muted">Release <b>${esc(release)}</b> will be deployed to the live system with zero downtime (blue/green). If it fails its health checks it is rolled back automatically and all super admins are emailed. Type <b>PRODUCTION</b> to continue.</div><input class="input" id="cf-in" autocomplete="off" />
      <div class="row"><button class="btn btn-secondary btn-sm" id="cf-no">Cancel</button><button class="btn btn-primary btn-sm" id="cf-yes" disabled>Push to production</button></div></div>`;
    document.body.appendChild(m);
    const inp = m.querySelector('#cf-in'), yes = m.querySelector('#cf-yes');
    inp.focus(); inp.addEventListener('input', () => { yes.disabled = inp.value.trim() !== 'PRODUCTION'; });
    m.querySelector('#cf-no').onclick = () => m.remove();
    yes.onclick = async () => {
      yes.disabled = true; m.remove();
      try { const { data } = await api.post('/admin/infra/promote', { release }); toast(data.message || 'Started', 'success'); setTimeout(renderDeployments, 1500); }
      catch (e) { toast(e.message || 'Could not start the production deploy', 'error'); }
    };
  }

  function confirmAct(act, word) {
    const body = act === 'restart' ? { service: $('rs-svc').value } : act === 'maintenance' ? { enabled: !S.ov.maintenance } : {};
    const run = async () => {
      try { const { data } = await api.post('/admin/infra/' + act, body); toast(data.message || 'Done', 'success'); await loadOverview(); }
      catch (e) { toast(e.message || 'Action failed', 'error'); }
    };
    if (!word) return run();
    const m = document.createElement('div'); m.className = 'inf-modal';
    m.innerHTML = `<div><h3>Confirm ${esc(act)}</h3><div class="text-sm text-muted">This affects live customers. Type <b>${esc(word)}</b> to continue.</div><input class="input" id="cf-in" autocomplete="off" />
      <div class="row"><button class="btn btn-secondary btn-sm" id="cf-no">Cancel</button><button class="btn btn-danger btn-sm" id="cf-yes" disabled>Confirm</button></div></div>`;
    document.body.appendChild(m);
    const inp = m.querySelector('#cf-in'), yes = m.querySelector('#cf-yes');
    inp.focus(); inp.addEventListener('input', () => { yes.disabled = inp.value.trim() !== word; });
    m.querySelector('#cf-no').onclick = () => m.remove();
    yes.onclick = async () => { yes.disabled = true; m.remove(); await run(); };
  }
})();
