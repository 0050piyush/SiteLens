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
          description: 'Runs (or returns a cached) full analysis. Cached for 6 hours; pass fresh=1 to re-run.',
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
      '/api/v1/rank/{domain}': { get: { summary: 'Tranco rank, 30-day rank history and traffic estimate (fast, no crawl)', parameters: [domainParam], responses: { 200: { description: 'Rank' } } } },
      '/api/v1/tech/{domain}': { get: { summary: 'Detected technologies grouped by category', parameters: [domainParam], responses: { 200: { description: 'Technologies' } } } },
      '/api/v1/top': {
        get: {
          summary: 'Top sites from the Tranco list',
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
      '/api/v1/status': { get: { summary: 'Service health, cache and limits', responses: { 200: { description: 'Status' } } } },
    },
  };
}
