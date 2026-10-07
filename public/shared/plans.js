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

// Data that comes from third-party datasets licensed for non-commercial or
// research use. It is shown on the free website only and is never part of
// paid API plans (the server strips it and doesn't fetch it for API calls).
export const WEBSITE_ONLY_DATA = [
  { id: 'popularity', label: 'Global rank & traffic estimates', source: 'Tranco list (includes Cloudflare Radar data, CC BY-NC 4.0)' },
  { id: 'registration', label: 'Domain registration details', source: 'RDAP registries (restrict commercial reuse)' },
  { id: 'archive', label: 'Archive history', source: 'Internet Archive (scholarship and research use)' },
];

// What paid API plans include: Webvieu's own live analysis.
export const API_DATA = [
  'Technology stack (180+ fingerprints)',
  'SEO, performance & security audits',
  'DNS, hosting, email & SaaS footprint',
  'TLS certificate & HTTP details',
  'Content, links, socials & robots.txt / ads.txt',
];

export const WEBSITE_ONLY_NOTE = 'Global rank, traffic estimates, registration and archive history come from third-party data licensed for non-commercial use, so they are available on the free website only and are not part of paid API plans.';
