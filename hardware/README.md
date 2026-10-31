# Hardware & Building Materials workspace (frontend)

Open `/hardware/` (the login redirects hardware businesses here automatically).
Same pattern as `/restaurant/`: one hash-routed app, own theme (`css/hw.css`, "Steel & Safety"), shared core scripts.

## Install
1. Copy the `hardware/` folder into the frontend root (next to `restaurant/`).
2. Replace `js/core/home-route.js` (adds: hardware businesses and SALES_REP / DISPATCHER / DRIVER roles land in `hardware/index.html`).
3. Deploy. Backend: apply the hardware delta (docs/HARDWARE.md) and run `node scripts/hardware-enable-features.js`.

## Workflow (left menu follows the day)
Sell → Quote → Order → Deliver → Collect
* **Counter till** – scan/search, units (bag/roll/pallet), fractions, contractor prices live, split pay, credit, then "Schedule delivery".
* **Quotes & orders** – draft → send → approve (stock held, backorder) → invoice all/part (deposits, payments, reprice) → pro forma print; backorders tab.
* **Projects & BOQ** – sites, BOQ editor, CSV import/export, required vs ordered vs invoiced, quote-from-BOQ, project quotes/deposits/deliveries.
* **Deposits** – take, refund, held balance.
* **Dispatch** – kanban (to load → loaded → on road → failed → delivered), driver "my deliveries" view, assign vehicle/driver/loaders/sub-contractor, rate-card pricing, OTP, signature/photo/code proof, part delivery, payments, costs, return/odometer, job profit.
* **Fleet & transport** – vehicles + expiry alerts, rate card, cost ledger (pay/void), transport report.
* **Shelves & picking** – locations, walking-order pick list with weight/handling, write-offs, repack.
* **Products & specs**, **Contractor pricing** (+ price check), **Suppliers & landed cost**, **Finance** (operating profit, budgets, unpaid bills, recurring), **Reports** (all 10), **Settings** (rules, templates, module status).


## Overview dashboard (Lime & Navy)
`js/hw-dash.js` builds the Overview: stat cards (sales, expenses, owed, transactions), sales bars (Monthly / Daily), sales trend area chart (Week / Month / Quarter, vs the period before), latest transactions and a dotted delivery map. Uses `/reports/sales`, `/reports/dashboard`, `/sales` and `/hardware/dashboard`; each block degrades gracefully if a permission or endpoint is missing. No chart library or CDN is needed.
