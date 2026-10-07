// Content pages: About, FAQ, Contact, Privacy policy and Sitemap.
// Each view receives `ctx` from app.js: { render, api, hasBackend, contactHref, fmt, CONTACT }.

import { h, ext } from './dom.js';
import { PLANS, FREE_DAILY_REPORTS } from './shared/plans.js';

const SITE = 'SiteLens';
const UPDATED = 'October 7, 2026';
// Fill these in before launch: they appear in the Terms of Service.
const LEGAL = {
  operator: 'SiteLens', // your full name or registered business name
  jurisdiction: '', // e.g. 'India' or 'the State of Delaware, USA'; blank shows a generic clause
};
const DEFAULT_TOPICS = ['General question', 'API plans & sales', 'Account & billing', 'Report a bug', 'Privacy request', 'Partnership'];

const page = (title, lead, ...body) => h('article', { class: 'page' },
  h('header', { class: 'page-head' }, h('h1', null, title), lead ? h('p', { class: 'lead muted' }, lead) : null),
  body);
const section = (title, ...body) => h('section', { class: 'page-section' }, h('h2', null, title), body);
const p = (...c) => h('p', null, c);
const ul = (items) => h('ul', null, items.map((i) => h('li', null, i)));
const plans = () => Object.values(PLANS);
const priceList = () => plans().map((x) => `${x.name} $${x.price}/month`).join(', ');

// ---- About ----------------------------------------------------------------------

export function aboutView(ctx) {
  ctx.render(page(`About ${SITE}`, 'Website intelligence that is honest about what it knows, and priced for everyone.',
    section('Why we built it',
      p('Knowing how a website is built, how popular it is and how healthy it looks shouldn’t require a sales call and a five-figure contract. ',
        `${SITE} gives anyone a clear picture of any website in seconds, and gives developers an affordable API to build on.`),
      p('We also believe estimates should look like estimates. Where we model a number, such as monthly visits, we show a range, a confidence level and the formula, instead of false precision.')),
    section('What SiteLens does',
      h('div', { class: 'grid g2 about-grid' },
        [
          ['Traffic & popularity', 'Global rank from the Tranco research list, 30-day rank history, and modelled monthly visits with a low–high range.'],
          ['Technology stack', '180+ fingerprints: CMS, frameworks, analytics, ad pixels, CDNs, payments, consent tools and hosting.'],
          ['Health audits', 'Live performance timings plus SEO and security checks, each graded with every check explained.'],
          ['Business signals', 'Email and DNS providers, SaaS tools verified on the domain, ad sellers, social profiles and domain history.'],
          ['Compare & monitor', 'Put up to five sites side by side, watch sites for changes, and get alerts by webhook.'],
          ['Open API', `Everything on the site as JSON, with bulk analysis and monitoring, from $${plans()[0].price}/month.`],
        ].map(([t, d]) => h('div', { class: 'card' }, h('h3', null, t), h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, d))))),
    section('How it works',
      h('ol', { class: 'steps-list' },
        h('li', null, h('b', null, 'You enter a domain. '), 'We visit its homepage and well-known files (robots.txt, sitemap, ads.txt), the way a browser would.'),
        h('li', null, h('b', null, 'We run live checks. '), 'DNS, TLS certificate, server timings, technology fingerprints, SEO and security rules.'),
        h('li', null, h('b', null, 'We add open data. '), 'Popularity from Tranco, registration data from RDAP and history from the Internet Archive.'),
        h('li', null, h('b', null, 'You get one clear report. '), 'Scores, explanations and raw data you can export as JSON or CSV.'))),
    section('What makes us different',
      ul([
        h('span', null, h('b', null, 'Honest numbers. '), 'We don’t buy clickstream panels, so we don’t claim traffic sources or demographics. What we show, we can explain.'),
        h('span', null, h('b', null, 'Live, not stale. '), 'Reports are generated when you ask, from the site itself.'),
        h('span', null, h('b', null, 'Fair pricing. '), `The website is free (${FREE_DAILY_REPORTS} full reports a day). API plans: ${priceList()}. No contracts.`),
        h('span', null, h('b', null, 'Privacy-friendly. '), 'No ads, no tracking cookies, no third-party analytics. See our ', h('a', { href: '#/privacy' }, 'privacy policy'), '.'),
      ])),
    section('Data sources & credits',
      p('Popularity data comes from the ', ext('https://tranco-list.eu', 'Tranco list'), ', a research-grade ranking. Registration data comes from RDAP registries, archive history from the ',
        ext('https://archive.org', 'Internet Archive'), ', and IP network data from Team Cymru. We are grateful to these open projects.'),
      p(`${SITE} is independent and is not affiliated with Similarweb, BuiltWith, Semrush or any other analytics company.`)),
    h('div', { class: 'card page-cta' },
      h('div', null, h('h3', null, 'Questions or ideas?'), h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'We read every message.')),
      h('div', { class: 'report-actions' }, h('a', { class: 'btn primary', href: '#/contact' }, 'Contact us'), h('a', { class: 'btn', href: '#/faq' }, 'Read the FAQ')))));
}

