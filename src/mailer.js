import https from 'node:https';
import http from 'node:http';

// Transactional email over HTTPS (no SMTP library needed).
//   SITELENS_EMAIL_FROM   "SiteLens <noreply@yourdomain.com>" (a sender your provider has verified)
//   RESEND_API_KEY        → sends through Resend (https://resend.com)
//   SENDGRID_API_KEY      → or through SendGrid
//   SITELENS_EMAIL_PROVIDER=console prints emails to the server log instead
//                         (local development only: it logs the links).
// EMAIL_API_BASE overrides the provider URL (used by the tests).

function config() {
  const from = process.env.SITELENS_EMAIL_FROM || '';
  if (process.env.SITELENS_EMAIL_PROVIDER === 'console') return { provider: 'console', from: from || 'SiteLens <dev@localhost>' };
  if (process.env.RESEND_API_KEY && from) return { provider: 'resend', key: process.env.RESEND_API_KEY, from };
  if (process.env.SENDGRID_API_KEY && from) return { provider: 'sendgrid', key: process.env.SENDGRID_API_KEY, from };
  return null;
}

export const emailEnabled = () => !!config();

function postJson(url, body, headers) {
  const u = new URL(url);
  const data = Buffer.from(JSON.stringify(body));
  const lib = u.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': data.length, ...headers },
      timeout: 15000,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => (res.statusCode < 300 ? resolve(text) : reject(new Error(`Email provider returned ${res.statusCode}: ${text.slice(0, 200)}`))));
    });
    req.on('timeout', () => req.destroy(new Error('Email provider timed out')));
    req.on('error', reject);
    req.end(data);
  });
}

/** Sends one email. Throws if the provider rejects it. */
export async function sendEmail({ to, subject, text, html, replyTo }) {
  const c = config();
  if (!c) throw new Error('Email is not configured');
  if (c.provider === 'console') {
    console.log(`\n--- email to ${to}: ${subject}\n${text}\n---\n`);
    return;
  }
  if (c.provider === 'resend') {
    await postJson(`${process.env.EMAIL_API_BASE || 'https://api.resend.com'}/emails`,
      { from: c.from, to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }, { authorization: `Bearer ${c.key}` });
    return;
  }
  const m = /^(.*)<([^>]+)>\s*$/.exec(c.from);
  await postJson(`${process.env.EMAIL_API_BASE || 'https://api.sendgrid.com'}/v3/mail/send`, {
    personalizations: [{ to: [{ email: to }] }],
    from: m ? { email: m[2].trim(), name: m[1].trim().replace(/^"|"$/g, '') } : { email: c.from },
    subject,
    ...(replyTo ? { reply_to: { email: replyTo } } : {}),
    content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
  }, { authorization: `Bearer ${c.key}` });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function layout({ heading, intro, button, link, footer }) {
  const text = `${heading}\n\n${intro}\n\n${button}: ${link}\n\n${footer}\n\n— SiteLens`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f3;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b0b0b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;border:1px solid #e1e0d9">
<tr><td style="padding:28px">
<div style="font-weight:700;font-size:18px;margin-bottom:20px">🔍 SiteLens</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(heading)}</h1>
<p style="font-size:15px;line-height:1.5;color:#52514e;margin:0 0 22px">${esc(intro)}</p>
<a href="${esc(link)}" style="display:inline-block;background:#2a78d6;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(button)}</a>
<p style="font-size:13px;line-height:1.5;color:#7a7873;margin:22px 0 0">${esc(footer)}</p>
<p style="font-size:12px;color:#7a7873;margin:14px 0 0;word-break:break-all">${esc(link)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

export function verificationEmail(link) {
  return {
    subject: 'Confirm your SiteLens email',
    ...layout({
      heading: 'Confirm your email address',
      intro: 'Thanks for signing up for SiteLens. Confirm your email to buy API plans and receive account notices.',
      button: 'Confirm email',
      link,
      footer: "This link expires in 24 hours. If you didn't create a SiteLens account, you can ignore this email.",
    }),
  };
}

export function resetEmail(link) {
  return {
    subject: 'Reset your SiteLens password',
    ...layout({
      heading: 'Reset your password',
      intro: 'Someone (hopefully you) asked to reset the password for your SiteLens account.',
      button: 'Choose a new password',
      link,
      footer: "This link expires in 1 hour and works once. If you didn't ask for this, ignore this email: your password won't change.",
    }),
  };
}

/** Forwards a contact-form message to the site owner (plain text; Reply goes to the sender). */
export function contactEmail({ name, email, topic, message }) {
  const text = `New message from the SiteLens contact form\n\nFrom: ${name} <${email}>\nTopic: ${topic}\n\n${message}\n`;
  return {
    subject: `[SiteLens] ${topic}: message from ${name}`.slice(0, 150),
    text,
    html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;font-size:14px">${esc(text)}</pre>`,
  };
}
