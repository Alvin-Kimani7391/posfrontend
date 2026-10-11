/**
 * password-toggle.js
 * Professional show/hide control for every password / PIN field.
 *
 *   PasswordToggle.init()          enhance the whole page now AND any field added later (modals, offline unlock box)
 *   PasswordToggle.enhance(root)   enhance password fields inside one element
 *
 * Behaviour
 *  - An eye button sits inside the right edge of the field (no layout shift, works in light and dark mode).
 *  - Real <button type="button">: keyboard (Tab, Enter, Space), screen-reader label ("Show password" / "Hide PIN"),
 *    aria-pressed state. Clicking it never steals focus from the field and keeps the cursor where it was.
 *  - Numeric PIN fields are labelled "PIN"; everything else "password".
 *  - The field goes back to hidden automatically when the form is submitted or reset, when the field is left for
 *    more than a moment (tab hidden / app switched), and after 30 s of being visible, so a PIN is never left on screen.
 *  - Idempotent: a field is never wrapped twice. Needs window.Icons (eye / eyeOff) but falls back to text if missing.
 */
(function (window) {
  'use strict';

  const AUTO_HIDE_MS = 30000;
  const timers = new WeakMap();

  function injectStyles() {
    if (document.getElementById('pw-toggle-css')) return;
    const s = document.createElement('style');
    s.id = 'pw-toggle-css';
    s.textContent = `
      .pw-wrap { position: relative; display: block; width: 100%; }
      .pw-wrap > input { width: 100%; padding-right: 46px !important; }
      .pw-toggle {
        position: absolute; top: 50%; right: 4px; transform: translateY(-50%);
        width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center;
        padding: 0; margin: 0; border: 0; border-radius: 8px; background: transparent;
        color: inherit; opacity: .6; cursor: pointer; -webkit-tap-highlight-color: transparent;
      }
      .pw-toggle:hover { opacity: 1; background: rgba(127,127,127,.14); }
      .pw-toggle:focus-visible { opacity: 1; outline: 2px solid currentColor; outline-offset: -2px; }
      .pw-toggle[aria-pressed="true"] { opacity: 1; }
      .pw-toggle svg { width: 20px; height: 20px; display: block; pointer-events: none; }
      .pw-toggle .pw-txt { font: 600 11px/1 system-ui, sans-serif; }
      @media (hover: none) { .pw-toggle { width: 44px; height: 44px; } .pw-wrap > input { padding-right: 52px !important; } }
    `;
    document.head.appendChild(s);
  }

  const icon = (name) => (window.Icons && window.Icons.get ? window.Icons.get(name) : '');

  function kindOf(input) {
    const mode = (input.getAttribute('inputmode') || '').toLowerCase();
    return mode === 'numeric' || mode === 'decimal' || input.pattern === '\\d{6,8}' ? 'PIN' : 'password';
  }

  function paint(btn, input, shown) {
    const kind = btn.dataset.kind;
    btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
    const label = `${shown ? 'Hide' : 'Show'} ${kind}`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    const svg = icon(shown ? 'eyeOff' : 'eye');
    btn.innerHTML = svg || `<span class="pw-txt">${shown ? 'HIDE' : 'SHOW'}</span>`;
  }

  function setShown(input, btn, shown) {
    input.type = shown ? 'text' : 'password';
    // Stop browsers from "helping" with autocapitalise/spellcheck when the value is visible.
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.spellcheck = false;
    paint(btn, input, shown);
    clearTimeout(timers.get(input));
    if (shown) timers.set(input, setTimeout(() => setShown(input, btn, false), AUTO_HIDE_MS));
  }

  function enhanceInput(input) {
    if (!input || input.dataset.pwEnhanced) return;
    if (input.type !== 'password') return;
    if (input.closest('.pw-wrap')) { input.dataset.pwEnhanced = '1'; return; }
    input.dataset.pwEnhanced = '1';

    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.dataset.kind = kindOf(input);
    btn.tabIndex = 0;
    paint(btn, input, false);
    wrap.appendChild(btn);

    // Keep focus and caret in the field while toggling.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); btn.click(); }, { passive: false });
    btn.addEventListener('click', () => {
      const shown = input.type === 'password';
      const start = input.selectionStart, end = input.selectionEnd;
      setShown(input, btn, shown);
      try { input.focus({ preventScroll: true }); if (start !== null) input.setSelectionRange(start, end); } catch { /* not focusable */ }
    });

    const hide = () => { if (input.type !== 'password') setShown(input, btn, false); };
    if (input.form) {
      input.form.addEventListener('submit', hide);
      input.form.addEventListener('reset', hide);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  }

  function enhance(root) {
    injectStyles();
    (root || document).querySelectorAll('input[type="password"]').forEach(enhanceInput);
  }

  let observer = null;
  function init() {
    enhance(document);
    if (observer || !window.MutationObserver) return;
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('input[type="password"]')) enhanceInput(n);
          else if (n.querySelectorAll) n.querySelectorAll('input[type="password"]').forEach(enhanceInput);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.PasswordToggle = { init, enhance };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);