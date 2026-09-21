/**
 * barcode-scanner.js
 * Unified barcode scanning entry point for the whole app. Two independent
 * input methods feed the same pipeline:
 *
 * 1. HARDWARE SCANNER (USB / Bluetooth "HID" scanners) - these devices type
 *    the barcode's characters into whatever currently has focus, at a
 *    speed no human can match on a keyboard, then send Enter. We don't
 *    need any camera or permission for this - we listen globally and use
 *    keystroke timing to tell "a scanner just fired" apart from normal
 *    typing, then hand the decoded string to the caller.
 *
 * 2. PHONE / WEBCAM CAMERA SCANNING - BarcodeScanner.openCameraModal()
 *    opens a full-screen camera viewfinder. Uses the native
 *    BarcodeDetector API when the browser supports it (fast, nothing to
 *    download); otherwise lazy-loads the html5-qrcode library from a CDN
 *    the first time it's actually needed.
 *
 * Usage:
 *   const stop = window.BarcodeScanner.listenHardwareScanner((code) => { ... });
 *   // later, when leaving the view: stop();
 *
 *   window.BarcodeScanner.openCameraModal({
 *     title: 'Scan product barcode',
 *     onDetect: (code) => { ... },
 *     onCancel: () => { ... }, // optional
 *   });
 */
