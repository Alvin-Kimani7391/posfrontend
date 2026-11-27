/**
 * cash-drawer.js  (NEW - loaded automatically by app-shell.js, no HTML change needed)
 *
 * Cash drawer control for the POS. Two jobs:
 *
 * 1. HARDWARE: send the ESC/POS "kick drawer" pulse to the receipt printer the drawer is
 *    plugged into (RJ11 / DK port), over WebUSB or Web Serial (Chrome / Edge, HTTPS or
 *    localhost). When the printer answers the ESC/POS drawer-status request
 *    (DLE EOT 1) the system also KNOWS when the drawer is open or closed.
 *
 * 2. THE RULE: the drawer opens ONLY when a cash sale has change to give back. From that
 *    moment the POS is LOCKED until the drawer is closed again:
 *      - drawer sensor available  -> the lock releases by itself the moment the drawer shuts
 *      - no sensor / no hardware  -> the cashier must tap "Drawer is closed"
 *    The lock is saved on this device, so reloading the page or reopening the browser
 *    cannot be used to skip it.
 *
 * NO DRAWER? Shops without a cash drawer leave the setting "This shop uses a cash drawer" OFF
 * (the default). Then nothing opens, nothing locks, and the POS simply shows "Give change".
 *
 * Lock phases:  opening -> open | failed | manual
 *   open    : pulse sent
 *   failed  : pulse could not be sent / drawer did not pop (sensor only)
 *   manual  : no drawer hardware connected - cashier opens it with the No-Sale key
 *
 * Events (CashDrawer.on(fn)): lock | phase | reading | overdue | unlock | connection
 *
 * Public API: see window.CashDrawer at the bottom.
 */
