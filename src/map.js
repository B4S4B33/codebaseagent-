// Walk a checked-out repo and produce a file map + contents for the LLM.
// Filters aggressively: no node_modules, no .git, no binaries, no lockfiles,
// no huge/generated files. Caps total files and per-file size.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { config } = require('./config');

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'vendor', '__pycache__', '.venv', 'venv',
  'env', '.idea', '.vscode', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', '.turbo', 'coverage', '.nyc_output',
  'Pods', '.dart_tool', '.gradle', '.mvn', 'bower_components',
]);

const IGNORE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.webm',
  '.exe', '.dll', '.so', '.dylib', '.a', '.o', '.obj', '.wasm',
  '.bin', '.dat', '.db', '.sqlite', '.sqlite3',
  '.lock', '.min.js', '.min.css', '.map',
]);

const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock',
  'poetry.lock', 'Gemfile.lock', 'go.sum',
]);

const MAX_SINGLE_FILE = 200 * 1024; // skip reading anything over 200KB raw

function isBinary(buf) {
  // Null byte in the first 8KB => binary.
  const sample = buf.slice(0, Math.min(8192, buf.length));
  return sample.includes(0);
}

async function walk(dir, acc) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      await walk(full, acc);
    } else if (ent.isFile()) {
      acc.push(full);
    }
  }
}

function relative(root, full) {
  return path.relative(root, full).split(path.sep).join('/');
}

async function mapRepo(root) {
  const files = [];
  await walk(root, files);

  // Sort so key config/entry files surface first — better context for the LLM.
  const priority = [
    'package.json', 'tsconfig.json', 'jsconfig.json', 'pyproject.toml',
    'setup.py', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
    'build.gradle.kts', 'Gemfile', 'requirements.txt', 'Cargo.lock',
    'README.md', 'README', 'main.py', 'index.js', 'index.ts', 'app.py',
    'server.js', 'server.ts', 'main.go', 'main.rs', 'App.tsx', 'App.jsx',
    'Dockerfile', 'docker-compose.yml', '.env.example',
  ];
  const score = (f) => {
    const base = path.basename(f).toLowerCase();
    let s = 0;
    for (let i = 0; i < priority.length; i++) {
      if (base === priority[i].toLowerCase()) { s = priority.length - i; break; }
    }
    return s;
  };
  files.sort((a, b) => score(b) - score(a) || a.localeCompare(b));

  const mapped = [];
  let totalChars = 0;
  let skippedBinary = 0;
  let skippedLarge = 0;
  let skippedCap = 0;
  let skippedPayload = 0;

  for (const full of files) {
    if (mapped.length >= config.maxFiles) { skippedCap++; continue; }
    const rel = relative(root, full);
    const ext = path.extname(rel).toLowerCase();
    if (IGNORE_EXT.has(ext)) { skippedBinary++; continue; }
    if (LOCK_FILES.has(path.basename(rel))) continue;
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    if (stat.size > MAX_SINGLE_FILE) { skippedLarge++; continue; }
    const buf = await fsp.readFile(full);
    if (isBinary(buf)) { skippedBinary++; continue; }
    const content = buf.toString('utf8');
    const capped = content.length > config.maxFileChars
      ? content.slice(0, config.maxFileChars) + '\n\n[TRUNCATED — file longer than limit]\n'
      : content;
    // Stop filling once we hit the payload budget. The tree still lists every
    // file, so the LLM can see what was left out.
    if (totalChars + capped.length > config.maxPayloadChars) { skippedPayload++; continue; }
    totalChars += capped.length;
    mapped.push({ path: rel, size: stat.size, content: capped });
  }

  return {
    root,
    files: mapped,
    // Full tree (all discovered files, before caps) so the report can say
    // which files were omitted from the LLM payload.
    allFiles: files.map((f) => relative(root, f)),
    summary: {
      totalFiles: mapped.length,
      totalChars,
      skippedBinary,
      skippedLarge,
      skippedCap,
      skippedPayload,
    },
  };
}

module.exports = { mapRepo };