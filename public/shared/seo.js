// Page titles, descriptions and indexing rules, shared by the browser app
// (when it navigates) and the prerenderer (for the HTML crawlers receive).

import { PLANS, FREE_DAILY_REPORTS } from './plans.js';

export const SITE_NAME = 'Webvieu';
export const TAGLINE = 'See any website clearly';

// Sites with a prebuilt, indexable report page. They also get linked from
// the home page and sitemap, so search engines and AI crawlers can find them.
export const POPULAR_DOMAINS = [
  'google.com', 'youtube.com', 'facebook.com', 'wikipedia.org', 'instagram.com', 'amazon.com', 'reddit.com', 'x.com',
  'linkedin.com', 'netflix.com', 'github.com', 'microsoft.com', 'apple.com', 'yahoo.com', 'bing.com', 'tiktok.com',
  'openai.com', 'chatgpt.com', 'whatsapp.com', 'pinterest.com', 'ebay.com', 'twitch.tv', 'stackoverflow.com', 'nytimes.com',
  'cnn.com', 'bbc.com', 'spotify.com', 'zoom.us', 'paypal.com', 'shopify.com', 'stripe.com', 'vercel.com',
  'wordpress.com', 'medium.com', 'quora.com', 'imdb.com', 'booking.com', 'airbnb.com', 'dropbox.com', 'adobe.com',
  'salesforce.com', 'notion.so', 'canva.com', 'figma.com', 'cloudflare.com', 'discord.com', 'duckduckgo.com', 'etsy.com',
  'walmart.com', 'hubspot.com', 'slack.com', 'tripadvisor.com',
];

/** Popular sites to cross-link from a report page (the next few in the list). */
export function relatedDomains(domain, n = 6) {
  const i = POPULAR_DOMAINS.indexOf(domain);
  const start = i < 0 ? 0 : i + 1;
  return Array.from({ length: n }, (_, k) => POPULAR_DOMAINS[(start + k) % POPULAR_DOMAINS.length]).filter((d) => d !== domain);
}

const INDEX = 'index,follow,max-image-preview:large,max-snippet:-1';
const NOINDEX = 'noindex,follow';
const fromPrice = () => Math.min(...Object.values(PLANS).map((p) => p.price));

const PAGES = {
  '': {
    title: 'Webvieu: Free Website Traffic Checker & Tech Stack Lookup',
    description: `Check any website's estimated traffic, global rank, tech stack, SEO, performance and security for free. Compare sites side by side. API from $${fromPrice()}/month.`,
  },
  compare: {
    title: 'Compare Websites: Traffic, Rank & Tech Side by Side · Webvieu',
    description: 'Compare up to five websites side by side: estimated monthly visits, global rank, technology stack, SEO, performance and security scores. Free, no sign-up.',
  },
  pricing: {
    title: `Pricing: Free Website Reports, API from $${fromPrice()}/month · Webvieu`,
    description: `The Webvieu website is free with ${FREE_DAILY_REPORTS} full reports a day. API plans: ${Object.values(PLANS).map((p) => `${p.name} $${p.price}/month`).join(', ')}. No contracts, cancel anytime.`,
  },
  rankings: {
    title: 'Top Websites Ranking: Most Visited Sites & Best Scores · Webvieu',
    description: 'The most visited websites in the world by global rank, plus leaderboards of sites analyzed on Webvieu by performance, SEO and security score.',
  },
  'api-docs': {
    title: 'Website Intelligence API: Tech Stack, SEO & DNS Data · Webvieu',
    description: `A JSON API for technology detection, SEO, performance and security audits, DNS, hosting and TLS data, with bulk jobs and change monitoring. Plans from $${fromPrice()}/month.`,
  },
  about: {
    title: 'About Webvieu: Honest, Affordable Website Intelligence',
    description: 'Webvieu shows how popular any website is, how it is built and how healthy it looks, with honest estimates. Learn how it works and where the data comes from.',
  },
  methodology: {
    title: 'How Webvieu Estimates Website Traffic: Methodology',
    description: 'How Webvieu turns Tranco rank into monthly visit estimates, how confident they are, how 180+ technologies are detected and how site scores are calculated.',
  },
  faq: {
    title: 'Webvieu FAQ: Traffic Estimates, Data Sources, Plans & API',
    description: 'Answers about Webvieu reports, how accurate traffic estimates are, where the data comes from, API plans, limits, billing and privacy.',
  },
  contact: {
    title: 'Contact Webvieu',
    description: 'Questions about Webvieu reports, API plans, billing or your data? Send us a message. We usually reply within 1–2 business days.',
  },
  privacy: { title: 'Privacy Policy · Webvieu', description: 'How Webvieu handles information when you use the website and API: what we collect, why, how long we keep it and your choices.' },
  terms: { title: 'Terms of Service · Webvieu', description: 'The terms for using the Webvieu website, reports and API, including plans, billing, acceptable use and limits of liability.' },
  sitemap: { title: 'Sitemap · Webvieu', description: 'Every page on Webvieu in one place: tools, plans, company pages, legal pages and popular website reports.' },
  login: { title: 'Log in · Webvieu', description: 'Log in to your Webvieu account to manage your API plan and key.', robots: NOINDEX },
  account: { title: 'Your account · Webvieu', description: 'Your Webvieu plan, usage and API key.', robots: NOINDEX },
  forgot: { title: 'Forgot password · Webvieu', description: 'Get a link to reset your Webvieu password.', robots: NOINDEX },
  reset: { title: 'Reset password · Webvieu', description: 'Choose a new Webvieu password.', robots: NOINDEX },
  verify: { title: 'Confirm email · Webvieu', description: 'Confirm your Webvieu email address.', robots: NOINDEX },
};

/**
 * Metadata for a page. `arg` is the decoded URL argument (a domain for
 * site pages). `indexed` marks a site the server has a report for.
 */
export function seoFor(view, arg = '', { indexed = false } = {}) {
  if (view === 'site' && arg) {
    return {
      title: `${arg} Traffic, Rank & Tech Stack · Webvieu`,
      description: `${arg} traffic estimate, global rank, tech stack, SEO, performance and security scores, hosting, DNS and domain history. Free website report.`,
      robots: POPULAR_DOMAINS.includes(arg) || indexed ? INDEX : NOINDEX,
    };
  }
  if (view === 'compare' && arg) {
    const sites = arg.split(',').filter(Boolean);
    return {
      title: `${sites.join(' vs ')}: Website Comparison · Webvieu`,
      description: `Compare ${sites.join(', ')} side by side: estimated traffic, global rank, tech stack, SEO, performance and security.`,
      robots: NOINDEX, // endless combinations; the main compare page is indexed
    };
  }
  if (view === 'rankings' && arg) return { ...PAGES.rankings, robots: NOINDEX };
  const page = PAGES[view];
  if (!page) return { title: 'Page not found · Webvieu', description: PAGES[''].description, robots: 'noindex,nofollow', notFound: true };
  return { robots: INDEX, ...page };
}
