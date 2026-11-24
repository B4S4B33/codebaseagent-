// Thin OpenAI-compatible client over Node's built-in fetch.
// Works with Groq, OpenAI, Azure, or a local Ollama — same code, different env.
// Retries transient failures (429/5xx/network) with backoff.

const { config } = require('./config');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function request({ messages, temperature = 0, maxTokens = 4000, json = false, retries = 3 }) {
  // Read config live so tests can swap the model via env without a process restart.
  const cfg = config;
  if (!cfg.llmApiKey) {
    throw new Error('No LLM API key configured (GROQ_API_KEY / OPENAI_API_KEY).');
  }

  const body = {
    model: cfg.llmModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      const text = await res.text().catch(() => '');
      lastErr = new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
      const wait = Math.min(30_000, 1000 * Math.pow(2, attempt) + Math.random() * 500);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM response missing message content');
    }
    return content;
  }
  throw lastErr || new Error('LLM request failed after retries');
}

module.exports = { request, sleep };