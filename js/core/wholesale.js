/**
 * wholesale.js - the till's copy of the server rule (backend src/utils/wholesale.js). PREVIEW ONLY online:
 * the server recomputes the price on "Complete sale". Offline, this is what the till charges, and the server
 * re-checks it on sync.
 *
 * RULE: a line is WHOLESALE when the business has the wholesalePricing feature, the product is wholesaleEnabled with
 * moq > 0, and the TOTAL quantity of that product in the cart (all variants / repeated lines) is >= moq. The wholesale
 * price is the variant's own wholesalePrice, else the product's, and only counts when it is LOWER than retail.
 * Money here is decimal KES (as the API returns it).
 */
(function (window) {
  'use strict';
  const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

  function featureOn() {
    try {
      const shell = window.AppShell;
      if (shell && shell.hasFeature && shell.hasFeature('wholesalePricing')) return true;
      const ctx = window.Offline && window.Offline.context && window.Offline.context.get && window.Offline.context.get();
      return !!(ctx && ctx.business && ctx.business.wholesalePricing);
    } catch { return false; }
  }

  function qtyByProduct(cart) {
    const m = new Map();
    (cart || []).forEach((i) => {
      const k = String(i.product._id);
      m.set(k, (m.get(k) || 0) + (Number(i.quantity) || 0));
    });
    return m;
  }

  /** Wholesale unit price for this product/variant, or null when none is usable. */
  function priceOf(product, variant) {
    const retail = variant ? variant.sellingPrice : product.sellingPrice;
    const wp = variant && pos(Number(variant.wholesalePrice)) ? Number(variant.wholesalePrice)
      : pos(Number(product.wholesalePrice)) ? Number(product.wholesalePrice) : null;
    return wp !== null && wp < retail ? wp : null;
  }

  /** @returns {{unit:number, priceType:'RETAIL'|'WHOLESALE', retail:number, wholesale:number|null, moq:number|null}} */
  function resolve(product, variant, productQty) {
    const retail = variant ? variant.sellingPrice : product.sellingPrice;
    const out = { unit: retail, priceType: 'RETAIL', retail, wholesale: null, moq: null };
    if (!featureOn() || !product.wholesaleEnabled || !pos(Number(product.moq))) return out;
    const wp = priceOf(product, variant);
    if (wp === null) return out;
    out.wholesale = wp;
    out.moq = Number(product.moq);
    if ((Number(productQty) || 0) >= out.moq) { out.unit = wp; out.priceType = 'WHOLESALE'; }
    return out;
  }

  /** Price info for a cart item (ignores any override; the caller applies that). */
  function forItem(cart, item) {
    return resolve(item.product, item.variant, qtyByProduct(cart).get(String(item.product._id)));
  }

  window.Wholesale = { featureOn, qtyByProduct, priceOf, resolve, forItem };
})(window);