// ---- FAQ ------------------------------------------------------------------------

function faqItems() {
  const [starter] = plans();
  return [
    ['General', [
      ['What is SiteLens?', `${SITE} analyzes any website and shows its popularity, estimated traffic, technology stack, performance, SEO, security, hosting and history in one report. You can compare sites, watch them for changes, and use the same data through our API.`],
      ['Is SiteLens free?', `Yes. The website is free, with ${FREE_DAILY_REPORTS} full reports a day per visitor. Results you have already opened, and your recent searches, stay available instantly. The API (for your own apps and scripts) is paid: ${priceList()}.`],
      ['How accurate are the traffic numbers?', 'Monthly visits are estimates. We model them from a site’s Tranco rank using a published formula, and show a low–high range and a confidence level. They are good for comparing sites and spotting trends, not for exact figures. For sites outside the top 1 million we show “< 10K” rather than inventing a number.'],
      ['Where does the data come from?', 'Most of each report comes from live checks of the website itself: its homepage, headers, DNS, TLS certificate and public files like robots.txt. Popularity comes from the Tranco research list, domain registration from RDAP, and history from the Internet Archive.'],
      ['Why don’t you show traffic sources or demographics?', 'Those numbers come from paid clickstream panels that track people’s browsing. We don’t buy or use that kind of data, so we don’t show it. We’d rather show less than make things up.'],
      ['What does “Lite mode” mean?', 'When SiteLens runs without its server (for example on a static host), it works entirely in your browser. You still get rank, traffic estimates, DNS, hosting, email, registration and history, but tech stack, SEO, performance and security-header audits need the server.'],
      ['Why couldn’t a site be analyzed?', 'The site may be down, very slow, blocking automated visitors, or the domain may not exist. Try again in a minute with “Re-run”. Failed lookups never count against your limits.'],
    ]],
    ['Plans & API', [
      ['How do I get an API key?', 'Create an account, choose a plan on the Pricing page and pay securely through Stripe. Then click “Create API key” on your Account page. The key is shown once, so copy it somewhere safe.'],
      ['What counts as an analysis?', 'Each successful report for one website. Comparing 3 sites counts 3, a bulk job counts one per site, and each monitor check counts one. Failed requests (invalid or unreachable domains) are free.'],
      ['What happens if I reach my limit?', 'The API returns HTTP 429 with a clear message until your monthly quota resets on the 1st (UTC). You can upgrade anytime from “Manage billing” on your Account page.'],
      ['Can I change or cancel my plan?', 'Yes, anytime, from “Manage billing” on your Account page. Upgrades apply right away. If you cancel, your plan stays active until the end of the period you paid for.'],
      ['Do you offer refunds?', 'If something isn’t working the way you expected, contact us. We review refund requests individually and aim to be fair.'],
      ['What are bulk analysis and monitoring?', `Bulk analysis runs a list of domains in one job (up to ${starter.bulkMax} on ${starter.name}) and returns JSON or CSV. Monitoring re-checks sites daily or weekly and sends a signed webhook when something changes, such as downtime, rank moves, new technologies or certificate expiry.`],
      ['Is there a free trial of the API?', `Not at the moment, but the free website lets you try every report first, and ${starter.name} starts at $${starter.price}/month with no contract.`],
    ]],
    ['Privacy & data', [
      ['Do you store the websites I search?', 'A short summary of analyzed sites (title, scores, rank, technologies) is kept on our server and may appear in “Recently analyzed” and Rankings. Your own recent searches and saved results are stored only in your browser.'],
      ['Do you use cookies or trackers?', 'No tracking cookies, no ads and no third-party analytics. We use your browser’s local storage for things like your theme, recent searches, saved results and login.'],
      ['I own a website. Can I opt out of SiteLens?', 'Yes. Contact us with the domain and we’ll stop showing it publicly and exclude it from future checks.'],
      ['How do I delete my account?', 'Cancel any active plan in “Manage billing”, then contact us from your account email and we’ll delete your account and its data.'],
      ['Is SiteLens affiliated with Similarweb?', 'No. SiteLens is an independent project and is not affiliated with Similarweb or any other analytics company.'],
    ]],
  ];
}

