/**
 * cash-drawer.js
 * Cash drawer control for the POS. The drawer's RJ11/RJ12 cable plugs into the
 * receipt printer; to pop it we send the printer the standard ESC/POS "kick"
 * command (ESC p m t1 t2). The browser talks to the printer directly through
 *   - WebUSB      (USB receipt printers; Chrome / Edge / Android Chrome), or
 *   - Web Serial  (printers that show up as a COM / serial port)
 * Both need HTTPS (or localhost). The printer is paired ONCE (user gesture);
 * after that it reconnects silently on every page load.
 *
 * RULES THIS MODULE ENFORCES (the sales screen reads them)
 *   - The drawer is only opened by open() - sales.js calls it ONLY for a cash
 *     sale that has change to give back. Exact cash / M-PESA / card never open it.
 *   - open() puts the drawer in the "open" state. While it is open the sales
 *     screen is locked: no new sale can start until the drawer is closed.
 *   - The state survives a page reload (a half-finished change hand-over can
 *     never be skipped by refreshing).
 *
 * HOW "CLOSED" IS KNOWN
 *   1. Sensor (optional, Settings -> "Detect when the drawer is shut"): while the
 *      drawer is open we poll the printer's real-time status (DLE EOT 1, bit 2 =
 *      drawer connector). It must be SEEN open first, then closed twice in a row,
 *      before the lock releases by itself. Needs the drawer's sensor wire.
 *   2. Manual: the cashier taps "Drawer is closed". With a working sensor that
 *      tap is refused while the sensor still says open (sales.js offers a
 *      timed manual override so a broken sensor can never freeze the till).
 *
 * API (window.CashDrawer)
 *   init()                       start (auto-reconnect paired printer). Safe to call twice.
 *   info()                       { state, active, connected, label, error, pending, sensor, settings, support }
 *                                state: 'unconfigured' | 'disconnected' | 'ready' | 'open'
 *   isActive() / isOpen()
 *   open({ change, receipt })    kick the drawer and enter the "open" state
 *   reopen()                     kick again while open (drawer did not pop)
 *   confirmClosed({ force })     manual "it is closed" -> true when accepted
 *   onChange(cb)                 subscribe, returns unsubscribe
 *   openSettings({ canTest })    pairing / options window
 */
