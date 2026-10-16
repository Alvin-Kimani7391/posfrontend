/**
 * country-flag.js - drop-in dashboard module (no framework, no build step).
 *
 *  1. Shows the business's flag (Kenya / Tanzania) + currency in the dashboard header.
 *  2. If the business has not chosen its country yet (every account that existed before Tanzania support),
 *     the OWNER gets a one-time "Choose your country" window. Other roles are told to ask the owner.
 *
 * (In this app app-shell.js loads it automatically; the setup below is for other pages.)
 * Flags are drawn from inline SVG (no flagcdn.com): they work offline and under a strict CSP.
 *
 * Setup (add to the dashboard page, after the page has the user's access token):
 *
 *   <link rel="stylesheet" href="country-flag.css">
 *   <span id="country-flag"></span>            <!-- optional: put it where the flag should appear -->
 *   <script>
 *     window.POS_COUNTRY = {
 *       apiBase: '/api/v1',                                  // or 'https://your-backend.example.com/api/v1'
 *       getToken: () => localStorage.getItem('accessToken'), // <-- change to however YOUR app stores the token
 *     };
 *   </script>
 *   <script src="country-flag.js" defer></script>
 *
 * Other scripts can read the result:  window.POS_COUNTRY_INFO  -> { code, name, currency, language, ... }
 * and listen for the event:           document.addEventListener('pos:country', (e) => e.detail)
 * Format money in the business currency:  PosMoney.format(centsOrDecimal, { cents: true })
 */
