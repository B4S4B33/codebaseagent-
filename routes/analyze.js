// POST /api/analyze
// Body: multipart/form-data with one of:
//   url=<github url>          -> server clones the public repo
//   file=<zip upload>         -> server extracts the archive
// Returns 202 + { jobId } immediately; results are polled via GET /api/jobs/:id.

const Busboy = require('busboy');
const { config } = require('../src/config');
const { createJob, getJob, patch } = require('../src/store');
const { run } = require('../src/analyze');

function analyzeHandler(req, res) {
  // Parse multipart once; decide the source; spawn the job; return the id.
  const busboy = Busboy({ headers: req.headers, limits: { fileSize: config.maxZipBytes } });
  let source = null;
  let zipBuffer = null;
  let url = null;
  let err = null;

  busboy.on('file', (_name, stream, info) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('error', (e) => { err = e; });
    stream.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length > config.maxZipBytes) {
        err = new Error(`Uploaded zip is ${buf.length} bytes, over the ${config.maxZipBytes} byte limit.`);
        return;
      }
      zipBuffer = buf;
    });
  });
  busboy.on('field', (name, val) => {
    if (name === 'url') url = String(val || '').trim();
  });
  busboy.on('error', (e) => { err = e; });
  busboy.on('finish', () => {
    if (err) return sendError(res, 400, err.message);

    if (url) {
      source = { kind: 'url', url };
    } else if (zipBuffer && zipBuffer.length > 0) {
      source = { kind: 'zip', buffer: zipBuffer, label: 'uploaded zip' };
    } else {
      return sendError(res, 400, 'Provide either a GitHub url or a zip file.');
    }

    if (!config.llmApiKey) {
      return sendError(res, 503, 'Server is not configured with an LLM API key.');
    }

    const job = createJob();
    patch(job.id, { source, status: 'queued' });
    run(job.id, source)
      .then((report) => patch(job.id, { status: 'done', report }))
      .catch((e) => patch(job.id, { status: 'error', error: e.message }))
      .finally(() => {});

    res.status(202).json({ jobId: job.id });
  });

  req.pipe(busboy);
}

function jobHandler(req, res) {
  const job = getJob(req.params.id);
  if (!job) return sendError(res, 404, 'job not found');
  res.json({ id: job.id, status: job.status, progress: job.progress, error: job.error, report: job.report });
}

function sendError(res, code, msg) {
  res.status(code).json({ error: msg });
}

module.exports = { analyzeHandler, jobHandler };