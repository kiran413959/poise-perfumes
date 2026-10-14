// Minimal email sender (SMTP) with no packages to install. Works with Gmail, Outlook/Microsoft 365, your web host's mail, etc.
// Settings in server/.env: SMTP_HOST, SMTP_PORT, SMTP_SECURE (ssl | starttls | none), SMTP_USER, SMTP_PASS, MAIL_FROM
const net = require('net'), tls = require('tls'), crypto = require('crypto');
const E = () => process.env;
const on = () => !!(E().SMTP_HOST && E().MAIL_FROM);
const clean = s => String(s).replace(/[\r\n]+/g, ' ').trim();
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const addr = s => { const m = /<([^<>]+)>/.exec(s); return clean(m ? m[1] : s); };

function build(to, subject, text) {
  const from = clean(E().MAIL_FROM);
  const body = b64(text).replace(/(.{76})/g, '$1\r\n');
  return ['From: ' + from, 'To: ' + clean(to), 'Subject: =?UTF-8?B?' + b64(clean(subject)) + '?=', 'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomBytes(8).toString('hex') + '@' + (addr(from).split('@')[1] || 'localhost') + '>',
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
}

function send(to, subject, text) {
  const host = E().SMTP_HOST, mode = (E().SMTP_SECURE || 'starttls').toLowerCase();
  const port = parseInt(E().SMTP_PORT) || (mode === 'ssl' ? 465 : mode === 'none' ? 25 : 587);
  return new Promise((resolve, reject) => {
    let sock = mode === 'ssl' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '', waiter = null, done = false;
    const timer = setTimeout(() => fail(new Error('Timed out')), 25000);
    const fail = e => { if (!done) { done = true; clearTimeout(timer); sock.destroy(); reject(e); } };
    const check = () => {
      const lines = buf.split('\r\n').slice(0, -1), last = lines[lines.length - 1];
      if (waiter && last && /^\d{3} /.test(last)) { const w = waiter; waiter = null; buf = ''; w({ code: parseInt(last), text: lines.join(' | ') }); }
    };
    const attach = s => { s.setEncoding('utf8'); s.on('data', d => { buf += d; check(); }); s.on('error', fail); s.on('close', () => { if (!done) fail(new Error('Connection closed')); }); };
    const read = () => new Promise(r => { waiter = r; check(); });
    const cmd = async (line, ok) => {
      if (line !== null) sock.write(line + '\r\n');
      const r = await read();
      if (!ok.includes(r.code)) throw new Error('Mail server said: ' + r.text.slice(0, 160));
      return r;
    };
    attach(sock);
    (async () => {
      await cmd(null, [220]);
      let r = await cmd('EHLO poise-shop', [250]);
      if (mode === 'starttls') {
        await cmd('STARTTLS', [220]);
        sock.removeAllListeners('data'); sock.removeAllListeners('close'); sock.removeAllListeners('error');
        buf = ''; sock = tls.connect({ socket: sock, servername: host }); attach(sock);
        await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
        r = await cmd('EHLO poise-shop', [250]);
      }
      if (E().SMTP_USER) {
        await cmd('AUTH LOGIN', [334]); await cmd(b64(E().SMTP_USER), [334]); await cmd(b64(E().SMTP_PASS || ''), [235]);
      }
      await cmd('MAIL FROM:<' + addr(E().MAIL_FROM) + '>', [250]);
      await cmd('RCPT TO:<' + addr(to) + '>', [250, 251]);
      await cmd('DATA', [354]);
      await cmd(build(to, subject, text) + '\r\n.', [250]);
      sock.write('QUIT\r\n'); done = true; clearTimeout(timer); sock.end(); resolve();
    })().catch(fail);
  });
}
module.exports = { on, send };