export function faqView(ctx) {
  const groups = faqItems();
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search questions…', 'aria-label': 'Search the FAQ' });
  const empty = h('p', { class: 'muted', hidden: true }, 'No questions match. ', h('a', { href: '#/contact' }, 'Ask us directly →'));
  const sections = groups.map(([title, items]) => h('section', { class: 'page-section faq-group' },
    h('h2', null, title),
    items.map(([q, a]) => h('details', { class: 'faq-item' }, h('summary', null, q), h('p', null, a)))));
  search.addEventListener('input', () => {
    const term = search.value.trim().toLowerCase();
    let shown = 0;
    for (const sec of sections) {
      let any = false;
      for (const d of sec.querySelectorAll('.faq-item')) {
        const match = !term || d.textContent.toLowerCase().includes(term);
        d.hidden = !match;
        if (match) { any = true; shown++; }
        if (term && match) d.open = true;
      }
      sec.hidden = !any;
    }
    empty.hidden = shown > 0;
  });
  ctx.render(page('Frequently asked questions', 'Quick answers about reports, plans, the API and your data.',
    h('div', { class: 'faq-search' }, search),
    sections,
    empty,
    h('div', { class: 'card page-cta' },
      h('div', null, h('h3', null, 'Still have a question?'), h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'We usually reply within 1–2 business days.')),
      h('a', { class: 'btn primary', href: '#/contact' }, 'Contact us'))));
}

// ---- Contact --------------------------------------------------------------------

