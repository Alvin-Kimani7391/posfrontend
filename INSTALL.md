# Restaurant + Accommodation frontend: install

Copy everything in this folder into the ROOT of your existing frontend (the folder that has login.html and dashboard.html), keeping the same folder structure.

New (restaurant AND accommodation, one workspace):
- restaurant/index.html, restaurant/css/hx.css, restaurant/js/hx-app.js, hx-more.js, hx-extra.js
- q.html  (public page guests open from a table/room QR code)

Replace (existing files, small changes):
- vercel.json        adds the /q/<code> route for the guest page
- js/pages/login.js  sends restaurant/hospitality accounts to restaurant/index.html after login

Open: https://YOUR-SITE/restaurant/index.html
