/**
 * admin-infra-db.js - "MongoDB health" tab of the super-admin Infrastructure page.
 * Read-only monitoring of the self-hosted MongoDB Community database + backups + recovery + resources + migration progress.
 * Loaded BEFORE admin-infra.js, which calls window.InfraDB.mount(ctx).
 *   GET  /admin/infra/database   -> { installed, guardian, events[], resourceLog[], migration, usingCommunity, hosting }
 *   POST /admin/infra/db-action  -> { action: backup | verify | check | restore-test | recover | recover-discard }   (operators only)
 * The page is only a window: backups, monitoring and recovery jobs run from the server's scheduler whether or not anyone is logged in.
 */
(function () {
  const SEV = { critical: 'badge-danger', high: 'badge-warning', warning: 'badge-warning', info: 'badge-info' };
  const STEP_LABELS = { audit: 'Audit Atlas', backup: 'Encrypted Atlas backup', stage: 'Staging copy', reconcile: 'Reconcile', cutover: 'Production cutover', delta: 'Catch-up of late writes', finalize: 'Finalise (14+ days)' };
  const mb = (n) => (n == null ? '-' : n >= 1024 ? (n / 1024).toFixed(n >= 10240 ? 0 : 1) + ' GB' : Math.round(n) + ' MB');
  let ctx = null;

  const e = (v) => ctx.esc(v == null ? '' : String(v));
  const sevBadge = (s) => `<span class="badge ${SEV[s] || 'badge-neutral'}" style="text-transform:uppercase">${e(s)}</span>`;
  const kv = (rows) => `<dl class="inf-kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const yn = (ok, yes, no) => `${ctx.dot(ok)} ${ok === null || ok === undefined ? 'Unknown' : ok ? yes : no}`;

  async function load(silent) {
    try {
      const { data } = await ctx.api.get('/admin/infra/database');
      draw(data);
    } catch (err) {
      if (silent) return;
      const notWired = /404|not found/i.test(err.message || '');
      ctx.$('inf-body').innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: notWired ? 'Database API not connected yet' : 'Could not load', message: notWired ? 'Deploy the backend with the /admin/infra/database endpoint, or preview with ?demo=1.' : err.message })}</div>`;
    }
  }

  function banner(d) {
    const g = d.guardian;
    if (!g) return `<div class="inf-banner warn"><b>Self-hosted MongoDB monitoring is not running yet.</b> The POS is currently using <b>${e(d.hosting === 'atlas' ? 'MongoDB Atlas' : d.hosting)}</b>. Install MongoDB Community with <span class="inf-mono">deployment/mongo/install-mongodb.sh</span>; this tab fills in automatically.</div>`;
    if (g.stale) return `<div class="inf-banner bad"><b>Monitoring is silent.</b> The last health report is ${ctx.dur(g.ageSec)} old. The scheduled guardian job (cron) is not running - check <span class="inf-mono">/var/log/sixstar-mongo/guardian.log</span>.</div>`;
    const t = g.health === 'ok' ? ['ok', 'All database checks are healthy'] : g.health === 'warning' ? ['warn', 'Needs attention'] : ['bad', 'Critical problem'];
    return `<div class="inf-banner ${t[0]}"><b>${t[1]}.</b> ${d.usingCommunity ? 'The POS is running on the self-hosted MongoDB Community database.' : 'The POS is still running on ' + e(d.hosting === 'atlas' ? 'MongoDB Atlas' : d.hosting) + ' (migration not finished).'} Last checked ${ctx.ago(g.generatedAt)}.</div>`;
  }

  function alerts(g) {
    if (!g || !g.alerts.length) return '';
    return `<div class="inf-card" style="margin-bottom:var(--space-4)"><h3>Active alerts</h3>${g.alerts.map((a) => `<div class="inf-alert">${sevBadge(a.severity)}<div><div>${e(a.message)}</div>${a.action ? `<div class="inf-sub">Recommended: ${e(a.action)}</div>` : ''}<div class="inf-sub">Since ${ctx.ago(a.since)}</div></div></div>`).join('')}</div>`;
  }

  function mongoCard(g) {
    const m = (g && g.mongo) || {};
    const c = m.cache || {}, cn = m.connections || {}, rs = m.replSet || {};
    const cp = ctx.pct(c.usedMb, c.maxMb), cc = ctx.pct(cn.current, (cn.current || 0) + (cn.available || 0));
    return `<div class="inf-card"><h3>MongoDB Community</h3>
      <div class="inf-big">${ctx.dot(m.running === true ? true : m.installed ? false : null)} ${m.running ? 'Running' : m.installed ? 'DOWN' : 'Not installed'}</div>
      ${m.running ? kv([['Version', e(m.version)], ['Uptime', ctx.dur(m.uptimeSec)], ['Response', (m.latencyMs != null ? m.latencyMs : '-') + ' ms'],
        ['Replica set', rs.name ? `${e(rs.name)} · ${e(rs.state || '?')}` : '<b>not configured</b>'], ['Oplog window', m.oplog ? m.oplog.windowHours + ' h (' + mb(m.oplog.maxMb) + ')' : '-'],
        ['Authentication', yn(m.auth && m.auth.enforced, 'Enforced', 'OFF')], ['Public exposure', yn(m.publicExposure === undefined ? null : !m.publicExposure, 'Closed (127.0.0.1 only)', 'PORT OPEN')],
        ['Failed logins (1h)', e(m.failedAuth1h || 0)], ['Slow queries (1h)', e(m.slowQueries1h || 0)]]) : ''}
      ${m.running ? `<div class="inf-sub" style="margin-top:10px">Connections ${cn.current} / ${(cn.current || 0) + (cn.available || 0)}</div>${ctx.bar(cc)}<div class="inf-sub" style="margin-top:8px">WiredTiger cache ${mb(c.usedMb)} / ${mb(c.maxMb)}</div>${ctx.bar(cp)}` : ''}</div>`;
  }

  function resourcesCard(g) {
    const r = (g && g.resources) || {}, p = r.profile || {}, s = (g && g.server) || {};
    const mem = ctx.pct(s.ramMb - s.ramAvailMb, s.ramMb);
    return `<div class="inf-card"><h3>Server resources</h3>
      <div class="inf-big">${e(mb(s.ramMb))}<small> RAM · ${e(s.cpus)} CPU</small></div>
      <div class="inf-sub">Profile <b>${e(p.profile || '-')}</b> · mode <b>${e(r.mode || 'normal')}</b>${r.restartPending ? ' · <b>restart pending</b>' : ''}</div>${ctx.bar(mem)}
      ${kv([['Available RAM', mb(s.ramAvailMb)], ['Load (1/5/15)', (s.load || []).join(' · ')], ['MongoDB cache target', mb(p.mongoCacheMb)], ['OS reserve', mb(p.osReserveMb)], ['Node/PM2 reserve', mb(p.appReserveMb)], ['Worker concurrency', e(p.workerConcurrency)],
        ['Backup compression', p.backup ? 'zstd -' + p.backup.zstdLevel + ' · ' + p.backup.uploadConcurrency + ' upload(s)' : '-']])}
      ${(r.modeReasons || []).length ? `<div class="inf-sub" style="margin-top:8px"><b>Protective mode:</b> ${e(r.modeReasons.join(', '))}. Non-essential jobs are throttled; the database itself is never restarted by this.</div>` : ''}</div>`;
  }

  function storageCard(g) {
    const st = (g && g.storage) || { disks: {} }, dbs = (g && g.mongo && g.mongo.dbs) || [];
    return `<div class="inf-card"><h3>Storage</h3>
      ${Object.entries(st.disks).map(([k, d]) => `<div style="margin-bottom:10px"><div class="inf-sub" style="display:flex;justify-content:space-between"><span>${e(k)}</span><span>${d.usedGb} / ${d.totalGb} GB · ${d.usedPct}%</span></div>${ctx.bar(d.usedPct)}</div>`).join('') || '<div class="inf-sub">No data yet</div>'}
      ${dbs.length ? `<div class="inf-sub" style="margin-top:6px">Database size</div>${kv(dbs.map((x) => [e(x.name), `${mb(x.sizeMb)} data · ${mb(x.indexMb)} indexes · ${x.collections} collections`]))}` : ''}
      <div class="inf-sub" style="margin-top:8px">Warnings at 70% / 80%, critical at 90%, emergency protection at 95%. Live database files are never deleted automatically.</div></div>`;
  }

  function backupCard(g) {
    const b = (g && g.backup) || {};
    if (!b.configured && b.configProblem) return `<div class="inf-card" style="margin-bottom:var(--space-4)"><h3>Backups &amp; recovery</h3><div class="inf-banner warn"><b>Not set up:</b> ${e(b.configProblem)}</div></div>`;
    const rec = b.recovery || {}, lf = b.lastFull, ch = b.chain, rt = b.restoreTest, pt = b.pitrTest;
    const tone = (t) => (!t ? null : t.status === 'passed' ? true : t.status === 'failed' ? false : null);
    const rows = (b.fulls || []).slice(0, 10).map((f) => `<tr><td class="inf-mono">${e(f.id)}</td><td>${ctx.ago(f.ts)}</td><td class="num">${f.sizeMb} MB</td><td class="num">${f.docs == null ? '-' : f.docs}</td>
      <td>${f.verifyError ? '<span class="badge badge-danger">Verify failed</span>' : f.verifiedAt ? '<span class="badge badge-success">Verified</span>' : '<span class="badge badge-neutral">Pending</span>'}</td></tr>`).join('');
    return `<div class="inf-card" style="margin-bottom:var(--space-4)"><h3>Backups (Cloudflare R2) &amp; recovery points</h3>
      <div class="inf-grid" style="margin-bottom:0">
        <div>${kv([['Last full backup', lf ? ctx.ago(lf.ts) + ' · ' + lf.sizeMb + ' MB' : 'none yet'], ['Verified', yn(lf ? !!lf.verifiedAt && !lf.verifyError : null, 'Checksum + decrypt OK', 'NO')],
          ['In R2', b.r2 && b.r2.objects != null ? `${b.r2.objects} objects · ${b.r2.sizeGb} GB` : '-'], ['Retention', b.retention ? `${b.retention.daily} daily · ${b.retention.weekly} weekly · ${b.retention.monthly} monthly` : '-'],
          ['Queued uploads', e(b.pending || 0)], b.lastError ? ['Last error', `<span class="inf-bad">${e(b.lastError.message)}</span>`] : null])}</div>
        <div>${kv([['Recover to (full backup)', rec.fullOnly ? ctx.ago(rec.fullOnly) : '<b>not available</b>'], ['Point-in-time window', rec.chainOk ? `${e(new Date(rec.pitrFrom).toLocaleString())} → ${e(new Date(rec.pitrUntil).toLocaleString())}` : 'not available yet'],
          ['Oplog chain', ch ? `${ctx.dot(ch.ok)} ${ch.segments} segments${ch.broken ? ' · BROKEN' : ''}` : 'not started'], ['Restore test', `${ctx.dot(tone(rt))} ${e(rt ? rt.status : 'never run')}${rt ? ' · ' + ctx.ago(rt.ts) : ''}`],
          ['Point-in-time test', `${ctx.dot(tone(pt))} ${e(pt ? pt.status : 'never run')}${pt ? ' · ' + ctx.ago(pt.ts) : ''}`]])}
          <div class="inf-sub" style="margin-top:6px">A recovery point is only shown when its backup and every oplog segment were verified. Target: lose at most 24 h with full backups only, ~15 min with oplog archiving.</div></div>
      </div>
      ${rows ? `<div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Backup</th><th>Taken</th><th class="num">Size</th><th class="num">Docs</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}</div>`;
  }

  function resourceLog(d) {
    const l = d.resourceLog || [];
    return `<div class="inf-card" style="margin-bottom:var(--space-4)"><h3>Resource configuration &amp; upgrade detection</h3>
      <div class="inf-sub" style="margin-bottom:8px">When the VPS is upgraded (e.g. 2 GB → 4 GB) the new RAM/CPU is detected automatically, safe settings are calculated and applied without reinstalling MongoDB or touching the application. A downgrade switches on protective mode instead.</div>
      ${l.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Event</th><th>RAM</th><th>CPU</th><th>MongoDB cache</th><th>Result</th></tr></thead><tbody>${l.map((x) => `<tr><td>${ctx.ago(x.ts)}</td><td>${e(x.kind || 'change')}</td>
        <td>${x.previous ? mb(x.previous.ramMb) + ' → ' : ''}${mb(x.detected && x.detected.ramMb)}</td><td>${x.previous ? e(x.previous.cpus) + ' → ' : ''}${e(x.detected && x.detected.cpus)}</td><td>${mb(x.calculated && x.calculated.mongoCacheMb)}</td>
        <td>${e(x.result)}${x.restartRequired ? ' · restart needed' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="inf-sub">No changes recorded yet.</div>'}</div>`;
  }

  function migrationCard(d) {
    const m = d.migration;
    if (!m && d.usingCommunity) return '';
    const steps = (m && m.steps) || {};
    const keys = Object.keys(STEP_LABELS);
    const next = keys.find((k) => !steps[k] || steps[k].status !== 'ok');
    return `<div class="inf-card" style="margin-bottom:var(--space-4)"><h3>Atlas → Community migration</h3>
      <ol class="inf-steps">${keys.map((k) => { const s = steps[k], st = s ? s.status : 'todo', cls = st === 'ok' ? 'done' : st === 'failed' ? 'failed' : k === next ? 'next' : '';
        return `<li class="${cls}"><b>${e(STEP_LABELS[k])}</b><span>${s ? e(s.detail || st) + ' · ' + ctx.ago(s.ts) : k === next ? 'Next step' : 'Waiting'}</span></li>`; }).join('')}</ol>
      <div class="inf-sub">Atlas stays untouched as the rollback source. Each step is run on the server with <span class="inf-mono">sudo sixstar-mongoctl migrate &lt;step&gt;</span> (see MIGRATION-RUNBOOK.md).</div></div>`;
  }

  function eventsCard(d) {
    const ev = d.events || [];
    return `<div class="inf-card" style="margin-bottom:var(--space-4)"><h3>Maintenance, recovery &amp; security events</h3>
      ${ev.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Severity</th><th>Event</th></tr></thead><tbody>${ev.slice(0, 25).map((x) => `<tr><td style="white-space:nowrap">${ctx.ago(x.ts)}</td><td>${sevBadge(x.severity)}</td><td>${e(x.message)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="inf-sub">No events yet.</div>'}</div>`;
  }

  function actionsCard(d, canOperate) {
    if (!canOperate) return '';
    const row = (t, p, act, word, cls) => `<div class="inf-ctl"><div><b>${t}</b><p>${p}</p></div><button class="btn ${cls || 'btn-secondary'} btn-sm" data-dbact="${act}" data-word="${word || ''}">${t.split(' ')[0]}</button></div>`;
    return `<div class="inf-card"><h3>Database actions</h3>
      ${row('Run backup now', 'Encrypted full backup to Cloudflare R2, then verified. Runs at low priority.', 'backup')}
      ${row('Verify latest backup', 'Re-reads the backup from R2: checksum, decryption and decompression.', 'verify')}
      ${row('Run health check', 'Runs the monitoring pass immediately.', 'check')}
      ${row('Restore test', 'Restores the latest backup into a throwaway database and validates it. Production is not touched.', 'restore-test')}
      ${row('Build recovery copy', 'Restores the latest verified backup onto a separate MongoDB instance for inspection. Production is NOT modified; replacing production is a guarded SSH-only step.', 'recover', 'RECOVER')}
      ${row('Discard recovery copy', 'Removes the recovery instance and frees its disk space.', 'recover-discard', 'DISCARD')}</div>`;
  }

  function draw(d) {
    const g = d.guardian;
    ctx.$('inf-body').innerHTML = banner(d) + alerts(g) + (g ? `<div class="inf-grid">${mongoCard(g)}${resourcesCard(g)}${storageCard(g)}</div>${backupCard(g)}` : '') + migrationCard(d) + resourceLog(d) + eventsCard(d) + actionsCard(d, ctx.S.ov && ctx.S.ov.permissions && ctx.S.ov.permissions.canOperate);
    ctx.$('inf-body').onclick = (ev) => { const b = ev.target.closest('[data-dbact]'); if (b) run(b.dataset.dbact, b.dataset.word); };
  }

  function run(action, word) {
    const go = async () => {
      try { const { data } = await ctx.api.post('/admin/infra/db-action', { action }); ctx.toast(data.message || 'Started', 'success'); setTimeout(() => load(true), 8000); }
      catch (err) { ctx.toast(err.message || 'Action failed', 'error'); }
    };
    if (!word) return go();
    const m = document.createElement('div'); m.className = 'inf-modal';
    m.innerHTML = `<div><h3>Confirm</h3><div class="text-sm text-muted">Type <b>${e(word)}</b> to continue.</div><input class="input" id="cf-in" autocomplete="off" /><div class="row"><button class="btn btn-secondary btn-sm" id="cf-no">Cancel</button><button class="btn btn-danger btn-sm" id="cf-yes" disabled>Confirm</button></div></div>`;
    document.body.appendChild(m);
    const inp = m.querySelector('#cf-in'), yes = m.querySelector('#cf-yes');
    inp.focus(); inp.addEventListener('input', () => { yes.disabled = inp.value.trim() !== word; });
    m.querySelector('#cf-no').onclick = () => m.remove();
    yes.onclick = () => { m.remove(); go(); };
  }

  window.InfraDB = {
    mount(c) {
      ctx = c;
      load(false);
      ctx.S.timers.push(setInterval(() => { if (!document.hidden && ctx.S.tab === 'database') load(true); }, 20000));
    },
  };
})();