(function (window) {
  const HTML5_QRCODE_SRC = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';

  // Formats we ask the *native* BarcodeDetector for. Retail barcodes are
  // almost always EAN-13/EAN-8/UPC-A/UPC-E; the rest are included for
  // broader compatibility (some businesses print CODE_128/CODE_39/QR on
  // their own labels).
  const SUPPORTED_FORMATS_NATIVE = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'codabar', 'itf', 'qr_code'];

  const CAMERA_ICON_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>' +
    '<circle cx="12" cy="13" r="4"></circle></svg>';

  let html5QrcodeLoadPromise = null;
  function loadHtml5Qrcode() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (html5QrcodeLoadPromise) return html5QrcodeLoadPromise;
    html5QrcodeLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HTML5_QRCODE_SRC;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load the barcode scanner. Check your connection.'));
      document.head.appendChild(script);
    });
    return html5QrcodeLoadPromise;
  }

  function hasNativeDetector() {
    return 'BarcodeDetector' in window;
  }

  function isCameraLikelyAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* -------------------- Hardware scanner (keyboard-wedge) -------------------- */
  /**
   * Listens document-wide for the character-burst pattern a hardware
   * barcode scanner produces (many characters within a very short window,
   * terminated by Enter) and calls onScan(code) when one completes.
   * Ordinary human typing - even fast typing - has gaps well above
   * maxKeystrokeGapMs between keys, so it never accumulates a buffer long
   * enough to fire. Returns an unsubscribe function.
   */
  function listenHardwareScanner(onScan, opts = {}) {
    const maxKeystrokeGapMs = opts.maxKeystrokeGapMs ?? 40;
    const minLength = opts.minLength ?? 4;

    let buffer = '';
    let lastKeyTime = 0;

    function handleKeydown(e) {
      // A modifier combo (Ctrl+V, Cmd+Tab, ...) is never a scanner burst.
      if (e.ctrlKey || e.metaKey || e.altKey) { buffer = ''; return; }

      const now = performance.now();
      const gap = now - lastKeyTime;
      lastKeyTime = now;

      if (gap > maxKeystrokeGapMs) buffer = ''; // too slow to be a scanner - restart the burst

      if (e.key === 'Enter') {
        if (buffer.length >= minLength) {
          const code = buffer;
          buffer = '';
          onScan(code);
        }
        return;
      }

      if (e.key.length === 1) buffer += e.key; // ignore Shift/Tab/arrow keys etc.
    }

    document.addEventListener('keydown', handleKeydown, true);
    return () => document.removeEventListener('keydown', handleKeydown, true);
  }

  /* -------------------- Camera scanning modal -------------------- */
  function openCameraModal({ title = 'Scan barcode', onDetect, onCancel } = {}) {
    if (!isCameraLikelyAvailable()) {
      window.UI?.toast?.error('Camera not available on this device or browser.');
      return null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'scanner-overlay';
    overlay.innerHTML = `
      <div class="scanner-modal">
        <div class="scanner-header">
          <span>${title}</span>
          <button type="button" class="scanner-close" aria-label="Close scanner">${window.Icons?.get ? window.Icons.get('close') : '&times;'}</button>
        </div>
        <div class="scanner-viewport" id="scanner-video-region">
          <div class="scanner-frame"></div>
        </div>
        <div class="scanner-hint" id="scanner-hint">Point the camera at a barcode</div>
      </div>
    `;
    document.body.appendChild(overlay);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let stopped = false;
    let nativeStream = null;
    let nativeRAF = null;
    let html5Instance = null;

    function cleanup() {
      if (stopped) return;
      stopped = true;
      if (nativeRAF) cancelAnimationFrame(nativeRAF);
      if (nativeStream) nativeStream.getTracks().forEach((t) => t.stop());
      if (html5Instance) {
        html5Instance.stop().catch(() => {}).finally(() => { try { html5Instance.clear(); } catch {} });
      }
      document.body.style.overflow = previousOverflow;
      overlay.remove();
    }

    overlay.querySelector('.scanner-close').addEventListener('click', () => { cleanup(); onCancel?.(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); onCancel?.(); } });

    function handleDetected(code) {
      if (stopped) return;
      cleanup();
      onDetect(code);
    }

    async function startNative() {
      const region = overlay.querySelector('#scanner-video-region');
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.muted = true;
      region.insertBefore(video, region.firstChild);

      try {
        nativeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = nativeStream;
        await video.play();

        const detector = new window.BarcodeDetector({ formats: SUPPORTED_FORMATS_NATIVE });

        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length) { handleDetected(codes[0].rawValue); return; }
          } catch {
            // transient decode misses between frames are normal - keep going
          }
          nativeRAF = requestAnimationFrame(tick);
        };
        nativeRAF = requestAnimationFrame(tick);
      } catch (err) {
        if (nativeStream) { nativeStream.getTracks().forEach((t) => t.stop()); nativeStream = null; }
        region.removeChild(video);
        throw err;
      }
    }

    async function startFallback() {
      const hint = overlay.querySelector('#scanner-hint');
      hint.textContent = 'Loading scanner…';
      try {
        await loadHtml5Qrcode();
      } catch (err) {
        hint.textContent = err.message;
        return;
      }
      if (stopped) return;
      hint.textContent = 'Point the camera at a barcode';

      const region = overlay.querySelector('#scanner-video-region');
      const innerId = 'scanner-html5-inner';
      let inner = region.querySelector(`#${innerId}`);
      if (!inner) {
        inner = document.createElement('div');
        inner.id = innerId;
        region.insertBefore(inner, region.firstChild);
      }

      const Formats = window.Html5QrcodeSupportedFormats;
      html5Instance = new window.Html5Qrcode(innerId, {
        formatsToSupport: [
          Formats.EAN_13, Formats.EAN_8, Formats.UPC_A, Formats.UPC_E,
          Formats.CODE_128, Formats.CODE_39, Formats.CODABAR, Formats.ITF, Formats.QR_CODE,
        ],
        verbose: false,
      });

      try {
        await html5Instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 160 } },
          (decodedText) => handleDetected(decodedText),
          () => {} // per-frame decode failure - expected constantly, ignore
        );
      } catch (err) {
        hint.textContent = 'Could not start the camera: ' + err.message;
      }
    }

    if (hasNativeDetector()) {
      startNative().catch(() => { if (!stopped) startFallback(); });
    } else {
      startFallback();
    }

    return cleanup;
  }

  window.BarcodeScanner = {
    listenHardwareScanner,
    openCameraModal,
    isCameraLikelyAvailable,
    hasNativeDetector,
    cameraIconSvg: CAMERA_ICON_SVG,
  };
})(window);