/**
 * admin-weekly-report.js - platform admin: when the weekly shop report (email + Low Stock and Expiry PDFs) goes out,
 * send a demo to any address, or send it to every shop now.
 */
(function () {
  const Api = window.Api;
  const esc = window.UI.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const toastErr = (e) => window.UI.toast.error((e && e.message) || 'Something went wrong');
  const LONG = { timeoutMs: 120000 };
  let slots = []; let el;

  document.addEventListener('DOMContentLoaded', async () => {
    el = window.AdminShell.mount({ title: 'Weekly report' });
    if (!el) return;
    el.innerHTML = `
      <div class="page-header"><div><h1>Weekly report</h1><p>Every week, shop owners and their managers get an email with the shop's sales (day by day and against previous weeks) plus two PDF reports: Low Stock, and Expiry with the stock value at risk.</p></div></div>
      <div id="wr-body">${window.UI.skeletonRows(3, 1)}</div>`;
    try { await render(); } catch (e) { $('wr-body').innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load', message: e.message })}</div>`; }
  });

  async function render() {
    const { data: s } = await Api.get('/admin/weekly-report');
    slots = s.slots.map((x) => ({ ...x }));
    const lr = s.lastRun;
    $('wr-body').innerHTML = `
      ${s.emailConfigured ? '' : '<div class="card" style="border-left:4px solid var(--danger,#dc2626);margin-bottom:var(--space-4)"><div class="card-body"><b>Email is not configured.</b> Set <code>BREVO_API_KEY</code> and <code>BREVO_SENDER_EMAIL</code> on the server, otherwise nothing can be sent.</div></div>'}
      <div class="card bl-card-gap"><div class="card-header"><div><h2>Schedule</h2><p class="text-sm text-muted">Times are Nairobi time. Default is every Saturday at 10:00. Add as many send times as you like.</p></div>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" id="wr-on" ${s.enabled ? 'checked' : ''}/> Weekly emails on</label></div>
        <div class="card-body"><div id="wr-slots"></div><button class="btn btn-secondary btn-sm" id="wr-add" style="margin-top:10px">+ Add a send time</button></div>
        <div class="card-footer" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="text-sm text-muted">${lr ? `Last run: ${esc(window.UI.formatDateTime(lr.at))} (${esc(lr.trigger)}): ${lr.sent} sent, ${lr.skipped} skipped, ${lr.failed} failed of ${lr.businesses} shops.` : 'Has not run yet.'}</span>
          <button class="btn btn-primary btn-sm" id="wr-save">Save schedule</button></div></div>

      <div class="card bl-card-gap"><div class="card-header"><div><h2>Send a demo</h2><p class="text-sm text-muted">Check how the email and PDFs look. It uses real numbers from one shop but is sent <b>only</b> to the address below, never to the shop's owner.</p></div></div><div class="card-body">
        <div class="form-row">
          <div class="field"><label>Send demo to (email)</label><input class="input" id="wr-email" type="email" placeholder="you@example.com" /></div>
          <div class="field"><label>Use data from</label><select class="select" id="wr-biz"><option value="">The most recently active shop</option></select></div>
        </div></div>
        <div class="card-footer" style="display:flex;justify-content:flex-end"><button class="btn btn-primary btn-sm" id="wr-demo">Send demo</button></div></div>

      <div class="card bl-card-gap"><div class="card-header"><div><h2>Send to all shops now</h2><p class="text-sm text-muted">Does exactly what the scheduled run does: emails the owner and managers of every active shop. Shops that switched the weekly email off, or have no activity, are skipped.</p></div></div>
        <div class="card-footer" style="display:flex;justify-content:flex-end"><button class="btn btn-danger btn-sm" id="wr-run">Send to all shops now</button></div></div>`;
    drawSlots();
    $('wr-add').onclick = () => { if (slots.length < 14) { slots.push({ day: 6, time: '10:00' }); drawSlots(); } };
    $('wr-slots').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { slots.splice(Number(b.dataset.del), 1); drawSlots(); } });
    $('wr-slots').addEventListener('change', (e) => {
      const i = Number(e.target.dataset.i); if (Number.isNaN(i)) return;
      if (e.target.dataset.k === 'day') slots[i].day = Number(e.target.value); else slots[i].time = e.target.value;
    });
    $('wr-save').onclick = save; $('wr-demo').onclick = demo; $('wr-run').onclick = runNow;
    Api.get('/admin/weekly-report/businesses').then(({ data }) => {
      $('wr-biz').insertAdjacentHTML('beforeend', data.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join(''));
    }).catch(() => {});
  }

  function drawSlots() {
    $('wr-slots').innerHTML = slots.length ? slots.map((s, i) => `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <select class="select" data-i="${i}" data-k="day" style="max-width:180px">${DAYS.map((d, n) => `<option value="${n}" ${n === s.day ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <input class="input" type="time" data-i="${i}" data-k="time" value="${esc(s.time)}" style="max-width:140px" />
        <button class="btn btn-ghost btn-sm" data-del="${i}" title="Remove">Remove</button></div>`).join('')
      : '<div class="text-muted text-sm">No send times: the weekly email will not go out until you add one.</div>';
  }

  async function save() {
    try {
      const bad = slots.find((s) => !/^\d\d:\d\d$/.test(s.time));
      if (bad) return window.UI.toast.error('Pick a time for every row.');
      await Api.put('/admin/weekly-report', { enabled: $('wr-on').checked, slots });
      window.UI.toast.success('Schedule saved'); await render();
    } catch (e) { toastErr(e); }
  }

  async function demo() {
    const email = $('wr-email').value.trim();
    if (!email) return window.UI.toast.error('Type the email address to send the demo to.');
    const btn = $('wr-demo'); btn.disabled = true; btn.textContent = 'Building and sending...';
    try {
      const { message } = await Api.post('/admin/weekly-report/demo', { email, businessId: $('wr-biz').value || undefined }, LONG);
      window.UI.toast.success(message || 'Demo sent');
    } catch (e) { toastErr(e); } finally { btn.disabled = false; btn.textContent = 'Send demo'; }
  }

  async function runNow() {
    const ok = await window.UI.confirmDialog({ title: 'Email every shop now?', message: 'The owner and managers of every active shop will receive this week\'s report immediately.', confirmText: 'Send to all', danger: true });
    if (!ok) return;
    const btn = $('wr-run'); btn.disabled = true; btn.textContent = 'Sending...';
    try { const { message } = await Api.post('/admin/weekly-report/run-now', { confirm: true }, { timeoutMs: 600000 }); window.UI.toast.success(message); await render(); }
    catch (e) { toastErr(e); } finally { btn.disabled = false; btn.textContent = 'Send to all shops now'; }
  }
})();
