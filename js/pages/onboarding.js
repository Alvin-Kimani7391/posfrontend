/**
 * onboarding.js - Setup guide. The owner works through the checklist one step at a time, can leave
 * at any point and resume later (progress is saved on the server and also detected from real data).
 */
(function () {
  document.addEventListener('DOMContentLoaded', init);
  let contentEl;
  let progress = null;
  let pickerOpen = false;
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Setup guide' });
    if (!contentEl) return;
    const user = window.AppShell.getUser();
    if (user.role !== 'OWNER') {
      contentEl.innerHTML = '<div class="card"><div class="card-body">The setup guide is for the business owner.</div></div>';
      return;
    }
    contentEl.innerHTML = '<div class="card"><div class="card-body text-muted">Loading your setup guide…</div></div>';
    await window.BusinessTypes.syncWithBackend();
    await refresh();
  }

  async function refresh() {
    try { progress = await window.BusinessSetup.loadProgress(); }
    catch (err) { contentEl.innerHTML = `<div class="card"><div class="card-body">${esc(err.message || 'Could not load the setup guide')}</div></div>`; return; }
    // The very first step is shown open for a brand-new business.
    if (!progress.state.typeConfirmed) pickerOpen = true;
    render();
  }

  function render() {
    const { steps, doneCount, total, state, profile } = progress;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    const allDone = doneCount >= total;
    const typeLabel = window.BusinessTypes.typeInfo(profile?.businessType || 'general_shop').label;
    const firstOpen = steps.find((s) => !(s.done || s.skipped) && !s.locked);

    contentEl.innerHTML = `
      <div class="ob-head">
        <div class="ob-progress">
          <h2 style="margin:0">${new URLSearchParams(location.search).get('welcome') ? 'Welcome to Six Star Pos' : 'Setup guide'}</h2>
          <div class="text-sm text-secondary">${allDone ? 'Everything is set up.' : 'Finish these steps one by one. Leave any time and resume later.'}</div>
          <div class="ob-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
          <div class="text-xs text-muted" style="margin-top:4px">${doneCount} of ${total} steps done${state.typeConfirmed ? ` · ${esc(typeLabel)}` : ''}</div>
        </div>
        <div class="ob-actions">
          <button class="btn btn-secondary" id="ob-leave">Leave &amp; resume later</button>
          <a class="btn btn-primary" href="dashboard.html" id="ob-start">${allDone ? 'Start using the system' : 'Skip to dashboard'}</a>
        </div>
      </div>
      <div class="ob-steps">${steps.map((s, i) => stepHtml(s, i, firstOpen)).join('')}</div>
      <div class="ob-footer">
        <span class="text-sm text-muted">${allDone ? 'Great work. Your business is ready.' : 'Skipped steps count as finished; you can reopen them any time.'}</span>
        ${allDone ? '<button class="btn btn-primary" id="ob-finish">Finish setup</button>' : ''}
      </div>`;
    bind();
    if (pickerOpen) mountPicker();
  }

  function stepHtml(s, i, firstOpen) {
    const isDone = s.done, isSkipped = s.skipped;
    const dot = isDone ? window.Icons.get('check') : isSkipped ? '–' : i + 1;
    const badges = [
      s.optional ? '<span class="badge badge-neutral">Optional</span>' : '',
      isSkipped ? '<span class="badge badge-warning">Skipped</span>' : '',
      s.autoDetected ? '<span class="badge badge-success">Detected</span>' : '',
    ].join('');
    let actions = '';
    if (s.key === 'type') {
      actions = pickerOpen ? '' : `<button class="btn btn-secondary btn-sm" data-act="type">${isDone ? 'Change business type' : 'Choose business type'}</button>`;
    } else if (s.locked) {
      actions = `<span class="ob-note">Finish “${esc(progress.steps.find((x) => x.key === s.needs)?.title || 'the previous step')}” first.</span>`;
    } else {
      actions = `<a class="btn ${isDone ? 'btn-secondary' : 'btn-primary'} btn-sm" href="${window.BusinessSetup.stepHref(s)}">${esc(isDone ? 'Open again' : s.label)}</a>`;
      if (!s.autoDetected) {
        if (!isDone) actions += `<button class="btn btn-secondary btn-sm" data-act="done" data-key="${s.key}">Mark as done</button>`;
        if (!isDone && !isSkipped) actions += `<button class="btn btn-ghost btn-sm" data-act="skip" data-key="${s.key}">Skip for now</button>`;
        if (isDone || isSkipped) actions += `<button class="btn btn-ghost btn-sm" data-act="undo" data-key="${s.key}">Reopen</button>`;
      }
    }
    return `
      <div class="ob-step ${isDone ? 'done' : ''} ${s.locked ? 'locked' : ''}" data-step="${s.key}" ${s === firstOpen ? 'id="ob-current"' : ''}>
        <div class="ob-dot">${dot}</div>
        <div class="ob-body">
          <div class="ob-title">${esc(s.title)} ${badges}</div>
          <div class="ob-desc">${esc(s.desc)}</div>
          ${s.note ? `<div class="ob-note" style="margin-bottom:var(--space-2)">${esc(s.note)}</div>` : ''}
          ${s.key === 'type' && pickerOpen ? '<div id="ob-picker"></div>' : ''}
          <div class="ob-actions">${actions}</div>
        </div>
      </div>`;
  }

  function mountPicker() {
    const slot = document.getElementById('ob-picker');
    if (!slot) return;
    const prof = progress.profile || {};
    window.BusinessSetup.mountTypePicker(slot, {
      type: prof.businessType || 'general_shop',
      flags: progress.state.typeConfirmed ? prof.featureSettings : undefined,
      saveLabel: 'Save and continue',
      showKeep: false,
      onCancel: progress.state.typeConfirmed ? () => { pickerOpen = false; render(); } : null,
      onSaved: async () => { pickerOpen = false; await refresh(); document.getElementById('ob-current')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    });
  }

  function bind() {
    contentEl.querySelector('[data-act="type"]')?.addEventListener('click', () => { pickerOpen = true; render(); });
    contentEl.querySelectorAll('[data-act="done"],[data-act="skip"],[data-act="undo"]').forEach((b) => b.addEventListener('click', async () => {
      const status = { done: 'done', skip: 'skipped', undo: 'pending' }[b.dataset.act];
      window.UI.setButtonLoading(b, true, '…');
      try { await window.BusinessSetup.setStep(b.dataset.key, status); await refresh(); }
      catch (e) { window.UI.toast.error(e.message || 'Could not save'); window.UI.setButtonLoading(b, false); }
    }));
    document.getElementById('ob-leave')?.addEventListener('click', async () => {
      try { await window.BusinessSetup.updateOnboarding({ dismissed: true }); } catch { /* ignore */ }
      window.UI.toast.success('Saved. Resume any time from “Setup guide” in the menu.');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 600);
    });
    document.getElementById('ob-finish')?.addEventListener('click', async (e) => {
      window.UI.setButtonLoading(e.currentTarget, true, 'Finishing…');
      try { await window.BusinessSetup.updateOnboarding({ completed: true }); } catch { /* ignore */ }
      window.location.href = 'dashboard.html';
    });
  }
})();
