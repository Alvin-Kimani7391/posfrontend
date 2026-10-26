/**
 * hx-offline-tour.js - the guided tour that teaches a restaurant / hotel team how to set up and use offline mode.
 * Opens from the top-bar "Set up offline" button (or window.HXOfflineGuide.open()). Plain language, one idea per screen, with
 * live checks and "do it now" buttons for every setup step, then how each job (orders, kitchen, bills, stock, rooms, TV) works
 * with no internet, a practice drill, and a cheat-sheet for the person's own role. Remembers where you stopped.
 */
(function (window) {
  'use strict';
  const H = () => window.HXOffline; if (!H()) return;
  const E = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Real (line) icons instead of emojis. ic(name, size, colour)
  const PATHS = {
    hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M8 13l-1.6-2.3a1.4 1.4 0 0 0-2.3 1.6L7 17a6 6 0 0 0 5 3h1a6 6 0 0 0 6-6v-1"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    device: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    utensils: '<path d="M6 3v7a2 2 0 0 0 2 2v9M10 3v7a2 2 0 0 1-2 2M6 3v6M17 21V3c-2 1-3.5 3.5-3.5 7 0 2 1 3 3.5 3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
    chef: '<path d="M7 14a4 4 0 0 1 0-8 5 5 0 0 1 10 0 4 4 0 0 1 0 8v6H7z"/><path d="M7 17h10"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21a2 2 0 0 0 4 0"/>',
    printer: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    devices: '<rect x="2" y="5" width="13" height="10" rx="1.5"/><rect x="16" y="8" width="6" height="11" rx="1.5"/><path d="M6 19h5"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/>',
    flask: '<path d="M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4A1.5 1.5 0 0 0 19 19l-5-10V3M7.5 15h9"/>',
    clip: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
    done: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    off: '<path d="M2 8.8a15 15 0 0 1 4-2.6M22 8.8a15 15 0 0 0-10-3.3M5.5 12.5a10 10 0 0 1 3-1.8M18.5 12.5a10 10 0 0 0-3.7-2M9 16.2a5 5 0 0 1 6 0M12 20h.01M3 3l18 18"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    dot: '<circle cx="12" cy="12" r="5"/>',
  };
  const ic = (n, size = 20, col = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex:none;vertical-align:-4px">${PATHS[n] || PATHS.dot}</svg>`;
  const feat = () => (H().state()?.snap?.features) || {};
  const role = () => { try { return String(window.Storage?.getUser?.()?.role || '').toUpperCase(); } catch (e) { return ''; } };
  const li = (a) => `<ul>${a.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const dot = (c, t) => `<div class="row"><span class="dt" style="background:${c}"></span><span>${t}</span></div>`;
  const flow = (a) => `<div class="flow">${a.map((x, i) => `${i ? '<span class="ar">→</span>' : ''}<div class="fb"><div class="fi">${ic(x[0], 32, '#1d4ed8')}</div><b>${x[1]}</b><small>${x[2]}</small></div>`).join('')}</div>`;
  const mock = (title, rows) => `<div class="mock"><div class="mt">${E(title)}</div>${rows.map((r) => `<div class="mr">${r}</div>`).join('')}</div>`;

  // A step: { id, title, icon, show?(), body(ctx) -> html, check?(ctx) -> {ok, text}, action?: [label, fn(btn)], spot?: selector }
  const STEPS = [
    { id: 'welcome', icon: 'hand', title: 'Welcome: keep serving when the internet is down', spot: '#hxo-top-btn', body: () => `
      <p>Internet cuts happen. With offline mode switched on, your team <b>keeps taking orders, cooking, serving, billing and receiving stock</b> even with no connection. When the internet returns, everything is sent to the server automatically, in the right order, with nothing lost or counted twice.</p>
      <p>This tour takes about <b>5 minutes</b>. The first part prepares <b>this device</b>. The rest shows how each job works offline, so nobody panics when the Wi-Fi drops.</p>
      <h4>The coloured dot at the top of every screen</h4>
      ${dot('#1d4ed8', '<b>Blue</b>: this device still needs to be set up (this tour).')}${dot('#0d7a4f', '<b>Green</b>: ready. It will keep working offline.')}${dot('#ea580c', '<b>Orange</b>: no internet right now, or work is waiting to be sent.')}${dot('#b91c1c', '<b>Red</b>: something could not be applied and a manager should look.')}` },
    { id: 'how', icon: 'bulb', title: 'How it works, in 30 seconds', body: () => `
      ${flow([['device', 'Prepare once', 'While online, the device saves your menu, prices, tables, stock and staff.'], ['off', 'Keep working', 'No internet? Every tap is saved on the device and the screens keep updating.'], ['cloud', 'Auto-sync', 'Internet back? Saved work is sent to the server in order. Nothing is duplicated.']])}
      <p>Think of it like writing in a notebook: while offline the device writes everything down, and when the internet is back it copies the notebook to the office.</p>
      <p class="note"><b>Good to know:</b> the numbers you see offline (totals, stock left) are calculated on the device. The server re-checks everything when it syncs, so tiny differences can appear. Official receipt numbers are issued at sync time.</p>` },
    { id: 'sw', icon: 'device', title: 'Step 1: Let this device open the app with no internet', check: async () => { const c = (await H().checks()).find((x) => x.id === 'sw'); return c; }, action: ['Reload this page', () => location.reload()], body: () => `
      <p>The app must be saved inside the browser so it can start even when the internet is off.</p>
      ${li(['Use <b>Chrome</b> (Android/PC), <b>Edge</b> or <b>Safari</b>. Do not use a private / incognito window.', 'Best of all: <b>install the app</b>: in Chrome tap the ⋮ menu → <i>Install app</i> / <i>Add to Home screen</i>. This also stops the browser from clearing saved data.', 'If the check below is not green, press <b>Reload</b> once while online.'])}` },
    { id: 'pages', icon: 'folder', title: 'Step 2: Save all the restaurant screens', check: async () => (await H().checks()).find((x) => x.id === 'pages'), action: ['Download screens', async (b) => { await H().downloadPages((n, t) => { b.textContent = `Downloading ${n}/${t}…`; }); }], body: () => `
      <p>Floor, Cashier, Kitchen, Bills, Menu, Stock, Reservations, Front desk, Rooms and more. Each one must be saved so you can open it offline.</p>
      <p>Press the button and wait until it says all screens are saved (about 10–20 seconds on normal Wi-Fi).</p>` },
    { id: 'data', icon: 'utensils', title: 'Step 3: Save your menu, prices, tables, stock and staff', check: async () => (await H().checks()).find((x) => x.id === 'data'), action: ['Download my restaurant data', async (b) => { b.textContent = 'Downloading…'; await H().refresh(); }], body: () => `
      <p>This is the information your team needs to work: the <b>menu with prices</b> (including happy-hour and order-type prices), modifiers, <b>tables</b>, kitchen stations, <b>ingredients and stock</b>, suppliers, staff, open orders and bills${feat().accommodation ? ', and the guests currently in the rooms' : ''}.</p>
      ${li(['It refreshes by itself every few minutes while you are online.', '<b>Changed the menu or a price?</b> Press the button again so this device has the latest.', 'Do this on <b>every</b> device that will take orders or run the kitchen.'])}` },
    { id: 'store', icon: 'lock', title: 'Step 4: Protect the saved data', check: async () => (await H().checks()).find((x) => x.id === 'store'), action: ['Protect storage', async () => { try { const g = await navigator.storage.persist(); H().toast(g ? 'success' : 'warning', g ? 'Storage protected' : 'The browser said no. Installing the app to the home screen usually fixes this.'); } catch (e) { /* unsupported */ } }], body: () => `
      <p>Phones and tablets sometimes clear a website's saved data when they run low on space. This step asks the browser to <b>keep</b> it.</p>
      <p class="note">If it says no, install the app to the home screen (Step 1 tip) and try again. This is the most common reason offline data disappears.</p>` },
    { id: 'pin', icon: 'key', title: 'Step 5: Offline sign-in PIN', check: async () => (await H().checks()).find((x) => x.id === 'pin'), action: ['Open offline setup', () => { document.getElementById('hxo-tour')?.remove(); document.getElementById('ofl-top-btn')?.click(); }], body: () => `
      <p>If the internet is down when someone <b>logs in or their session runs out</b>, they need another way in. The <b>offline PIN</b> is that way.</p>
      ${li(['Tap <b>Open offline setup</b>, choose <i>Set up this till</i>, then create your PIN.', 'Each staff member who works on this device should sign in once while online, then set their PIN.', 'Anyone already signed in simply keeps working. The PIN is only needed after a log-out or a long break.'])}
      <p class="note">A lost or stolen device can be blocked by the manager from the <b>Devices</b> screen.</p>` },
    { id: 'shift', icon: 'cash', title: 'Step 6: Open the cash shift before you need it', show: () => true, body: () => `
      <p>Cash payments need an open cash shift. <b>Open the shift at the start of the day while online</b> (Cashier → Open shift). If the internet is already down, you can still open it offline: it is saved and sent later.</p>
      <p class="note">If the shift is not open, cash payments are refused and flagged for a manager after sync, so open it first.</p>` },
    { id: 'orders', icon: 'receipt', title: 'Taking orders offline', body: () => `
      <p>Works exactly like normal. Go to <b>Floor</b> (POS), tap a table, add items, press <b>Send</b>.</p>
      ${mock('Table 5 (saved on this device)', ['2 × Chicken Burger <span>KES 1,400</span>', '1 × Fresh Juice <span>KES 250</span>', '<b>Status: sent to kitchen · offline</b>'])}
      ${li(['The table turns occupied, the order number looks like <b>OFF-001</b>, and the kitchen ticket is created.', 'Items that were sold out or not in the saved menu are refused with a clear message.', '<b>Prices</b> come from the last saved menu (happy hour and order-type prices included).', 'Two waiters cannot open the same table on the <i>same</i> device. On <i>different</i> devices a clash is flagged for review after sync.'])}` },
    { id: 'kitchen', icon: 'chef', title: 'Kitchen screen offline', show: () => feat().kitchen !== false, body: () => `
      <p>Tickets appear on the kitchen screen <b>of the same device</b> the order was sent from. Cooks can still <b>Accept → Preparing → Ready</b>, and waiters can mark items <b>Served</b>.</p>
      ${li(['Bumping a ticket updates the order, the table and the waiter\'s view immediately.', '<b>Important:</b> a kitchen tablet only sees orders taken on <i>itself</i> while offline. Other phones\' orders appear after they reconnect. See "Several devices" below for the safe setup.', 'Stock is deducted from ingredients when the work syncs.'])}` },
    { id: 'bills', icon: 'card', title: 'Bills and payments offline', body: () => `
      <p>Press <b>Bill</b> on an order, then <b>Pay</b>. Split payments work.</p>
      <div class="two"><div><h4>${ic('check', 18, '#0d7a4f')} Works offline</h4>${li(['Cash (with change)', 'Card (machine used separately, type the slip number)', 'Bank / other', 'M-PESA with the <b>customer\'s M-PESA code</b>', 'Tips', feat().accommodation ? 'Charge to a checked-in guest\'s room' : 'Discounts you are allowed to give'])}</div><div><h4>${ic('globe', 18, '#b45309')} Needs internet</h4>${li(['M-PESA <b>STK push</b> (the prompt on the customer\'s phone)', 'Customer credit / deposits', 'Refunds and reports'])}</div></div>
      <p class="note"><b>M-PESA with no internet:</b> ask the customer to show the SMS, type the code (like <i>SJK2L9XYZ1</i>) as the reference. It is saved as <b>unverified</b> and checked automatically after sync.</p>
      <p>The bill number looks like <b>OFFLINE-001</b> and a <b>provisional receipt</b> prints from the browser. The official receipt (and eTIMS, if used) is created when the work syncs.</p>` },
    { id: 'stock', icon: 'box', title: 'Stock, ingredients and the menu', show: () => feat().recipes !== false, body: () => `
      <p>Even the stock room keeps working:</p>
      ${li(['<b>Receive stock</b> from a supplier (invoice number, quantities, cost, batch, expiry).', '<b>Record waste</b>, spoilage or staff meals.', '<b>Adjust stock</b> (in or out) with a reason.', 'The ingredient list and quantities on screen update straight away.'])}
      <p class="note">Creating <b>new</b> ingredients, editing recipes, changing prices or the menu, and stock counts need the internet (they change your setup). Do those while online, then press <i>Download my restaurant data</i>.</p>` },
    { id: 'rooms', icon: 'bell', title: 'Hotels and lodges: room service', show: () => !!feat().accommodation, body: () => `
      <p>Guests who are <b>already checked in</b> can order from their room and have the bill charged to the room, all offline.</p>
      ${li(['The list of in-house guests and rooms is saved with the rest of the data.', '<b>Check-in, check-out, new bookings and online payments need internet.</b> Do them when the connection is back.', 'Room charges appear on the guest\'s folio after syncing.'])}` },
    { id: 'print', icon: 'printer', title: 'Printing without internet', body: () => `
      <p>Printers connected through the internet (the server print queue) pause when you are offline. In offline mode the app prints a <b>provisional receipt</b> straight from the browser.</p>
      ${li(['Set your <b>receipt printer as the default printer</b> on this device.', 'Press the test button below to confirm it prints.', 'Kitchen tickets are on the kitchen screen. If you rely on a kitchen printer, keep a hand-written pad as a backup for outages.'])}`, action: ['Print a test slip', () => { const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.appendChild(f); f.contentDocument.write('<html><body style="font:13px monospace;width:280px"><h3 style="text-align:center">PRINTER TEST</h3><p style="text-align:center">Provisional receipts print here when offline.</p></body></html>'); f.contentDocument.close(); setTimeout(() => { try { f.contentWindow.print(); } catch (e) { /* blocked */ } setTimeout(() => f.remove(), 2000); }, 300); }] },
    { id: 'tv', icon: 'tv', title: 'Live TV menu', body: () => `
      <p>Each TV needs to be <b>paired once while online</b> (Live TV menu → Screens → add screen, type the 8-character code on the TV).</p>
      ${li(['After that the TV <b>keeps showing the menu and all the pictures</b> with no internet.', 'Breakfast, lunch and happy-hour slides <b>switch by themselves</b> using the TV\'s own clock.', 'Price or sold-out changes made during an outage reach the TV when the internet returns.', 'The TV reconnects on its own. No one needs to touch it.'])}` },
    { id: 'devices', icon: 'devices', title: 'Several devices: the one rule to remember', body: () => `
      <div class="warn"><b>While offline, devices cannot talk to each other.</b></div>
      ${mock('Example', ['Waiter phone takes an order → saved on the phone only', 'Kitchen tablet → does <b>not</b> see it until the phone is back online', 'When the internet returns, both sync and the kitchen sees it'])}
      <h4>For a busy service with no internet, use this safe setup</h4>
      ${li(['Run the <b>floor, kitchen and cashier on one shared tablet or PC</b> (everything then updates instantly on that one device).', 'Or have waiters <b>call/write orders</b> and have one person enter them on the main device.', 'Keep a <b>paper order pad</b> as the last backup.'])}
      <p class="note">If the internet is only slow (not gone), everything keeps working normally and syncs live.</p>` },
    { id: 'back', icon: 'cloud', title: 'When the internet comes back', body: () => `
      <p><b>You do nothing.</b> The top button shows <span style="color:#ea580c"><b>Syncing…</b></span>, then turns <span style="color:#0d7a4f"><b>green</b></span>.</p>
      ${li(['Everything is sent <b>in the order it happened</b> and cannot be applied twice, even if the connection drops mid-way.', 'Real receipts, eTIMS entries, stock deductions and sales reports are created at this point.', 'The device clock must be correct. You will get a warning if it is more than 5 minutes off.'])}
      <h4>If the button turns red: "Needs attention"</h4>
      <p>Something could not be applied, for example an item ran out of stock on the server, or a table was taken by someone else. Tap the red button to read what it was. Managers can also open <b>Offline review</b>. <b>Money and customer orders are never silently changed or deleted.</b></p>` },
    { id: 'drill', icon: 'flask', title: 'Practice drill (do this once per device)', body: () => `
      <p>Do not wait for a real outage. Run this drill now so everyone is confident:</p>
      <ol class="drill">
        <li>Make sure all the setup steps above are <b>green</b>.</li>
        <li>Turn on <b>Airplane mode</b> (or switch off Wi-Fi). The top button turns orange: <i>Offline</i>.</li>
        <li>Open <b>Floor</b> → tap a table → add 2 items → <b>Send</b>.</li>
        <li>Open <b>Kitchen</b> → mark the items <b>Ready</b>. Back on the order, mark them <b>Served</b>.</li>
        <li>Press <b>Bill</b> → <b>Pay</b> with cash. Print the provisional receipt.</li>
        <li>Turn the internet back on. Watch it say <b>Syncing…</b> then <b>green</b>. Check the order in <b>Bills</b> and the stock.</li>
      </ol>
      <p class="note">Tip: do the drill with a test table and cancel/refund the test sale afterwards.</p>` },
    { id: 'cheat', icon: 'clip', title: 'Your quick cheat-sheet', body: () => {
      const R = role(); const sheets = {
        waiter: ['Open Floor → table → add items → <b>Send</b>. Works offline.', 'Need the bill? Press <b>Request bill</b>; the cashier sees it on the same device.', 'If a message says an item is unavailable, offer an alternative.', 'After the internet returns, check the top button is green.'],
        cook: ['Kitchen screen: <b>Accept → Preparing → Ready</b>.', 'You only see orders sent from <b>this device</b> while offline.', 'Keep a paper pad as backup for outages.', 'Never refresh the page to "fix" it: your work is saved on the device.'],
        cashier: ['Open the <b>cash shift</b> first.', 'Cash, card and <b>M-PESA code</b> work offline. STK push does not.', 'Print the <b>provisional receipt</b>.', 'After sync, check unverified M-PESA payments in the cashier screen.'],
        manager: ['Check the dot on every device each morning: it should be <b>green</b>.', 'Press <b>Download my restaurant data</b> after any menu / price change.', 'Review <b>Needs attention</b> items and Offline review after an outage.', 'Make sure every device has done the practice drill.'],
      };
      const key = /WAITER|HEAD|BARTENDER/.test(R) ? 'waiter' : /CHEF|KITCHEN|EXPEDITOR/.test(R) ? 'cook' : /CASHIER/.test(R) ? 'cashier' : 'manager';
      return `<p>Your role: <b>${E(R || 'Staff')}</b></p>${li(sheets[key])}<details><summary>See the other roles</summary>${Object.entries(sheets).filter(([k]) => k !== key).map(([k, v]) => `<h4 style="text-transform:capitalize">${k}</h4>${li(v)}`).join('')}</details>`; } },
    { id: 'done', icon: 'done', title: 'All set', final: true, body: async () => { const cs = await H().checks(); const ok = cs.every((c) => c.ok || c.soft); return `<p><b>${ok ? 'This device is ready to work offline.' : 'Almost there: some setup steps are still not green.'}</b></p>${li(cs.map((c) => `${c.ok || c.soft ? ic('check', 16, '#0d7a4f') : ic('x', 16, '#94a3b8')} ${E(c.title)}`))}${ok ? '' : '<p class="note">Go back to the blue steps (use Back) and press their buttons while you are online.</p>'}<p>You can reopen this tour any time from the <b>Set up offline</b> / <b>Offline ready</b> button at the top.</p>`; } },
  ];

  const CSS = `#hxo-tour{position:fixed;inset:0;z-index:2800;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:10px;font:15px/1.5 system-ui,sans-serif}
  #hxo-tour .tc{background:#fff;color:#0f172a;border-radius:18px;width:100%;max-width:680px;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35)}
  #hxo-tour .th{padding:16px 20px 0;display:flex;justify-content:space-between;align-items:center;gap:8px;color:#64748b;font-size:13px}
  #hxo-tour .bar{height:6px;background:#e2e8f0;border-radius:9px;margin:10px 20px 0;overflow:hidden}#hxo-tour .bar i{display:block;height:100%;background:#1d4ed8;transition:width .3s}
  #hxo-tour .tb{padding:14px 20px;overflow:auto;flex:1}#hxo-tour h2{margin:0 0 8px;font-size:21px}#hxo-tour h4{margin:14px 0 4px}
  #hxo-tour ul,#hxo-tour ol{padding-left:20px;margin:6px 0}#hxo-tour li{margin:4px 0}
  #hxo-tour .ic{font-size:34px;line-height:1}.row{display:flex;gap:10px;align-items:center;margin:6px 0}.dt{width:14px;height:14px;border-radius:50%;flex:none}
  #hxo-tour .note{background:#eff6ff;border-left:4px solid #1d4ed8;padding:8px 12px;border-radius:8px;margin:10px 0}.warn{background:#fff7ed;border-left:4px solid #ea580c;padding:10px 12px;border-radius:8px;font-size:16px}
  #hxo-tour .flow{display:flex;align-items:stretch;gap:6px;flex-wrap:wrap;margin:10px 0}.fb{flex:1;min-width:150px;background:#f1f5f9;border-radius:12px;padding:12px;text-align:center}.fi{font-size:28px}.fb small{display:block;color:#475569}.ar{align-self:center;font-size:22px;color:#64748b}
  #hxo-tour .mock{border:1px solid #cbd5e1;border-radius:12px;margin:10px 0;overflow:hidden}.mt{background:#1e293b;color:#fff;padding:6px 12px;font-weight:600}.mr{padding:6px 12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between}
  #hxo-tour .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:560px){#hxo-tour .two{grid-template-columns:1fr}}
  #hxo-tour .st{display:flex;gap:10px;align-items:center;border-radius:10px;padding:10px 12px;margin:12px 0;font-weight:600}.st.ok{background:#ecfdf5;color:#065f46}.st.no{background:#eff6ff;color:#1e3a8a}
  #hxo-tour .tf{padding:12px 20px 16px;display:flex;gap:8px;justify-content:space-between;border-top:1px solid #e2e8f0}
  #hxo-tour button{font:inherit;border:0;border-radius:10px;padding:9px 16px;cursor:pointer}.pri{background:#1d4ed8;color:#fff}.sec{background:#e2e8f0;color:#0f172a}.act{background:#0f172a;color:#fff}
  .hxo-spot{outline:3px solid #fbbf24!important;outline-offset:3px;border-radius:10px;animation:hxop 1s infinite}@keyframes hxop{50%{outline-color:#fff}}`;

  let idx = 0; let root = null;
  const visible = () => STEPS.filter((s) => !s.show || s.show());
  async function render() {
    const list = visible(); idx = Math.max(0, Math.min(idx, list.length - 1)); const s = list[idx];
    document.querySelectorAll('.hxo-spot').forEach((e) => e.classList.remove('hxo-spot')); if (s.spot) document.querySelector(s.spot)?.classList.add('hxo-spot');
    H().kvSet('tourStep', s.id);
    const chk = s.check ? await s.check() : null; const body = await s.body();
    root.innerHTML = `<div class="tc" role="dialog" aria-modal="true"><div class="th"><span>Step ${idx + 1} of ${list.length}</span><button class="sec" data-x>Close</button></div><div class="bar"><i style="width:${Math.round((idx + 1) / list.length * 100)}%"></i></div>
      <div class="tb"><div class="ic" style="color:#1d4ed8">${ic(s.icon, 38)}</div><h2>${E(s.title)}</h2>${body}
      ${chk ? `<div class="st ${chk.ok ? 'ok' : 'no'}"><span>${chk.ok ? ic('done', 22, '#059669') : ic('dot', 22, '#1d4ed8')}</span><span>${E(chk.ok ? chk.ok_t : chk.bad_t)}</span></div>` : ''}
      ${s.action ? `<button class="act" data-a>${E(chk && chk.ok ? 'Do it again' : s.action[0])}</button>` : ''}</div>
      <div class="tf"><button class="sec" data-b ${idx ? '' : 'disabled'}>← Back</button><button class="pri" data-n>${s.final ? 'Finish' : 'Next →'}</button></div></div>`;
    root.querySelector('[data-x]').onclick = close;
    root.querySelector('[data-b]').onclick = () => { idx -= 1; render(); };
    root.querySelector('[data-n]').onclick = () => { if (s.final) { H().kvSet('tourDone', Date.now()); close(); } else { idx += 1; render(); } };
    const a = root.querySelector('[data-a]'); if (a) a.onclick = async () => { a.disabled = true; try { await s.action[1](a); } catch (e) { /* shown by toast */ } render(); };
  }
  function close() { document.removeEventListener('keydown', key); document.querySelectorAll('.hxo-spot').forEach((e) => e.classList.remove('hxo-spot')); root && root.remove(); root = null; }
  function key(e) { if (!root) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') root.querySelector('[data-n]')?.click(); if (e.key === 'ArrowLeft') root.querySelector('[data-b]')?.click(); }
  async function open(opts) {
    if (root) return; if (!document.getElementById('hxo-tour-css')) { const st = document.createElement('style'); st.id = 'hxo-tour-css'; st.textContent = CSS; document.head.appendChild(st); }
    root = document.createElement('div'); root.id = 'hxo-tour'; document.body.appendChild(root); document.addEventListener('keydown', key);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    const saved = opts && opts.restart ? null : await H().kvGet('tourStep'); const list = visible(); idx = Math.max(0, list.findIndex((s) => s.id === saved)); if (saved === 'done') idx = 0;
    render();
  }
  window.HXOfflineGuide = Object.assign(window.HXOfflineGuide || {}, { open });
  window.HXOfflineTour = { open, restart: () => open({ restart: true }) };
})(window);