(function (window) {
  'use strict';

  const SETTINGS_KEY = 'pos.drawer.settings';
  const PENDING_KEY = 'pos.drawer.pending';
  const DEFAULTS = { transport: 'none', pin: 'both', sense: false, invert: false, baud: 9600, vid: null, pid: null };
  const STATUS_REQ = Uint8Array.of(0x10, 0x04, 0x01); // DLE EOT 1: real-time status, drawer bit
  const PULSE_2 = [0x1b, 0x70, 0x00, 0x19, 0xfa]; // ESC p 0 25 250  (drawer connector pin 2)
  const PULSE_5 = [0x1b, 0x70, 0x01, 0x19, 0xfa]; // ESC p 1 25 250  (drawer connector pin 5)

  const listeners = new Set();
  let settings = loadSettings();
  let link = null; // { kind, label, canQuery, send(bytes), query(bytes, ms), close(), device|port }
  let linkError = '';
  let pending = loadPending(); // { at, change, receipt } while the drawer is open
  let sensor = freshSensor();
  let watchTimer = null;
  let polling = false;
  let inited = false;
  let reconnecting = null;
  let ioQueue = Promise.resolve();

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function loadSettings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } }
  function loadPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; } }
  function savePending() {
    try { if (pending) localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); else localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  }
  function freshSensor() { return { seenOpen: false, closedReads: 0, last: null, unreadable: false }; }
  function isActive() { return settings.transport !== 'none'; }
  function isOpen() { return !!pending && isActive(); }
  function withTimeout(p, ms) { return Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]); }

  /** Every write/query to the printer goes through one queue so they can never overlap. */
  function io(fn) {
    const run = ioQueue.then(fn);
    ioQueue = run.catch(() => {});
    return run;
  }

  function supportInfo() {
    return { usb: !!navigator.usb, serial: !!navigator.serial, secure: window.isSecureContext !== false };
  }

  function friendly(err) {
    const name = err && err.name;
    const msg = (err && err.message) || String(err || 'Unknown error');
    if (name === 'SecurityError') return 'The browser blocked printer access (the page must be HTTPS or localhost)';
    if (name === 'NetworkError' || /claim|access denied|busy/i.test(msg)) {
      return 'The printer is busy or owned by its Windows driver. Close other apps using it, or pair it as a Serial port instead';
    }
    if (name === 'NotFoundError') return 'No printer was chosen';
    return msg;
  }

  function pulseBytes(pin) {
    const p = pin || settings.pin;
    return Uint8Array.from(p === 'pin2' ? PULSE_2 : p === 'pin5' ? PULSE_5 : [...PULSE_2, ...PULSE_5]);
  }

  function info() {
    const active = isActive();
    const state = !active ? 'unconfigured' : pending ? 'open' : link ? 'ready' : 'disconnected';
    return {
      state,
      active,
      connected: !!link,
      label: link ? link.label : '',
      error: linkError,
      pending: pending ? { ...pending } : null,
      sensor: {
        active: !!(active && settings.sense && link && link.canQuery),
        last: sensor.last,
        seenOpen: sensor.seenOpen,
        unreadable: sensor.unreadable,
      },
      settings: { ...settings },
      support: supportInfo(),
    };
  }

  function emit() {
    const snapshot = info();
    listeners.forEach((cb) => { try { cb(snapshot); } catch (e) { console.error('CashDrawer listener', e); } });
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  /* ------------------------------------------------------------------ *
   * Transports
   * ------------------------------------------------------------------ */
  function pickInterface(device) {
    const cands = [];
    device.configuration.interfaces.forEach((iface) => iface.alternates.forEach((alt) => {
      const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (out) cands.push({ iface, alt, out, inn: alt.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk') });
    }));
    return cands.find((c) => c.alt.interfaceClass === 7) || cands[0] || null; // class 7 = printer
  }

  async function openUsb(device) {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    const c = pickInterface(device);
    if (!c) throw new Error('No printable USB endpoint found on this device');
    await device.claimInterface(c.iface.interfaceNumber);
    if (c.alt.alternateSetting) await device.selectAlternateInterface(c.iface.interfaceNumber, c.alt.alternateSetting);
    return {
      kind: 'usb',
      device,
      label: device.productName || 'USB printer',
      canQuery: !!c.inn,
      async send(bytes) { await device.transferOut(c.out.endpointNumber, bytes); },
      async query(bytes, ms) {
        if (!c.inn) return null;
        await device.transferOut(c.out.endpointNumber, bytes);
        const r = await withTimeout(device.transferIn(c.inn.endpointNumber, 8), ms || 700);
        return r && r.data && r.data.byteLength ? r.data.getUint8(0) : null;
      },
      async close() { try { await device.close(); } catch { /* already gone */ } },
    };
  }

  async function openSerial(port) {
    await port.open({ baudRate: settings.baud || 9600 });
    const rx = [];
    let waiter = null;
    let alive = true;
    const reader = port.readable.getReader();
    (async () => {
      try {
        while (alive) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) {
            if (waiter) { const w = waiter; waiter = null; w(value[0]); } else rx.push(value[0]);
          }
        }
      } catch { /* port closed */ }
    })();
    const send = async (bytes) => {
      const w = port.writable.getWriter();
      try { await w.write(bytes); } finally { w.releaseLock(); }
    };
    return {
      kind: 'serial',
      port,
      label: 'Serial printer',
      canQuery: true,
      send,
      async query(bytes, ms) {
        rx.length = 0;
        await send(bytes);
        if (rx.length) return rx.shift();
        return new Promise((res) => {
          const t = setTimeout(() => { waiter = null; res(null); }, ms || 700);
          waiter = (v) => { clearTimeout(t); res(v); };
        });
      },
      async close() {
        alive = false;
        try { await reader.cancel(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { await port.close(); } catch { /* ignore */ }
      },
    };
  }

  async function dropLink() {
    const l = link;
    link = null;
    stopWatch();
    if (l) { try { await l.close(); } catch { /* ignore */ } }
  }

  /** Silent reconnect to a printer the browser already has permission for. */
  function reconnect() {
    if (link) return Promise.resolve(link);
    if (reconnecting) return reconnecting;
    reconnecting = (async () => {
      try {
        if (settings.transport === 'usb' && navigator.usb) {
          const devs = await navigator.usb.getDevices();
          const dev = devs.find((d) => (settings.vid == null || d.vendorId === settings.vid) && (settings.pid == null || d.productId === settings.pid));
          if (dev) link = await openUsb(dev);
        } else if (settings.transport === 'serial' && navigator.serial) {
          const ports = await navigator.serial.getPorts();
          const port = ports.find((p) => {
            const i = p.getInfo();
            return settings.vid == null || (i.usbVendorId === settings.vid && i.usbProductId === settings.pid);
          });
          if (port) link = await openSerial(port);
        }
        linkError = link ? '' : (isActive() ? 'No printer paired - tap the drawer button and choose one' : '');
        if (link && pending) startWatch();
      } catch (err) {
        link = null;
        linkError = friendly(err);
      } finally {
        reconnecting = null;
        emit();
      }
      return link;
    })();
    return reconnecting;
  }

  /** Pairing (needs a user gesture because it shows the browser's device chooser). */
  async function connectDevice(kind) {
    try {
      if (kind === 'usb') {
        if (!navigator.usb) throw new Error('WebUSB is not available in this browser');
        const dev = await navigator.usb.requestDevice({ filters: [{ classCode: 7 }, { classCode: 0xff }] });
        await dropLink();
        link = await openUsb(dev);
        settings = { ...settings, transport: 'usb', vid: dev.vendorId, pid: dev.productId };
      } else if (kind === 'serial') {
        if (!navigator.serial) throw new Error('Web Serial is not available in this browser');
        const port = await navigator.serial.requestPort();
        await dropLink();
        link = await openSerial(port);
        const i = port.getInfo();
        settings = { ...settings, transport: 'serial', vid: i.usbVendorId != null ? i.usbVendorId : null, pid: i.usbProductId != null ? i.usbProductId : null };
      } else {
        throw new Error('Choose USB or Serial first');
      }
      linkError = '';
      saveSettings();
      if (pending) startWatch();
      emit();
      return { ok: true };
    } catch (err) {
      const cancelled = err && err.name === 'NotFoundError';
      if (!cancelled) linkError = friendly(err);
      emit();
      return { ok: false, cancelled, error: friendly(err) };
    }
  }

  async function forget() {
    const raw = link && (link.device || link.port);
    await dropLink();
    if (raw && typeof raw.forget === 'function') { try { await raw.forget(); } catch { /* ignore */ } }
    settings = { ...settings, vid: null, pid: null };
    saveSettings();
    linkError = isActive() ? 'No printer paired - tap the drawer button and choose one' : '';
    emit();
  }

  /* ------------------------------------------------------------------ *
   * Kick + sensor
   * ------------------------------------------------------------------ */
  async function kick(pin) {
    const bytes = pulseBytes(pin);
    if (!link) await reconnect();
    if (!link) throw new Error(linkError || 'The drawer printer is not connected');
    try {
      await io(() => link.send(bytes));
    } catch (e) {
      // Stale connection (printer power-cycled / re-plugged): rebuild once and retry.
      await dropLink();
      await reconnect();
      if (!link) throw e;
      await io(() => link.send(bytes));
    }
  }

  async function readSensor(invert) {
    if (!link || !link.canQuery) return { ok: false, reason: 'unsupported' };
    const raw = await link.query(STATUS_REQ, 600);
    if (raw == null) return { ok: false, reason: 'noreply' };
    const bit = (raw & 0x04) !== 0; // drawer kick-out connector status
    const inv = invert == null ? settings.invert : invert;
    return { ok: true, open: inv ? !bit : bit };
  }

  function stopWatch() {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    polling = false;
  }

  function startWatch() {
    stopWatch();
    sensor = freshSensor();
    if (!pending || !settings.sense || !link || !link.canQuery) return;
    watchTimer = setInterval(async () => {
      if (!pending || polling) return;
      polling = true;
      const before = `${sensor.last}|${sensor.seenOpen}|${sensor.unreadable}`;
      try {
        const r = await io(() => readSensor());
        if (!pending) return;
        if (!r.ok) {
          sensor.unreadable = true;
        } else {
          sensor.unreadable = false;
          sensor.last = r.open ? 'open' : 'closed';
          if (r.open) {
            sensor.seenOpen = true;
            sensor.closedReads = 0;
          } else if (sensor.seenOpen) {
            sensor.closedReads += 1;
            if (sensor.closedReads >= 2) { closeNow(); return; }
          }
        }
      } catch {
        sensor.unreadable = true;
      } finally {
        polling = false;
      }
      if (pending && before !== `${sensor.last}|${sensor.seenOpen}|${sensor.unreadable}`) emit();
    }, 600);
  }

  function closeNow() {
    pending = null;
    savePending();
    stopWatch();
    emit();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Public actions
   * ------------------------------------------------------------------ */
  async function open(meta = {}) {
    if (!isActive()) return { ok: false, skipped: true };
    // Lock the till FIRST so the cashier sees it instantly, even if the printer is slow.
    pending = { at: Date.now(), change: Number(meta.change) || 0, receipt: meta.receipt || '' };
    savePending();
    sensor = freshSensor();
    emit();
    try {
      await kick();
      startWatch();
      return { ok: true };
    } catch (err) {
      linkError = friendly(err);
      emit();
      if (window.UI && window.UI.toast) window.UI.toast.error(`Drawer did not open automatically: ${linkError}. Use the manual release or key.`);
      return { ok: false, error: linkError };
    }
  }

  async function reopen() {
    if (!pending) return { ok: false };
    try {
      await kick();
      startWatch();
      return { ok: true };
    } catch (err) {
      linkError = friendly(err);
      emit();
      return { ok: false, error: linkError };
    }
  }

  function confirmClosed({ force = false } = {}) {
    if (!pending) return true;
    if (!force && settings.sense && link && link.canQuery && sensor.seenOpen && sensor.last === 'open') return false;
    return closeNow();
  }

  function init() {
    if (inited) return;
    inited = true;
    if (!isActive()) { pending = null; savePending(); }

    const watchHardware = (target) => {
      if (!target || !target.addEventListener) return;
      target.addEventListener('connect', () => { if (isActive() && !link) reconnect(); });
      target.addEventListener('disconnect', (e) => {
        const mine = link && (link.device || link.port);
        if (!mine || (e.device || e.port) !== mine) return;
        dropLink().then(() => { linkError = 'Printer unplugged'; emit(); });
      });
    };
    watchHardware(navigator.usb);
    watchHardware(navigator.serial);

    if (isActive()) reconnect(); else emit();
  }

  /* ------------------------------------------------------------------ *
   * Settings window (pairing, pin, sensor)
   * ------------------------------------------------------------------ */
  function openSettings({ canTest = false } = {}) {
    const sup = supportInfo();
    const esc = window.UI.escapeHtml;
    const modal = window.UI.openModal({
      title: 'Cash drawer',
      maxWidth: '540px',
      bodyHtml: `
        <div class="cd-status" id="cd-status"></div>
        ${sup.secure ? '' : '<div class="pz-note warn">Direct printer access needs a secure page (HTTPS or localhost).</div>'}
        <div class="field">
          <label for="cd-transport">How is the drawer connected?</label>
          <select class="select" id="cd-transport">
            <option value="none">I do not use a cash drawer</option>
            <option value="usb" ${sup.usb ? '' : 'disabled'}>USB receipt printer (WebUSB)${sup.usb ? '' : ' - not supported in this browser'}</option>
            <option value="serial" ${sup.serial ? '' : 'disabled'}>Serial / COM printer (Web Serial)${sup.serial ? '' : ' - not supported in this browser'}</option>
          </select>
          <span class="field-hint">The drawer cable plugs into the receipt printer. The POS pops it only when a cash sale has change to give back.</span>
        </div>
        <div id="cd-more">
          <div class="input-button-row" style="margin-bottom:var(--space-4)">
            <button type="button" class="btn btn-primary" id="cd-connect"><i class="fa-solid fa-plug" aria-hidden="true"></i> Choose printer…</button>
            <button type="button" class="btn btn-secondary" id="cd-forget">Forget</button>
          </div>
          <div class="field">
            <label for="cd-pin">Drawer connector</label>
            <select class="select" id="cd-pin">
              <option value="both">Auto (try both pins)</option>
              <option value="pin2">Pin 2 (most drawers)</option>
              <option value="pin5">Pin 5</option>
            </select>
          </div>
          <label class="checkbox-row" style="margin-bottom:var(--space-2)"><input type="checkbox" id="cd-sense" /> <span class="text-sm">Detect when the drawer is shut (needs the drawer sensor cable)</span></label>
          <label class="checkbox-row"><input type="checkbox" id="cd-invert" /> <span class="text-sm">Sensor reads backwards (open shows as closed)</span></label>
          <div class="cd-sensor-read" id="cd-sensor-read">Not sure about the sensor? Leave it off - the cashier then taps "Drawer is closed" after pushing the drawer shut.</div>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-act="close">Close</button>
        <button class="btn btn-secondary" data-act="sensor">Check sensor</button>
        ${canTest ? '<button class="btn btn-secondary" data-act="test">Test open</button>' : ''}
        <button class="btn btn-primary" data-act="save">Save</button>
      `,
    });

    const q = (sel) => modal.querySelector(sel);
    q('#cd-transport').value = settings.transport;
    q('#cd-pin').value = settings.pin;
    q('#cd-sense').checked = !!settings.sense;
    q('#cd-invert').checked = !!settings.invert;
    const draft = () => ({ transport: q('#cd-transport').value, pin: q('#cd-pin').value, sense: q('#cd-sense').checked, invert: q('#cd-invert').checked });

    function paint() {
      if (!document.body.contains(modal)) return;
      const i = info();
      const text = {
        unconfigured: 'Not set up - choose how the drawer is connected.',
        disconnected: i.error || 'Printer not connected.',
        ready: `Connected: ${i.label || 'printer'}. Drawer is closed.`,
        open: 'Drawer is open - waiting for it to be closed.',
      }[i.state];
      const st = q('#cd-status');
      st.className = `cd-status ${i.state}`;
      st.innerHTML = `<span class="cd-dot"></span><span>${esc(text)}</span>`;
      const on = q('#cd-transport').value !== 'none';
      q('#cd-more').style.display = on ? '' : 'none';
      q('[data-act="sensor"]').style.display = on ? '' : 'none';
      const t = q('[data-act="test"]');
      if (t) t.style.display = on ? '' : 'none';
    }
    const unsub = onChange(paint);
    q('#cd-transport').addEventListener('change', paint);
    paint();

    q('#cd-connect').addEventListener('click', async () => {
      const r = await connectDevice(q('#cd-transport').value);
      if (r.ok) window.UI.toast.success('Printer connected');
      else if (!r.cancelled) window.UI.toast.error(r.error);
      paint();
    });
    q('#cd-forget').addEventListener('click', async () => { await forget(); window.UI.toast.success('Printer forgotten'); paint(); });

    q('[data-act="sensor"]').addEventListener('click', async () => {
      const out = q('#cd-sensor-read');
      if (!link) { out.textContent = 'Connect the printer first.'; return; }
      out.textContent = 'Reading…';
      try {
        const r = await io(() => readSensor(q('#cd-invert').checked));
        out.textContent = !r.ok
          ? 'No sensor reply. This printer/drawer may not report its state - leave detection off.'
          : `Sensor says the drawer is ${r.open ? 'OPEN' : 'CLOSED'} right now. Open and shut it by hand and check again; if it is reversed, tick "Sensor reads backwards".`;
      } catch (err) {
        out.textContent = friendly(err);
      }
    });

    q('[data-act="test"]')?.addEventListener('click', async () => {
      try { await kick(q('#cd-pin').value); window.UI.toast.success('Open signal sent to the drawer'); } catch (err) { window.UI.toast.error(friendly(err)); }
    });

    q('[data-act="close"]').addEventListener('click', () => { unsub(); window.UI.closeModal(); });
    q('[data-act="save"]').addEventListener('click', async () => {
      const d = draft();
      const changed = d.transport !== settings.transport;
      settings = { ...settings, pin: d.pin, sense: d.sense, invert: d.invert, transport: d.transport };
      if (d.transport === 'none') {
        await dropLink();
        settings.vid = null;
        settings.pid = null;
        pending = null;
        savePending();
      } else if (changed) {
        await dropLink();
        settings.vid = null;
        settings.pid = null;
      }
      saveSettings();
      if (isActive() && !link) await reconnect();
      if (pending) startWatch();
      emit();
      unsub();
      window.UI.closeModal();
      window.UI.toast.success('Cash drawer settings saved');
    });
  }

  window.CashDrawer = { init, info, isActive, isOpen, open, reopen, confirmClosed, onChange, openSettings, supportInfo };
})(window);