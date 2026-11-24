// Central configuration. Reads from env live, so tests can swap values
// (e.g. the model) without a process restart. No secrets are logged.

const path = require('path');

const config = {
  get port() { return Number(process.env.PORT || 3000); },
  get host() { return process.env.HOST || '0.0.0.0'; },

  // OpenAI-compatible endpoint. Groq ships a compatible API, so one client works for all.
  get llmBaseUrl() { return (process.env.BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''); },
  get llmModel() { return process.env.MODEL || 'qwen/qwen3.8-27b'; },
  get llmApiKey() { return process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || ''; },

  get githubToken() { return process.env.GITHUB_TOKEN || ''; },

  get workDir() { return process.env.WORK_DIR || path.join(__dirname, '..', '.work'); },

  get maxCloneBytes() { return Number(process.env.MAX_CLONE_BYTES || 20_000_000); },
  get maxZipBytes() { return Number(process.env.MAX_ZIP_BYTES || 25_000_000); },

  // Hard ceiling on how many files the LLM ever reads, regardless of repo size.
  get maxFiles() { return Number(process.env.MAX_FILES || 400); },
  // Per-file character cap before we truncate.
  get maxFileChars() { return Number(process.env.MAX_FILE_CHARS || 20_000); },

  // Timeouts, in ms.
  get cloneTimeoutMs() { return Number(process.env.CLONE_TIMEOUT_MS || 120_000); },
  get analyzeTimeoutMs() { return Number(process.env.ANALYZE_TIMEOUT_MS || 180_000); },
};

function validate() {
  if (!config.llmApiKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] No LLM API key set (GROQ_API_KEY / OPENAI_API_KEY). ' +
        'Analysis will fail at runtime until one is provided.'
    );
  }
}

module.exports = { config, validate };