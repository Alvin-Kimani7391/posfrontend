/**
 * sales-addproduct.js  -  upgrades the small "Add product" window on the Sales screen.   Loaded after sales.js.
 *
 *   1. Barcode field  : a scan button opens the camera and fills the field with whatever it reads -
 *                       normal product barcodes (EAN / UPC / Code 128 ...) AND QR codes.
 *   2. Product name   : a copy button copies the name into the SKU field in one tap
 *                       (also puts it on the clipboard). After that the SKU is no longer
 *                       auto-generated from the name, so it keeps what was copied.
 *
 * Works for both versions of the window (the built-in "Add product" and PosBoost's "Quick add product").
 * It only adds buttons next to the existing fields; saving and validation are untouched.
 * Desktop and phone.
 */
(function () {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'sales') return;

  const STYLE = `
    .qa-wrap{position:relative;display:flex;align-items:center;min-width:0}
    .qa-wrap>.input{flex:1 1 auto;min-width:0;padding-right:52px}
    .qa-ibtn{position:absolute;right:5px;top:50%;transform:translateY(-50%);width:38px;height:38px;padding:0;border:1px solid #dde1e9;border-radius:10px;background:#f6f7fa;color:var(--color-text-secondary,#333a50);display:inline-flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
    .qa-ibtn:hover{background:var(--color-primary-50,#fff4ec);color:var(--color-primary,#ff6600);border-color:var(--color-primary,#ff6600)}
    .qa-ibtn:active{transform:translateY(-50%) scale(.94)}
    .qa-ibtn.ok{background:var(--color-success-bg,#e7f8ef);color:var(--color-success,#12b76a);border-color:var(--color-success,#12b76a)}
    .qa-ibtn.scan{background:var(--color-primary,#ff6600);border-color:var(--color-primary,#ff6600);color:#fff}
    .qa-ibtn.scan:hover{filter:brightness(1.06);color:#fff}
  `;
  if (!document.getElementById('qa-plus-style')) {
    const st = document.createElement('style');
    st.id = 'qa-plus-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  const toast = (type, msg) => { try { window.UI.toast[type](msg); } catch { /* ignore */ } };

  function addButton(input, { icon, title, cls, onClick }) {
    const wrap = document.createElement('span');
    wrap.className = 'qa-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);                                   // same node: ids, labels and listeners keep working
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `qa-ibtn ${cls || ''}`;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    wrap.appendChild(b);
    return b;
  }

  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }

  function flashOk(btn, iconOk, iconBack) {
    const i = btn.querySelector('i');
    btn.classList.add('ok');
    if (i) i.className = iconOk;
    setTimeout(() => { btn.classList.remove('ok'); if (i) i.className = iconBack; }, 1300);
  }

  function enhance(form) {
    if (!form || form.dataset.qaPlus) return;
    form.dataset.qaPlus = '1';
    const nameEl = form.querySelector('[name="name"]');
    const skuEl = form.querySelector('[name="sku"]');
    const bcEl = form.querySelector('[name="barcode"]');

    if (nameEl) {
      addButton(nameEl, {
        icon: 'fa-regular fa-copy',
        title: skuEl ? 'Copy product name to SKU' : 'Copy product name',
        onClick: (btn) => {
          const v = nameEl.value.trim();
          if (!v) { toast('error', 'Type the product name first'); nameEl.focus(); return; }
          if (skuEl) { skuEl.value = v; fire(skuEl); }   // the "input" event also stops auto-generating the SKU
          try { navigator.clipboard && navigator.clipboard.writeText(v).catch(() => {}); } catch { /* clipboard is optional */ }
          flashOk(btn, 'fa-solid fa-check', 'fa-regular fa-copy');
          toast('success', skuEl ? 'Name copied to SKU' : 'Name copied');
        },
      });
    }

    if (bcEl && window.BarcodeScanner) {
      addButton(bcEl, {
        icon: 'fa-solid fa-qrcode',
        title: 'Scan barcode or QR code with the camera',
        cls: 'scan',
        onClick: (btn) => {
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // hide the keyboard
          window.BarcodeScanner.openCameraModal({
            title: 'Scan product barcode or QR code',
            hint: 'Point the camera at the product barcode or QR code',
            onDetect: (code) => {
              const v = String(code || '').trim();
              if (!v) return;
              bcEl.value = v;
              fire(bcEl);
              flashOk(btn, 'fa-solid fa-check', 'fa-solid fa-qrcode');
              toast('success', `Scanned: ${v.length > 40 ? `${v.slice(0, 40)}…` : v}`);
              const next = form.querySelector('[name="sellingPrice"]');
              if (next && !next.value) setTimeout(() => next.focus(), 50);
            },
          });
        },
      });
    }
  }

  function scan() {
    document.querySelectorAll('#qa-form, #pb-qa-form').forEach(enhance);
  }
  new MutationObserver(scan).observe(document.body, { childList: true });   // modals are appended straight to <body>
  scan();
})();