/**
 * ticket-ui.js - helpers shared by the shop-side Support page and the
 * platform-admin Tickets page: status/priority badges, thread + screenshot
 * rendering, the screenshot picker (browse / drag-drop / Ctrl+V paste),
 * and copy-to-clipboard. Load after ui.js.
 */
(function (window) {
  const esc = window.UI.escapeHtml;

  const STATUS = {
    OPEN: { label: 'Open', badge: 'badge-info' },
    IN_PROGRESS: { label: 'In progress', badge: 'badge-warning' },
    RESOLVED: { label: 'Resolved', badge: 'badge-success' },
    CLOSED: { label: 'Closed', badge: 'badge-neutral' },
  };
  const PRIORITY = { LOW: 'badge-neutral', MEDIUM: 'badge-info', HIGH: 'badge-warning', URGENT: 'badge-danger' };
  const CATEGORIES = [
    ['SALES', 'Sales / checkout'], ['PAYMENTS', 'Payments / M-PESA'], ['INVENTORY', 'Inventory / stock'],
    ['PRODUCTS', 'Products'], ['REPORTS', 'Reports'], ['PRINTING', 'Receipts / printing'],
    ['LOGIN', 'Login / account'], ['ETIMS', 'eTIMS / KRA'], ['OTHER', 'Other'],
  ];
  const PRIORITIES = [['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High - affecting sales'], ['URGENT', 'Urgent - shop cannot trade']];

  const statusBadge = (s) => `<span class="badge ${(STATUS[s] || {}).badge || 'badge-neutral'}">${esc((STATUS[s] || {}).label || s)}</span>`;
  const priorityBadge = (p) => `<span class="badge ${PRIORITY[p] || 'badge-neutral'}">${esc(String(p || '').toLowerCase())}</span>`;
  const categoryLabel = (c) => (CATEGORIES.find(([k]) => k === c) || [, c])[1];
  const options = (list, selected) => list.map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${esc(l)}</option>`).join('');

  const thumb = (url) => (String(url).includes('/upload/') ? url.replace('/upload/', '/upload/c_fill,w_240,h_240,q_auto/') : url);

  function attachmentsHtml(list) {
    if (!list || !list.length) return '';
    return `<div class="tk-thumbs">${list.map((a) =>
      `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(thumb(a.url))}" alt="${esc(a.originalName || 'screenshot')}" loading="lazy" /></a>`).join('')}</div>`;
  }

  function errorBlockHtml(t) {
    if (!t.errorMessage) return '';
    return `<div class="tk-error"><div class="tk-error-head"><span>Error message from the system</span><button type="button" class="btn-link" data-copy-error>Copy</button></div><pre>${esc(t.errorMessage)}</pre></div>`;
  }

  function threadHtml(t) {
    const msg = (cls, name, role, at, text, atts) => `
      <div class="tk-msg ${cls}">
        <div class="tk-msg-head"><b>${esc(name)}</b><span>${esc(role)} · ${window.UI.formatDateTime(at)}</span></div>
        <p>${esc(text)}</p>${attachmentsHtml(atts)}
      </div>`;
    return `<div class="tk-thread">
      ${msg('', t.raisedByName || 'User', String(t.raisedByRole || '').toLowerCase(), t.createdAt, t.description, t.attachments)}
      ${(t.replies || []).map((r) => msg(r.isStaff ? 'tk-msg-staff' : '', r.isStaff ? 'Support' : r.authorName, r.isStaff ? 'platform support' : String(r.authorRole || '').toLowerCase(), r.createdAt, r.message, r.attachments)).join('')}
    </div>`;
  }

  async function copyText(text, okMsg = 'Copied') {
    try { await navigator.clipboard.writeText(text); window.UI.toast.success(okMsg); }
    catch { window.UI.toast.error('Could not copy - select the text and copy manually'); }
  }

  function bindCopyError(root, t) {
    root.querySelector('[data-copy-error]')?.addEventListener('click', () => copyText(t.errorMessage, 'Error copied'));
  }

  /**
   * Screenshot picker. Supports file browse (camera on phones), drag & drop and
   * pasting a screenshot with Ctrl+V. Returns { getFiles, clear, destroy }.
   */
  let pickerSeq = 0;
  function createPicker(root, { max = 5, maxMB = 5 } = {}) {
    const inputId = `tk-file-${++pickerSeq}`;
    let files = [];
    root.innerHTML = `
      <label class="tk-drop" for="${inputId}">
        <strong>Add screenshots</strong>
        <span>Tap to choose, drag images here, or press Ctrl+V to paste</span>
        <small>Up to ${max} images, ${maxMB}MB each (JPG, PNG, WEBP)</small>
      </label>
      <input id="${inputId}" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden />
      <div class="tk-previews"></div>`;
    const input = root.querySelector('input');
    const drop = root.querySelector('.tk-drop');
    const prev = root.querySelector('.tk-previews');

    function render() {
      prev.querySelectorAll('img').forEach((i) => URL.revokeObjectURL(i.src));
      prev.innerHTML = files.map((f, i) => `<div class="tk-prev"><img src="${URL.createObjectURL(f)}" alt="" /><button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
      prev.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { files.splice(Number(b.dataset.rm), 1); render(); }));
    }
    function add(list) {
      const incoming = Array.from(list || []);
      for (const f of incoming) {
        if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { window.UI.toast.warning(`${f.name || 'File'} skipped - images only`); continue; }
        if (f.size > maxMB * 1024 * 1024) { window.UI.toast.warning(`${f.name || 'Image'} is over ${maxMB}MB`); continue; }
        if (files.length >= max) { window.UI.toast.warning(`Maximum ${max} screenshots`); break; }
        files.push(f);
      }
      render();
    }
    const onPaste = (e) => {
      const imgs = Array.from(e.clipboardData?.items || []).filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile());
      if (imgs.length) { e.preventDefault(); add(imgs); }
    };
    input.addEventListener('change', () => { add(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => add(e.dataTransfer.files));
    document.addEventListener('paste', onPaste);

    return {
      getFiles: () => files.slice(),
      clear: () => { files = []; render(); },
      destroy: () => document.removeEventListener('paste', onPaste),
    };
  }

  /** Builds a FormData from plain fields + screenshots (empty values skipped). */
  function buildForm(fields, files) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null && String(v).trim() !== '') fd.append(k, v); });
    files.forEach((f, i) => fd.append('screenshots', f, f.name || `screenshot-${i + 1}.png`));
    return fd;
  }

  window.TicketUI = {
    STATUS, CATEGORIES, PRIORITIES, statusBadge, priorityBadge, categoryLabel, options,
    attachmentsHtml, errorBlockHtml, threadHtml, copyText, bindCopyError, createPicker, buildForm,
  };
})(window);
