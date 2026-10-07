const domainParam = { name: 'domain', in: 'path', required: true, schema: { type: 'string' }, example: 'github.com' };
const err = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };

export function openapi(version) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SiteLens API',
      version,
      description: 'Website intelligence: popularity rank and traffic estimates, technology stack, SEO, performance, security, DNS/hosting, registration and archive history for any domain. Requires an API key in the X-API-Key header.',
      license: { name: 'MIT' },
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Required for all data endpoints.' } },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } } },
        Scores: { type: 'object', properties: { overall: { type: 'integer' }, performance: { type: 'integer' }, seo: { type: 'integer' }, security: { type: 'integer' } } },
      },
    },
    security: [{ ApiKey: [] }],
    paths: {
      '/api/v1/analyze/{domain}': {
        get: {
          summary: 'Full report for a domain',
          description: 'Runs (or returns a cached) analysis. Cached for 6 hours; pass fresh=1 to re-run. API-key responses contain SiteLens\'s own live analysis and omit rank, traffic, domainInfo (registration/archive) and include a dataScope object explaining why; those fields are available on the free website only.',
          parameters: [
            domainParam,
            { name: 'fresh', in: 'query', schema: { type: 'string', enum: ['1'] } },
            { name: 'fields', in: 'query', schema: { type: 'string' }, description: 'Comma-separated dotted paths to return, e.g. scores,traffic.monthlyVisits,tech.list' },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } },
          ],
          responses: { 200: { description: 'Report' }, 400: err, 403: err, 429: err, 502: err },
        },
      },
      '/api/v1/summary/{domain}': { get: { summary: 'Compact summary (scores, rank, visits, tech names)', parameters: [domainParam], responses: { 200: { description: 'Summary' } } } },
      '/api/v1/compare': {
        get: {
          summary: 'Compare 2–5 domains side by side',
          parameters: [
            { name: 'domains', in: 'query', required: true, schema: { type: 'string' }, example: 'github.com,gitlab.com' },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } },
          ],
          responses: { 200: { description: 'Comparison' }, 400: err },
        },
      },
      '/api/v1/rank/{domain}': { get: { 'x-website-only': true, summary: 'Tranco rank, 30-day rank history and traffic estimate (free website only; API keys get 403)', parameters: [domainParam], responses: { 200: { description: 'Rank' } } } },
      '/api/v1/tech/{domain}': { get: { summary: 'Detected technologies grouped by category', parameters: [domainParam], responses: { 200: { description: 'Technologies' } } } },
      '/api/v1/top': {
        get: {
          'x-website-only': true,
          summary: 'Top sites from the Tranco list (free website only; API keys get 403)',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', maximum: 1000 } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: { description: 'Top sites' }, 503: err },
        },
      },
      '/api/v1/leaderboard': {
        get: {
          summary: 'Sites analyzed on this server, ranked',
          parameters: [
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['rank', 'score', 'performance', 'seo', 'security'] } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
          ],
          responses: { 200: { description: 'Leaderboard' } },
        },
      },
      '/api/v1/recent': { get: { summary: 'Recently analyzed sites', responses: { 200: { description: 'Recent' } } } },
      '/api/v1/usage': { get: { 'x-paid': true, summary: 'Your key\'s plan, usage this month and remaining quota', responses: { 200: { description: 'Usage' }, 401: err } } },
      '/api/v1/bulk': {
        post: {
          'x-paid': true,
          summary: 'Start a bulk job: analyze a list of domains in the background',
          description: 'Body: {"domains": ["a.com", "b.com"]} or a newline-separated list. Up to 100/500/1000 domains per job (Starter/Pro/Business). Uses one analysis per successful site; failed sites are free. Returns 202 with a job id to poll.',
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { domains: { type: 'array', items: { type: 'string' } } } } }, 'text/plain': { schema: { type: 'string' } } } },
          responses: { 202: { description: 'Job created' }, 400: err, 403: err, 413: err, 429: err },
        },
        get: { 'x-paid': true, summary: 'List your bulk jobs (kept for 24 hours)', responses: { 200: { description: 'Jobs' } } },
      },
      '/api/v1/bulk/{id}': {
        get: {
          'x-paid': true,
          summary: 'Bulk job progress and results',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } }],
          responses: { 200: { description: 'Job' }, 404: err },
        },
      },
      '/api/v1/monitors': {
        post: {
          'x-paid': true,
          summary: 'Watch a site and get webhook alerts when it changes',
          description: 'Body: {"domain": "example.com", "webhook": "https://your.app/hook", "interval": "daily"|"weekly"}. Alerts cover downtime, rank moves, score changes, tech added/removed, hosting and certificate changes. Each check uses one analysis. Webhooks are signed: X-SiteLens-Signature = sha256 HMAC of the body with the monitor secret (returned once, on creation).',
          responses: { 201: { description: 'Monitor created (includes the signing secret)' }, 400: err, 403: err },
        },
        get: { 'x-paid': true, summary: 'List your monitors', responses: { 200: { description: 'Monitors' } } },
      },
      '/api/v1/monitors/{id}': {
        get: { 'x-paid': true, summary: 'Monitor status and check history', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Monitor' }, 404: err } },
        delete: { 'x-paid': true, summary: 'Stop monitoring a site', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' }, 404: err } },
      },
      '/api/v1/monitors/{id}/test': {
        post: { 'x-paid': true, summary: 'Send a test webhook', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Delivered' }, 502: err } },
      },
      '/api/v1/auth/signup': { post: { summary: 'Create an account (website)', responses: { 201: { description: 'Session token and account' }, 400: err, 409: err } } },
      '/api/v1/auth/login': { post: { summary: 'Log in (website)', responses: { 200: { description: 'Session token and account' }, 401: err } } },
      '/api/v1/auth/forgot': { post: { summary: 'Email a password-reset link (website)', responses: { 200: { description: 'Same reply whether or not the account exists' } } } },
      '/api/v1/auth/reset': { post: { summary: 'Set a new password with a reset token (website)', responses: { 200: { description: 'New session' }, 400: err } } },
      '/api/v1/auth/verify': { post: { summary: 'Confirm an email address with a verification token (website)', responses: { 200: { description: 'Verified' }, 400: err } } },
      '/api/v1/account': { get: { summary: 'Your account, plan and usage (Authorization: Bearer session token)', responses: { 200: { description: 'Account' }, 401: err } } },
      '/api/v1/status': { get: { summary: 'Service health, cache and limits', responses: { 200: { description: 'Status' } } } },
    },
  };
}
