// POISE PERFUMES - API server (server side). No packages to install: just run `node server/server.js`
// The storefront (client/) and the dashboard (admin/) only talk to this server through /api.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
// Settings can live in server/.env (one KEY=value per line); see .env.example
try { fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch (e) {}
const gw = require('./gateways');
const emails = require('./emails');
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'poise123'; // CHANGE THIS before going live
if (ADMIN_PASSWORD === 'poise123' && (process.env.NODE_ENV === 'production' || /^https:/.test(process.env.PUBLIC_API_URL || ''))) {
  console.error('Stopped: set a strong ADMIN_PASSWORD before going live (in server/.env or your host settings).'); process.exit(1);
}
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';               // set to your storefront/admin address when hosted
// DATA_DIR lets a host keep your data on a permanent disk, e.g. DATA_DIR=/var/data
const DD = process.env.DATA_DIR;
const FILE = DD ? path.join(DD, 'db.json') : path.join(__dirname, 'data', 'db.json'), ROOT = path.join(__dirname, '..'), UP = DD ? path.join(DD, 'uploads') : path.join(__dirname, 'uploads');

const seed = () => ({
  n: 7, rate: 15.42, users: [], orders: [],
  brands: ['Lattafa','Khadlaj','Riiffs','Luxury Perfumes','Parisvally','Riggs','Brandy Designs','Aris','Louis Cardin','Confetti','Dear Body','Fogg','UDV','Nusuk','Topface','Rasasi','ARMAF','JC','Body Luxuries','AXE'],
  products: [
    { id: 1, name: 'Sample Eau de Parfum', brand: 'Lattafa', cat: 'Perfume', price: 1500, stock: 14, size: '100ml', notes: 'rose, amber, musk', hue: 340 },
    { id: 2, name: 'Sample Oud Perfume', brand: 'Rasasi', cat: 'Perfume', price: 2200, stock: 3, size: '100ml', notes: 'oud, saffron', hue: 28 },
    { id: 3, name: 'Sample Body Spray', brand: 'AXE', cat: 'Body', price: 120, stock: 22, size: '150ml', notes: 'fresh, woody', hue: 200 },
    { id: 4, name: 'Sample Body Lotion', brand: 'Dear Body', cat: 'Body', price: 180, stock: 30, size: '250ml', notes: 'moisturising', hue: 160 },
    { id: 5, name: 'Sample Lip Colour', brand: 'Topface', cat: 'Makeup', price: 300, stock: 40, size: '3.5g', notes: 'matte, long-wear', hue: 350 },
    { id: 6, name: 'Sample Foundation', brand: 'Topface', cat: 'Makeup', price: 450, stock: 0, size: '30ml', notes: 'satin finish', hue: 30 }
  ]
});
let db;
const save = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 1)); };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { db = seed(); save(); }
db.settings = db.settings || { cod: true, bank: { bankName: '', accountName: '', accountNumber: '', instructions: '' } };

db.pay = db.pay || {}; // gateway references per order (kept private, never sent to browsers)
const API_PUBLIC = process.env.PUBLIC_API_URL || `http://localhost:${PORT}`, STORE_URL = process.env.STORE_URL || API_PUBLIC;
const methods = () => ({ cod: !!db.settings.cod, bank: !!db.settings.bank.accountNumber, card_bml: gw.bmlOn(), card_mib: gw.mibOn() });
const restock = o => o.items.forEach(i => { const pr = db.products.find(x => x.id === i.id); if (pr) pr.stock += i.qty; });
const cancelOrder = (o, ps) => { if (o.status !== 'Cancelled') restock(o); o.status = 'Cancelled'; o.payStatus = ps; save(); };
async function settle(o, rec) { // ask the bank, then update the order
  if (o.payStatus === 'Paid') return 'paid';
  const st = await gw.check(rec.gw, o, rec);
  if (st === 'paid') { o.payStatus = 'Paid'; save(); emails.notify(o, 'paid'); emails.notify(o, 'new'); } else if (st === 'failed') cancelOrder(o, 'Payment failed');
  return st;
}

const sessions = new Map(), tries = new Map();
const newToken = d => { const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, d); return t; };
const who = req => sessions.get((req.headers.authorization || '').replace('Bearer ', ''));
const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const check = (pw, h) => { const a = Buffer.from(hash(pw, h.split(':')[0])), b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req, max) => new Promise((ok, no) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > max) { no(new Error('Request too large')); req.destroy(); } });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new Error('Invalid JSON')); } });
});

