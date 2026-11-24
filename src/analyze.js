// The review pipeline.
// Steps: ingest (clone/zip) -> map files -> call LLM with structured prompt -> validate report.
// The LLM is advisory; the objective layer (linters/type-checkers) is a future stage.

const { config } = require('./config');
const { parseGithub, cloneUrl, extractZip } = require('./ingest');
const { mapRepo } = require('./map');
const { buildPrompt } = require('./prompt');
const { request } = require('./llm');
const { patch } = require('./store');

function run(jobId, input) {
  return new Promise(async (resolve, reject) => {
    let repoDir;
    try {
      // 1. Ingest
      patch(jobId, { status: 'cloning', progress: 'ingesting source' });
      if (input.kind === 'url') {
        const gh = parseGithub(input.url);
        if (!gh) return reject(new Error('Could not parse a GitHub URL from the input.'));
        repoDir = await cloneUrl(jobId, input.url, config.githubToken);
      } else {
        repoDir = await extractZip(jobId, input.buffer);
      }

      // 2. Map
      patch(jobId, { progress: 'mapping files' });
      const map = await mapRepo(repoDir);
      const tree = map.files.map((f) => `${f.size}B  ${f.path}`).join('\n');
      const files = map.files
        .map((f) => `===== ${f.path} =====\n${f.content}\n`)
        .join('\n');

      // 3. LLM review
      patch(jobId, { status: 'analyzing', progress: 'reviewing with LLM' });
      const { system, user } = buildPrompt({ tree, files, language: detectLanguage(map) });
      const raw = await request({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        maxTokens: 4000,
        json: true,
      });

      // 4. Validate
      const report = validateReport(raw, map);
      resolve(report);
    } catch (e) {
      reject(e);
    } finally {
      cleanup(repoDir);
    }
  });
}

// Best-effort language detection from file extensions / config files.
function detectLanguage(map) {
  const has = (p) => map.files.some((f) => f.path.endsWith(p));
  if (has('package.json')) return 'Node.js/JavaScript';
  if (has('pyproject.toml') || has('setup.py')) return 'Python';
  if (has('go.mod')) return 'Go';
  if (has('Cargo.toml')) return 'Rust';
  if (has('pom.xml') || has('build.gradle')) return 'Java';
  if (has('tsconfig.json')) return 'TypeScript';
  const exts = {};
  for (const f of map.files) {
    const ext = f.path.split('.').pop().toLowerCase();
    exts[ext] = (exts[ext] || 0) + 1;
  }
  const order = ['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'rb', 'c', 'cpp', 'kt', 'swift'];
  for (const e of order) if (exts[e]) return e;
  return 'unknown';
}

function validateReport(raw, map) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('LLM did not return valid JSON. Raw (truncated): ' + raw.slice(0, 300));
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM returned a non-object report.');
  }
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const normalized = findings.map((f, i) => ({
    id: String(f.id || `finding-${i + 1}`),
    file: String(f.file || 'unknown'),
    location: String(f.location || ''),
    severity: clampSeverity(f.severity),
    category: String(f.category || 'logic'),
    description: String(f.description || ''),
    evidence: String(f.evidence || ''),
    proposedFix: String(f.proposedFix || ''),
    confidence: clampConfidence(f.confidence),
  }));

  return {
    projectSummary: String(parsed.projectSummary || ''),
    language: String(parsed.language || detectLanguage(map)),
    findings: normalized,
    couldNotReview: Array.isArray(parsed.couldNotReview) ? parsed.couldNotReview.map(String) : [],
    notes: String(parsed.notes || ''),
    stats: map.summary,
    generatedAt: new Date().toISOString(),
  };
}

function clampSeverity(s) {
  const v = String(s).toLowerCase();
  return ['critical', 'high', 'medium', 'low'].includes(v) ? v : 'medium';
}

function clampConfidence(s) {
  const v = String(s).toLowerCase();
  return ['high', 'medium', 'low'].includes(v) ? v : 'medium';
}

function cleanup(repoDir) {
  if (!repoDir) return;
  const fsp = require('fs/promises');
  fsp.rm(repoDir, { recursive: true, force: true }).catch(() => {});
}

module.exports = { run, detectLanguage, validateReport };