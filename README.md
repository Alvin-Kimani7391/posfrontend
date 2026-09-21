# Kenya POS Frontend

Vanilla HTML/CSS/JS. No build step, no framework, no bundler - deploys to
Vercel as a static site exactly as-is. Talks to the Render-hosted backend
over the REST API from Phase 1.

## Status: covers backend Phase 1 (auth, business, branches, employees)

Pages: `index.html` (boot/redirect), `login.html`, `register.html`,
`dashboard.html`, `branches.html`, `employees.html`. More pages
(products, inventory, sales, reports, ...) get added here as each backend
phase lands - they'll all follow the exact same pattern described below,
so adding one is mostly copy-paste-and-adjust.

## Architecture

```
css/
  variables.css   <- design tokens (colors, spacing, type scale). Change the
                     look of the whole app by editing values here only.
  base.css        <- reset + utility classes
  components.css  <- buttons, forms, cards, tables, modals, toasts, badges...
  layout.css      <- app shell (sidebar/topbar/bottom-nav), auth screens

js/core/          <- shared code every page relies on. Never duplicate
                      logic that belongs here into a page script.
  config.js       <- API_BASE_URL (auto-switches local vs production)
  storage.js      <- the ONLY place that touches localStorage
  api.js          <- the ONLY place that calls fetch() against the backend.
                      Attaches the auth token, retries once on a 401 via a
                      silent refresh, throws ApiError { message, code, errors }
  icons.js        <- small inline SVG icon set (zero external dependency)
  permissions.js  <- UI-side mirror of backend role/permission defaults,
                      used ONLY to hide/show buttons - never a security
                      boundary, the backend re-checks everything
  ui.js           <- toast, modal, confirm dialog, formatMoney/formatDate,
                      table pagination, form serialize/error rendering -
                      every page-specific script leans on this
  app-shell.js    <- renders the sidebar/topbar/bottom-nav into
                      <div id="app-shell"> on every authenticated page

js/pages/         <- one file per page, page-specific logic only. These are
                      intentionally thin: they build page markup and wire
                      it to js/core functions.
```

### The pattern every authenticated page follows

```html
<body data-page="branches">
  <div class="app-shell" id="app-shell"></div>
  <script src="js/core/config.js"></script>
  <script src="js/core/icons.js"></script>
  <script src="js/core/storage.js"></script>
  <script src="js/core/api.js"></script>
  <script src="js/core/permissions.js"></script>
  <script src="js/core/ui.js"></script>
  <script src="js/core/app-shell.js"></script>
  <script src="js/pages/branches.js"></script>
</body>
```

```js
// js/pages/branches.js
document.addEventListener('DOMContentLoaded', async () => {
  const content = window.AppShell.mount({ title: 'Branches' }); // redirects to
  if (!content) return;                                          // login.html if
  content.innerHTML = '...';                                     // not authed
  const { data } = await window.Api.get('/branches', { page: 1 });
  // render data.items into content, using window.UI helpers throughout
});
```

`data-page="branches"` tells `app-shell.js` which sidebar link to highlight
and which bottom-nav icon to mark active - it's the only per-page wiring
needed in the shell itself.

## Adding a new page (e.g. Products, once backend Phase 2 lands)

1. Copy `branches.html` -> `products.html`, change `data-page` and the
   script tag at the bottom.
2. Copy `js/pages/branches.js` -> `js/pages/products.js`, change the API
   path and table columns.
3. Add the nav entry in `js/core/app-shell.js`'s `NAV_ITEMS` array (just
   flip `disabled: true` to `false` and set the real `href` - the
   placeholder is already there).
4. If it needs a permission gate, add `data-requires-permission="products.view"`
   the same way branches/employees do.

No other file needs to change.

## Configuration

Edit `js/core/config.js` once you have your Render URL:

```js
const PRODUCTION_API_URL = 'https://your-pos-backend.onrender.com/api/v1';
```

Everything else in the app reads `window.APP_CONFIG.API_BASE_URL` - no
other file has a hard-coded URL.

## Local development

No build step needed. Serve the folder with any static server, e.g.:

```bash
npx serve .
# or
python3 -m http.server 5500
```

Then run the backend locally on port 5000 (its default) - `config.js`
auto-detects `localhost`/`127.0.0.1` and points at `http://localhost:5000/api/v1`.

## Deploying

**Frontend (Vercel):** push this folder to a Git repo and import it in
Vercel as a static project (no framework preset, no build command needed).
`vercel.json` sets basic security headers and clean URLs.

**Backend (Render):** see the backend's own `render.yaml`. Once deployed,
copy its URL into `PRODUCTION_API_URL` above and redeploy the frontend.

**CORS:** the backend's `FRONTEND_URL` environment variable must be set to
your Vercel domain (e.g. `https://your-pos.vercel.app`) or requests from
the deployed frontend will be blocked by the backend's CORS policy. Update
it in the Render dashboard after your first Vercel deploy.

## Security notes

- `permissions.js` is UI convenience only. Every real authorization check
  happens server-side (`requirePermission` middleware) - hiding a button
  here never substitutes for that.
- Access/refresh tokens live in `localStorage` (via `storage.js`). This is
  the standard trade-off for a token-based SPA with no server-rendered
  session; it's vulnerable to XSS if you ever add third-party scripts, so
  keep the CSP tight and audit any new `<script src>` you add.
- `api.js` clears the session and redirects to `login.html` the moment a
  refresh attempt fails, so an expired/revoked session can't silently keep
  making authenticated-looking requests.