const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(p, res) { // convenience for local use: / = storefront, /admin/ = dashboard
  if (p === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  let dir = path.join(ROOT, 'client'), rel = p;
  if (p.startsWith('/admin/')) { dir = path.join(ROOT, 'admin'); rel = p.slice(6); }
  if (rel.endsWith('/')) rel += 'index.html';
  const f = path.join(dir, rel);
  if (!f.startsWith(dir)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(f, (e, d) => {
    if (e) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d);
  });
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const p = new URL(req.url, 'http://x').pathname, m = req.method;
  try {
    if (p.startsWith('/uploads/')) { // product photos
      const f = path.join(UP, path.basename(p));
      return fs.readFile(f, (e, d) => {
        if (e) return send(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' }); res.end(d);
      });
    }
    if (!p.startsWith('/api/')) return serve(p, res);
    const b = (m === 'POST' || m === 'PUT') ? await readBody(req, p.endsWith('/image') ? 4e6 : 1e5) : {};
    const u = who(req);

    // ---- public (storefront) ----
    if (m === 'GET' && p === '/api/store') return send(res, 200, { brands: db.brands, products: db.products, rate: db.rate, pay: { methods: methods(), bank: db.settings.bank } });
    if (m === 'POST' && p === '/api/orders') {
      if (!b.customer || !b.address || !Array.isArray(b.items) || !b.items.length) return send(res, 400, { error: 'Name, address and items are required' });
      const pm = String(b.payMethod || '');
      if (!methods()[pm]) return send(res, 400, { error: 'Choose an available payment method' });
      const lines = []; let total = 0;
      for (const it of b.items) {
        const pr = db.products.find(x => x.id === it.id), q = parseInt(it.qty);
        if (!pr || !(q > 0) || q > pr.stock) return send(res, 400, { error: 'Not enough stock for ' + (pr ? pr.name : 'an item') });
        lines.push({ pr, q });
      }
      lines.forEach(({ pr, q }) => { pr.stock -= q; total += pr.price * q; }); // prices always come from the server
      const o = { id: 1001 + db.orders.length, customer: String(b.customer).slice(0, 80), address: String(b.address).slice(0, 200),
        email: u && u.role === 'customer' ? u.email : '',
        notify: u && u.role === 'customer' ? u.email : (/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(String(b.email || '').trim()) ? String(b.email).trim().toLowerCase().slice(0, 120) : ''),
        items: lines.map(({ pr, q }) => ({ id: pr.id, name: pr.name, qty: q, price: pr.price })),
        total, status: 'Processing', payMethod: pm,
        payStatus: pm === 'cod' ? 'Pay on delivery' : pm === 'bank' ? 'Awaiting transfer' : 'Pending card payment',
        payRef: String(b.payRef || '').slice(0, 60), date: new Date().toISOString() };
      db.orders.unshift(o); save();
      if (pm.startsWith('card_')) {
        try {
          const g = pm.slice(5), gr = await gw.create(g, o, API_PUBLIC + '/api/pay/return?order=' + o.id, db.rate);
          db.pay[o.id] = { gw: g, ref: gr.ref, amount: gr.amount }; save();
          const payUrl = g === 'mib' ? STORE_URL + '/pay-mib.html?order=' + o.id + '&session=' + encodeURIComponent(gr.session) : gr.url;
          return send(res, 201, Object.assign({}, o, { payUrl }));
        } catch (e) { console.error('Card payment start failed:', e.message); cancelOrder(o, 'Payment failed'); return send(res, 502, { error: 'Card payment could not be started. Please try another method.' }); }
      }
      emails.notify(o, 'received', db.settings.bank); emails.notify(o, 'new');
      return send(res, 201, Object.assign({}, o, pm === 'bank' ? { bank: db.settings.bank } : {}));
    }
    if (m === 'POST' && p === '/api/register') {
      const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim();
      if (!name || email.indexOf('@') < 1 || String(b.password || '').length < 6) return send(res, 400, { error: 'Enter your name, a valid email and a password of 6+ characters' });
      if (db.users.some(x => x.email === email)) return send(res, 409, { error: 'An account with this email already exists' });
      db.users.push({ name, email, pw: hash(b.password) }); save();
      return send(res, 201, { token: newToken({ role: 'customer', email }), name });
    }
    if (m === 'POST' && p === '/api/login') {
      const e = String(b.email || '').trim().toLowerCase(), x = db.users.find(y => y.email === e);
      if (!x || !check(String(b.password || ''), x.pw)) return send(res, 401, { error: 'Email or password is incorrect' });
      return send(res, 200, { token: newToken({ role: 'customer', email: e }), name: x.name });
    }
    if (m === 'GET' && p === '/api/me/orders') {
      if (!u || u.role !== 'customer') return send(res, 401, { error: 'Sign in first' });
      return send(res, 200, db.orders.filter(o => o.email === u.email));
    }

    // ---- card gateways ----
    if (m === 'GET' && p === '/api/pay/mib-config') return send(res, 200, gw.mibOn() ? { host: gw.mibHost() } : {});
    if (m === 'GET' && p === '/api/pay/return') { // the customer comes back from the bank's page
      const id = parseInt(new URL(req.url, 'http://x').searchParams.get('order')), o = db.orders.find(x => x.id === id), rec = o && db.pay[o.id];
      let st = 'failed';
      if (rec) { try { st = await settle(o, rec); } catch (e) { console.error('Payment check failed:', e.message); st = 'pending'; } }
      res.writeHead(302, { Location: STORE_URL + '/?pay=' + st + '&order=' + (o ? o.id : '') }); return res.end();
    }
    if (m === 'POST' && p === '/api/pay/bml-webhook') { // BML tells us a payment changed
      const o = db.orders.find(x => String(x.id) === String(b.localId)), rec = o && db.pay[o.id];
      if (!rec || rec.gw !== 'bml' || !gw.bmlWebhookOk(b)) return send(res, 400, { error: 'Invalid webhook' });
      try { await settle(o, rec); } catch (e) { console.error('Webhook check failed:', e.message); }
      return send(res, 200, { ok: true });
    }

    // ---- admin (dashboard) ----
    if (m === 'POST' && p === '/api/admin/login') {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim(), t = tries.get(ip) || { n: 0, at: Date.now() };
      if (Date.now() - t.at > 15 * 60 * 1000) { t.n = 0; t.at = Date.now(); }
      if (t.n >= 8) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      if (b.password !== ADMIN_PASSWORD) { t.n++; tries.set(ip, t); return send(res, 401, { error: 'Wrong password' }); }
      tries.delete(ip);
      return send(res, 200, { token: newToken({ role: 'admin' }) });
    }
    if (p.startsWith('/api/admin/')) {
      if (!u || u.role !== 'admin') return send(res, 401, { error: 'Admin sign-in required' });
      const parts = p.split('/'), id = parseInt(parts[4]), pr = db.products.find(x => x.id === id);
      if (m === 'GET' && p === '/api/admin/orders') return send(res, 200, { orders: db.orders, customers: db.users.length });
      if (m === 'POST' && p === '/api/admin/brands') {
        const n = String(b.name || '').trim();
        if (!n) return send(res, 400, { error: 'Enter a brand name' });
        if (db.brands.some(x => x.toLowerCase() === n.toLowerCase())) return send(res, 409, { error: 'That brand already exists' });
        db.brands.push(n); save(); return send(res, 201, { brands: db.brands });
      }
      if (m === 'POST' && p === '/api/admin/products') {
        const price = parseFloat(b.price);
        if (!String(b.name || '').trim() || !db.brands.includes(b.brand) || isNaN(price) || price < 0) return send(res, 400, { error: 'Enter a name, pick a brand and enter a price' });
        const np = { id: db.n++, name: String(b.name).trim(), brand: b.brand, cat: ['Perfume', 'Makeup', 'Skincare', 'Body'].includes(b.cat) ? b.cat : 'Perfume',
          price, stock: Math.max(0, parseInt(b.stock) || 0), size: String(b.size || '').trim() || '-', notes: String(b.notes || '').trim(), hue: Math.floor(Math.random() * 360) };
        db.products.push(np); save(); return send(res, 201, np);
      }
      if (m === 'PUT' && parts[3] === 'products' && parts[5] === 'image' && pr) {
        const mt = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ''));
        if (!mt) return send(res, 400, { error: 'Upload a JPG, PNG or WebP image' });
        const buf = Buffer.from(mt[2], 'base64');
        if (buf.length > 2e6) return send(res, 400, { error: 'Image is too large (max 2 MB)' });
        fs.mkdirSync(UP, { recursive: true });
        if (pr.image) fs.rm(path.join(UP, path.basename(pr.image)), () => {});
        const name = id + '-' + crypto.randomBytes(4).toString('hex') + '.' + (mt[1] === 'jpeg' ? 'jpg' : mt[1]);
        fs.writeFileSync(path.join(UP, name), buf); pr.image = '/uploads/' + name; save();
        return send(res, 200, pr);
      }
      if (m === 'PUT' && parts[3] === 'products' && pr) {
        if (b.price !== undefined) pr.price = Math.max(0, Number(b.price) || 0);
        if (b.stock !== undefined) pr.stock = Math.max(0, parseInt(b.stock) || 0);
        save(); return send(res, 200, pr);
      }
      if (m === 'DELETE' && parts[3] === 'products' && pr) { if (pr.image) fs.rm(path.join(UP, path.basename(pr.image)), () => {}); db.products = db.products.filter(x => x.id !== id); save(); return send(res, 200, { ok: true }); }
      if (m === 'PUT' && parts[3] === 'orders') {
        const o = db.orders.find(x => x.id === id);
        const PS = ['Pay on delivery', 'Awaiting transfer', 'Pending card payment', 'Paid', 'Payment failed'];
        if (!o || (b.status === undefined && b.payStatus === undefined) || (b.status !== undefined && !['Processing', 'Shipped', 'Delivered', 'Cancelled'].includes(b.status)) || (b.payStatus !== undefined && !PS.includes(b.payStatus))) return send(res, 400, { error: 'Invalid order or status' });
        const was = { s: o.status, p: o.payStatus };
        if (b.status !== undefined) { if (b.status === 'Cancelled' && o.status !== 'Cancelled') restock(o); o.status = b.status; }
        if (b.payStatus !== undefined) o.payStatus = b.payStatus;
        save();
        if (o.payStatus === 'Paid' && was.p !== 'Paid') emails.notify(o, 'paid');
        if (o.status !== was.s && (o.status === 'Shipped' || o.status === 'Cancelled')) emails.notify(o, o.status === 'Shipped' ? 'shipped' : 'cancelled');
        return send(res, 200, o);
      }
      if (m === 'GET' && p === '/api/admin/backup') { // a copy of everything except photos
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="poise-backup-' + new Date().toISOString().slice(0, 10) + '.json"' });
        return res.end(JSON.stringify(db, null, 1));
      }
      if (m === 'GET' && p === '/api/admin/settings') return send(res, 200, { settings: db.settings, cards: { bml: gw.bmlOn(), mib: gw.mibOn() }, mail: emails.on(), shopEmail: !!process.env.SHOP_EMAIL });
      if (m === 'PUT' && p === '/api/admin/settings') {
        const bk = b.bank || {}, s = x => String(x || '').trim().slice(0, 200);
        db.settings = { cod: !!b.cod, bank: { bankName: s(bk.bankName), accountName: s(bk.accountName), accountNumber: s(bk.accountNumber), instructions: s(bk.instructions) } };
        save(); return send(res, 200, db.settings);
      }
      if (m === 'POST' && p === '/api/admin/test-email') {
        if (!emails.on() || !process.env.SHOP_EMAIL) return send(res, 400, { error: 'Set SMTP_HOST, MAIL_FROM and SHOP_EMAIL in server/.env first' });
        try { await emails.test(process.env.SHOP_EMAIL); return send(res, 200, { ok: true }); } catch (e) { return send(res, 502, { error: 'Email failed: ' + e.message }); }
      }
      if (m === 'PUT' && p === '/api/admin/rate') {
        const r = parseFloat(b.rate);
        if (!(r > 0)) return send(res, 400, { error: 'Enter a rate above 0' });
        db.rate = r; save(); return send(res, 200, { rate: r });
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) { send(res, 400, { error: e.message }); }
}).listen(PORT, () => console.log(`POISE PERFUMES running\n  Storefront: http://localhost:${PORT}/\n  Admin:      http://localhost:${PORT}/admin/  (password: ${ADMIN_PASSWORD})`));
