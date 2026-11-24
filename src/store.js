// In-memory job store. One analysis at a time, keyed by random job id.
// Jobs expire after a TTL so memory does not grow without bound.

const TTL_MS = Number(process.env.JOB_TTL_MS || 3_600_000);

const jobs = new Map();

function createJob() {
  const id = require('crypto').randomBytes(12).toString('hex');
  const job = {
    id,
    status: 'pending', // pending | cloning | analyzing | done | error
    source: null,      // { kind: 'url'|'zip', label }
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
    progress: '',
    report: null,      // final structured report
    error: null,
  };
  jobs.set(id, job);
  sweep();
  return job;
}

function getJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (Date.now() > job.expiresAt) {
    jobs.delete(id);
    return null;
  }
  return job;
}

function patch(id, updates) {
  const job = getJob(id);
  if (!job) return null;
  Object.assign(job, updates);
  return job;
}

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now > job.expiresAt) jobs.delete(id);
  }
}

module.exports = { createJob, getJob, patch, TTL_MS };