// The emails the shop sends. Plain text, so they work everywhere.
const mail = require('./mailer');
const SHOP = () => process.env.SHOP_NAME || 'POISE PERFUMES';
const money = n => 'MVR ' + Number(n).toLocaleString('en', { maximumFractionDigits: 2 });
const items = o => o.items.map(i => `  ${i.qty} x ${i.name} - ${money(i.price * i.qty)}`).join('\n');
const PAY = { cod: 'Cash on delivery', bank: 'Bank transfer', card_bml: 'Card (Bank of Maldives)', card_mib: 'Card (MIB)' };

function compose(o, kind, bank) {
  const summary = `Order #${o.id}\n${items(o)}\nTotal: ${money(o.total)}\nDelivery to: ${o.customer}, ${o.address}\n`;
  const sign = `\nThank you,\n${SHOP()}`;
  if (kind === 'received') {
    const pay = o.payMethod === 'bank' && bank
      ? `\nPlease pay by bank transfer:\n  Bank: ${bank.bankName}\n  Account name: ${bank.accountName}\n  Account number: ${bank.accountNumber}\n  Amount: ${money(o.total)}\n  Reference: Order #${o.id}\n${bank.instructions ? '  ' + bank.instructions + '\n' : ''}We will confirm your order once the transfer is received.\n`
      : o.payMethod === 'cod' ? '\nYou will pay in cash when your order is delivered.\n' : '';
    return [`We received your order #${o.id}`, `Hi ${o.customer},\n\nThank you for your order.\n\n${summary}${pay}${sign}`];
  }
  if (kind === 'paid') return [`Payment received for order #${o.id}`, `Hi ${o.customer},\n\nWe have received your payment. We will prepare your order now.\n\n${summary}${sign}`];
  if (kind === 'shipped') return [`Your order #${o.id} is on its way`, `Hi ${o.customer},\n\nYour order has been shipped.\n\n${summary}${sign}`];
  if (kind === 'cancelled') return [`Your order #${o.id} was cancelled`, `Hi ${o.customer},\n\nYour order has been cancelled. If you have questions, please reply to this email or contact us.\n\n${summary}${sign}`];
  // 'new': goes to the shop owner
  return [`New order #${o.id} (${money(o.total)}) - ${PAY[o.payMethod] || o.payMethod}`,
    `A new order came in.\n\n${summary}Customer email: ${o.notify || o.email || '(none given)'}\nPayment: ${PAY[o.payMethod] || o.payMethod} - ${o.payStatus}\n\nManage it in your admin dashboard.`];
}

// Never lets an email problem break an order: errors are only logged.
function notify(o, kind, bank) {
  if (!mail.on()) return;
  const to = kind === 'new' ? process.env.SHOP_EMAIL : o.notify;
  if (!to) return;
  const [subject, text] = compose(o, kind, bank);
  mail.send(to, subject, text).catch(e => console.error('Email failed:', e.message));
}
const test = to => mail.send(to, `Test email from ${SHOP()}`, 'This is a test. Your order emails are set up correctly.');
module.exports = { on: mail.on, notify, test };
