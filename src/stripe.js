import https from 'node:https';
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './util.js';

// Minimal Stripe client (no SDK): Checkout for subscriptions, the billing
// portal, and webhook verification. Configure with:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//   STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS
// STRIPE_API_BASE overrides the API URL (used by the tests).

const env = () => ({
  secret: process.env.STRIPE_SECRET_KEY || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  base: process.env.STRIPE_API_BASE || 'https://api.stripe.com',
  prices: {
    starter: process.env.STRIPE_PRICE_STARTER || '',
    pro: process.env.STRIPE_PRICE_PRO || '',
    business: process.env.STRIPE_PRICE_BUSINESS || '',
  },
});

export const billingEnabled = () => {
  const e = env();
  return !!(e.secret && e.webhookSecret && e.prices.starter && e.prices.pro && e.prices.business);
};

export const priceFor = (plan) => env().prices[plan] || null;

export function planForPrice(priceId) {
  const entry = Object.entries(env().prices).find(([, id]) => id && id === priceId);
  return entry ? entry[0] : null;
}

/** Flattens {a: {b: 1}, c: [x]} into Stripe's form encoding: a[b]=1&c[0]=x. */
export function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

function stripeRequest(method, pathname, params) {
  const { secret, base } = env();
  if (!secret) throw new HttpError(503, 'Payments are not configured on this server.');
  const url = new URL(pathname, base);
  const body = params ? formEncode(params) : '';
  const lib = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body),
        'stripe-version': '2024-06-20',
      },
      timeout: 15000,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(text); } catch { json = null; }
        if (res.statusCode >= 400 || !json) {
          console.error('Stripe error:', res.statusCode, json?.error?.message || text.slice(0, 200));
          return reject(new HttpError(502, 'The payment provider returned an error. Please try again.'));
        }
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new HttpError(504, 'Payment provider timed out')));
    req.on('error', (err) => reject(err instanceof HttpError ? err : new HttpError(502, 'Could not reach the payment provider')));
    req.end(body);
  });
}

export function createCheckoutSession({ user, plan, successUrl, cancelUrl }) {
  return stripeRequest('POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price: priceFor(plan), quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: user.id,
    ...(user.stripeCustomerId ? { customer: user.stripeCustomerId } : { customer_email: user.email }),
    metadata: { userId: user.id, plan },
    subscription_data: { metadata: { userId: user.id, plan } },
    allow_promotion_codes: 'true',
  });
}

export function createPortalSession({ user, returnUrl }) {
  return stripeRequest('POST', '/v1/billing_portal/sessions', { customer: user.stripeCustomerId, return_url: returnUrl });
}

/**
 * Verifies a Stripe-Signature header ("t=…,v1=…") against the raw body.
 * Rejects signatures older than `toleranceSec`.
 */
export function verifyWebhook(rawBody, header, secret = env().webhookSecret, toleranceSec = 300) {
  if (!secret) throw new HttpError(503, 'Webhooks are not configured');
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const signatures = String(header || '').split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !signatures.length) throw new HttpError(400, 'Missing Stripe signature');
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new HttpError(400, 'Stripe signature is too old');
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const ok = signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new HttpError(400, 'Invalid Stripe signature');
  return JSON.parse(rawBody);
}

export const signWebhookForTests = (rawBody, secret, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;

/** Applies a verified Stripe event to the accounts store. */
export function applyStripeEvent(event, accounts) {
  const obj = event?.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed': {
      const user = accounts.byId(obj.client_reference_id || obj.metadata?.userId);
      if (!user) return 'unknown user';
      accounts.setPlan(user, {
        plan: obj.metadata?.plan || user.plan,
        status: 'active',
        stripeCustomerId: obj.customer || user.stripeCustomerId,
        stripeSubscriptionId: obj.subscription || user.stripeSubscriptionId,
      });
      return 'plan activated'; // the customer creates their key on the account page
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const user = accounts.byStripeCustomer(obj.customer) || accounts.byId(obj.metadata?.userId);
      if (!user) return 'unknown customer';
      const priceId = obj.items?.data?.[0]?.price?.id;
      accounts.setPlan(user, {
        plan: planForPrice(priceId) || user.plan,
        status: obj.status,
        stripeCustomerId: obj.customer || user.stripeCustomerId,
        stripeSubscriptionId: obj.id,
      });
      return `subscription ${obj.status}`;
    }
    case 'customer.subscription.deleted': {
      const user = accounts.byStripeCustomer(obj.customer);
      if (!user) return 'unknown customer';
      accounts.setPlan(user, { status: 'canceled' });
      return 'subscription canceled';
    }
    default:
      return 'ignored';
  }
}
