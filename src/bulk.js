import { randomUUID } from 'node:crypto';

const RETENTION_MS = 24 * 3600 * 1000;
const CONCURRENCY = 4;
const MAX_ACTIVE_PER_KEY = 2;

/**
 * Bulk analysis jobs for API customers. A job analyzes a list of domains in
 * the background; callers poll it for progress and results. Jobs live in
 * memory for 24 hours.
 */
export class BulkJobs {
  constructor({ getReport, usage, summarizeRow, csvRow }) {
    this.getReport = getReport;
    this.usage = usage;
    this.summarizeRow = summarizeRow;
    this.csvRow = csvRow;
    this.jobs = new Map();
    setInterval(() => {
      const cutoff = Date.now() - RETENTION_MS;
      for (const [id, job] of this.jobs) if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) this.jobs.delete(id);
    }, 3600 * 1000).unref();
  }

  activeFor(key) {
    return [...this.jobs.values()].filter((j) => j.key === key && (j.status === 'queued' || j.status === 'running')).length;
  }

  listFor(key) {
    return [...this.jobs.values()].filter((j) => j.key === key).map((j) => this.view(j, { results: false }));
  }

  get(id, key) {
    const job = this.jobs.get(id);
    return job && job.key === key ? job : null;
  }

  /** domains: already normalized and de-duplicated. */
  create({ key, plan, domains }) {
    const job = {
      id: randomUUID(),
      key,
      plan: plan.id,
      monthlyLimit: plan.monthly,
      status: 'queued',
      total: domains.length,
      done: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      results: new Array(domains.length).fill(null),
      csvRows: new Array(domains.length).fill(null),
      domains,
    };
    this.jobs.set(job.id, job);
    queueMicrotask(() => this.run(job));
    return job;
  }

  async run(job) {
    job.status = 'running';
    let next = 0;
    const worker = async () => {
      while (next < job.domains.length) {
        const i = next++;
        const domain = job.domains[i];
        if (this.usage.used(job.key) >= job.monthlyLimit) {
          job.results[i] = { domain, status: 'skipped', error: 'Monthly quota reached' };
          job.skipped++;
          job.done++;
          continue;
        }
        // Reserve one unit before analyzing so parallel workers can't overshoot
        // the quota; failed sites are refunded.
        this.usage.add(job.key, 1);
        try {
          const report = await this.getReport(domain);
          if (report.reachable) {
            job.results[i] = { status: 'ok', ...this.summarizeRow(report) };
            job.csvRows[i] = this.csvRow(report);
            job.succeeded++;
          } else {
            this.usage.add(job.key, -1);
            job.results[i] = { domain, status: 'failed', error: report.error || 'Unreachable' };
            job.failed++;
          }
        } catch (err) {
          this.usage.add(job.key, -1);
          job.results[i] = { domain, status: 'failed', error: err.message };
          job.failed++;
        }
        job.done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, job.domains.length) }, worker));
    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
  }

  view(job, { results = true } = {}) {
    return {
      id: job.id,
      status: job.status,
      total: job.total,
      done: job.done,
      succeeded: job.succeeded,
      failed: job.failed,
      skipped: job.skipped,
      progress: job.total ? Math.round((job.done / job.total) * 100) : 100,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      ...(results ? { results: job.results.filter(Boolean) } : {}),
    };
  }

  static get maxActivePerKey() { return MAX_ACTIVE_PER_KEY; }
}
