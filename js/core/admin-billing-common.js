/**
 * admin-billing-common.js - helpers shared by every admin billing page, plus the manual-payment review modal.
 * Money from the API is integer cents; admin inputs are KES and converted here.
 */
(function (window) {
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const kes = (c) => window.UI.formatMoney((Number(c) || 0) / 100);
  const kesToCents = (v) => Math.round(Number(v) * 100);
  const centsToKes = (c) => (Number(c) || 0) / 100;
  const fdate = (d) => (d ? window.UI.formatDate(d) : '-');

  const SUB_BADGE = { TRIALING: 'badge-info', ACTIVE: 'badge-success', PAST_DUE: 'badge-warning', SUSPENDED: 'badge-danger', CANCELLED: 'badge-neutral' };
  const SUB_LABEL = { TRIALING: 'Trial', ACTIVE: 'Active', PAST_DUE: 'Past due', SUSPENDED: 'Locked', CANCELLED: 'Cancelled' };
  const PAY_BADGE = { PENDING: 'badge-info', SUBMITTED: 'badge-warning', SUCCESS: 'badge-success', FAILED: 'badge-danger', REJECTED: 'badge-danger', CANCELLED: 'badge-neutral' };
  const PAY_LABEL = { PENDING: 'Waiting', SUBMITTED: 'To verify', SUCCESS: 'Received', FAILED: 'Failed', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
  const INV_BADGE = { PENDING: 'badge-warning', PARTIAL: 'badge-warning', PAID: 'badge-success', VOID: 'badge-neutral' };
  const METHOD_LABEL = { STK: 'M-PESA prompt', MPESA_MANUAL: 'M-PESA manual', CASH: 'Cash', BANK: 'Bank', OTHER: 'Other' };
  const FLAG_TEXT = {
    AMOUNT_NOT_IN_MESSAGE: 'The amount could not be read from the message. Check the amount carefully.',
    RECIPIENT_NOT_FOUND: 'Your till / account name or number was not found in the message. It may have been paid somewhere else.',
    LOOKS_LIKE_RECEIVED_MESSAGE: 'The message says "you have received". That is the wording sent to the RECEIVER, so the owner may have copied someone else\'s message.',
    SIMILAR_RECENT_STK: 'This business paid the same amount by STK in the last 48 hours. Make sure it is not the same money twice.',
    DUPLICATE_RECEIPT: 'This M-PESA code matches another payment.',
  };

  const badge = (map, labels, key) => `<span class="badge ${map[key] || 'badge-neutral'}">${esc((labels && labels[key]) || key)}</span>`;

  function subnav(active) {
    const items = [['overview', 'admin-billing.html', 'Overview & payments'], ['plans', 'admin-billing-plans.html', 'Plans & prices'], ['settings', 'admin-billing-settings.html', 'Settings']];
    return `<nav class="bl-subnav">${items.map(([k, h, l]) => `<a href="${h}" class="${k === active ? 'active' : ''}">${l}</a>`).join('')}</nav>`;
  }

  function stat({ label, value, sub, tone = '', href }) {
    const inner = `<span class="l">${esc(label)}</span><span class="v">${value}</span>${sub ? `<span class="s">${sub}</span>` : ''}`;
    return href ? `<a class="bl-stat ${tone}" href="${href}">${inner}</a>` : `<div class="bl-stat ${tone}">${inner}</div>`;
  }

  function errText(err) {
    const list = (err.errors || []).slice(0, 3).map((e) => e.message).filter(Boolean);
    return list.length ? `${err.message}: ${list.join('; ')}` : err.message;
  }

  /** Modal with a form. onSubmit(form, modal) -> return false to keep it open. Errors become toasts. */
  function formModal({ title, bodyHtml, submitText = 'Save', danger = false, maxWidth = '520px', onSubmit }) {
    const modal = window.UI.openModal({
      title, maxWidth,
      bodyHtml: `<form id="ab-form" onsubmit="return false">${bodyHtml}</form>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel" type="button">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="submit" type="button">${esc(submitText)}</button>`,
    });
    const form = modal.querySelector('#ab-form');
    const btn = modal.querySelector('[data-action="submit"]');
    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    btn.addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      window.UI.setButtonLoading(btn, true, 'Working…');
      try {
        const keepOpen = (await onSubmit(form, modal)) === false;
        if (!keepOpen) window.UI.closeModal();
      } catch (err) {
        window.UI.toast.error(errText(err));
      } finally {
        if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false);
      }
    });
    return modal;
  }

  const val = (form, name) => (form.elements[name] ? String(form.elements[name].value).trim() : '');

  /* ------------------------- manual payment review ------------------------- */
  async function openPaymentReview(id, onDone) {
    let data;
    try { ({ data } = await window.Api.get(`/admin/billing/payments/${id}`)); }
    catch (err) { return window.UI.toast.error(err.message); }

    const p = data.payment;
    const sim = data.similarPayments || [];
    const acc = data.account || {};
    const review = p.status === 'SUBMITTED';
    const flags = (p.flags || []).map((f) => `<div class="bl-flag">${esc(FLAG_TEXT[f] || f)}</div>`).join('');
    const parsedAmt = p.parsed && p.parsed.amountCents != null ? kes(p.parsed.amountCents) : 'Not found';

    const modal = window.UI.openModal({
      title: `Payment ${p.reference}`,
      maxWidth: '640px',
      bodyHtml: `
        <div class="bl-kv"><span>Business</span><span><a class="bl-link" href="admin-billing-business.html?id=${esc(p.businessId)}">${esc(p.businessName)}</a></span></div>
        <div class="bl-kv"><span>Method</span><span>${esc(METHOD_LABEL[p.method] || p.method)}</span></div>
        <div class="bl-kv"><span>Status</span><span>${badge(PAY_BADGE, PAY_LABEL, p.status)}</span></div>
        <div class="bl-kv"><span>Submitted</span><span>${window.UI.formatDateTime(p.createdAt)}</span></div>
        <div class="bl-kv"><span>Amount the owner claims</span><span>${kes(p.claimedAmount)}</span></div>
        <div class="bl-kv"><span>Amount read from the message</span><span>${parsedAmt}</span></div>
        <div class="bl-kv"><span>M-PESA code</span><span><strong>${esc(p.mpesaReceiptNumber || '-')}</strong></span></div>
        ${p.status === 'SUCCESS' ? `<div class="bl-kv"><span>Credited</span><span>${kes(p.amount)}</span></div>` : ''}
        <div class="bl-kv"><span>Account right now</span><span>Overdue ${kes(acc.arrearsCents)} · Open ${kes(acc.openBalanceCents)} · Credit ${kes(acc.creditCents)}</span></div>
        ${flags ? `<div style="margin-top:var(--space-3)">${flags}</div>` : ''}
        ${p.mpesaMessage ? `<div class="text-sm" style="margin:var(--space-4) 0 var(--space-2)"><strong>Message pasted by the owner</strong></div><div class="bl-pre">${esc(p.mpesaMessage)}</div>` : ''}
        ${sim.length ? `<div class="bl-flag" style="margin-top:var(--space-3)">Similar payments from this business within 2 days: ${sim.map((s) => `${esc(s.mpesaReceiptNumber || s.reference)} (${kes(s.amount)})`).join(', ')}</div>` : ''}
        ${p.review && p.review.byName ? `<p class="bl-muted" style="margin-top:var(--space-3)">Reviewed by ${esc(p.review.byName)} on ${window.UI.formatDateTime(p.review.at)}${p.review.note ? `: ${esc(p.review.note)}` : ''}</p>` : ''}
        ${review ? `
          <hr style="margin:var(--space-4) 0;border-color:var(--color-border)" />
          <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">Before approving, confirm in your M-PESA statement that code <strong>${esc(p.mpesaReceiptNumber)}</strong> was received on your till for the amount below.</p>
          <div class="field"><label for="rv-amount">Verified amount to credit (KES)</label><input class="input" id="rv-amount" type="number" min="1" step="0.01" value="${centsToKes(p.claimedAmount)}" /></div>
          <div class="field"><label for="rv-note">Note / reason <span class="text-muted">(reason is required to reject)</span></label><textarea class="textarea" id="rv-note" rows="2" maxlength="300"></textarea></div>` : ''}`,
      footerHtml: review
        ? '<button class="btn btn-secondary" data-action="close">Close</button><button class="btn btn-danger" data-action="reject">Reject</button><button class="btn btn-success" data-action="approve">Approve & credit</button>'
        : '<button class="btn btn-primary" data-action="close">Close</button>',
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    if (!review) return;

    const done = (msg) => { window.UI.closeModal(); window.UI.toast.success(msg); if (onDone) onDone(); };

    modal.querySelector('[data-action="approve"]').addEventListener('click', async (e) => {
      const amount = Number(modal.querySelector('#rv-amount').value);
      if (!(amount > 0)) return window.UI.toast.error('Enter the verified amount');
      const ok = await window.UI.confirmDialog({
        title: 'Credit this payment?',
        message: `${kes(kesToCents(amount))} will be credited to ${p.businessName} and applied to their oldest invoices. This cannot be undone.`,
        confirmText: 'Approve & credit',
      });
      if (!ok) return;
      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Approving…');
      try {
        const note = modal.querySelector('#rv-note').value.trim();
        await window.Api.post(`/admin/billing/payments/${p._id}/approve`, { amountCents: kesToCents(amount), ...(note ? { note } : {}) });
        done('Payment approved and credited');
      } catch (err) { window.UI.toast.error(errText(err)); }
      finally { if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false); }
    });

    modal.querySelector('[data-action="reject"]').addEventListener('click', async (e) => {
      const reason = modal.querySelector('#rv-note').value.trim();
      if (reason.length < 3) return window.UI.toast.error('Write the reason in the note box - the owner will see it');
      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Rejecting…');
      try {
        await window.Api.post(`/admin/billing/payments/${p._id}/reject`, { reason });
        done('Payment rejected - the owner was notified');
      } catch (err) { window.UI.toast.error(errText(err)); }
      finally { if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false); }
    });
  }

  window.AdminBilling = {
    esc, kes, kesToCents, centsToKes, fdate, subnav, stat, badge, errText, formModal, val, openPaymentReview,
    SUB_BADGE, SUB_LABEL, PAY_BADGE, PAY_LABEL, INV_BADGE, METHOD_LABEL,
  };
})(window);