export async function contactView(ctx, params) {
  const backend = await ctx.hasBackend();
  let topics = DEFAULT_TOPICS;
  if (backend) {
    try { topics = (await ctx.api('/api/v1/status')).contactTopics || DEFAULT_TOPICS; } catch { /* defaults */ }
  }
  const mailto = !backend && ctx.CONTACT ? ctx.contactHref(ctx.CONTACT, `${SITE}: message`) : null;
  const canSend = backend || !!mailto;

  const name = h('input', { class: 'field', name: 'name', autocomplete: 'name', required: true, maxlength: '100', placeholder: 'Your name', 'aria-label': 'Your name' });
  const email = h('input', { class: 'field', name: 'email', type: 'email', autocomplete: 'email', required: true, placeholder: 'you@company.com', 'aria-label': 'Your email' });
  const topic = h('select', { class: 'field', name: 'topic', 'aria-label': 'Topic' }, topics.map((t) => h('option', { value: t }, t)));
  const wanted = params?.get('topic');
  if (wanted && topics.includes(wanted)) topic.value = wanted;
  const message = h('textarea', { class: 'field', name: 'message', required: true, minlength: '10', maxlength: '5000', rows: '6', placeholder: 'How can we help?', 'aria-label': 'Message' });
  // Honeypot for bots: hidden from people and screen readers.
  const trap = h('input', { name: 'website', tabindex: '-1', autocomplete: 'off', class: 'hp', 'aria-hidden': 'true' });
  const status = h('div', { class: 'form-error', role: 'status' });
  const submit = h('button', { class: 'btn primary', type: 'submit', disabled: !canSend || null },
    backend ? 'Send message' : mailto?.startsWith('mailto:') ? 'Write email' : 'Contact us');
  const form = h('form', { class: 'contact-form' },
    h('div', { class: 'form-row' }, h('label', null, 'Name', name), h('label', null, 'Email', email)),
    h('label', null, 'Topic', topic),
    h('label', null, 'Message', message),
    trap, status, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    if (!backend) {
      // No server: open the visitor's email app with the message filled in.
      const subject = `${SITE}: ${topic.value}`;
      const body = `${message.value}\n\n— ${name.value} (${email.value})`;
      location.href = mailto.startsWith('mailto:')
        ? `${mailto.split('?')[0]}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
        : mailto; // the contact setting is a web page, not an email address
      return;
    }
    submit.disabled = true;
    try {
      const res = await ctx.api('/api/v1/contact', { method: 'POST', body: { name: name.value, email: email.value, topic: topic.value, message: message.value, website: trap.value } });
      form.replaceWith(h('div', { class: 'callout contact-done' }, h('b', null, 'Message sent. '), res.message));
    } catch (err) {
      status.textContent = err.message;
      submit.disabled = false;
    }
  });

  ctx.render(page('Contact us', 'Questions about reports, API plans, billing or your data? Send us a message.',
    h('div', { class: 'contact-layout' },
      h('div', { class: 'card' },
        canSend ? null : h('div', { class: 'callout', style: { marginBottom: '14px' } }, 'The contact form isn’t set up on this copy of the site yet. Please check back soon.'),
        form),
      h('aside', { class: 'contact-side' },
        h('div', { class: 'card' }, h('h3', null, 'Quick answers'), h('p', { class: 'muted small' }, 'Most questions about limits, plans and data are answered in the FAQ.'), h('a', { href: '#/faq' }, 'Read the FAQ →')),
        h('div', { class: 'card' }, h('h3', null, 'Response time'), h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, 'We usually reply within 1–2 business days. Business plan customers get priority.')),
        h('div', { class: 'card' }, h('h3', null, 'Privacy requests'), h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, 'To access or delete your data, choose “Privacy request” and write from your account email.'))))));
}

// ---- Privacy policy -------------------------------------------------------------

export function privacyView(ctx) {
  const contactLink = h('a', { href: '#/contact?topic=Privacy%20request' }, 'contact form');
  ctx.render(page('Privacy policy', `Last updated: ${UPDATED}`,
    h('div', { class: 'callout' }, h('b', null, 'In short: '), `${SITE} doesn’t sell your data, show ads, or use tracking cookies or third-party analytics. We collect only what the service needs to work, and you can ask us to delete it.`),
    section('1. Who we are',
      p(`This policy explains how ${SITE} (“we”, “us”) handles information when you use our website and API. It should be read with our `, h('a', { href: '#/terms' }, 'Terms of Service'), '. If you have questions, reach us through our ', contactLink, '.')),
    section('2. Information we collect',
      h('h3', null, 'When you analyze a website'),
      ul([
        'The domain names you look up, and the public report we generate for them. A short summary (title, category, scores, rank and technologies) is stored on our server and may appear publicly in “Recently analyzed” and Rankings.',
        'Your IP address, kept briefly in memory to apply rate limits and the free daily allowance. It is not written to our logs or database for this purpose.',
      ]),
      h('h3', null, 'When you create an account'),
      ul([
        'Your email address and whether you have confirmed it.',
        'Your password, stored only as a one-way scrypt hash. We cannot see your password.',
        'Login sessions and API keys, stored only as SHA-256 hashes.',
        'Your plan, its status, and the customer and subscription IDs from our payment provider.',
        'Usage counts for the current month, and any monitors (domain, webhook URL and check history) and bulk jobs you create.',
      ]),
      h('h3', null, 'When you contact us'),
      ul(['Your name, email address, topic, message, and the IP address it was sent from (to prevent abuse).']),
      h('h3', null, 'What we never collect'),
      ul(['Card numbers: payments are handled entirely by Stripe.', 'Clickstream or browsing data about you, and data from advertising networks.'])),
    section('3. Information stored in your browser',
      p('We don’t use cookies. We use your browser’s local storage, which stays on your device, for:'),
      ul(['Your light/dark theme preference.', 'Your last 5 searches and up to 15 saved reports (kept for 24 hours) so pages open instantly.', 'Your watchlist.', 'Your login session, if you log in.']),
      p('“Clear” next to your recent searches removes them; clearing your browser’s site data for this website removes everything else (saved reports expire on their own after 24 hours).')),
    section('4. How we use information',
      ul([
        'To generate reports, run the API, and operate your account, plan, monitors and bulk jobs.',
        'To process payments and send you service emails: email confirmation, password resets and replies to your messages. We don’t send marketing emails.',
        'To prevent abuse, enforce limits and keep the service secure.',
      ])),
    section('5. Services we share data with',
      p('We share the minimum needed with these providers, who process it on our behalf:'),
      ul([
        h('span', null, h('b', null, 'Stripe'), ' processes payments and subscriptions (see ', ext('https://stripe.com/privacy', 'Stripe’s privacy policy'), ').'),
        h('span', null, h('b', null, 'Our email provider'), ' (Resend or SendGrid) delivers account emails.'),
        h('span', null, h('b', null, 'Our hosting provider'), ' runs the servers that store the data described here.'),
        h('span', null, h('b', null, 'Public data sources'), ' (Tranco, RDAP registries, the Internet Archive and Team Cymru) receive the domain names being analyzed, never your personal details.'),
      ]),
      p('When SiteLens runs in “Lite mode”, your browser contacts some of these public sources directly (for example Google Public DNS, Tranco, rdap.org and the Internet Archive), so they can see your IP address. Website icons in reports are loaded directly from the analyzed websites.'),
      p('We do not sell or rent personal information, and we don’t share it for advertising.')),
    section('6. How long we keep data',
      ul([
        'Report caches: about 6 hours. Bulk job results: 24 hours.',
        'Site summaries in “Recently analyzed”: until removed or replaced.',
        'Account data, usage and monitors: while your account exists. Email links expire after 1 hour (password reset) or 24 hours (confirmation).',
        'Contact messages: as long as needed to handle your request, and at most the latest 5,000 messages.',
        'Payment records are kept by Stripe as required by law.',
      ])),
    section('7. Security',
      p('Passwords, sessions, API keys and email links are stored only as hashes; webhooks and payment events are verified with signatures; and our server refuses requests to private network addresses. No system is perfectly secure, so please use a unique password and keep your API key private.')),
    section('8. Your rights',
      p('Depending on where you live (for example under the GDPR in the EU/UK or the Digital Personal Data Protection Act in India), you may have the right to access, correct, export or delete your personal data, and to object to or restrict its use. To make a request, use our ', contactLink, ' from your account email and choose “Privacy request”. We respond within 30 days.')),
    section('9. For website owners',
      p(`${SITE} analyzes publicly available information about websites, with a visitor identified as “SiteLensBot”. If you own a site and want it excluded from public listings and future checks, contact us with the domain.`)),
    section('10. Children',
      p(`${SITE} is not directed at children under 16, and we don’t knowingly collect their personal data.`)),
    section('11. Changes to this policy',
      p('If we make material changes, we’ll update the date at the top and, for significant changes, notify account holders by email.')),
    section('12. Contact',
      p('Questions or requests about privacy: use our ', contactLink, '.'))));
}

// ---- Terms of Service -----------------------------------------------------------

export function termsView(ctx) {
  const contactLink = h('a', { href: '#/contact' }, 'contact form');
  const [starter, pro, business] = plans();
  ctx.render(page('Terms of Service', `Last updated: ${UPDATED}`,
    h('div', { class: 'callout' }, h('b', null, 'In short: '),
      'use SiteLens fairly, keep your API key private, and remember our traffic numbers are estimates. Paid plans renew monthly until you cancel, and you can cancel anytime.'),
    section('1. Agreement',
      p(`These Terms of Service (“Terms”) are an agreement between you and ${LEGAL.operator} (“${SITE}”, “we”, “us”) for your use of the ${SITE} website, reports and API (the “Service”). By using the Service or creating an account, you agree to these Terms and to our `, h('a', { href: '#/privacy' }, 'Privacy policy'), '. If you use the Service for an organization, you confirm you are allowed to accept these Terms for it.'),
      p('You must be at least 16 years old to use the Service.')),
    section('2. The Service',
      p(`${SITE} analyzes publicly available information about websites: their homepages, public files (such as robots.txt and sitemaps), DNS records, TLS certificates, and open data sources (such as the Tranco list, RDAP registries and the Internet Archive). We may add, change or remove features over time.`),
      p(`The website is free to use within a fair-use allowance (currently ${FREE_DAILY_REPORTS} full reports per visitor per day). API access requires a paid plan.`)),
    section('3. Accounts',
      ul([
        'Give us a valid email address and keep your login details secure. You are responsible for activity on your account.',
        'Tell us promptly if you think your account or API key has been compromised. You can create a new key at any time, which disables the old one.',
        'One person or organization per account. Don’t create multiple accounts to get around limits.',
      ])),
    section('4. Plans, billing and cancellation',
      ul([
        h('span', null, `API plans are monthly subscriptions: ${starter.name} ($${starter.price}), ${pro.name} ($${pro.price}) and ${business.name} ($${business.price}) per month, each with the quotas shown on our `, h('a', { href: '#/pricing' }, 'Pricing page'), '.'),
        'Payments are processed by Stripe. Prices are in US dollars and may not include taxes, which are added where required.',
        'Subscriptions renew automatically each month until cancelled. You can upgrade, downgrade or cancel anytime from “Manage billing” on your Account page.',
        'If you cancel, your plan stays active until the end of the period you have paid for, then ends. Unused analyses do not roll over to the next month.',
        'If a payment fails, we may pause API access until it succeeds.',
        'We may change prices with at least 30 days’ notice by email; changes apply from your next billing period, and you can cancel before then.',
      ])),
    section('5. Refunds',
      p('If the Service did not work as described, contact us and we will review your request fairly and individually. Nothing in these Terms limits any refund rights you have under the consumer laws that apply to you.')),
    section('6. API keys, quotas and fair use',
      ul([
        'Keep API keys secret. Don’t publish them in public code or share them outside your organization.',
        'Each plan has a monthly quota and an hourly limit. Over the limit, the API returns HTTP 429 until the quota resets or you upgrade.',
        'Don’t try to get around limits, for example by rotating accounts, spoofing headers, or scraping the website instead of using the API.',
        'Monitors and webhooks must point to systems you own or are authorized to use.',
      ])),
    section('7. Acceptable use',
      p('You agree not to:'),
      ul([
        'Use the Service to break any law, or to harass, stalk or harm anyone.',
        'Use the Service to attack, overload or probe websites or networks you are not authorized to test.',
        'Interfere with, disrupt, or try to gain unauthorized access to the Service or other users’ accounts.',
        'Resell or redistribute the Service or its data as a competing product, or present it as your own data source, without our written permission. Using reports and API results inside your own products, analysis and client work is fine.',
        'Remove credits or notices about the third-party data sources we use.',
      ])),
    section('8. Accuracy of data',
      p('Reports combine live checks with third-party data. Traffic and visit figures are statistical estimates modelled from public rankings, shown with ranges, and may differ significantly from a site’s real traffic. Scores reflect automated checks at the time of analysis. Don’t rely on the Service as your only basis for financial, legal, security or investment decisions.')),
    section('9. Third-party services and data',
      p('The Service relies on third parties, including Stripe, our email and hosting providers, and public data sources such as the Tranco list, RDAP registries, the Internet Archive and Team Cymru. Their availability and terms are outside our control, and some data may be subject to their own conditions.')),
    section('10. Your content',
      p('You keep ownership of anything you send us, such as contact messages and the domain lists you submit. You give us permission to use it only to provide and improve the Service. Don’t submit anything you don’t have the right to share.')),
    section('11. Our intellectual property',
      p(`The Service, including its software, design and branding, belongs to ${LEGAL.operator} or its licensors. These Terms don’t give you any rights to our trademarks. Reports and data you obtain through the Service may be used under these Terms.`)),
    section('12. Availability and changes',
      p('We work to keep the Service running, but it is provided without a guaranteed uptime unless we agree otherwise in writing. We may perform maintenance, and may modify or discontinue features. If we discontinue the Service entirely, we will give paid subscribers reasonable notice and a pro-rated refund for any prepaid period.')),
    section('13. Suspension and termination',
      p('You can stop using the Service and close your account at any time. We may suspend or close accounts that break these Terms, put the Service or others at risk, or stay unpaid. Where reasonable, we will tell you first and give you a chance to fix the problem.')),
    section('14. Disclaimers',
      p('To the extent permitted by law, the Service is provided “as is” and “as available”, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, accuracy and non-infringement.')),
    section('15. Limitation of liability',
      p(`To the extent permitted by law, ${LEGAL.operator} will not be liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue or data. Our total liability for any claim relating to the Service is limited to the amount you paid us in the 12 months before the claim (or US$50 if you have not paid us). Some places don’t allow these limits, so they may not apply to you.`)),
    section('16. Indemnity',
      p(`If you misuse the Service or break these Terms, you agree to cover reasonable losses and costs that ${LEGAL.operator} incurs as a result, including from third-party claims.`)),
    section('17. Changes to these Terms',
      p('We may update these Terms. If a change is material, we will update the date above and notify account holders by email at least 14 days before it takes effect. Continuing to use the Service after that means you accept the updated Terms.')),
    section('18. Governing law',
      p(LEGAL.jurisdiction
        ? `These Terms are governed by the laws of ${LEGAL.jurisdiction}, and disputes will be handled by its courts, except where your local consumer law gives you the right to bring proceedings where you live.`
        : `These Terms are governed by the laws of the country where ${LEGAL.operator} is established, except where your local consumer law gives you the right to bring proceedings where you live.`)),
    section('19. Contact',
      p('Questions about these Terms? Reach us through our ', contactLink, '.'))));
}

// ---- Sitemap --------------------------------------------------------------------

export async function sitemapView(ctx) {
  const backend = await ctx.hasBackend();
  const groups = [
    ['Product', [
      ['#/', 'Home', 'Analyze any website'],
      ['#/compare', 'Compare websites', 'Up to five sites side by side'],
      ['#/pricing', 'Pricing', 'Free website and API plans'],
      backend && ['#/top', 'Rankings', 'Top sites and the analyzed leaderboard'],
      backend && ['#/api', 'API documentation', 'Endpoints, limits and a playground'],
    ]],
    ['Account', backend ? [
      ['#/login', 'Log in', 'Or create an account'],
      ['#/account', 'Your account', 'Plan, usage and API key'],
      ['#/forgot', 'Forgot password', 'Get a reset link by email'],
    ] : []],
    ['Company', [
      ['#/about', 'About us', 'What SiteLens is and how it works'],
      ['#/faq', 'FAQ', 'Answers about reports, plans and data'],
      ['#/contact', 'Contact us', 'Send us a message'],
    ]],
    ['Legal', [
      ['#/terms', 'Terms of Service', 'The rules for using SiteLens'],
      ['#/privacy', 'Privacy policy', 'How we handle your data'],
      ['#/sitemap', 'Sitemap', 'This page'],
    ]],
    ['Popular reports', ['github.com', 'wikipedia.org', 'stripe.com', 'nytimes.com', 'shopify.com', 'vercel.com'].map((d) => [`#/site/${d}`, d, 'Sample report'])],
  ].map(([t, links]) => [t, links.filter(Boolean)]).filter(([, links]) => links.length);

  ctx.render(page('Sitemap', 'Every page on SiteLens in one place.',
    h('div', { class: 'sitemap-grid' }, groups.map(([title, links]) => h('section', { class: 'card' },
      h('h2', null, title),
      h('ul', { class: 'sitemap-list' }, links.map(([href, label, desc]) => h('li', null, h('a', { href }, label), h('span', { class: 'muted small' }, desc)))))))));
}
