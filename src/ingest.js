// Repo ingestion: clone a public GitHub URL, or extract an uploaded zip.
// Both land in a per-job sandbox under WORK_DIR and are deleted after analysis.
// Nothing here writes into the served tree; nothing is executed from the repo.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');

const { config } = require('./config');

function ensureDir(p) {
  return fsp.mkdir(p, { recursive: true });
}

// Resolve a GitHub URL into a local clone path.
// Accepts https://github.com/OWNER/REPO(.git)? and git@ forms.
function parseGithub(url) {
  const m = String(url).match(
    /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$|\?|#)/i
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function cloneUrl(jobId, url, token) {
  return new Promise((resolve, reject) => {
    const dest = path.join(config.workDir, jobId, 'repo');
    const authed = token
      ? url.replace('https://github.com', `https://${token}@github.com`)
      : url;
    const args = ['clone', '--depth', '1', '--filter=blob:none', authed, dest];
    execFile('git', args, { timeout: config.cloneTimeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) {
        return reject(new Error(`git clone failed: ${stderr || err.message}`));
      }
      resolve(dest);
    });
  });
}

async function extractZip(jobId, buffer) {
  const dest = path.join(config.workDir, jobId, 'repo');
  await ensureDir(dest);
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  // Reject zip bombs / absurd entry counts defensively.
  if (entries.length > 20_000) {
    throw new Error('zip has too many entries');
  }
  // Strip a single top-level folder so uploading "myrepo.zip" behaves like a clone.
  const stripPrefix = findTopPrefix(entries);
  for (const e of entries) {
    if (e.isDirectory) continue;
    const name = stripPrefix && e.entryName.startsWith(stripPrefix)
      ? e.entryName.slice(stripPrefix.length)
      : e.entryName;
    if (!name || name.startsWith('/')) continue;
    const target = path.join(dest, name);
    if (!target.startsWith(dest + path.sep) && target !== dest) continue;
    await ensureDir(path.dirname(target));
    await fsp.writeFile(target, e.getData());
  }
  return dest;
}

function findTopPrefix(entries) {
  const names = entries.map((e) => e.entryName.split('/')[0]);
  const set = new Set(names);
  return set.size === 1 ? names[0] + '/' : null;
}

module.exports = { parseGithub, cloneUrl, extractZip, ensureDir };