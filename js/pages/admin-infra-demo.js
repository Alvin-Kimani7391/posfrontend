/** admin-infra-demo.js - fake data so the page can be previewed with admin-infra.html?demo=1 (no backend needed). */
(function () {
  const now = () => Date.now();
  const ago = (m) => new Date(now() - m * 60000).toISOString();
  const svcs = ['sixstar-blue', 'sixstar-green', 'sixstar-worker', 'sixstar-staging'];
  const msgs = [
    ['info', 'POST /api/v1/sales 201 48ms'], ['info', 'GET /api/v1/products 200 12ms'],
    ['info', 'mpesa callback received ref=QJK8X2L9 status=success'], ['warn', 'slow query products.find 640ms'],
    ['info', 'job mpesaReconcile completed in 1.2s (0 changes)'], ['info', 'job smsQueue completed in 210ms (3 sent)'],
    ['error', 'PayHero timeout after 30000ms - will reconcile, NOT retrying charge'], ['debug', 'cache hit business:settings'],
    ['info', 'POST /api/v1/auth/login 200 95ms'], ['warn', 'rate limit reached ip=41.90.x.x'],
  ];
  let seq = 0;
  function line(service) {
    const m = msgs[Math.floor(Math.random() * msgs.length)];
    return { id: ++seq, ts: new Date().toISOString(), level: m[0], service: service || svcs[Math.floor(Math.random() * 3)], msg: m[1] };
  }
  const state = { active: 'green', maintenance: false };
  const seed = Array.from({ length: 120 }, () => line());
  const clamp = (n) => Math.max(1, Math.min(99, n));
  function overview() {
    const a = state.active, b = a === 'green' ? 'blue' : 'green';
    return {
      permissions: { canOperate: true, canPromote: true },
      maintenance: state.maintenance,
      github: { pendingApprovalUrl: 'https://github.com/' },
      server: { cpuPct: clamp(18 + Math.random() * 20), memUsedMb: 1180, memTotalMb: 2048, diskUsedGb: 14.6, diskTotalGb: 40, uptimeSec: 86400 * 12 + 4000, load: [0.42, 0.38, 0.31], netInKbps: 220, netOutKbps: 540 },
      release: {
        active: { slot: a, releaseId: '20261104-1410-a3f9c1e', sha: 'a3f9c1e', since: ago(190), healthy: true },
        standby: { slot: b, releaseId: '20261102-0905-77be210', sha: '77be210', healthy: true },
      },
      services: [
        { name: 'sixstar-' + a, role: 'API (live)', status: 'online', port: a === 'blue' ? 5100 : 5101, memMb: 168, restarts: 0, uptimeSec: 11400, release: '20261104-1410-a3f9c1e' },
        { name: 'sixstar-' + b, role: 'API (standby)', status: 'online', port: b === 'blue' ? 5100 : 5101, memMb: 154, restarts: 0, uptimeSec: 188000, release: '20261102-0905-77be210' },
        { name: 'sixstar-worker', role: 'Background jobs', status: 'online', port: null, memMb: 121, restarts: 1, uptimeSec: 11200, release: '20261104-1410-a3f9c1e' },
        { name: 'sixstar-staging', role: 'Staging API', status: 'online', port: 5200, memMb: 140, restarts: 0, uptimeSec: 9000, release: '20261104-1402-a3f9c1e' },
        { name: 'nginx', role: 'Reverse proxy', status: 'online', port: 443, memMb: 12, restarts: 0, uptimeSec: 86400 * 12, release: null },
      ],
      database: { engine: 'MongoDB', status: 'connected', sizeGb: 1.8, connections: 23, maxConnections: 100, pgReady: false },
      backup: { lastSuccess: ago(310), lastStatus: 'success', r2Objects: 14, r2SizeGb: 3.2, retentionDays: 14, lastRestoreTest: ago(60 * 24 * 6), restoreTestStatus: 'passed', encrypted: true, walStatus: 'not configured' },
      jobs: { lockedBy: 'sixstar-worker', running: 12, lastFailure: null },
    };
  }
  const D = (o) => Object.assign({ by: 'zion', previous: 'blue', tests: '48 passed', health: 'ready in 6s', reason: '', env: 'production' }, o);
  const deployments = [
    D({ release: '20261110-1602-e41b7d9', sha: 'e41b7d9', status: 'success', env: 'staging', ts: ago(4), previous: '-', promotable: true, outcome: 'success' }),
    D({ release: '20261110-1511-5c0aa31', sha: '5c0aa31', status: 'staging_failed', env: 'staging', ts: ago(55), previous: '-', reason: 'staging did not become ready', outcome: 'failed' }),
    D({ release: '20261104-1410-a3f9c1e', sha: 'a3f9c1e', status: 'success', ts: ago(190), outcome: 'success' }),
    D({ release: '20261103-1630-9d21aa0', sha: '9d21aa0', status: 'failed_before_switch', previous: 'green', ts: ago(1300), health: 'not ready after 40s', reason: '/health/ready did not pass', outcome: 'failed' }),
    D({ release: '20261102-0905-77be210', sha: '77be210', status: 'success', ts: ago(3300), outcome: 'success' }),
    D({ release: '20261101-0800-aa11bb2', sha: 'aa11bb2', status: 'rollback_verified', previous: 'green', ts: ago(5000), reason: 'manual rollback', outcome: 'info' }),
    D({ release: '20261031-1120-0c4e8b7', sha: '0c4e8b7', status: 'rolled_back_verified', previous: 'green', ts: ago(6300), health: 'failed after switch', reason: 'post-switch health failed', outcome: 'failed' }),
  ];

  function get(path, q) {
    q = q || {};
    if (path.endsWith('/overview')) return overview();
    if (path.endsWith('/deployments')) return { items: deployments, promote: { available: true, reason: '' } };
    if (path.endsWith('/logs')) {
      const after = Number(q.after || 0);
      if (!after) return { lines: seed.filter((l) => !q.service || l.service === q.service) };
      const fresh = Array.from({ length: Math.floor(Math.random() * 3) }, () => line(q.service || undefined));
      seed.push(...fresh);
      return { lines: seed.filter((l) => l.id > after && (!q.service || l.service === q.service)) };
    }
    return {};
  }
  function post(path) {
    if (path.endsWith('/rollback')) state.active = state.active === 'green' ? 'blue' : 'green';
    if (path.endsWith('/promote')) { deployments[0].promotable = false; deployments.unshift(D({ release: 'promoting', sha: 'e41b7d9', status: 'success', ts: new Date().toISOString(), outcome: 'success', previous: 'green' })); }
    if (path.endsWith('/maintenance')) state.maintenance = !state.maintenance;
    return { ok: true, message: 'Demo: action simulated, nothing real changed.' };
  }
  window.InfraDemo = {
    get: (p, q) => new Promise((r) => setTimeout(() => r({ data: get(p, q) }), 250)),
    post: (p, b) => new Promise((r) => setTimeout(() => r({ data: post(p, b) }), 600)),
  };
})();