(function (window) {
  'use strict';

  const CFG_KEY = 'pos.drawer.cfg';
  const LOCK_KEY = 'pos.drawer.lock';
  const OVERDUE_MS = 60 * 1000;        // drawer open longer than this -> "overdue"
  const POLL_MS = 500;                 // sensor polling while locked
  const NO_POP_MS = 4000;              // pulse sent but sensor never saw "open" -> failed
  const LOCK_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const STATUS_REQ = new Uint8Array([0x10, 0x04, 0x01]); // DLE EOT 1 (printer status)

  const DEFAULT_CFG = { enabled: false, mode: 'none', pin: 0, baud: 9600, closedBit: null, usb: null, cmd: 'auto', custom: '', flow: 'none' };

  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));

  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
  function writeJson(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }

  let cfg = { ...DEFAULT_CFG, ...(readJson(CFG_KEY) || {}) };
  if (!(readJson(CFG_KEY) || {}).cmd && cfg.pin === 1) cfg.cmd = 'pin5'; // a till set to "Pin 5" before the command option existed
  let lastError = '';      // last drawer problem, shown in the setup screen and the top bar until a pulse works again
  let lock = null;
  const listeners = new Set();

  let link = null;          // { kind: 'serial' | 'usb', label }
  let port = null;          // Web Serial port
  let serialReader = null;
  let serialLoop = null;
  let usbDev = null;        // WebUSB device
  let usbEp = null;         // { iface, out, in }
  let senseOk = false;      // printer has answered a valid status request
  let missStreak = 0;
  let statusWaiter = null;
  let writeQueue = Promise.resolve();
  let pollTimer = null;
  let overdueTimer = null;
  let ticking = false;

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */
  function emit(type, extra = {}) {
    const detail = { type, lock: lock ? { ...lock } : null, ...extra };
    listeners.forEach((fn) => { try { fn(detail); } catch (err) { console.error('CashDrawer listener failed', err); } });
  }
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /* ------------------------------------------------------------------ *
   * Status
   * ------------------------------------------------------------------ */
  function isSupported() { return 'serial' in navigator || 'usb' in navigator; }

  function status() {
    const connected = !!link;
    return {
      enabled: !!cfg.enabled,
      supported: isSupported(),
      serialSupported: 'serial' in navigator,
      usbSupported: 'usb' in navigator,
      connected,
      kind: link ? link.kind : null,
      label: link ? link.label : '',
      calibrated: cfg.closedBit != null,
      canSense: connected && senseOk && cfg.closedBit != null,
      pin: cfg.pin,
      baud: cfg.baud,
      cmd: cfg.cmd,
      custom: cfg.custom,
      flow: cfg.flow,
      answering: senseOk,
      lastError,
    };
  }

  function isLocked() { return !!lock; }
  function isEnabled() { return !!cfg.enabled; }

  /** Turn the whole drawer feature on/off for this device. Turning it off releases any lock and disconnects. */
  async function setEnabled(value) {
    cfg.enabled = !!value;
    writeJson(CFG_KEY, cfg);
    if (!cfg.enabled) {
      if (lock) finish('disabled');
      await dropLink();
      cfg.mode = 'none';
      writeJson(CFG_KEY, cfg);
    }
    emit('connection');
  }
  function getLock() { return lock ? { ...lock } : null; }

  /* ------------------------------------------------------------------ *
   * Low-level I/O (serialised so writes never overlap)
   * ------------------------------------------------------------------ */
  async function rawWrite(bytes) {
    if (!link) throw new Error('Drawer not connected');
    if (link.kind === 'serial') {
      if (!port || !port.writable) throw new Error('The COM port is closed');
      const writer = port.writable.getWriter();
      let timer;
      try {
        // a printer that never accepts data (wrong speed / flow control / switched off) would make write() wait forever
        await Promise.race([
          writer.write(bytes),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('The printer is not accepting data. Check it is switched on, the cable, the serial speed (baud) and flow control.')), 3000); }),
        ]);
      } finally { clearTimeout(timer); try { writer.releaseLock(); } catch { /* a stuck write keeps the lock: the port is re-opened by reconnect */ } }
    } else {
      const res = await usbDev.transferOut(usbEp.out, bytes);
      if (res.status !== 'ok') throw new Error(`USB transfer failed (${res.status})`);
    }
  }

  function write(bytes) {
    const p = writeQueue.then(() => rawWrite(bytes));
    writeQueue = p.catch(() => {});
    return p;
  }

  function onStatusBytes(u8) {
    if (statusWaiter && u8.length) statusWaiter(u8[u8.length - 1]);
  }

  function requestStatus(timeoutMs = 500) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { statusWaiter = null; resolve(null); }, timeoutMs);
      statusWaiter = (b) => { clearTimeout(timer); statusWaiter = null; resolve(b); };
      write(STATUS_REQ).catch(() => { clearTimeout(timer); statusWaiter = null; resolve(null); });
    });
  }

  function startSerialLoop(p) {
    serialLoop = (async () => {
      try {
        serialReader = p.readable.getReader();
        while (true) {
          const { value, done } = await serialReader.read();
          if (done) break;
          if (value && value.length) onStatusBytes(value);
        }
      } catch { /* port closed or unplugged */ }
      finally {
        try { serialReader && serialReader.releaseLock(); } catch { /* ignore */ }
        serialReader = null;
      }
    })();
  }

  function startUsbLoop(dev, ep) {
    if (ep.in == null) return;
    (async () => {
      try {
        while (link && link.kind === 'usb' && usbDev === dev) {
          const r = await dev.transferIn(ep.in, 64);
          if (r.status === 'ok' && r.data && r.data.byteLength) {
            onStatusBytes(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
          } else if (r.status === 'stall') {
            await dev.clearHalt('in', ep.in);
          }
        }
      } catch { /* device closed or unplugged */ }
    })();
  }

  async function dropLink() {
    const kind = link && link.kind;
    link = null;
    senseOk = false;
    missStreak = 0;
    try {
      if (kind === 'serial' && port) {
        try { if (serialReader) await serialReader.cancel(); } catch { /* ignore */ }
        try { if (serialLoop) await serialLoop; } catch { /* ignore */ }
        await port.close();
      }
    } catch { /* ignore */ }
    try {
      if (kind === 'usb' && usbDev) {
        try { await usbDev.releaseInterface(usbEp.iface); } catch { /* ignore */ }
        await usbDev.close();
      }
    } catch { /* ignore */ }
    port = null; usbDev = null; usbEp = null; serialReader = null; serialLoop = null;
  }

  /* ------------------------------------------------------------------ *
   * Connecting
   * ------------------------------------------------------------------ */
  async function adoptSerial(p, remember = true) {
    await dropLink();
    try { await p.close(); } catch { /* it was not open */ }
    try {
      await p.open({ baudRate: Number(cfg.baud) || 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: cfg.flow === 'hardware' ? 'hardware' : 'none', bufferSize: 4096 });
    } catch (err) {
      if (err && (err.name === 'NetworkError' || /access denied|busy|in use|failed to open/i.test(String(err.message)))) {
        throw new Error('The COM port could not be opened. Another program or browser tab is using it (close the printer software / other POS tabs), or the cable was unplugged.');
      }
      throw err;
    }
    try { await p.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch { /* not every adapter supports it */ }
    port = p;
    link = { kind: 'serial', label: 'Serial / COM printer' };
    startSerialLoop(p);
    if (remember) { cfg.mode = 'serial'; writeJson(CFG_KEY, cfg); }
    await readState(); // sets senseOk when the printer answers
    emit('connection');
  }

  async function adoptUsb(dev, remember = true) {
    await dropLink();
    await dev.open();
    if (!dev.configuration) await dev.selectConfiguration(1);

    // Prefer a printer-class (7) interface, otherwise any interface with a bulk OUT endpoint.
    let found = null;
    for (const preferPrinter of [true, false]) {
      for (const iface of dev.configuration.interfaces) {
        for (const alt of iface.alternates) {
          if (preferPrinter && alt.interfaceClass !== 7) continue;
          const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
          if (!out) continue;
          const inn = alt.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk');
          found = { iface: iface.interfaceNumber, alt: alt.alternateSetting, out: out.endpointNumber, in: inn ? inn.endpointNumber : null };
          break;
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) { try { await dev.close(); } catch { /* ignore */ } throw new Error('No printer endpoint found on this USB device.'); }

    try {
      await dev.claimInterface(found.iface);
      if (found.alt) await dev.selectAlternateInterface(found.iface, found.alt);
    } catch (err) {
      try { await dev.close(); } catch { /* ignore */ }
      throw new Error('Could not take control of the printer. On Windows install the WinUSB driver for it (e.g. with Zadig), or use the Serial / COM option.');
    }

    usbDev = dev;
    usbEp = found;
    link = { kind: 'usb', label: dev.productName || 'USB receipt printer' };
    startUsbLoop(dev, found);
    if (remember) { cfg.mode = 'usb'; cfg.usb = { vendorId: dev.vendorId, productId: dev.productId }; writeJson(CFG_KEY, cfg); }
    await readState();
    emit('connection');
  }

  async function connectSerial() {
    if (!('serial' in navigator)) throw new Error('This browser has no Web Serial support. Use Chrome or Edge.');
    const p = await navigator.serial.requestPort();
    await adoptSerial(p, true);
  }

  async function connectUsb() {
    if (!('usb' in navigator)) throw new Error('This browser has no WebUSB support. Use Chrome or Edge.');
    const dev = await navigator.usb.requestDevice({ filters: [{ classCode: 7 }, { classCode: 255 }] });
    await adoptUsb(dev, true);
  }

  async function disconnect() {
    await dropLink();
    cfg.mode = 'none';
    writeJson(CFG_KEY, cfg);
    emit('connection');
  }

  function configure(partial = {}) {
    if (partial.pin != null) cfg.pin = Number(partial.pin) === 1 ? 1 : 0;
    if (partial.baud != null) cfg.baud = Number(partial.baud) || 9600;
    if (partial.cmd != null) cfg.cmd = ['auto', 'pin2', 'pin5', 'dle', 'bel', 'signal', 'custom'].includes(partial.cmd) ? partial.cmd : 'auto';
    if (partial.custom != null) cfg.custom = String(partial.custom).slice(0, 80);
    if (partial.flow != null) cfg.flow = partial.flow === 'hardware' ? 'hardware' : 'none';
    writeJson(CFG_KEY, cfg);
  }

  /* ------------------------------------------------------------------ *
   * Open / sense
   * ------------------------------------------------------------------ */
  const ESC_INIT = [0x1B, 0x40];
  const escP = (m) => [0x1B, 0x70, m, 50, 250];      // ESC p m t1 t2: pin 2 (m=0) / pin 5 (m=1), 100 ms on, 500 ms off
  const dle14 = (m) => [0x10, 0x14, 0x01, m, 0x01];  // DLE DC4 1 m t: the same pulse as a real-time command (works when the printer is busy)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function commandBytes(cmd) {
    switch (cmd) {
      case 'pin2': return [...ESC_INIT, ...escP(0)];
      case 'pin5': return [...ESC_INIT, ...escP(1)];
      case 'dle': return [...dle14(0), ...dle14(1)];
      case 'bel': return [0x07];
      case 'custom': {
        const hex = String(cfg.custom || '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
        if (hex.length < 2 || hex.length % 2) throw new Error('The custom drawer command is not valid hex (example: 1B 70 00 32 FA).');
        return (hex.match(/../g) || []).map((h) => parseInt(h, 16));
      }
      default: return [...ESC_INIT, ...escP(0), ...escP(1), ...dle14(0), ...dle14(1)]; // auto: both connector pins, both command styles
    }
  }

  /** Direct RS-232 drawers (no printer in between) open on a change of the DTR / RTS line. */
  async function pulseSignals() {
    if (!link || link.kind !== 'serial' || !port || !port.setSignals) throw new Error('Signal pulse needs a Serial / COM connection.');
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(250);
    await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    await sleep(250);
  }

  /** Re-attach to the printer this till already has permission for (unplugged / replugged, sleep, page reload). */
  async function reconnect() {
    try {
      if (cfg.mode === 'serial' && 'serial' in navigator) {
        const ports = await navigator.serial.getPorts();
        if (ports[0]) { await adoptSerial(ports[0], false); return !!link; }
      } else if (cfg.mode === 'usb' && 'usb' in navigator) {
        const devs = await navigator.usb.getDevices();
        const dev = devs.find((d) => !cfg.usb || (d.vendorId === cfg.usb.vendorId && d.productId === cfg.usb.productId));
        if (dev) { await adoptUsb(dev, false); return !!link; }
      }
    } catch (err) { console.warn('CashDrawer: reconnect failed', err); }
    return false;
  }

  async function sendOpen(cmd) {
    if (cmd === 'signal') { await pulseSignals(); return; }
    await write(new Uint8Array(commandBytes(cmd)));
  }

  /** Sends the open pulse. Never reports success unless the bytes really went to the printer; one automatic reconnect + retry on failure. */
  async function open(opts = {}) {
    const cmd = opts.cmd || cfg.cmd || 'auto';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!link && !(await reconnect())) {
        lastError = cfg.mode === 'none' ? 'No printer / drawer is connected to this till. Open Cash drawer settings and connect it.' : 'The printer is not connected (unplugged, switched off, or the browser lost permission). Open Cash drawer settings and connect it again.';
        emit('connection');
        return { ok: false, reason: 'no-device', error: lastError };
      }
      try {
        await sendOpen(cmd);
        lastError = '';
        return { ok: true };
      } catch (err) {
        lastError = err.message || 'The drawer command failed';
        await dropLink();
        emit('connection');
        if (attempt === 1) return { ok: false, reason: 'error', error: lastError };
      }
    }
    return { ok: false, reason: 'error', error: lastError };
  }

  /** Opens the drawer for a sale that needs no change lock (exact cash). Reports a failure so the cashier knows at once. */
  async function kick(info = {}) {
    if (!cfg.enabled) return { ok: false, reason: 'disabled' };
    try { await ready; } catch { /* init errors are already logged */ }
    const res = await open();
    if (!res.ok) emit('error', { error: res.error, info });
    return res;
  }

  /** 'open' | 'closed' | 'unknown' - 'unknown' whenever the printer cannot tell us. */
  async function readState() {
    if (!link) return 'unknown';
    const b = await requestStatus(600);
    // Valid DLE EOT 1 reply: bits 0,1,4,7 are fixed (0,1,1,0).
    if (b == null || (b & 0x93) !== 0x12) {
      missStreak += 1;
      if (missStreak >= 3) senseOk = false;
      return 'unknown';
    }
    missStreak = 0;
    senseOk = true;
    if (cfg.closedBit == null) return 'unknown';
    return ((b & 0x04) ? 1 : 0) === cfg.closedBit ? 'closed' : 'open';
  }

  /** Learn what "closed" looks like for THIS drawer. The drawer must be shut when this runs. */
  async function calibrate() {
    if (!link) throw new Error('Connect the drawer first.');
    const b = await requestStatus(800);
    if (b == null || (b & 0x93) !== 0x12) {
      throw new Error('This printer does not report the drawer state. The "Drawer is closed" button will be used instead.');
    }
    cfg.closedBit = (b & 0x04) ? 1 : 0;
    writeJson(CFG_KEY, cfg);
    senseOk = true;
    missStreak = 0;
    emit('connection');
    return cfg.closedBit;
  }

  /** Setup-screen test: kick the drawer, then report what the sensor sees. */
  async function test(opts = {}) {
    const res = await open(opts);
    if (!res.ok) return { ...res, state: 'unknown' };
    await new Promise((r) => setTimeout(r, 900));
    return { ...res, state: await readState() };
  }

  /* ------------------------------------------------------------------ *
   * The lock: drawer opens for change, POS stays locked until it is closed
   * ------------------------------------------------------------------ */
  function persistLock() { writeJson(LOCK_KEY, lock); }

  async function pulseForLock() {
    const res = await open();
    if (!lock) return res; // released while the pulse was in flight
    lock.phase = res.ok ? 'open' : (res.reason === 'no-device' && cfg.mode === 'none' ? 'manual' : 'failed');
    if (!res.ok) emit('error', { error: res.error });
    lock.sawOpen = false;
    lock.reading = 'unknown';
    if (res.ok) lock.openedAt = Date.now();
    persistLock();
    emit('phase');
    return res;
  }

  /**
   * Called right after a cash sale that has change. Locks the POS and kicks the drawer.
   * info: { change, tendered, due, receiptNumber, saleId }   (KES)
   */
  async function beginChange(info = {}) {
    if (!cfg.enabled) return null; // shop has no drawer: nothing to open, nothing to lock
    if (lock) return getLock();
    lock = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      openedAt: null,
      change: Number(info.change) || 0,
      tendered: Number(info.tendered) || 0,
      due: Number(info.due) || 0,
      receiptNumber: info.receiptNumber || '',
      saleId: info.saleId || '',
      phase: 'opening',
      reading: 'unknown',
      sawOpen: false,
      overdue: false,
      restored: false,
    };
    persistLock();
    startWatch();
    emit('lock');
    await pulseForLock();
    return getLock();
  }

  async function reopen() {
    if (!lock) return { ok: false };
    lock.phase = 'opening';
    persistLock();
    emit('phase');
    return pulseForLock();
  }

  function finish(method, persist = true) {
    if (!lock) return null;
    const now = Date.now();
    const done = {
      ...lock,
      method,
      closedAt: now,
      seconds: Math.max(0, Math.round((now - (lock.openedAt || lock.createdAt)) / 1000)),
    };
    lock = null;
    stopWatch();
    if (persist) persistLock();
    emit('unlock', { done });
    return done;
  }

  /** method: 'sensor' | 'manual' | 'override' | 'restore' */
  function release({ method = 'manual' } = {}) { return finish(method, true); }

  function stopWatch() {
    clearInterval(pollTimer); pollTimer = null;
    clearTimeout(overdueTimer); overdueTimer = null;
  }

  function startWatch() {
    stopWatch();
    if (!lock) return;
    pollTimer = setInterval(tick, POLL_MS);
    if (!lock.overdue) {
      const left = Math.max(0, OVERDUE_MS - (Date.now() - (lock.openedAt || lock.createdAt)));
      overdueTimer = setTimeout(() => {
        if (lock && !lock.overdue) { lock.overdue = true; persistLock(); emit('overdue'); }
      }, left);
    }
  }

  async function tick() {
    if (!lock || ticking || lock.phase === 'opening') return;
    if (!status().canSense) return;
    ticking = true;
    try {
      const st = await readState();
      if (!lock) return;
      const changed = st !== lock.reading;
      lock.reading = st;

      if (st === 'open') {
        lock.sawOpen = true;
        if (lock.phase === 'failed') { lock.phase = 'open'; if (!lock.openedAt) lock.openedAt = Date.now(); }
      }
      if (changed || st === 'open') { persistLock(); }
      if (changed) emit('reading');

      if (st === 'closed') {
        if (lock.sawOpen) finish('sensor');
        else if (lock.restored) finish('restore');
        else if (lock.phase === 'open' && lock.openedAt && Date.now() - lock.openedAt > NO_POP_MS) {
          lock.phase = 'failed';
          persistLock();
          emit('phase');
        }
      }
    } finally {
      ticking = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Setup screen
   * ------------------------------------------------------------------ */
  function openSetup() {
    const modal = window.UI.openModal({
      title: 'Cash drawer',
      maxWidth: '540px',
      bodyHtml: '<div id="cd-body"></div>',
      footerHtml: '<button class="btn btn-primary" data-action="done">Done</button>',
    });
    const body = modal.querySelector('#cd-body');
    let busy = false;

    const run = async (fn) => {
      if (busy) return;
      busy = true;
      try { await fn(); } catch (err) {
        if (err && err.name === 'NotFoundError') return; // user closed the device chooser
        window.UI.toast.error(err.message || 'Something went wrong');
      } finally { busy = false; paint(); }
    };

    function paint() {
      const st = status();
      const senseText = !st.connected
        ? 'Manual mode: the system opens nothing, but still makes the cashier confirm the drawer is closed before the next sale.'
        : st.canSense
          ? 'Close detection: automatic - the POS unlocks by itself when the drawer shuts.'
          : st.calibrated
            ? 'Close detection: the printer is not answering - the "Drawer is closed" button is used.'
            : 'Close detection: not calibrated - the "Drawer is closed" button is used. Close the drawer and tap Calibrate to enable automatic detection.';

      if (!st.enabled) {
        body.innerHTML = `
          <label class="checkbox-row" style="margin-bottom:var(--space-3)">
            <input type="checkbox" id="cd-enabled" />
            <span class="text-sm"><strong>This shop uses a cash drawer</strong></span>
          </label>
          <p class="text-sm text-secondary">Off: no drawer is opened and the POS is never locked - the cashier just sees the change to give. Turn this on only on tills that have a cash drawer.</p>`;
        body.querySelector('#cd-enabled').addEventListener('change', () => run(() => setEnabled(true)));
        return;
      }

      body.innerHTML = `
        <label class="checkbox-row" style="margin-bottom:var(--space-3)">
          <input type="checkbox" id="cd-enabled" checked />
          <span class="text-sm"><strong>This shop uses a cash drawer</strong></span>
        </label>
        ${!st.supported ? '<div class="drawer-setup-note warn">This browser cannot talk to a cash drawer. Use Chrome or Edge on HTTPS (or localhost). Manual mode still works.</div>' : ''}
        <div class="drawer-setup-state ${st.connected ? 'ok' : ''}">
          <span class="drawer-setup-dot"></span>
          <div>
            <strong>${st.connected ? esc(st.label) : 'No drawer hardware connected'}</strong>
            <small>${esc(senseText)}</small>
          </div>
        </div>
        <div class="drawer-setup-actions">
          ${st.usbSupported ? '<button class="btn btn-secondary btn-sm" data-act="usb">Connect USB printer</button>' : ''}
          ${st.serialSupported ? '<button class="btn btn-secondary btn-sm" data-act="serial">Connect Serial / COM</button>' : ''}
          ${st.connected ? '<button class="btn btn-primary btn-sm" data-act="find">Find my drawer</button>' : ''}
          ${st.connected ? '<button class="btn btn-secondary btn-sm" data-act="test">Test open</button>' : ''}
          ${st.connected ? '<button class="btn btn-secondary btn-sm" data-act="calibrate">Calibrate (drawer closed)</button>' : ''}
          ${st.connected ? '<button class="btn btn-ghost btn-sm" data-act="disconnect">Disconnect</button>' : ''}
        </div>
        ${st.lastError ? `<div class="drawer-setup-note warn" style="margin-top:var(--space-3)"><strong>Drawer problem:</strong> ${esc(st.lastError)}</div>` : ''}
        ${st.connected && !st.answering ? '<div class="drawer-setup-note warn" style="margin-top:var(--space-3)">The port is open, but the printer is not answering the status request, so the system cannot confirm the drawer opened. Use <strong>Find my drawer</strong> or <strong>Test open</strong> and watch the drawer.</div>' : ''}
        <div class="form-row" style="margin-top:var(--space-4)">
          <div class="field">
            <label for="cd-cmd">Open command</label>
            <select class="select" id="cd-cmd">
              <option value="auto" ${st.cmd === 'auto' ? 'selected' : ''}>Automatic (ESC/POS, both pins) - recommended</option>
              <option value="pin2" ${st.cmd === 'pin2' ? 'selected' : ''}>ESC/POS pin 2 only</option>
              <option value="pin5" ${st.cmd === 'pin5' ? 'selected' : ''}>ESC/POS pin 5 only</option>
              <option value="dle" ${st.cmd === 'dle' ? 'selected' : ''}>Real-time (DLE DC4)</option>
              <option value="bel" ${st.cmd === 'bel' ? 'selected' : ''}>Bell character (some serial drawers)</option>
              <option value="signal" ${st.cmd === 'signal' ? 'selected' : ''}>DTR / RTS signal (drawer wired straight to COM)</option>
              <option value="custom" ${st.cmd === 'custom' ? 'selected' : ''}>Custom hex bytes</option>
            </select>
          </div>
          <div class="field" ${st.cmd === 'custom' ? '' : 'hidden'} id="cd-custom-wrap">
            <label for="cd-custom">Custom bytes (hex)</label>
            <input class="input" id="cd-custom" value="${esc(st.custom)}" placeholder="1B 70 00 32 FA" />
          </div>
          <div class="field">
            <label for="cd-flow">Flow control</label>
            <select class="select" id="cd-flow">
              <option value="none" ${st.flow !== 'hardware' ? 'selected' : ''}>None (default)</option>
              <option value="hardware" ${st.flow === 'hardware' ? 'selected' : ''}>Hardware (RTS/CTS)</option>
            </select>
            <span class="field-hint">Applied the next time you connect.</span>
          </div>
          <div class="field">
            <label for="cd-baud">Serial speed (baud)</label>
            <select class="select" id="cd-baud">
              ${[9600, 19200, 38400, 57600, 115200].map((b) => `<option value="${b}" ${st.baud === b ? 'selected' : ''}>${b}</option>`).join('')}
            </select>
            <span class="field-hint">Used the next time you connect a serial printer.</span>
          </div>
        </div>
        <p class="text-xs text-muted">The drawer cable must be plugged into the DK / drawer port of the receipt printer. The drawer opens only when a cash sale has change to give back.</p>
      `;

      body.querySelector('#cd-enabled')?.addEventListener('change', () => run(() => setEnabled(false)));
      body.querySelector('[data-act="usb"]')?.addEventListener('click', () => run(async () => { await connectUsb(); window.UI.toast.success('Printer connected'); }));
      body.querySelector('[data-act="serial"]')?.addEventListener('click', () => run(async () => { await connectSerial(); window.UI.toast.success('Printer connected'); }));
      body.querySelector('[data-act="disconnect"]')?.addEventListener('click', () => run(disconnect));
      body.querySelector('[data-act="test"]')?.addEventListener('click', () => run(async () => {
        const r = await test();
        if (!r.ok) throw new Error(r.error || 'The drawer did not respond.');
        if (r.state === 'open') window.UI.toast.success('Drawer opened - the sensor sees it OPEN');
        else if (r.state === 'closed') window.UI.toast.error('Command sent, but the sensor still reads CLOSED. Try "Find my drawer", another Open command, or recalibrate.');
        else window.UI.toast.success(window.confirm('Command sent. Did the drawer open?') ? 'Great - the drawer works' : 'Not opened: use "Find my drawer" to try the other settings.');
      }));
      // Tries every serial speed (and the Automatic command) and asks after each one whether the drawer popped.
      body.querySelector('[data-act="find"]')?.addEventListener('click', () => run(async () => {
        const st0 = status();
        const bauds = st0.kind === 'serial' ? [...new Set([cfg.baud, 9600, 19200, 38400, 115200, 57600])] : [cfg.baud];
        const cmds = st0.kind === 'serial' ? ['auto', 'bel', 'signal'] : ['auto', 'dle'];
        for (const baud of bauds) {
          if (st0.kind === 'serial' && baud !== cfg.baud) { cfg.baud = baud; writeJson(CFG_KEY, cfg); if (port) await adoptSerial(port, false); }
          for (const cmd of cmds) {
            if (!window.confirm(`Trying ${st0.kind === 'serial' ? `${baud} baud, ` : ''}command "${cmd}".\n\nPress OK, then watch the drawer.`)) return;
            const r = await open({ cmd });
            if (!r.ok) { window.UI.toast.error(r.error || 'Could not send the command'); continue; }
            await sleep(900);
            if (window.confirm('Did the drawer OPEN?')) {
              configure({ cmd, baud }); lastError = '';
              window.UI.toast.success(`Found it: ${st0.kind === 'serial' ? `${baud} baud, ` : ''}command "${cmd}" saved.`);
              emit('connection');
              return;
            }
          }
        }
        window.UI.toast.error('The drawer did not open with any setting. Check the cable is in the printer\'s DK / drawer port, the drawer key is not locked, and the drawer has power from the printer.');
      }));
      body.querySelector('[data-act="calibrate"]')?.addEventListener('click', () => run(async () => {
        await calibrate();
        window.UI.toast.success('Calibrated - make sure the drawer was closed. Use Test open to verify.');
      }));
      body.querySelector('#cd-cmd')?.addEventListener('change', (e) => { configure({ cmd: e.target.value }); const w = body.querySelector('#cd-custom-wrap'); if (w) w.hidden = e.target.value !== 'custom'; });
      body.querySelector('#cd-custom')?.addEventListener('change', (e) => configure({ custom: e.target.value }));
      body.querySelector('#cd-flow')?.addEventListener('change', (e) => configure({ flow: e.target.value }));
      body.querySelector('#cd-baud')?.addEventListener('change', (e) => configure({ baud: e.target.value }));
    }

    const off = on((ev) => {
      if (!document.body.contains(modal)) { off(); return; }
      if (ev.type === 'connection') paint();
    });
    modal.querySelector('[data-action="done"]').addEventListener('click', () => { off(); window.UI.closeModal(); });
    paint();
  }

  /* ------------------------------------------------------------------ *
   * Init: reconnect to the printer we already have permission for, restore any lock
   * ------------------------------------------------------------------ */
  async function init() {
    if (!cfg.enabled) { if (readJson(LOCK_KEY)) writeJson(LOCK_KEY, null); return; }
    try {
      if (cfg.mode === 'serial' && 'serial' in navigator) {
        const ports = await navigator.serial.getPorts();
        if (ports[0]) await adoptSerial(ports[0], false);
      } else if (cfg.mode === 'usb' && 'usb' in navigator) {
        const devs = await navigator.usb.getDevices();
        const dev = devs.find((d) => !cfg.usb || (d.vendorId === cfg.usb.vendorId && d.productId === cfg.usb.productId));
        if (dev) await adoptUsb(dev, false);
      }
    } catch (err) {
      console.warn('CashDrawer: could not reconnect automatically', err);
      await dropLink();
    }

    const saved = readJson(LOCK_KEY);
    if (saved && saved.createdAt && Date.now() - saved.createdAt < LOCK_MAX_AGE_MS) {
      lock = { ...saved, restored: true, phase: saved.phase === 'opening' ? 'failed' : saved.phase };
      startWatch();
      emit('lock');
    } else if (saved) {
      writeJson(LOCK_KEY, null);
    }
  }

  // Unplugged printer
  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', () => {
      if (link && link.kind === 'serial') dropLink().then(() => emit('connection'));
    });
  }
  if ('usb' in navigator) {
    navigator.usb.addEventListener('disconnect', (e) => {
      if (link && link.kind === 'usb' && usbDev && e.device === usbDev) dropLink().then(() => emit('connection'));
    });
  }

  // Another POS tab on this device opened / closed the drawer
  window.addEventListener('storage', (e) => {
    if (e.key !== LOCK_KEY) return;
    const next = readJson(LOCK_KEY);
    if (!next && lock) finish('other-tab', false);
    else if (next && !lock) { lock = { ...next, restored: true }; startWatch(); emit('lock'); }
    else if (next && lock) { lock = { ...lock, ...next }; emit('phase'); }
  });

  const ready = init().catch((err) => console.warn('CashDrawer init failed', err));

  window.CashDrawer = {
    ready,
    on,
    status,
    isSupported,
    isLocked,
    isEnabled,
    setEnabled,
    getLock,
    open,
    reopen,
    kick,
    reconnect,
    beginChange,
    release,
    readState,
    connectSerial,
    connectUsb,
    disconnect,
    calibrate,
    test,
    configure,
    openSetup,
  };
})(window);