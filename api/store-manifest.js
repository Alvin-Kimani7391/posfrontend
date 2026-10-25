/**
 * GET /api/store-manifest?t=<store token>[&n=<name hint>&c=<hex colour without #>]
 *
 * The ONE web-app manifest of a restaurant's ordering app (store.html). It is a real https URL, which is what Chrome needs before it
 * offers "Install", and it carries the restaurant's own name, so the installed icon says "Mama Rosa Grill", never "Order online".
 *
 * Rules that keep it to ONE installable app per restaurant:
 *  - identity is fixed: id = /s/<token>, start_url = /s/<token>, scope = /s/  (so it never overlaps the staff POS app, which lives at /)
 *  - the name comes from the backend (the source of truth). If the backend is unreachable (Render waking up) the page's own `n` hint
 *    is used and the answer is NOT cached; if there is no usable name at all, NO manifest is served, so nothing generic can be installed
 *  - an unknown / rotated token gets a 404: it cannot be installed
 * Vercel serverless function (Node 18+). Set API_BASE_URL in the project env to override the backend address.
 */
const API = process.env.API_BASE_URL || 'https://posbackend-5jaq.onrender.com/api/v1';
const TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function lookup(token) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(`${API}/public/store/${encodeURIComponent(token)}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);
      if (r.status === 404) return { invalid: true };                       // not a valid / current QR code
      if (r.ok) {
        const j = await r.json(); const d = (j && j.data) || j;
        const name = clean(d && d.business && d.business.name, 80);
        if (name) { const tc = d.store && d.store.themeColor; return { name, theme: tc && /^#[0-9a-f]{6}$/i.test(tc) && tc.toLowerCase() !== '#0f766e' ? tc : null }; }
      }
    } catch (e) { clearTimeout(timer); }
    if (attempt === 0) await new Promise((ok) => setTimeout(ok, 400));
  }
  return null;                                                              // backend unreachable
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const token = String(q.t || '');
  const fail = (code, msg) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.status(code).send(JSON.stringify({ error: msg })); };
  if (!TOKEN_RE.test(token)) return fail(404, 'Unknown store');

  const found = await lookup(token);
  if (found && found.invalid) return fail(404, 'Unknown store');
  let name = found && found.name; let theme = (found && found.theme) || null; const verified = !!name;
  if (!name) { name = clean(q.n, 60); if (!name) return fail(503, 'Store not reachable'); }          // never fall back to a generic name
  if (!theme && /^[0-9a-f]{6}$/i.test(String(q.c || ''))) theme = `#${q.c}`;
  theme = theme || '#F26A21';

  const short = name.length > 12 ? (name.slice(0, 12).replace(/\s+\S*$/, '') || name.slice(0, 12)) : name;
  const id = `/s/${encodeURIComponent(token)}`;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const self = host ? `https://${host}${req.url}` : '';

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', verified ? 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400' : 'no-store');
  res.status(200).send(JSON.stringify({
    id, name, short_name: short, description: `Order food, book a table or a room at ${name}.`, lang: 'en-KE',
    start_url: `${id}?source=pwa`, scope: '/s/', display: 'standalone', display_override: ['standalone', 'minimal-ui'], orientation: 'any',
    background_color: '#ffffff', theme_color: theme, categories: ['food', 'shopping'], prefer_related_applications: false,
    related_applications: self ? [{ platform: 'webapp', url: self }] : undefined,        // lets the page ask "is this app already installed?"
    shortcuts: [
      { name: 'Order food', short_name: 'Order', url: `${id}?tab=menu&source=shortcut`, icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'My orders', short_name: 'Orders', url: `${id}?tab=orders&source=shortcut`, icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }));
};