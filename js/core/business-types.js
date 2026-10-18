/**
 * business-types.js
 * Frontend catalogue of the business types and feature flags the BACKEND supports
 * (src/constants/businessFeatures.js). Labels, descriptions and icons live here; the defaults
 * below mirror the backend and are refreshed from GET /business/types when available
 * (BusinessTypes.syncWithBackend()), so a backend change never leaves the UI out of step.
 *
 * Any type the backend adds that is not listed here still works: it is shown as "Other".
 *
 * Features marked `ready: true` have real screens/APIs behind them today. The others are stored
 * on the business (so they switch on automatically when those modules ship) but are labelled
 * "coming soon" in the customise screen.
 */
(function (window) {
  const TYPES = {
    supermarket:  { label: 'Supermarket',        icon: 'sales',     blurb: 'Fast checkout, barcodes, expiry dates and batches.' },
    electronics:  { label: 'Electronics',        icon: 'hash',      blurb: 'Serial numbers / IMEI, warranty and repairs.' },
    clothing:     { label: 'Clothing & fashion', icon: 'tag',       blurb: 'Sizes and colours as product variants.' },
    hardware:     { label: 'Hardware',           icon: 'wrench',    blurb: 'Units like bags and metres, quotations, deliveries.' },
    cosmetics:    { label: 'Cosmetics & beauty', icon: 'layers',    blurb: 'Shades, batches with expiry, recalls.' },
    restaurant:   { label: 'Restaurant, café & rooms', icon: 'utensils', blurb: 'Tables, kitchen screen, recipes, reservations and optional rooms & stays.' },
    general_shop: { label: 'General shop',       icon: 'bag',       blurb: 'Simple selling and stock. The standard setup.' },
    wholesale:    { label: 'Wholesale',          icon: 'truck',     blurb: 'Wholesale prices, credit, multiple warehouses.' },
    garage:       { label: 'Garage / workshop',  icon: 'car',       blurb: 'Vehicles, job cards and quotations.' },
    pharmacy:     { label: 'Pharmacy',           icon: 'shield',    blurb: 'Batches, expiry, recalls and quarantine are always on.' },
    other:        { label: 'Other business',     icon: 'store',     blurb: 'Start with the standard setup and add what you need.' },
  };

  // Feature catalogue. group = how it is listed in the customise screen.
  const FEATURES = {
    expiryTracking:        { label: 'Expiry dates',             group: 'Stock',      ready: true,  desc: 'Record expiry dates on stock and see what is about to expire.' },
    batchTracking:         { label: 'Batch tracking',           group: 'Stock',      ready: true,  desc: 'Receive stock in batches; quarantine, release or dispose a batch.' },
    productVariants:       { label: 'Product variants',         group: 'Stock',      ready: true,  desc: 'Sell one product in sizes, colours or shades.' },
    unitConversions:       { label: 'Unit conversions',         group: 'Stock',      ready: false, desc: 'Buy in cartons, sell in pieces (and similar).' },
    multiWarehouse:        { label: 'Warehouse & retail stock', group: 'Stock',      ready: true,  desc: 'Keep a wholesale warehouse and the shop floor as separate stock. Receive into either, and move stock between them.' },
    serialNumberTracking:  { label: 'Serial numbers / IMEI',    group: 'After-sales', ready: true, desc: 'Track each unit by serial number or IMEI.' },
    warrantyManagement:    { label: 'Warranty claims',          group: 'After-sales', ready: true, desc: 'Open and decide warranty claims. Needs serial numbers.', requires: ['serialNumberTracking'] },
    repairManagement:      { label: 'Repairs',                  group: 'After-sales', ready: true, desc: 'Take in items for repair and follow the job to collection.' },
    vehicleManagement:     { label: 'Vehicle register',         group: 'Garage',     ready: true,  desc: 'Keep a register of customer vehicles and service history.' },
    jobCards:              { label: 'Job cards',                group: 'Garage',     ready: true,  desc: 'Run workshop jobs: labour, parts, approval and payment. Needs the vehicle register.', requires: ['vehicleManagement'] },
    quotationManagement:   { label: 'Quotations',               group: 'Selling',    ready: false, desc: 'Send quotations and turn them into sales.' },
    deliveryManagement:    { label: 'Deliveries',               group: 'Selling',    ready: false, desc: 'Plan and track deliveries.' },
    wholesalePricing:      { label: 'Wholesale pricing',        group: 'Selling',    ready: true,  desc: 'Set a minimum order quantity and a wholesale price per product. The till switches to it automatically.' },
    customerCredit:        { label: 'Customer credit',          group: 'Selling',    ready: true,  desc: 'Let trusted customers buy on credit.' },
    loyaltyProgram:        { label: 'Loyalty programme',        group: 'Selling',    ready: false, desc: 'Reward repeat customers with points.' },
    restaurantOrdering:    { label: 'Restaurant ordering',      group: 'Restaurant', ready: true,  desc: 'The restaurant module: take orders, send them to the kitchen, bill and pay. Switch this off and no restaurant screen works.' },
    tableManagement:       { label: 'Tables',                   group: 'Restaurant', ready: true,  desc: 'Open orders against tables and see the floor at a glance.', requires: ['restaurantOrdering'] },
    kitchenDisplay:        { label: 'Kitchen screen',           group: 'Restaurant', ready: true,  desc: 'Send orders to a kitchen / bar screen with tickets and timers.', requires: ['restaurantOrdering'] },
    recipeManagement:      { label: 'Recipes & ingredients',    group: 'Restaurant', ready: true,  desc: 'Deduct ingredients when a dish is sold; track food cost and waste.', requires: ['restaurantOrdering'] },
    reservations:          { label: 'Reservations',             group: 'Restaurant', ready: true,  desc: 'Book tables ahead, take deposits and manage the waiting list.', requires: ['restaurantOrdering'] },
    guestQrOrdering:       { label: 'Guest QR ordering',        group: 'Restaurant', ready: true,  desc: 'QR codes on tables and rooms: guests see the menu, order and call a waiter.' },
    accommodation:         { label: 'Rooms & stays',            group: 'Accommodation', ready: true, desc: 'Rooms, bookings, check-in / check-out, guest folios and housekeeping.' },
    pharmacyDispensing:    { label: 'Dispensing',               group: 'Pharmacy',   ready: true,  desc: 'Medicine records, patients, prescriptions, the dispensing register, labels and the pharmacy desk. Switching this on opens the whole pharmacy module.' },
    prescriptionManagement:{ label: 'Prescriptions',            group: 'Pharmacy',   ready: true,  desc: 'Record prescriptions, have a pharmacist review them, and dispense against them at the till.' },
    restrictedProductControl:{ label: 'Restricted products',    group: 'Pharmacy',   ready: true,  desc: 'Control who may sell prescription-only and controlled medicines (credentials, countersign, Poisons Book).' },
    recallManagement:      { label: 'Recalls',                  group: 'Quality',    ready: true,  desc: 'Recall a batch and find where it went.' },
    quarantineManagement:  { label: 'Quarantine',               group: 'Quality',    ready: true,  desc: 'Hold suspect stock so it cannot be sold.' },
  };

  const GROUP_ORDER = ['Stock', 'After-sales', 'Garage', 'Selling', 'Restaurant', 'Accommodation', 'Pharmacy', 'Quality'];

  // Mirrors backend BUSINESS_FEATURE_DEFAULTS / LOCKED_ON.
  const DEFAULTS = {
    supermarket: ['expiryTracking', 'batchTracking', 'unitConversions', 'loyaltyProgram'],
    electronics: ['serialNumberTracking', 'warrantyManagement', 'repairManagement'],
    clothing: ['productVariants', 'loyaltyProgram'],
    hardware: ['unitConversions', 'quotationManagement', 'deliveryManagement'],
    cosmetics: ['expiryTracking', 'batchTracking', 'productVariants', 'loyaltyProgram', 'quarantineManagement', 'recallManagement'],
    restaurant: ['restaurantOrdering', 'tableManagement', 'kitchenDisplay', 'recipeManagement', 'reservations', 'guestQrOrdering', 'batchTracking'],
    general_shop: [],
    wholesale: ['wholesalePricing', 'unitConversions', 'quotationManagement', 'deliveryManagement', 'multiWarehouse', 'customerCredit'],
    garage: ['vehicleManagement', 'jobCards', 'quotationManagement'],
    pharmacy: ['expiryTracking', 'batchTracking', 'pharmacyDispensing', 'prescriptionManagement', 'restrictedProductControl', 'recallManagement', 'quarantineManagement'],
    other: [],
  };
  const LOCKED = { pharmacy: ['expiryTracking', 'batchTracking', 'quarantineManagement', 'recallManagement'] };

  const featureKeys = () => Object.keys(FEATURES);
  const typeKeys = () => Object.keys(TYPES);

  function defaultsFor(type) {
    const on = new Set(DEFAULTS[type] || []);
    return Object.fromEntries(featureKeys().map((k) => [k, on.has(k)]));
  }
  const lockedFor = (type) => LOCKED[type] || [];
  const typeInfo = (type) => TYPES[type] || TYPES.other;

  /** Switching a feature on also switches on what it needs; switching one off also switches off what depends on it. */
  function applyToggle(flags, key, on, type) {
    const out = { ...flags };
    if (lockedFor(type).includes(key) && !on) return out;
    out[key] = on;
    if (on) (FEATURES[key]?.requires || []).forEach((r) => { out[r] = true; });
    else featureKeys().forEach((k) => { if ((FEATURES[k].requires || []).includes(key) && !lockedFor(type).includes(k)) out[k] = false; });
    return out;
  }

  /** Pull the live defaults from the backend (no-op on failure; the built-in copy keeps working). */
  async function syncWithBackend() {
    try {
      const { data } = await window.Api.get('/business/types');
      (data.types || []).forEach((t) => {
        DEFAULTS[t.key] = Object.entries(t.defaults || {}).filter(([, v]) => v).map(([k]) => k);
        if (t.lockedOn && t.lockedOn.length) LOCKED[t.key] = t.lockedOn; else delete LOCKED[t.key];
        if (!TYPES[t.key]) TYPES[t.key] = { label: t.key.replace(/_/g, ' '), icon: 'store', blurb: '' };
      });
      (data.featureKeys || []).forEach((k) => {
        if (!FEATURES[k]) FEATURES[k] = { label: k, group: 'Other', ready: false, desc: '' };
      });
    } catch { /* keep built-in */ }
  }

  window.BusinessTypes = {
    TYPES, FEATURES, GROUP_ORDER,
    typeKeys, featureKeys, defaultsFor, lockedFor, typeInfo, applyToggle, syncWithBackend,
  };
})(window);
