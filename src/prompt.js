// The system/user prompt that drives the review.
// Deliberately engineered so that "no bugs" is a valid, honest answer,
// and so the model reports only findings it can point at.

const SYSTEM = `You are a senior software engineer reviewing a codebase for bugs.
Your job is to find REAL, actionable defects — not style nits, not hypotheticals.

Rules:
- Only report a finding if you can point at a specific file and (ideally) a function/line.
- Prefer real bugs: incorrect logic, unhandled errors, race conditions, resource leaks,
  missing input validation, auth/authorization gaps, SQL/command injection, off-by-one,
  wrong API usage, un awaited promises, unhandled rejections, unsafe deserialization.
- Ignore pure style, naming, formatting, and "could be better" suggestions.
- If the codebase is genuinely fine, say so. An empty findings list is a valid,
  correct answer — never invent bugs to seem useful.
- Be specific about the fix: show the corrected code when you can.
- Severity is one of: critical, high, medium, low.
  critical = data loss, security vuln, or service outage.
  high = wrong behavior in common paths.
  medium = bug triggered only in edge cases.
  low = fragile but currently works.
- You may note that a finding depends on assumptions (e.g. "assuming X is null here").
- Do not summarize the project. Go straight to findings.`;

const USER_TEMPLATE = (tree, files, language) => `Review this codebase for bugs.

Project language/runtime hint: ${language || 'unknown'}

FILE TREE:
${tree}

FILES:
${files}

Return ONLY a JSON object with this exact shape, no prose outside it:
{
  "projectSummary": "2-3 sentences: what this project is and how it is built",
  "language": "detected primary language/runtime",
  "findings": [
    {
      "id": "short kebab-case slug, unique",
      "file": "path/to/file.js",
      "location": "function or area, e.g. authenticate() in auth.js",
      "severity": "critical|high|medium|low",
      "category": "logic|security|error-handling|performance|concurrency|api|validation",
      "description": "what is wrong and why it is a bug",
      "evidence": "quote or paraphrase the offending code",
      "proposedFix": "concrete corrected code or a precise description of the change",
      "confidence": "high|medium|low"
    }
  ],
  "couldNotReview": ["file.js", "other.js"],
  "notes": "any caveats about the review, e.g. tests could not be run, or files were truncated"
}
If there are no findings, use an empty array: "findings": []`;

function buildPrompt({ tree, files, language }) {
  return {
    system: SYSTEM,
    user: USER_TEMPLATE(tree, files, language),
  };
}

module.exports = { SYSTEM, USER_TEMPLATE, buildPrompt };