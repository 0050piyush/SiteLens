// Plans, shared by the server (limits) and the pricing page.
// monthly  = API analyses per calendar month (UTC). Each analyzed site counts
//            once: a comparison or bulk job of N sites uses N, and every
//            monitor check uses 1.
// hourly   = burst limit per hour.
// bulkMax  = most domains in one bulk job.
// monitors = sites that can be watched at once.

export const PLANS = {
  starter: {
    id: 'starter', name: 'Starter', price: 15, monthly: 1000, hourly: 200, bulkMax: 100, monitors: 5,
    blurb: 'For side projects and small tools.',
  },
  pro: {
    id: 'pro', name: 'Pro', price: 50, monthly: 10000, hourly: 1000, bulkMax: 500, monitors: 50,
    blurb: 'For growing products and agencies.', featured: true,
  },
  business: {
    id: 'business', name: 'Business', price: 199, monthly: 50000, hourly: 5000, bulkMax: 1000, monitors: 250,
    blurb: 'For high-volume teams and data pipelines.',
  },
};

export const DEFAULT_PLAN = 'starter';

// The free website (no key): full reports per visitor per day (UTC).
export const FREE_DAILY_REPORTS = 10;
