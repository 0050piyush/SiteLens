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

There's also a **watchlist** that tells you what changed since your last visit, **rankings** (Tranco top sites plus a leaderboard of every site analyzed on your server), **similar sites** (matched by category, topics, tech stack and outbound links), and a **free REST API** with an in-browser playground.

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

### Hostinger (Business or Cloud plans)

1. hPanel → **Websites → Add Website → Node.js Apps → Import Git Repository**, then pick this repo.
2. Node version **22.x**, no build command, start command `npm start` (entry file `server.js`).
3. Environment variables: `NODE_ENV=production`, `SITELENS_TRUST_PROXY=1`, `SITELENS_TRANCO_LIMIT=100000`.
4. Deploy, then attach your domain or a subdomain. The app listens on the `PORT` Hostinger provides.

The server needs outbound HTTPS and DNS. It connects directly and does not use an `HTTPS_PROXY`.

## API

All endpoints are `GET` and return JSON with open CORS. The OpenAPI 3.1 spec is served at `/api/openapi.json`.

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
| `/api/v1/status` | Health, cache and limits |

```bash
curl http://localhost:8080/api/v1/analyze/stripe.com
curl "http://localhost:8080/api/v1/compare?domains=github.com,gitlab.com&format=csv"
```

Reports are cached for 6 hours, and concurrent requests for the same domain share one analysis.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `SITELENS_API_KEYS` | none | Comma-separated keys. Callers sending `X-API-Key` get the higher limit |
| `SITELENS_ANON_PER_HOUR` | `60` | Analyses per hour per IP without a key |
| `SITELENS_KEY_PER_HOUR` | `1000` | Analyses per hour per key |
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
test/              node:test suites with a local fixture site
```
