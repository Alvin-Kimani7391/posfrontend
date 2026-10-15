/**
 * barcode.js - tiny dependency-free Code 128 encoder that draws crisp SVG (prints well, scans at the till).
 *   Barcode.svg('6001234567890', { height: 40, module: 2, quiet: 10 })  -> '<svg ...>'
 * Uses subset C for runs of 4+ digits (compact) and subset B for everything else.
 * Supports printable ASCII 32-126. Anything else is replaced by '?'.
 */
(function (window) {
  const PATTERNS = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112',
  ];
  const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

  function sanitize(text) {
    return String(text == null ? '' : text).replace(/[^\x20-\x7E]/g, '?');
  }

  function encodeValues(text) {
    const t = sanitize(text);
    const out = [];
    let set = null; // 'B' | 'C'
    let i = 0;
    const digitRun = (from) => { let n = 0; while (/\d/.test(t[from + n] || '')) n++; return n; };
    while (i < t.length) {
      const run = digitRun(i);
      const atStart = set === null;
      // Use C for 4+ digits (or 2+ when the whole string is digits and even length at the start).
      const wantC = run >= 4 || (atStart && run === t.length && run >= 2 && run % 2 === 0);
      if (wantC) {
        const pairs = Math.floor(run / 2) * 2;
        if (set !== 'C') { out.push(atStart ? START_C : CODE_C); set = 'C'; }
        for (let k = 0; k < pairs; k += 2) out.push(parseInt(t.substr(i + k, 2), 10));
        i += pairs;
      } else {
        if (set !== 'B') { out.push(atStart ? START_B : CODE_B); set = 'B'; }
        out.push(t.charCodeAt(i) - 32);
        i += 1;
      }
    }
    if (!out.length) out.push(START_B);
    let sum = out[0];
    for (let k = 1; k < out.length; k++) sum += out[k] * k;
    out.push(sum % 103, STOP);
    return out;
  }

  function modules(text) {
    return encodeValues(text).map((v) => PATTERNS[v]).join('');
  }

  /** Widths -> [x, width] bar rectangles in module units. */
  function bars(text) {
    const pat = modules(text);
    const rects = []; let x = 0;
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i]);
      if (i % 2 === 0) rects.push([x, w]);
      x += w;
    }
    return { rects, width: x };
  }

  function svg(text, opts = {}) {
    const module = opts.module || 2, height = opts.height || 40, quiet = opts.quiet == null ? 10 : opts.quiet;
    const { rects, width } = bars(text);
    const totalW = (width + quiet * 2) * module;
    const path = rects.map(([x, w]) => `M${(x + quiet) * module} 0h${w * module}v${height}h${-w * module}z`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${opts.className || 'barcode-svg'}" viewBox="0 0 ${totalW} ${height}" width="${opts.fluid ? '100%' : totalW}" height="${opts.fluid ? '100%' : height}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Barcode ${sanitize(text).replace(/"/g, '')}"><rect width="${totalW}" height="${height}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  window.Barcode = { svg, encodeValues, modules, sanitize };
  if (typeof module !== 'undefined') module.exports = window.Barcode;
})(typeof window !== 'undefined' ? window : globalThis);