(function () {
  'use strict';
  var cfg = Object.assign({ apiBase: (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || '/api/v1', getToken: function () { return (window.Storage && window.Storage.getAccessToken && window.Storage.getAccessToken()) || localStorage.getItem('pos.accessToken'); }, mount: '#country-flag', reloadAfterChange: true }, window.POS_COUNTRY || {});
  var COUNTRIES = {
    KE: { name: 'Kenya', flagCode: 'ke', currency: 'KES', language: 'en', note: 'Kenya shillings (KES)' },
    TZ: { name: 'Tanzania', flagCode: 'tz', currency: 'TZS', language: 'sw', note: 'Tanzanian shillings (TZS)' },
  };
  var LABELS = {
    en: { title: 'Choose your country', body: 'This sets your currency, notes and coins at shift close, tax labels, receipts and subscription billing. Pick the country your business operates in.', language: 'Language', save: 'Continue', saving: 'Saving…', owner: 'The business owner must choose the country before you continue. Please ask them to open the dashboard.', failed: 'Could not save. Please try again.', keepKenya: 'Keep Kenya (KES)', askSupport: 'Ask support to move us to Tanzania', ticketSent: 'Request sent. Support will contact you. Meanwhile you can keep using Kenya (KES).', ticketFail: 'Could not send the request. Open Tickets and describe it.', lockedNote: 'Your business already has money records in Kenya shillings, so the country cannot be switched automatically.' },
    sw: { title: 'Chagua nchi yako', body: 'Hii huamua sarafu, noti na sarafu za kufunga zamu, lebo za kodi, risiti na malipo ya usajili. Chagua nchi ambayo biashara yako inafanyia kazi.', language: 'Lugha', save: 'Endelea', saving: 'Inahifadhi…', owner: 'Mmiliki wa biashara lazima achague nchi kabla ya kuendelea. Tafadhali mwombe afungue dashibodi.', failed: 'Imeshindwa kuhifadhi. Jaribu tena.', keepKenya: 'Endelea na Kenya (KES)', askSupport: 'Omba msaada wa kuhamia Tanzania', ticketSent: 'Ombi limetumwa. Msaada watawasiliana nawe. Kwa sasa unaweza kuendelea kutumia Kenya (KES).', ticketFail: 'Imeshindwa kutuma ombi. Fungua Tiketi na ueleze.', lockedNote: 'Biashara yako tayari ina rekodi za pesa kwa shilingi za Kenya, kwa hiyo nchi haiwezi kubadilishwa kiotomatiki.' },
  };

  // Inline flags (data: URIs): no network, no third-party host. Simplified but recognisable.
  var FLAG_SVG = {
    ke: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 40'><rect width='60' height='40' fill='#fff'/><rect width='60' height='11' fill='#000'/><rect y='14.5' width='60' height='11' fill='#bb0000'/><rect y='29' width='60' height='11' fill='#006600'/><ellipse cx='30' cy='20' rx='5.5' ry='10' fill='#bb0000'/><ellipse cx='30' cy='20' rx='2' ry='7' fill='#000'/><ellipse cx='30' cy='20' rx='.9' ry='7' fill='#fff'/></svg>",
    tz: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 40'><rect width='60' height='40' fill='#1eb53a'/><polygon points='0,40 60,0 60,40' fill='#00a3dd'/><polygon points='0,40 0,31 51,0 60,0 60,9 9,40' fill='#fcd116'/><polygon points='0,40 0,35.5 55.5,0 60,0 60,4.5 4.5,40' fill='#000'/></svg>",
  };
  function flagUrl(code) {
    var svg = FLAG_SVG[String(code).toLowerCase()] || FLAG_SVG.ke;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function api(method, path, body) {
    var token = ''; try { token = cfg.getToken() || ''; } catch (e) { /* storage blocked */ }
    return fetch(cfg.apiBase + path, {
      method: method, credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, (function () { try { var l = localStorage.getItem('pos.lang'); return l ? { 'X-Lang': l } : {}; } catch (e) { return {}; } })(), token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) { var e = new Error(j.message || 'Request failed'); e.code = j.code; throw e; } return j.data; }); });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  /* ------------------------------ flag badge ------------------------------ */
  function renderBadge(info) {
    var old = document.querySelector('.cf-badge'); if (old) old.remove();
    var c = COUNTRIES[info.code] || COUNTRIES.KE;
    var badge = el('span', { class: 'cf-badge', title: info.name + ' - ' + info.currency, 'aria-label': info.name + ', ' + info.currency }, [
      el('img', { src: flagUrl(info.flagCode || c.flagCode), alt: info.name + ' flag', width: '24', height: '16' }),
      el('span', { text: info.code }), el('small', { text: info.currency }),
    ]);
    var mount = document.querySelector(cfg.mount);
    if (mount) mount.appendChild(badge); else { badge.classList.add('cf-floating'); document.body.appendChild(badge); }
  }

  /* --------------------------- one-time country prompt --------------------------- */
  function promptCountry(isOwner, lang) {
    var L = LABELS[lang] || LABELS.en;
    var chosen = null; var language = null;
    var err = el('p', { class: 'cf-error', hidden: 'hidden' });
    var save = el('button', { type: 'button', text: L.save, disabled: 'disabled' });
    var langSel = el('select', { 'aria-label': L.language }, [el('option', { value: 'en', text: 'English' }), el('option', { value: 'sw', text: 'Kiswahili' })]);
    var cards = {};
    var choices = el('div', { class: 'cf-choices' });
    Object.keys(COUNTRIES).forEach(function (code) {
      var c = COUNTRIES[code];
      var b = el('button', { type: 'button', class: 'cf-choice', 'data-code': code }, [
        el('img', { src: flagUrl(c.flagCode, 80), alt: c.name + ' flag' }), el('strong', { text: c.name }), el('span', { text: c.note }),
      ]);
      b.addEventListener('click', function () {
        chosen = code; Object.keys(cards).forEach(function (k) { cards[k].classList.toggle('cf-on', k === code); });
        if (!language) { langSel.value = c.language; } save.removeAttribute('disabled');
      });
      cards[code] = b; choices.appendChild(b);
    });
    langSel.addEventListener('change', function () { language = langSel.value; });
    var lockBox = el('div', { class: 'cf-lock', hidden: 'hidden' });
    function finish() {
      var l = langSel.value;
      var done = function () { var bd = document.querySelector('.cf-backdrop'); if (bd) bd.remove(); if (cfg.reloadAfterChange) location.reload(); else init(); };
      // Also save it as THIS person's own language (their account + this device), then continue.
      Promise.resolve(window.I18n && window.I18n.setLanguage ? window.I18n.setLanguage(l) : null).then(done, done);
    }
    function showLocked(message) {
      err.hidden = true; lockBox.hidden = false; lockBox.textContent = '';
      lockBox.appendChild(el('p', { text: L.lockedNote + ' ' + (message || '') }));
      var keep = el('button', { type: 'button', class: 'cf-secondary', text: L.keepKenya });
      var ask = el('button', { type: 'button', class: 'cf-secondary', text: L.askSupport });
      keep.addEventListener('click', function () {
        keep.disabled = true;
        api('PUT', '/business/country', { countryCode: 'KE', language: langSel.value }).then(finish).catch(function (e) { keep.disabled = false; err.textContent = e.message || L.failed; err.hidden = false; });
      });
      ask.addEventListener('click', function () {
        ask.disabled = true;
        var biz = (window.Storage && window.Storage.getUser && window.Storage.getUser()) || {};
        var desc = 'Please move our business to Tanzania (TZS). The country picker refused because we already have records stored in Kenya shillings. Owner: ' + (biz.name || '') + ' ' + (biz.phone || '') + '. Business: ' + (biz.businessId || '') + '.';
        var fd = new FormData(); fd.append('subject', 'Move business to Tanzania (TZS)'); fd.append('description', desc); fd.append('category', 'OTHER'); fd.append('priority', 'HIGH');
        var send = window.Api && window.Api.upload ? window.Api.upload('/tickets', fd) : Promise.reject(new Error('no api'));
        send.then(function () { lockBox.appendChild(el('p', { class: 'cf-ok', text: L.ticketSent })); }).catch(function () { ask.disabled = false; lockBox.appendChild(el('p', { class: 'cf-error', text: L.ticketFail })); });
      });
      lockBox.appendChild(el('div', { class: 'cf-actions' }, [keep, ask]));
    }
    save.addEventListener('click', function () {
      if (!chosen) return;
      err.hidden = true; lockBox.hidden = true; save.disabled = true; save.textContent = L.saving;
      api('PUT', '/business/country', { countryCode: chosen, language: langSel.value })
        .then(finish)
        .catch(function (e) {
          save.disabled = false; save.textContent = L.save;
          if (e.code === 'COUNTRY_LOCKED' || e.code === 'COUNTRY_LOCKED_BILLING') return showLocked(e.message);
          err.textContent = e.message || L.failed; err.hidden = false;
        });
    });
    var body = isOwner
      ? [el('h2', { text: L.title }), el('p', { text: L.body }), choices, el('label', { class: 'cf-lang' }, [el('span', { text: L.language + ':' }), langSel]), err, lockBox, el('div', { class: 'cf-actions' }, [save])]
      : [el('h2', { text: L.title }), el('p', { text: L.owner })];
    var modal = el('div', { class: 'cf-modal', role: 'dialog', 'aria-modal': 'true' }, body);
    document.body.appendChild(el('div', { class: 'cf-backdrop' }, [modal]));
  }

  /* --------------------------------- money --------------------------------- */
  window.PosMoney = {
    currency: function () { return (window.POS_COUNTRY_INFO && window.POS_COUNTRY_INFO.currency) || 'KES'; },
    // Amounts from the billing API are integer cents ({ cents: true }); other endpoints return decimals.
    format: function (value, opts) {
      opts = opts || {}; var cur = opts.currency || this.currency();
      var n = Number(value || 0); if (opts.cents) n = n / 100;
      var whole = cur === 'TZS' && Math.round(n * 100) % 100 === 0;
      return cur + ' ' + n.toLocaleString(cur === 'TZS' ? 'en-TZ' : 'en-KE', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    },
  };

  /* ---------------------------------- init ---------------------------------- */
  function init() {
    api('GET', '/auth/me').then(function (d) {
      var info = d.country; if (!info) return;
      window.POS_COUNTRY_INFO = info;
      // Cache the currency so every page renders money in it from the first paint (UI.formatMoney reads this).
      var prev = null; try { prev = localStorage.getItem('pos.currency'); localStorage.setItem('pos.currency', info.currency); } catch (e) { /* storage blocked */ }
      if (prev && prev !== info.currency && !info.needsCountrySelection) { location.reload(); return; }
      document.documentElement.setAttribute('data-country', info.code);
      // Language: the person's own saved choice wins, otherwise the business default. KES -> TZS in labels.
      if (window.I18n) { window.I18n.setCurrency(info.currency); window.I18n.adopt(d.user && d.user.language, info.language, d.user && d.user._id); }
      renderBadge(info);
      document.dispatchEvent(new CustomEvent('pos:country', { detail: info }));
      if (info.needsCountrySelection) promptCountry(d.user && d.user.role === 'OWNER', info.language);
    }).catch(function () { /* not signed in yet: show nothing */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
