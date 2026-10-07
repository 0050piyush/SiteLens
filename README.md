# SiteLens: open website intelligence

SiteLens is a self-hostable alternative to traffic-intelligence tools such as Similarweb. Type in any domain and you get:

| Area | What you get | Where it comes from |
| --- | --- | --- |
| **Popularity** | Global rank, 30-day rank history, estimated monthly visits with a low–high range | [Tranco](https://tranco-list.eu) research ranking plus a published power-law model |
| **Technology** | 180+ fingerprints: CMS, frameworks, analytics, ad pixels, CDN, hosting, payments, consent, chat… | Homepage HTML, script URLs, headers, cookies, meta tags |
| **Performance** | DNS, connect, TLS and TTFB timings, compression, HTTP/2/3, page weight, render-blocking scripts | Live request |
| **SEO** | 20 on-page checks, robots.txt, sitemap, structured data, hreflang, blocked AI crawlers | Live crawl of the homepage and well-known files |
| **Security** | TLS certificate, HSTS, CSP and other headers, SPF/DMARC, CAA, security.txt (graded A+–F) | TLS handshake, headers, DNS |
| **Infrastructure** | Hosting provider/ASN, server country, DNS and email providers, IPv6 | DNS and Team Cymru IP-to-ASN |
| **Business signals** | SaaS tools verified on the domain, services sending email for it, ad sellers (ads.txt), social profiles, outbound links | TXT/SPF records, ads.txt, homepage links |
| **History** | Registrar, creation and expiry dates, first Internet Archive capture, years archived | RDAP and the Wayback Machine CDX API |
| **Comparison** | Up to 5 sites side by side with winners highlighted, rank trend overlay, tech overlap, CSV export | All of the above |

Your **last 5 searches** appear as one-click chips and as suggestions in the search and compare boxes, with a Clear button. Reports you've already run are **saved in your browser for 24 hours** (up to 15), so revisiting a site or adding it to a comparison is instant. Re-run forces a fresh check.

The site also has **About us**, **FAQ** (searchable), **Contact us**, **Privacy policy** and **Sitemap** pages, linked from the footer. Contact-form messages are saved to `data/messages.json` and, when email is set up and `SITELENS_CONTACT` is an email address, forwarded to you with Reply going to the sender (5 messages per hour per visitor, with a hidden bot trap). Without the server, the form opens the visitor's email app addressed to `SITELENS_CONTACT`. The privacy policy describes what this code actually stores; review it, and add your business details, before launch.

There's also a **watchlist** that tells you what changed since your last visit, **rankings** (Tranco top sites plus a leaderboard of every site analyzed on your server), **similar sites** (matched by category, topics, tech stack and outbound links), and a **REST API** (key-protected) with an in-browser playground.

### Honest about its limits

Similarweb buys clickstream panel data, which is how it can report traffic sources, referrals and demographics. SiteLens has no such panel, so it doesn't show those numbers, and it never makes up figures for sites it can't rank. Visit estimates come from rank with an explicit model and confidence level, and the formula is shown on every report.

## Run it

You need Node.js 20 or newer. There are no npm dependencies.

```bash
git clone https://github.com/0050piyush/sitelens.git
cd sitelens
npm start            # http://localhost:8080
npm test             # unit + end-to-end tests (fully offline)
npm run tranco       # optional: pre-download the Tranco top-1M list
```

When the server starts it downloads the Tranco list in the background. This turns on the Rankings page and makes rank lookups instant. Per-domain rank history always comes from the Tranco API.

With Docker:

```bash
docker build -t sitelens . && docker run -p 8080:8080 -v sitelens-data:/app/data sitelens
```

### GitHub Pages

The repo includes a workflow (`.github/workflows/pages.yml`) that publishes the frontend to Pages on every push to `main`.

1. The repo must be **public**, unless your GitHub plan includes Pages for private repos.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Re-run the "Deploy to GitHub Pages" workflow, or push a commit.

Pages can only host static files, so by default the site runs in **lite mode**, entirely in the visitor's browser. It shows rank, traffic estimate, DNS, hosting, email and SaaS footprint, email security, registration and archive history, and it supports comparisons. For full reports (tech stack, SEO, performance, security headers), run the server somewhere (Hostinger, Render, a VPS…) and set the repository variable **`SITELENS_API_URL`** (Settings → Secrets and variables → Actions → Variables), for example `https://api.example.com`. The next deploy points the Pages site at that API. On the server, also set `SITELENS_ALLOWED_ORIGINS=https://0050piyush.github.io` so the Pages site may call it without a key. Set the repository variable **`SITELENS_CONTACT`** (an email or https URL) to turn on the pricing page's "Get Starter/Pro/Business" buttons.

### Hostinger (Business or Cloud plans)

1. hPanel → **Websites → Add Website → Node.js Apps → Import Git Repository**, then pick this repo.
2. Node version **22.x**, no build command, start command `npm start` (entry file `server.js`).
3. Environment variables: `NODE_ENV=production`, `SITELENS_TRUST_PROXY=1`, `SITELENS_TRANCO_LIMIT=100000`, plus `SITELENS_API_KEYS` (keys you hand out) and `SITELENS_ALLOWED_ORIGINS=https://0050piyush.github.io` if the GitHub Pages site should use this server.
4. Deploy, then attach your domain or a subdomain. The app listens on the `PORT` Hostinger provides.

The server needs outbound HTTPS and DNS. It connects directly and does not use an `HTTPS_PROXY`.

## API

All endpoints are `GET` and return JSON. The OpenAPI 3.1 spec is served at `/api/openapi.json`.

### Access: private by default

The API is **not** open to the public. Requests are allowed when:

- they come from **SiteLens's own website**: the same origin as the server, or an origin listed in `SITELENS_ALLOWED_ORIGINS` (such as your GitHub Pages site). Website visitors get **10 full reports a day** per IP (`SITELENS_FREE_PER_DAY`); failed lookups don't count, and the site shows an upgrade screen at the limit; or
- they send a valid **API key** in the `X-API-Key` header (or `?api_key=`). Each key belongs to a plan, which sets its limits.

### Plans

| Plan | Price | Analyses / month | Burst / hour | Bulk job size | Monitors |
| --- | --- | --- | --- | --- | --- |
| Website | Free | No API access | 10 reports a day per visitor | | |
| Starter | $15/month | 1,000 | 200 | 100 | 5 |
| Pro | $50/month | 10,000 | 1,000 | 500 | 50 |
| Business | $199/month | 50,000 | 5,000 | 1,000 | 250 |

Plans are defined in `public/shared/plans.js`, which both the server and the pricing page read. Issue a key by adding `key:plan` to `SITELENS_API_KEYS`, for example `SITELENS_API_KEYS=3f9a…:pro,8c21…:starter` (a key without a plan is Starter). A successful request uses one analysis per site (a comparison of 3 sites uses 3); failed requests are free. Usage is stored in `data/usage.json`, resets on the 1st of each month (UTC), and over-quota calls get `429`. Customers can check usage at `GET /api/v1/usage`.

### Accounts and payments

Customers sign up on the **Log in** page, choose a plan, pay through **Stripe Checkout**, and manage everything on their **Account** page:
- **Plan:** shows their plan, its status and this month's usage.
- **API key:** create or rotate it. The full key is shown once; only a hash is stored.
- **Manage billing:** opens Stripe's billing portal, where they can upgrade, downgrade, cancel, update their card or download invoices.

While logged in with an active plan, the website uses their plan instead of the free daily limit.

**Setting up Stripe:**
1. In Stripe, create three recurring monthly **prices**: Starter $15, Pro $50 and Business $199. Copy each price ID (`price_…`).
2. Add a **webhook endpoint** pointing at `https://YOUR-SERVER/api/v1/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Copy its signing secret (`whsec_…`).
3. Turn on the **Customer portal** (Stripe → Settings → Billing → Customer portal) and allow plan switching between the three prices.
4. Set these on the server: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`.

Test with Stripe's test mode keys first (`sk_test_…`, card `4242 4242 4242 4242`). Until all five are set, plan buttons fall back to emailing `SITELENS_CONTACT`.

**Manual payments** (UPI, bank transfer…): set `SITELENS_ADMIN_TOKEN` (16+ random characters). After the customer signs up, grant their plan:

```bash
curl -X POST https://YOUR-SERVER/api/v1/admin/grant -H "X-Admin-Token: $SITELENS_ADMIN_TOKEN" \
  -H "content-type: application/json" -d '{"email": "customer@example.com", "plan": "pro"}'
# {"plan": null} removes it
```

Accounts are stored in `data/users.json`: passwords as scrypt hashes, and sessions and API keys as SHA-256 hashes. **Keep `data/` on persistent storage and back it up.** Some free hosting tiers (Render's free plan, for one) wipe the disk on each deploy, which would delete accounts. **Email (verification and password reset):** new accounts get a "Confirm your email" link (valid for 24 hours), and they must confirm before buying a plan. "Forgot password?" on the login page emails a single-use reset link that's valid for 1 hour. Resetting signs the account out everywhere else, and the reply is the same whether or not the email has an account. To turn email on:

1. Create a free [Resend](https://resend.com) account, verify your sending domain, and create an API key. SendGrid works too.
2. Set `RESEND_API_KEY` (or `SENDGRID_API_KEY`) and `SITELENS_EMAIL_FROM`, for example `SiteLens <noreply@yourdomain.com>`.

Without email configured, signup still works and verification isn't required, but password reset is unavailable. For local development, `SITELENS_EMAIL_PROVIDER=console` prints emails, links included, to the server log.

### Bulk analysis (paid)

```bash
curl -X POST -H "X-API-Key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"domains": ["stripe.com", "adyen.com", "paypal.com"]}' https://your-server/api/v1/bulk
# → 202 {"id": "…", "poll": "/api/v1/bulk/…"}
curl -H "X-API-Key: YOUR_KEY" https://your-server/api/v1/bulk/JOB_ID              # progress + results
curl -H "X-API-Key: YOUR_KEY" "https://your-server/api/v1/bulk/JOB_ID?format=csv" # spreadsheet
```

Jobs run in the background (4 sites at a time), skip duplicates, report invalid domains, and are kept for 24 hours. Each successful site uses one analysis; failed sites are refunded. A job is rejected upfront if it would exceed the month's remaining quota.

### Monitoring and alerts (paid)

```bash
curl -X POST -H "X-API-Key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"domain": "competitor.com", "webhook": "https://your.app/hooks/sitelens", "interval": "weekly"}' \
  https://your-server/api/v1/monitors
```

SiteLens records a baseline right away, then re-checks the site daily or weekly. When something changes it POSTs a `site.changed` event to the webhook. Changes include the site going down or coming back, rank moving by 10%+, any score moving 5+ points, technologies added or removed, a hosting move, a certificate issuer change or expiry within 14 days, and a new homepage title. Each check uses one analysis. Webhooks carry `X-SiteLens-Signature: sha256=<HMAC of the body with the monitor's secret>`; the secret is returned once, when the monitor is created. `GET /api/v1/monitors/{id}` shows status and the last 52 checks, `POST /api/v1/monitors/{id}/test` sends a test webhook, and `DELETE` removes it. Monitors are saved in `data/monitors.json`. Alerts go out by webhook only; email alerts would need a mail provider. Payment is not automated yet: the pricing page's buttons email `SITELENS_CONTACT`, and you add the key.

Everyone else gets `401 An API key is required`, and other websites' browsers get no CORS access. `/api/v1/status` and `/api/openapi.json` stay open for health checks and docs. Set `SITELENS_PUBLIC_API=1` if you ever want an open API.

The website check relies on browser headers (`Origin`, `Sec-Fetch-Site`, `Referer`). A determined script can fake these, so per-IP limits still cap that traffic; real volume always needs a key.

| Endpoint | Description |
| --- | --- |
| `/api/v1/analyze/{domain}` | Full report. `?fresh=1` re-runs it, `?fields=scores,traffic.monthlyVisits` trims the response, `?format=csv` returns CSV |
| `/api/v1/summary/{domain}` | Compact summary: scores, rank, visits, tech names |
| `/api/v1/compare?domains=a.com,b.com` | 2–5 sites side by side (`&format=csv` supported) |
| `/api/v1/rank/{domain}` | Rank, history and traffic estimate only. Fast, no crawl |
| `/api/v1/tech/{domain}` | Technologies grouped by category |
| `/api/v1/top?limit=100` | Tranco top sites |
| `/api/v1/leaderboard?sort=score&category=…` | Sites analyzed on this server |
| `/api/v1/recent` | Recently analyzed sites |
| `/api/v1/usage` | Your key's plan, usage this month and remaining quota |
| `POST /api/v1/bulk`, `GET /api/v1/bulk/{id}` | Bulk analysis jobs (paid) |
| `/api/v1/monitors` (POST, GET), `/api/v1/monitors/{id}` (GET, DELETE) | Site monitoring with webhook alerts (paid) |
| `/api/v1/status` | Health, cache, limits and plans |

```bash
curl -H "X-API-Key: YOUR_KEY" http://localhost:8080/api/v1/analyze/stripe.com
curl -H "X-API-Key: YOUR_KEY" "http://localhost:8080/api/v1/compare?domains=github.com,gitlab.com&format=csv"
```

Reports are cached for 6 hours, and concurrent requests for the same domain share one analysis.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `SITELENS_API_KEYS` | none | Comma-separated `key:plan` entries (plan: `starter`, `pro`, `business`). Required for any caller other than your own website |
| `SITELENS_ALLOWED_ORIGINS` | none | Comma-separated origins of your own frontends allowed to call the API without a key, e.g. `https://0050piyush.github.io` |
| `SITELENS_CONTACT` | none | Your contact email (or URL): pricing buttons, 401 responses, and where contact-form messages are forwarded |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | none | Stripe API key and webhook signing secret (see Accounts and payments) |
| `STRIPE_PRICE_STARTER` / `_PRO` / `_BUSINESS` | none | Stripe price IDs for each plan |
| `RESEND_API_KEY` or `SENDGRID_API_KEY` | none | Email provider for verification and password-reset emails |
| `SITELENS_EMAIL_FROM` | none | Sender, e.g. `SiteLens <noreply@yourdomain.com>` (must be verified with the provider) |
| `SITELENS_ADMIN_TOKEN` | none | Enables `POST /api/v1/admin/grant` for manual payments (16+ characters) |
| `SITELENS_APP_URL` | request origin | Where Stripe sends customers back to, if not the page that started checkout |
| `SITELENS_PUBLIC_API` | off | Set `1` to make the API open to everyone (anonymous limits apply) |
| `SITELENS_FREE_PER_DAY` | `10` | Full reports per day per IP for free website visitors |
| `SITELENS_ANON_PER_HOUR` | `60` | Hourly cap per IP for website visitors |
| `SITELENS_CACHE_HOURS` | `6` | Report cache lifetime |
| `SITELENS_TRUST_PROXY` | off | Set `1` behind a reverse proxy to rate-limit by `X-Forwarded-For` |
| `SITELENS_TRANCO_DOWNLOAD` | on | Set `0` to skip the background list download |
| `SITELENS_TRANCO_LIMIT` | `1000000` | How many list entries to keep in memory (the full list uses about 150 MB) |
| `SITELENS_DATA_DIR` | `./data` | Where the site index is stored |
| `SITELENS_OFFLINE` | off | Skip third-party APIs (Tranco, RDAP, Wayback). Used by the tests |
| `SITELENS_ALLOW_PRIVATE` | off | Allow analyzing private/loopback hosts. **Never enable this on a public server** |

## Security

The analyzer fetches URLs that users choose, so the server guards against SSRF. It resolves every hostname, rejects loopback, private, link-local (including cloud metadata), CGNAT and reserved addresses, pins each connection to the IP it checked, and checks every redirect hop again. IP literals are refused as input. The frontend builds all DOM with `textContent` and serves a strict Content-Security-Policy.

## Layout

```
server.js          HTTP server, routing, rate limits, cache, static files
src/analyze.js     orchestrates one analysis and builds the report
src/fetcher.js     SSRF-safe HTTP client with timings and decompression
src/html.js        regex HTML extraction, link and social analysis
src/tech.js        technology fingerprints
src/dnsinfo.js     DNS, hosting/ASN, email/DNS providers, SaaS verification records
src/tlsinfo.js     certificate, protocol, ALPN
src/audits.js      performance, SEO and security scoring
src/rank.js        Tranco API and list, traffic model, ZIP reader
src/external.js    RDAP, Wayback, robots/sitemap/ads.txt/security.txt/llms.txt
src/classify.js    category classifier and audience signals
src/store.js       report cache and persistent site index (similar sites, leaderboard)
public/            single-page frontend (no build step)
public/lite.js     browser-only analysis used when no API server is reachable
public/shared/     detection tables and traffic model shared by server and browser
test/              node:test suites with a local fixture site
```
