/**
 * offline-sale.js
 *   Offline.sales.create(...)   validate against the cashier's grant, compute totals EXACTLY like the server, write to the outbox
 *   Offline.receipts.*          receipt rebuilt from the saved sale (same shape ReceiptView already renders)
 *   Offline.lookup.search/barcode   server when online, local catalog when not
 * Money here is integer cents; the sales screen works in decimal KES.
 */
(function (window) {
  'use strict';
  const Offline = (window.Offline = window.Offline || {});
  const uid = () => (window.crypto?.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`.padEnd(32, '0'));
  const fail = (m, code) => { const e = new Error(m); e.code = code || 'OFFLINE_BLOCKED'; throw e; };
  const cents = (n) => Math.round((Number(n) || 0) * 100);

  /** Same maths as sale-pricing.util.js on the server. */
  function lineCalc(unit, qty, disc, rate, inclusive) {
    const gross = Math.round(unit * qty);
    const net = gross - disc;
    let tax; let total;
    if (inclusive) { tax = net - Math.round(net / (1 + rate / 100)); total = net; }
    else { tax = Math.round(net * (rate / 100)); total = net + tax; }
    return { gross, tax, total };
  }
  const nameOf = (p, v) => { const a = v ? Object.values(v.attributes || {}).join(', ') : ''; return a ? `${p.name} (${a})` : p.name; };

  /* ------------------------------ sales ------------------------------ */
  const Sales = (Offline.sales = {
    /** { ok, reason } - can this till take an offline sale right now? */
    check() {
      if (!Offline.isReady()) return { ok: false, reason: 'Offline mode is still starting.' };
      if (!Offline.device.enrolled() || !Offline.context.policyOn()) return { ok: false, reason: 'Offline selling is not set up on this till. Ask a manager.' };
      if (Offline.auth.requiresUnlock()) return { ok: false, reason: 'Unlock the till first.' };
      const g = Offline.auth.activeGrant();
      if (!g) return { ok: false, reason: 'No offline permission is stored for this cashier. Sign in online once on this till.' };
      if (!Offline.grants.valid(g)) return { ok: false, reason: 'The offline window has ended. Connect to the internet to continue selling.' };
      return { ok: true, grant: g };
    },

    /**
     * cart: sales.js cart items { product, variant, quantity, discount, overridePriceEnabled }
     * payments: [{ method, amount (KES), amountTendered?, reference?, mpesa?: { code, payerPhone, payerName } }]
     * Returns { receiptNumber, receipt, clientTransactionId }.
     */
    async create({ cart, cartDiscount = 0, payments, clientTransactionId, notes }) {
      const chk = Sales.check();
      if (!chk.ok) fail(chk.reason);
      const g = chk.grant; const caps = g.caps || {}; const lim = g.limits || {};
      const ctx = Offline.context.get();
      const inclusive = !!ctx.business.taxInclusive;
      const maxPct = caps.maxDiscountPercent == null ? 0 : caps.maxDiscountPercent;

      const qtyMap = window.Wholesale ? window.Wholesale.qtyByProduct(cart) : new Map();
      const items = []; let subtotal = 0; let itemDisc = 0; let tax = 0; let linesTotal = 0; let afterItem = 0;
      for (const it of cart) {
        const p = it.product; const v = it.variant;
        if (it.overridePriceEnabled) fail('Price changes are not allowed offline. Remove the changed price on ' + p.name + '.');
        if (p.trackSerialNumber) fail(`${p.name} needs a serial number. Sell it when the till is online.`);
        // Retail, or the wholesale price once this sale holds >= MOQ of the product (same rule as the server).
        const priced = window.Wholesale ? window.Wholesale.resolve(p, v, qtyMap.get(String(p._id))) : { unit: v ? v.sellingPrice : p.sellingPrice, priceType: 'RETAIL' };
        const unit = cents(priced.unit);
        const qty = Number(it.quantity);
        const disc = cents(it.discount);
        const rate = p.taxRate || 0;
        const c = lineCalc(unit, qty, disc, rate, inclusive);
        if (disc > c.gross) fail(`Discount on ${p.name} is more than the line total.`);
        const preset = Math.min(Math.round(cents(p.defaultDiscount) * qty), c.gross);
        const manual = disc - preset;
        if (manual > 1 && maxPct < 100 && manual > Math.round((c.gross * maxPct) / 100)) fail(`Discount on ${p.name} is above the ${maxPct}% limit for offline sales.`);
        items.push({ productId: p._id, variantId: v ? v._id : undefined, name: nameOf(p, v), quantity: qty, unitPriceCents: unit, priceType: priced.priceType, discountCents: disc, taxRate: rate, taxAmountCents: c.tax, totalCents: c.total });
        subtotal += c.gross; itemDisc += disc; tax += c.tax; linesTotal += c.total; afterItem += c.gross - disc;
      }
      const cartDiscCents = cents(cartDiscount);
      if (cartDiscCents > 0 && maxPct < 100 && cartDiscCents > Math.round((afterItem * maxPct) / 100)) fail(`Cart discount is above the ${maxPct}% limit for offline sales.`);
      const total = linesTotal - cartDiscCents;
      if (total <= 0) fail('The sale total must be more than zero.');

      // limits
      const pc = Offline.outbox.cached();
      if (lim.maxPendingSales && (pc.sales || 0) >= lim.maxPendingSales) fail(`This till already holds ${pc.sales} unsynced sales (limit ${lim.maxPendingSales}). Connect to the internet to sync.`);
      if (lim.maxPendingValueCents && (pc.valueCents || 0) + total > lim.maxPendingValueCents) fail('The unsynced sales on this till are over the value limit. Connect to the internet to sync.');

      // payments
      const pays = [];
      for (const p of payments) {
        const amountCents = cents(p.amount);
        if (amountCents <= 0) continue;
        if ((p.method === 'CARD' || p.method === 'BANK') && !caps.allowCard) fail('Card and bank payments cannot be taken offline.');
        if (p.method === 'MPESA' && (!caps.allowManualMpesa || !ctx.mpesaTill)) fail('M-PESA Till payments are not enabled for offline selling.');
        if (p.method === 'CREDIT') fail('Credit sales are not available offline.');
        const row = { method: p.method, amountCents, reference: p.reference || undefined };
        if (p.method === 'CASH') {
          row.amountTenderedCents = p.amountTendered == null ? amountCents : cents(p.amountTendered);
          if (row.amountTenderedCents < amountCents) fail('The cash received is less than the amount due.');
        }
        if (p.method === 'MPESA') row.mpesa = { code: String(p.mpesa.code).toUpperCase(), payerPhone: p.mpesa.payerPhone, payerName: p.mpesa.payerName || undefined };
        pays.push(row);
      }
      const paid = pays.reduce((a, p) => a + p.amountCents, 0);
      if (paid !== total) fail('Offline sales must be paid in full (no credit or part payment).');

      // shift
      const shift = Offline.shifts.current();
      const needShift = !!ctx.business.requireShift || pays.some((p) => p.method === 'CASH');
      if (needShift && !shift) fail('Open a shift before taking cash.');

      const cid = clientTransactionId || uid();
      const soldAt = new Date(Offline.time.now()).toISOString();
      const body = {
        type: 'SALE', clientTransactionId: cid, soldAt, grant: g.grant,
        ...(shift ? (shift.offline ? { clientShiftId: shift.clientShiftId } : { shiftId: shift.shiftId }) : {}),
        items, payments: pays, cartDiscountCents: cartDiscCents,
        subtotalCents: subtotal, itemDiscountCents: itemDisc, taxCents: tax, totalCents: total,
        catalogVersion: await Offline.catalog.version(), notes: notes || undefined,
        _view: { cashierName: g.name, branchName: (ctx.branch || {}).name }, // kept for reprints (the server ignores it)
      };
      const claims = g.claims || {};
      const saved = await Offline.outbox.enqueue('SALE', body, {
        ref: cid, soldAt, totalCents: total,
        prefix: claims.receiptPrefix || 'RCT', branchCode: claims.branchCode || 'MAIN', deviceCode: claims.deviceCode || (ctx.device || {}).deviceCode,
      });
      Offline.sync.kick();
      return { receiptNumber: saved.receiptNumber, clientTransactionId: cid, receipt: Offline.receipts.build(body, saved.receiptNumber, 'pending') };
    },
  });

  /* ------------------------------ receipts ------------------------------ */
  Offline.receipts = {
    build(body, receiptNumber, status, invoiceNumber) {
      const ctx = Offline.context.get() || { business: {}, branch: {} };
      const b = ctx.business || {}; const rs = b.receiptSettings || {};
      const view = body._view || {};
      const payments = body.payments.map((p) => ({
        method: p.method, amount: p.amountCents / 100, reference: p.reference || (p.mpesa && p.mpesa.code),
        externalTransactionId: p.mpesa ? p.mpesa.code : undefined,
        amountTendered: p.amountTenderedCents != null ? p.amountTenderedCents / 100 : undefined,
      }));
      const tendered = body.payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + (p.amountTenderedCents || 0), 0);
      const cashDue = body.payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amountCents, 0);
      return {
        receiptNumber, invoiceNumber: invoiceNumber || null, createdAt: body.soldAt, saleId: null, offline: true, status,
        receiptData: {
          business: {
            name: b.name, address: b.address, phone: b.phone, kraPin: b.kraPin, headerMessage: rs.headerMessage, footerMessage: rs.footerMessage,
            logo: rs.showLogo === false ? undefined : b.logo, showKraPin: rs.showKraPin, showCashierName: rs.showCashierName,
            showMpesaReceiptCode: rs.showMpesaReceiptCode, customLines: rs.customLines || [], paperWidth: rs.paperWidth || '80mm',
          },
          branch: { name: view.branchName || (ctx.branch || {}).name }, cashier: { name: view.cashierName }, customer: null,
          items: body.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPriceCents / 100, priceType: i.priceType, discount: i.discountCents / 100, taxRate: i.taxRate, taxAmount: i.taxAmountCents / 100, total: i.totalCents / 100 })),
          subtotal: body.subtotalCents / 100, itemDiscount: body.itemDiscountCents / 100, cartDiscount: body.cartDiscountCents / 100,
          tax: body.taxCents / 100, total: body.totalCents / 100, payments,
          amountTendered: tendered / 100, changeGiven: Math.max(0, tendered - cashDue) / 100, balance: 0,
        },
      };
    },
    async get(receiptNumber) {
      const r = await Offline.outbox.receipt(receiptNumber);
      return r ? Offline.receipts.build(r.body, receiptNumber, r.rec.status, r.rec.invoiceNumber) : null;
    },
    recent: () => Offline.outbox.recentReceipts(),
  };

  /* ------------------------------ product lookup ------------------------------ */
  const goLocal = (err) => !window.Connectivity.isOnline() || (err && err.code === 'NETWORK_ERROR');
  Offline.lookup = {
    async search(term) {
      if (window.Connectivity.isOnline()) {
        try { const { data } = await window.Api.get('/products', { search: term, limit: 15, status: 'active', channel: 'retail', branchId: (window.AppShell && window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId()) || undefined }); return data.items || []; }
        catch (e) { if (!goLocal(e) || !Offline.catalog.isReady()) throw e; }
      }
      if (!Offline.catalog.isReady()) fail('No product list is saved on this till yet. Connect to the internet once and let it download.');
      return Offline.catalog.search(term, 15);
    },
    async barcode(code) {
      if (window.Connectivity.isOnline()) {
        try { const { data } = await window.Api.get(`/products/barcode/${encodeURIComponent(String(code).trim())}`); return data; }
        catch (e) { if (!goLocal(e) || !Offline.catalog.isReady()) throw e; }
      }
      if (!Offline.catalog.isReady()) fail('No product list is saved on this till yet.');
      const hit = await Offline.catalog.byBarcode(code);
      if (!hit) fail(`No product found for barcode "${code}"`, 'BARCODE_NOT_FOUND');
      return hit;
    },
  };
})(window);
