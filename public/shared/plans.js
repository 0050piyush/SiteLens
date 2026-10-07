// API plans, shared by the server (quotas) and the pricing page.
// monthly = API analyses per calendar month (a comparison counts one per site);
// hourly = burst limit per hour.

export const PLANS = {
  starter: { id: 'starter', name: 'Starter', price: 15, monthly: 1000, hourly: 200, blurb: 'For side projects and small tools.' },
  pro: { id: 'pro', name: 'Pro', price: 50, monthly: 10000, hourly: 1000, blurb: 'For growing products and agencies.', featured: true },
  business: { id: 'business', name: 'Business', price: 199, monthly: 50000, hourly: 5000, blurb: 'For high-volume teams and data pipelines.' },
};

export const DEFAULT_PLAN = 'starter';
