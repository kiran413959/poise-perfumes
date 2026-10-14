// Card payment gateways: Bank of Maldives (BML Connect) and Maldives Islamic Bank (MIB Global Pay, a Mastercard gateway).
// Each one turns on only when its keys are in server/.env. Written from the banks' public API descriptions:
// test with each bank's sandbox keys before taking real payments.
const crypto = require('crypto');
const E = () => process.env;

const bmlOn = () => !!(E().BML_API_KEY && E().BML_APP_ID);
const mibOn = () => !!(E().MIB_GATEWAY_HOST && E().MIB_MERCHANT_ID && E().MIB_API_PASSWORD);
const bmlBase = () => E().BML_BASE_URL || (E().BML_ENV === 'live'
  ? 'https://api.merchants.bankofmaldives.com.mv/public' : 'https://api.uat.merchants.bankofmaldives.com.mv/public');
const mibBase = () => E().MIB_BASE_URL || `https://${E().MIB_GATEWAY_HOST}/api/rest/version/${E().MIB_API_VERSION || '100'}/merchant/${E().MIB_MERCHANT_ID}`;
const mibAuth = () => 'Basic ' + Buffer.from(`merchant.${E().MIB_MERCHANT_ID}:${E().MIB_API_PASSWORD}`).toString('base64');
const bmlHeaders = () => ({ Authorization: E().BML_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' });
const sig = (amount, currency) => `amount=${amount}&currency=${currency}&apiKey=${E().BML_API_KEY}`;
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const md5 = s => crypto.createHash('md5').update(s).digest('base64');
const body = async r => r.json().catch(() => ({}));

// Start a payment. Returns what the server must remember ({ref, amount}) plus where to send the customer.
async function create(name, o, returnUrl, rate) {
  if (name === 'bml') {
    const amount = Math.round(o.total * 100), currency = 'MVR'; // BML amounts are in laari (MVR 10.00 = 1000)
    const r = await fetch(bmlBase() + '/transactions', { method: 'POST', headers: bmlHeaders(), body: JSON.stringify({
      localId: String(o.id), customerReference: 'Order #' + o.id, amount, currency, signature: sha1(sig(amount, currency)),
      appVersion: 'poise-shop-1.0', apiVersion: '2.0', deviceId: E().BML_APP_ID, signMethod: 'sha1', redirectUrl: returnUrl }) });
    const d = await body(r);
    if (!r.ok) throw new Error('BML: ' + (d.message || r.status));
    const url = d.url || d.shortUrl;
    if (!url) throw new Error('BML did not return a payment page address');
    return { url, ref: d.id || d.transactionId, amount };
  }
  if (name === 'mib') {
    const currency = E().MIB_CURRENCY || 'USD';
    const amount = (currency === 'MVR' ? o.total : o.total / rate).toFixed(2);
    const r = await fetch(mibBase() + '/session', { method: 'POST', headers: { Authorization: mibAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify({
      apiOperation: 'INITIATE_CHECKOUT', checkoutMode: 'WEBSITE',
      interaction: { operation: 'PURCHASE', returnUrl, cancelUrl: returnUrl, merchant: { name: 'POISE PERFUMES' } },
      order: { id: 'POISE-' + o.id, amount, currency, description: 'Order #' + o.id } }) });
    const d = await body(r);
    if (!r.ok || d.result !== 'SUCCESS' || !d.session) throw new Error('MIB: ' + ((d.error && d.error.explanation) || r.status));
    return { session: d.session.id, ref: d.successIndicator, amount };
  }
  throw new Error('Unknown gateway');
}

// Ask the bank what happened. Never trust the customer's browser: only the bank's own answer counts.
// Returns 'paid', 'failed' or 'pending'.
async function check(name, o, rec) {
  if (name === 'bml') {
    if (!rec.ref) return 'pending';
    const r = await fetch(`${bmlBase()}/transactions/${rec.ref}`, { headers: bmlHeaders() });
    const d = await body(r);
    if (!r.ok) return 'pending';
    if (d.amount !== undefined && Number(d.amount) !== rec.amount) return 'pending'; // amount must match the order
    return d.state === 'CONFIRMED' ? 'paid' : d.state === 'CANCELLED' ? 'failed' : 'pending';
  }
  if (name === 'mib') {
    const r = await fetch(`${mibBase()}/order/POISE-${o.id}`, { headers: { Authorization: mibAuth() } });
    const d = await body(r);
    if (!r.ok) return 'pending';
    if (d.amount !== undefined && Number(d.amount).toFixed(2) !== String(rec.amount)) return 'pending';
    return d.status === 'CAPTURED' ? 'paid' : 'pending';
  }
  return 'pending';
}

// BML webhook: the signature must match before we even ask the bank.
function bmlWebhookOk(b) {
  if (!bmlOn() || !b || b.amount === undefined || !b.currency || !b.signature) return false;
  const s = sig(b.amount, b.currency);
  return b.signature === sha1(s) || b.signature === md5(s);
}

module.exports = { bmlOn, mibOn, create, check, bmlWebhookOk, mibHost: () => E().MIB_GATEWAY_HOST };
