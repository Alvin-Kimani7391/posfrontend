/**
 * crm-compat.js - safety net for crm.js.
 * Defines a UI helper ONLY if ui.js does not already have it, so it can never override your versions.
 */
(function (window) {
  const UI = window.UI;
  if (!UI) return;

  const toDate = (d) => (d instanceof Date ? d : new Date(d));

  if (!UI.debounce) {
    UI.debounce = (fn, ms = 250) => {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    };
  }

  if (!UI.initials) {
    UI.initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
  }

  if (!UI.formatDate) {
    UI.formatDate = (d) => (d ? toDate(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  }

  if (!UI.formatDateTime) {
    UI.formatDateTime = (d) => (d ? toDate(d).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  }

  if (!UI.timeAgo) {
    UI.timeAgo = (d) => {
      if (!d) return '—';
      const secs = Math.round((Date.now() - toDate(d).getTime()) / 1000);
      if (secs < 60) return 'just now';
      const mins = Math.round(secs / 60);
      if (mins < 60) return `${mins} min ago`;
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
      const days = Math.round(hrs / 24);
      if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
      const months = Math.round(days / 30);
      if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
      const years = Math.round(days / 365);
      return `${years} year${years === 1 ? '' : 's'} ago`;
    };
  }

  if (!UI.serializeForm) {
    UI.serializeForm = (form) => {
      const out = {};
      new FormData(form).forEach((v, k) => { out[k] = v; });
      return out;
    };
  }

  if (!UI.applyFormErrors) {
    UI.applyFormErrors = (form, errors) => {
      const msg = (errors || []).map((e) => e.message || e).filter(Boolean).join(' · ') || 'Please check the form';
      if (UI.toast && UI.toast.error) UI.toast.error(msg);
    };
  }
})(window);