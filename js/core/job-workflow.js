/**
 * job-workflow.js - one detail screen for both Repairs (/repairs) and Garage job cards (/job-cards).
 * JobWorkflow.open('repair'|'jobcard', id, onChange)
 * Buttons shown depend on the job's status; the server is the final judge of every transition.
 */
(function (window) {
  const K = () => window.ModuleKit;
  const PAY_FIELDS = [
    { name: 'type', label: 'Type', type: 'select', options: [['DEPOSIT', 'Deposit'], ['PAYMENT', 'Payment'], ['REFUND', 'Refund']] },
    { name: 'method', label: 'Method', type: 'select', options: ['CASH', 'MPESA', 'CARD', 'BANK', 'OTHER'] },
    { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, required: true },
    { name: 'reference', label: 'Reference (e.g. M-PESA code)' },
  ];

  const KINDS = {
    repair: {
      base: '/repairs', label: 'Repair', perm: 'repairs.manage', workPerm: 'repairs.manage',
      steps: [
        { a: 'startWork', label: 'Start work', st: ['APPROVED', 'AWAITING_PARTS'] },
        { a: 'awaitParts', label: 'Waiting for parts', st: ['APPROVED', 'IN_PROGRESS'] },
        { a: 'ready', label: 'Mark ready', st: ['IN_PROGRESS'] },
        { a: 'unrepairable', label: 'Cannot be repaired', st: ['RECEIVED', 'DIAGNOSED', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS'] },
      ],
      approvalSt: ['RECEIVED', 'DIAGNOSED', 'AWAITING_APPROVAL'], terminal: ['COLLECTED', 'CANCELLED', 'UNREPAIRABLE'], readySt: ['READY'],
      summary: (j) => [['Customer', j.customerName], ['Phone', j.customerPhone], ['Device', [j.device?.brand, j.device?.model].filter(Boolean).join(' ')], ['Serial', j.device?.serialNumber], ['Condition', j.device?.condition], ['Promised', K().date(j.promisedDate)], ['Warranty repair', j.isWarrantyRepair ? 'Yes' : 'No']],
      problem: (j) => j.fault, labourOf: (j) => K().money(j.labour),
      estimateFields: [{ name: 'diagnosis', label: 'Diagnosis', type: 'textarea' }, { name: 'labour', label: 'Labour charge', type: 'number', step: '0.01', min: 0 }, { name: 'promisedDate', label: 'Promised date', type: 'date' }],
      collectFields: [{ name: 'collectedByName', label: 'Collected by (name)', required: true }, { name: 'idChecked', label: 'ID checked', type: 'checkbox' }, { name: 'waiveBalance', label: 'Waive remaining balance', type: 'checkbox' }, { name: 'waiveReason', label: 'Waive reason' }],
    },
    jobcard: {
      base: '/job-cards', label: 'Job card', perm: 'jobcards.manage', workPerm: 'jobcards.work',
      steps: [
        { a: 'startWork', label: 'Start work', st: ['APPROVED', 'AWAITING_PARTS'] },
        { a: 'awaitParts', label: 'Waiting for parts', st: ['APPROVED', 'IN_PROGRESS'] },
        { a: 'sendToQualityCheck', label: 'Send to quality check', st: ['IN_PROGRESS'] },
      ],
      approvalSt: ['CHECKED_IN', 'DIAGNOSED', 'AWAITING_APPROVAL'], terminal: ['COLLECTED', 'CANCELLED'], readySt: ['READY'], qcSt: ['QUALITY_CHECK'],
      summary: (j) => [['Vehicle', `${j.plate} ${j.vehicleLabel || ''}`], ['Customer', j.customerName], ['Phone', j.customerPhone], ['Odometer in', j.odometerIn != null ? `${j.odometerIn} km` : ''], ['Fuel', j.fuelLevel], ['Promised', K().date(j.promisedDate)], ['Warranty job', j.isWarrantyRepair ? 'Yes' : 'No']],
      problem: (j) => j.complaint, labourOf: (j) => K().money(j.labourTotal),
      estimateFields: [{ name: 'diagnosis', label: 'Diagnosis', type: 'textarea' }, { name: 'labourDescription', label: 'Add labour line (description)' }, { name: 'labourHours', label: 'Hours', type: 'number', step: '0.1', min: 0.1, value: 1 }, { name: 'labourRate', label: 'Rate per hour (or fixed price with 1 hour)', type: 'number', step: '0.01', min: 0 }, { name: 'promisedDate', label: 'Promised date', type: 'date' }],
      collectFields: [{ name: 'collectedByName', label: 'Collected by (name)', required: true }, { name: 'odometerOut', label: 'Odometer out (km)', type: 'number', min: 0, required: true }, { name: 'workWarrantyDays', label: 'Work warranty (days)', type: 'number', min: 0 }, { name: 'idChecked', label: 'ID checked', type: 'checkbox' }, { name: 'waiveBalance', label: 'Waive remaining balance', type: 'checkbox' }, { name: 'waiveReason', label: 'Waive reason' }],
    },
  };

  async function open(kind, id, onChange) {
    const c = KINDS[kind], k = K();
    let j;
    try { j = (await window.Api.get(`${c.base}/${id}`)).data.job; } catch (e) { window.UI.toast.error(e.message); return; }
    const live = !c.terminal.includes(j.status);
    const manage = k.can(c.perm), work = k.can(c.workPerm);
    const has = (arr) => (arr || []).includes(j.status);

    const buttons = [];
    if (live && manage) buttons.push(['estimate', 'Update estimate']);
    if (manage && has(c.approvalSt)) buttons.push(['approval', 'Record customer approval']);
    if (work) c.steps.forEach((s) => has(s.st) && buttons.push([s.a, s.label]));
    if (work && has(c.qcSt)) buttons.push(['qc', 'Quality check']);
    if (manage && j.status !== 'CANCELLED') buttons.push(['payment', 'Record payment']);
    if (manage && has(c.readySt)) buttons.push(['notify', 'Tell customer it is ready'], ['collect', 'Hand over']);
    if (manage && live) buttons.push(['cancel', 'Cancel']);

    const num = j.jobNumber;
    const modal = window.UI.openModal({
      title: `${c.label} ${num}`, maxWidth: '860px',
      bodyHtml: `
        ${k.kv([['Status', k.badge(j.status)], ...c.summary(j)])}
        <div class="mk-section">${kind === 'repair' ? 'Fault' : 'Complaint'}</div><div class="text-sm">${k.esc(c.problem(j))}</div>
        ${j.diagnosis ? `<div class="mk-section">Diagnosis</div><div class="text-sm">${k.esc(j.diagnosis)}</div>` : ''}
        ${kind === 'jobcard' && (j.labourLines || []).length ? `<div class="mk-section">Labour</div><table class="table"><tbody>${j.labourLines.map((l) => `<tr><td>${k.esc(l.description)}</td><td>${l.hours} h</td><td style="text-align:right">${k.money(l.rate)}</td><td style="text-align:right">${l.done ? k.badge('done') : (work && live ? `<button class="btn btn-secondary btn-sm" data-labour="${l._id}">Mark done</button>` : '')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${(j.parts || []).length ? `<div class="mk-section">Parts</div><table class="table"><tbody>${j.parts.map((p) => `<tr><td>${k.esc(p.nameSnapshot)}</td><td>× ${p.quantity}</td><td style="text-align:right">${k.money(p.unitPrice)}</td><td style="text-align:right">${p.issued ? k.badge('issued') : (manage && live ? `<button class="btn btn-secondary btn-sm" data-part="${p._id}" data-issue="1">Issue from stock</button>` : '')}${p.issued && manage && live ? ` <button class="btn btn-ghost btn-sm" data-part="${p._id}" data-issue="0">Return</button>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
        <div class="mk-section">Money</div>
        ${k.kv([['Labour', c.labourOf(j)], ['Parts', k.money(j.partsTotal)], ['Tax', k.money(j.tax)], ['Total', k.money(j.total)], ['Paid', k.money(j.paid)], ['Balance', k.money(j.balance)]])}
        ${(j.history || []).length ? `<div class="mk-section">History</div><div class="text-xs text-muted">${j.history.slice(-6).map((h) => `${k.dateTime(h.at)} · ${k.esc(String(h.to || h.type || h.action || '').replace(/_/g, ' '))}${h.note ? ` · ${k.esc(h.note)}` : ''}`).join('<br>')}</div>` : ''}
        <div class="mk-actions">${buttons.map(([a, l]) => `<button class="btn ${a === 'collect' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-flow="${a}">${k.esc(l)}</button>`).join('')}</div>`,
      footerHtml: '<button class="btn btn-secondary" data-a="close">Close</button>',
    });
    modal.querySelector('[data-a="close"]').addEventListener('click', () => window.UI.closeModal());

    const done = (msg) => { window.UI.toast.success(msg); window.UI.closeModal(); onChange && onChange(); open(kind, id, onChange); };
    const post = (path, body, msg, method = 'post') => window.Api[method](`${c.base}/${id}${path}`, body).then(() => done(msg));

    modal.querySelectorAll('[data-labour]').forEach((b) => b.addEventListener('click', () => post(`/labour/${b.dataset.labour}/done`, { done: true }, 'Labour marked done').catch((e) => window.UI.toast.error(e.message))));
    modal.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => post(`/parts/${b.dataset.part}/${b.dataset.issue === '1' ? 'issue' : 'return'}`, {}, b.dataset.issue === '1' ? 'Part issued from stock' : 'Part returned to stock').catch((e) => window.UI.toast.error(e.message))));

    modal.querySelectorAll('[data-flow]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.flow;
      const step = c.steps.find((s) => s.a === a);
      const sub = (title, fields, submit, fn, intro) => { window.UI.closeModal(); k.formModal({ title, fields, submitLabel: submit, intro, onSubmit: async (d) => { await fn(d); window.UI.toast.success('Saved'); onChange && onChange(); open(kind, id, onChange); } }); };
      if (a === 'estimate') {
        sub('Update estimate', c.estimateFields, 'Save estimate', (d) => {
          const body = { diagnosis: d.diagnosis, promisedDate: d.promisedDate };
          if (kind === 'repair' && d.labour !== undefined) body.labour = d.labour;
          if (kind === 'jobcard' && d.labourDescription && d.labourRate) body.addLabour = [{ description: d.labourDescription, hours: d.labourHours || 1, rate: d.labourRate }];
          Object.keys(body).forEach((x) => body[x] === undefined && delete body[x]);
          return window.Api.put(`${c.base}/${id}/estimate`, body);
        }, 'Parts are added from the product list: ask your manager to add parts via the estimate.');
      } else if (a === 'approval') sub('Customer approval', [{ name: 'channel', label: 'How was it approved?', type: 'select', options: ['IN_PERSON', 'PHONE', 'SMS', 'WHATSAPP'] }, { name: 'note', label: 'Note' }], 'Record approval', (d) => window.Api.post(`${c.base}/${id}/approval`, d));
      else if (step) sub(step.label, [{ name: 'note', label: 'Note (optional)' }], 'Confirm', (d) => window.Api.post(`${c.base}/${id}/action`, { action: step.a, ...d }));
      else if (a === 'qc') sub('Quality check', [{ name: 'passed', label: 'Passed', type: 'select', options: [['true', 'Passed'], ['false', 'Failed - back to work']] }, { name: 'roadTest', label: 'Road test done', type: 'checkbox' }, { name: 'note', label: 'Note' }], 'Save', (d) => window.Api.post(`${c.base}/${id}/quality-check`, { ...d, passed: d.passed === 'true' }));
      else if (a === 'payment') sub('Record payment', PAY_FIELDS, 'Save payment', (d) => window.Api.post(`${c.base}/${id}/payments`, d), `Balance now ${k.money(j.balance)}.`);
      else if (a === 'notify') post('/notify', {}, 'Customer notified').catch((e) => window.UI.toast.error(e.message));
      else if (a === 'collect') sub('Hand over', c.collectFields, 'Hand over', (d) => window.Api.post(`${c.base}/${id}/collect`, d), `Balance due: ${k.money(j.balance)}. Take payment first, or waive it with a reason.`);
      else if (a === 'cancel') sub('Cancel', [{ name: 'reason', label: 'Reason', required: true }], 'Cancel it', (d) => window.Api.post(`${c.base}/${id}/cancel`, d));
    }));
  }

  window.JobWorkflow = { open };
})(window);
