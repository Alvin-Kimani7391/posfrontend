/**
 * charts.js
 * Small, dependency-free chart kit used by the dashboard and reports pages.
 * No CDN, no build step - so charts keep working when the shop's internet is
 * down (the POS is meant to survive that).
 *
 * SIZE: bar()/waterfall() height and donut() diameter are now treated as
 * floors, not close-to-final numbers - on anything wider than a phone they
 * always render at a substantial minimum size and grow further on wide
 * cards, regardless of the (often small) height/size a caller passes in.
 * responsive() still waits for real layout before measuring width and
 * keeps redrawing on resize (donut() included).
 */
(function (window) {
  const PALETTE = [
    'var(--color-primary)', '#f59e0b', '#10b981', '#8b5cf6', '#06b6d4',
    '#ec4899', '#ef4444', '#64748b', '#84cc16', '#f97316',
  ];
  const esc = (s) => window.UI.escapeHtml(s);

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function trim1(n) { return n.toFixed(1).replace(/\.0$/, ''); }

  /** 1 250 000 -> "1.3M", 45 000 -> "45K", 820 -> "820" */
  function compact(n) {
    const v = Number(n) || 0;
    const a = Math.abs(v);
    if (a >= 1e9) return `${trim1(v / 1e9)}B`;
    if (a >= 1e6) return `${trim1(v / 1e6)}M`;
    if (a >= 1e4) return `${trim1(v / 1e3)}K`;
    return Math.round(v).toLocaleString('en-KE');
  }

  function trunc(s, n) {
    const str = String(s == null ? '' : s);
    return str.length > n ? `${str.slice(0, Math.max(n - 1, 1))}…` : str;
  }

  function emptyHtml(text) {
    return `<div class="chart-empty">${esc(text || 'No data for this period')}</div>`;
  }

  function isSmallViewport() {
    return typeof window !== 'undefined' && window.innerWidth && window.innerWidth < 480;
  }

  /** How tall a bar/waterfall chart should be for a given container width.
   * The caller's `height` is now treated as a minimum, not a target - on
   * anything wider than a phone this always renders at least 440px tall,
   * growing further on genuinely wide cards, instead of quietly staying
   * at whatever (often small) number reports.js/dashboard.js passed in. */
  function chartHeight(requestedHeight, containerW) {
    if (isSmallViewport()) return Math.max(260, Math.min(Math.round(containerW * 0.85), 380));
    return Math.max(requestedHeight, 440, Math.min(Math.round(containerW * 0.5), 560));
  }

  /** Same idea for the donut/pie diameter: the caller's `size` is a floor,
   * not a ceiling. Previously this only ever shrank a fixed size (300/260)
   * down to fit a narrow container - it never grew on a wide one, which is
   * why donuts looked small on a laptop even after the resize fix. */
  function donutSize(requestedSize, containerW) {
    if (isSmallViewport()) return Math.max(190, Math.min(containerW - 16, 280));
    const capByContainer = Math.max(200, Math.round(containerW * 0.6)); // leave room for the legend beside it
    return Math.max(requestedSize, 340, Math.min(capByContainer, 460));
  }

  function niceNum(x, round) {
    const exp = Math.floor(Math.log10(x));
    const f = x / Math.pow(10, exp);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  /** Friendly axis: returns { min, max, ticks[] } that always contain the data. */
  function niceScale(min, max, count = 5) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (max === min) max = min + 1;
    const range = niceNum(max - min, false);
    const step = niceNum(range / (count - 1), true);
    const nmin = Math.floor(min / step) * step;
    const nmax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = nmin; v <= nmax + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { min: nmin, max: nmax, step, ticks };
  }

  /**
   * Runs draw(width) once layout has actually settled, and again whenever
   * the container's width changes. The first measurement is deferred two
   * animation frames: innerHTML is usually set synchronously right before
   * this runs, and clientWidth can read 0 (or a stale pre-layout value) in
   * that same tick - without this, charts fall back to a fixed width and
   * never recover even though the real container is much wider.
   */
  function responsive(container, draw) {
    let lastW = -1;
    let ro = null;
    const run = () => {
      if (!container.isConnected) { if (ro) ro.disconnect(); return; }
      const w = Math.floor(container.clientWidth) || 0;
      if (w && w !== lastW) { lastW = w; draw(w); }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        run();
        if (lastW <= 0) {
          const w = Math.floor(container.clientWidth) || 560;
          lastW = w;
          draw(w);
        }
        if (window.ResizeObserver && !ro) { ro = new ResizeObserver(run); ro.observe(container); }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Tooltip (one shared element). Works with mouse, pen and touch.
   * ------------------------------------------------------------------ */
  let tipEl = null;
  let tipTimer = null;

  function ensureTip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tooltip';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
      window.addEventListener('scroll', hideTip, { passive: true, capture: true });
    }
    return tipEl;
  }

  function placeTip(x, y) {
    const t = ensureTip();
    const pad = 14;
    const r = t.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
    if (left < 8) left = 8;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
    if (top < 8) top = 8;
    t.style.transform = `translate(${left}px, ${top}px)`;
  }

  function showTip(html, x, y) {
    const t = ensureTip();
    clearTimeout(tipTimer);
    t.innerHTML = html;
    t.classList.add('show');
    placeTip(x, y);
  }

  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

  /** Any element with data-tip="<escaped html>" inside root gets a tooltip. */
  function attachTips(root) {
    root.querySelectorAll('[data-tip]').forEach((node) => {
      const html = node.getAttribute('data-tip');
      node.addEventListener('pointerenter', (e) => showTip(html, e.clientX, e.clientY));
      node.addEventListener('pointermove', (e) => placeTip(e.clientX, e.clientY));
      node.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'touch') { clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 2200); }
        else hideTip();
      });
    });
  }

  function legendHtml(series) {
    if (series.length < 2) return '';
    return `<div class="chart-legend">${series.map((s, i) =>
      `<span><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${esc(s.name || '')}</span>`).join('')}</div>`;
  }

  /** Shared axis + grid for the bar and waterfall charts. */
  function layout(W, H, scale, format) {
    const tickText = scale.ticks.map((t) => String(format(t)));
    const left = Math.max(...tickText.map((t) => t.length)) * 8.6 + 22;
    const m = { t: 26, r: 18, b: 50, l: left };
    const ih = H - m.t - m.b;
    const y = (v) => m.t + ih * (1 - (v - scale.min) / (scale.max - scale.min));
    let grid = '';
    scale.ticks.forEach((t, i) => {
      const ty = y(t);
      grid += `<line class="ch-grid${t === 0 ? ' zero' : ''}" x1="${m.l}" x2="${W - m.r}" y1="${ty}" y2="${ty}"/>`
        + `<text class="ch-tick" x="${m.l - 10}" y="${ty + 5}" text-anchor="end">${esc(tickText[i])}</text>`;
    });
    return { m, iw: W - m.l - m.r, ih, y, y0: y(0), grid };
  }

  /* ------------------------------------------------------------------ *
   * Vertical bars (single or grouped series, negative values allowed)
   * ------------------------------------------------------------------ */
  function bar(container, opts) {
    const { labels = [], series = [], format = compact, height = 420, ariaLabel = 'Bar chart' } = opts;
    const tipFormat = opts.tipFormat || format;

    if (!labels.length || series.every((s) => s.values.every((v) => !v))) {
      container.innerHTML = emptyHtml(opts.emptyText);
      return;
    }
    const showValues = opts.showValues != null ? opts.showValues : labels.length * series.length <= 8;
    const minBand = Math.max(52, 30 + series.length * 26);

    responsive(container, (containerW) => {
      const h = chartHeight(height, containerW);
      const all = series.flatMap((s) => s.values);
      const scale = niceScale(Math.min(0, ...all), Math.max(0, ...all), 5);
      const probe = layout(containerW, h, scale, format);
      const requiredW = probe.m.l + probe.m.r + labels.length * minBand;
      const W = Math.max(containerW, requiredW);
      const { m, iw, ih, y, y0, grid } = layout(W, h, scale, format);
      const band = iw / labels.length;
      const inner = Math.min(band * 0.74, 96 * series.length);
      const bw = inner / series.length;
      const maxChars = Math.max(3, Math.floor(band / 7.8));

      let bars = '';
      let xl = '';
      let hits = '';
      labels.forEach((lab, i) => {
        const bx = m.l + band * i + (band - inner) / 2;
        const tip = `<strong>${esc(lab)}</strong>${series.map((s, si) => {
          const c = (s.colors && s.colors[i]) || s.color || PALETTE[si % PALETTE.length];
          return `<div class="tt-row"><i style="background:${c}"></i><span>${esc(s.name || '')}</span><b>${esc(tipFormat(s.values[i] || 0))}</b></div>`;
        }).join('')}`;

        series.forEach((s, si) => {
          const v = s.values[i] || 0;
          const c = (s.colors && s.colors[i]) || s.color || PALETTE[si % PALETTE.length];
          const top = Math.min(y(v), y0);
          const hgt = v ? Math.max(Math.abs(y(v) - y0), 2) : 0;
          const x = bx + bw * si + 1;
          bars += `<rect class="ch-bar" x="${x}" y="${top}" width="${Math.max(bw - 3, 1)}" height="${hgt}" rx="5" `
            + `style="fill:${c};transform-origin:0 ${y0}px;animation-delay:${i * 45}ms"/>`;
          if (showValues && v) {
            bars += `<text class="ch-val" x="${x + Math.max(bw - 3, 1) / 2}" y="${v >= 0 ? top - 8 : top + hgt + 16}" text-anchor="middle">${esc(format(v))}</text>`;
          }
        });
        xl += `<text class="ch-tick" x="${m.l + band * i + band / 2}" y="${h - m.b + 26}" text-anchor="middle">${esc(trunc(lab, maxChars))}</text>`;
        hits += `<rect class="ch-hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" data-tip="${esc(tip)}"/>`;
      });

      container.innerHTML = `${legendHtml(series)}<div class="chart-scroll"><svg class="chart-svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(ariaLabel)}">${grid}${bars}${xl}${hits}</svg></div>`;
      attachTips(container);
    });
  }

  /* ------------------------------------------------------------------ *
   * Waterfall (revenue -> costs -> profit style walk)
   * ------------------------------------------------------------------ */
  function waterfall(container, opts) {
    const { steps = [], format = compact, height = 420, ariaLabel = 'Waterfall chart' } = opts;
    const tipFormat = opts.tipFormat || format;
    if (!steps.length) { container.innerHTML = emptyHtml(opts.emptyText); return; }
    const minBand = 92;

    responsive(container, (containerW) => {
      const h = chartHeight(height, containerW);
      let run = 0;
      const bars = steps.map((s) => {
        let from;
        let to;
        if (s.kind === 'total') { from = 0; to = s.value; run = s.value; }
        else { from = run; to = run + s.value; run = to; }
        return { ...s, from, to, end: run };
      });
      const vals = bars.flatMap((b) => [b.from, b.to]);
      const scale = niceScale(Math.min(0, ...vals), Math.max(0, ...vals), 5);
      const probe = layout(containerW, h, scale, format);
      const requiredW = probe.m.l + probe.m.r + bars.length * minBand;
      const W = Math.max(containerW, requiredW);
      const { m, iw, y, grid } = layout(W, h, scale, format);
      const band = iw / bars.length;
      const bw = Math.min(band * 0.6, 120);
      const maxChars = Math.max(4, Math.floor(band / 7.8));

      let out = '';
      let xl = '';
      let links = '';
      bars.forEach((b, i) => {
        const x = m.l + band * i + (band - bw) / 2;
        const yA = y(b.from);
        const yB = y(b.to);
        const top = Math.min(yA, yB);
        const hgt = Math.max(Math.abs(yA - yB), 2);
        const color = b.color || (b.kind === 'total' ? (b.value >= 0 ? 'var(--color-primary)' : 'var(--color-danger)') : (b.value < 0 ? '#f59e0b' : '#10b981'));
        const label = b.kind === 'total' ? tipFormat(b.value) : `${b.value < 0 ? '−' : '+'}${tipFormat(Math.abs(b.value))}`;
        const tip = `<strong>${esc(b.label)}</strong><div class="tt-row"><span>${b.kind === 'total' ? 'Amount' : 'Change'}</span><b>${esc(label)}</b></div>`
          + (b.kind === 'total' ? '' : `<div class="tt-row"><span>Running total</span><b>${esc(tipFormat(b.end))}</b></div>`);
        out += `<rect class="ch-bar" x="${x}" y="${top}" width="${bw}" height="${hgt}" rx="5" style="fill:${color};transform-origin:0 ${y(0)}px;animation-delay:${i * 90}ms" data-tip="${esc(tip)}"/>`;
        const shown = b.kind === 'total' ? format(b.value) : `${b.value < 0 ? '−' : '+'}${format(Math.abs(b.value))}`;
        const up = b.to >= b.from;
        out += `<text class="ch-val" x="${x + bw / 2}" y="${up ? top - 8 : top + hgt + 16}" text-anchor="middle">${esc(shown)}</text>`;
        xl += `<text class="ch-tick" x="${m.l + band * i + band / 2}" y="${h - m.b + 26}" text-anchor="middle">${esc(trunc(b.label, maxChars))}</text>`;
        if (i < bars.length - 1) {
          const ny = y(b.end);
          links += `<line class="ch-link" x1="${x + bw}" x2="${m.l + band * (i + 1) + (band - bw) / 2}" y1="${ny}" y2="${ny}"/>`;
        }
      });

      container.innerHTML = `<div class="chart-scroll"><svg class="chart-svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(ariaLabel)}">${grid}${links}${out}${xl}</svg></div>`;
      attachTips(container);
    });
  }

  /* ------------------------------------------------------------------ *
   * Horizontal bars - HTML so long names wrap/ellipsis nicely on phones
   * ------------------------------------------------------------------ */
  function hbar(container, opts) {
    const { data = [], format = compact, ranked = false } = opts;
    if (!data.length || data.every((d) => !d.value)) { container.innerHTML = emptyHtml(opts.emptyText); return; }
    const max = Math.max(...data.map((d) => Math.max(d.value, 0)), 1);

    const rows = data.map((d, i) => {
      const w = Math.max((Math.max(d.value, 0) / max) * 100, d.value > 0 ? 1.5 : 0);
      const color = d.color || PALETTE[i % PALETTE.length];
      const tip = `<strong>${esc(d.label)}</strong><div class="tt-row"><span>${esc(opts.valueLabel || 'Value')}</span><b>${esc(format(d.value))}</b></div>${d.sub ? `<div class="tt-sub">${esc(d.sub)}</div>` : ''}`;
      return `
        <div class="hbar-row" data-tip="${esc(tip)}">
          <div class="hbar-head">
            ${ranked ? `<span class="hbar-rank">${i + 1}</span>` : ''}
            <span class="hbar-label" title="${esc(d.label)}">${esc(d.label)}${d.sub ? `<small>${esc(d.sub)}</small>` : ''}</span>
            <span class="hbar-value">${esc(format(d.value))}</span>
          </div>
          <div class="hbar-track"><div class="hbar-fill" style="--w:${w}%;background:${color};transition-delay:${i * 50}ms"></div></div>
        </div>`;
    }).join('');

    container.innerHTML = `<div class="hbar-list">${rows}</div>`;
    attachTips(container);
    const list = container.firstElementChild;
    requestAnimationFrame(() => requestAnimationFrame(() => list.classList.add('in')));
  }

  /* ------------------------------------------------------------------ *
   * Donut / pie - resize-aware, and now grows to fill a wide card instead
   * of only ever shrinking to fit a narrow one.
   * ------------------------------------------------------------------ */
  function donut(container, opts) {
    const { data = [], format = compact, inner = 0.62, centerLabel = 'Total', maxSlices = 7, ariaLabel = 'Share chart' } = opts;
    const centerFormat = opts.centerFormat || compact;
    const tipFormat = opts.tipFormat || format;
    const requestedSize = opts.size || 300;

    let items = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    if (!items.length) { container.innerHTML = emptyHtml(opts.emptyText); return; }
    if (items.length > maxSlices) {
      const rest = items.slice(maxSlices - 1);
      items = items.slice(0, maxSlices - 1).concat({ label: 'Others', value: rest.reduce((s, d) => s + d.value, 0), color: '#94a3b8' });
    }
    const total = items.reduce((s, d) => s + d.value, 0);

    responsive(container, (containerW) => {
      const size = donutSize(requestedSize, containerW);
      const r = size / 2 - 10;
      const cx = size / 2;
      const cy = size / 2;
      const ri = r * inner;
      const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];

      let a0 = -Math.PI / 2;
      const paths = items.map((d, i) => {
        const frac = d.value / total;
        const a1 = a0 + Math.min(frac, 0.99999) * 2 * Math.PI;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const [x0, y0] = pt(r, a0);
        const [x1, y1] = pt(r, a1);
        let path;
        if (ri > 0) {
          const [x2, y2] = pt(ri, a1);
          const [x3, y3] = pt(ri, a0);
          path = `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 ${large} 0 ${x3} ${y3}Z`;
        } else {
          path = `M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}Z`;
        }
        a0 = a1;
        const color = d.color || PALETTE[i % PALETTE.length];
        const tip = `<strong>${esc(d.label)}</strong><div class="tt-row"><span>Amount</span><b>${esc(tipFormat(d.value))}</b></div><div class="tt-row"><span>Share</span><b>${(frac * 100).toFixed(1)}%</b></div>`;
        return `<path class="dn-slice" d="${path}" style="fill:${color};transform-origin:${cx}px ${cy}px" data-tip="${esc(tip)}"/>`;
      }).join('');

      const center = ri > 0
        ? `<text class="dn-cv" x="${cx}" y="${cy + 6}" text-anchor="middle">${esc(centerFormat(total))}</text><text class="dn-cl" x="${cx}" y="${cy + 28}" text-anchor="middle">${esc(centerLabel)}</text>`
        : '';

      const legend = items.map((d, i) => `
        <li data-i="${i}">
          <i style="background:${d.color || PALETTE[i % PALETTE.length]}"></i>
          <span class="lbl" title="${esc(d.label)}">${esc(d.label)}</span>
          <span class="val">${esc(format(d.value))}</span>
          <span class="pct">${((d.value / total) * 100).toFixed(1)}%</span>
        </li>`).join('');

      container.innerHTML = `
        <div class="donut-wrap">
          <svg class="dn-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(ariaLabel)}">${paths}${center}</svg>
          <ul class="dn-legend">${legend}</ul>
        </div>`;
      attachTips(container);

      const svg = container.querySelector('.dn-svg');
      const cv = svg.querySelector('.dn-cv');
      const cl = svg.querySelector('.dn-cl');
      const slices = svg.querySelectorAll('.dn-slice');
      const lis = container.querySelectorAll('.dn-legend li');
      const activate = (i) => {
        slices.forEach((p, k) => p.classList.toggle('active', k === i));
        lis.forEach((l, k) => l.classList.toggle('active', k === i));
        svg.classList.add('has-active');
        if (cv) { cv.textContent = `${((items[i].value / total) * 100).toFixed(1)}%`; cl.textContent = trunc(items[i].label, 18); }
      };
      const reset = () => {
        slices.forEach((p) => p.classList.remove('active'));
        lis.forEach((l) => l.classList.remove('active'));
        svg.classList.remove('has-active');
        if (cv) { cv.textContent = centerFormat(total); cl.textContent = centerLabel; }
      };
      slices.forEach((p, i) => { p.addEventListener('pointerenter', () => activate(i)); p.addEventListener('pointerleave', reset); });
      lis.forEach((l, i) => { l.addEventListener('pointerenter', () => activate(i)); l.addEventListener('pointerleave', reset); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Ring gauge for percentages (margins, ratios)
   * ------------------------------------------------------------------ */
  function gauge(container, opts) {
    const { value = 0, label = '', sub = '', color = 'var(--color-primary)' } = opts;
    const r = 62;
    const C = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, value));
    const off = C * (1 - v / 100);
    container.innerHTML = `
      <div class="gauge">
        <svg viewBox="0 0 160 160" role="img" aria-label="${esc(label)} ${value.toFixed(1)}%">
          <circle class="g-track" cx="80" cy="80" r="${r}"/>
          <circle class="g-arc" cx="80" cy="80" r="${r}" transform="rotate(-90 80 80)" style="stroke:${color};stroke-dasharray:${C};stroke-dashoffset:${C}"/>
          <text class="g-val" x="80" y="88" text-anchor="middle" ${value < 0 ? 'style="fill:var(--color-danger)"' : ''}>${value.toFixed(1)}%</text>
        </svg>
        <div class="g-label">${esc(label)}</div>
        ${sub ? `<div class="g-sub">${esc(sub)}</div>` : ''}
      </div>`;
    const arc = container.querySelector('.g-arc');
    requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = off; }));
  }

  /* ------------------------------------------------------------------ *
   * One-line stacked bar (share of a whole)
   * ------------------------------------------------------------------ */
  function stackbar(container, opts) {
    const { segments = [], format = compact } = opts;
    const segs = segments.filter((s) => s.value > 0);
    const total = segs.reduce((s, d) => s + d.value, 0);
    if (!total) { container.innerHTML = emptyHtml(opts.emptyText); return; }

    const bar = segs.map((s, i) => {
      const pct = (s.value / total) * 100;
      const tip = `<strong>${esc(s.label)}</strong><div class="tt-row"><span>Amount</span><b>${esc(format(s.value))}</b></div><div class="tt-row"><span>Share</span><b>${pct.toFixed(1)}%</b></div>`;
      return `<div class="sb-seg" style="width:${pct}%;background:${s.color || PALETTE[i % PALETTE.length]}" data-tip="${esc(tip)}">${pct >= 9 ? `<span>${pct.toFixed(0)}%</span>` : ''}</div>`;
    }).join('');
    const legend = segs.map((s, i) => `<span><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${esc(s.label)} <b>${esc(format(s.value))}</b></span>`).join('');
    container.innerHTML = `<div class="stackbar">${bar}</div><div class="chart-legend">${legend}</div>`;
    attachTips(container);
  }

  window.Charts = { bar, hbar, donut, waterfall, gauge, stackbar, compact, PALETTE };
})(window);