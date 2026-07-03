#!/usr/bin/env node

// @loom-layer: lab
//
// item 4 (D1, D2, D5) - a PURE, DETERMINISTIC, TOTAL issue->persona classifier. Given a
// live-issue record it returns the BUILDER persona whose fixed signal phrases best match the
// issue text, or null. NO network, NO LLM, NO exec - a keyword scorer over a frozen table, so
// the classification is reproducible and auditable (the materializer that consumes it stays
// ADVISORY/SHADOW; this never gates an action).
//
// TOTALITY (D1): classifyIssue NEVER throws. Any internal failure (a record whose getter
// throws, a malformed input) is caught -> { persona: null, classify_signal: 'classify-threw',
// matched: null }. A caller can always destructure the three fields.
//
// CLOSED-ENUM `matched` (fold M1, the injection-echo guard): `matched` is the FIXED TABLE
// phrase that hit - a closed enum value, NEVER a substring of the attacker-influenced
// problem_statement. An issue body is externally-derived text on a stranger's repo; echoing a
// slice of it into a downstream field/log is an injection surface, so we only ever surface the
// phrase from OUR table.
//
// D2 validation: the chosen persona is round-tripped through canonicalPersonaKey against
// materializablePersonas() (the BUILDERS intersect resolvable set). A persona not in that set ->
// null + 'matched-no-brief' (defensive: the table only holds builders, but enforce it so a
// future table edit cannot launder a non-builder through).

'use strict';

const { canonicalPersonaKey } = require('./canonical-persona-key');
const { materializablePersonas } = require('./persona-brief-map');

// The frozen signal table: builder-persona -> fixed, lowercased phrases. Each phrase is a
// closed-enum token; a DISTINCT phrase hit scores one point for its persona. Phrases are chosen
// to be specific enough that cross-persona collisions are rare (e.g. 'node.js' not 'node').
//
// F1/F3 (the substring-false-positive fold): a SINGLE alnum token (e.g. 'ios', 'pip', 'helm')
// matches on a WORD BOUNDARY only (via wordMatch below) so it can never hit inside a longer word
// ('scenarios', 'pipeline', 'overwhelm'). A few tokens are still real standalone English words
// even WITH a boundary, so they are removed or replaced by a multi-word phrase here:
//   - security-auditor: bare 'injection' REMOVED (a real word in "dependency injection").
//   - react-frontend: 'hook' + 'component' REMOVED (match "git hook" / "software component").
//   - node-backend: 'nest' -> 'nestjs' (bare 'nest' word-bounded both rejects "nestjs" AND
//     matches "honest").
//   - java-backend: 'spring' -> 'spring boot' + 'spring framework' (multi-word; "spring cleaning"
//     no longer matches).
//   - ml-engineer: 'embedding' -> 'model embedding'; 'inference' -> 'model inference'.
//   - W1-next widening (2026-07-03): each ADDED phrase passed the same three-part audit — (a)
//     word-boundary safe (single alnum tokens ride wordMatch's boundary regex; 'prisma' cannot hit
//     "prismatic", 'kafka' cannot hit "kafkaesque"), (b) NOT a real English word even word-bounded
//     (so ambiguous single words were dropped: 'poetry'/'redshift'/'spark', and made multi-word:
//     'hibernate' -> 'hibernate orm', 'tailwind' -> 'tailwind css', 'apache spark'; the VALIDATE hacker
//     then caught TWO more real-word single tokens I had missed — 'parquet' (hardwood flooring / a
//     tiling pattern) and 'ansible' (a standard SF FTL-comms term) — now made multi-word 'parquet file'
//     / 'ansible playbook' so a CSS-pattern or sci-fi issue no longer mis-classifies), (c) discriminative
//     for one builder (a genuinely cross-cutting token like 'kafka' is fine — it TIES honestly via
//     ambiguous-tie when a sibling signal co-occurs, never a silent mis-pick).
const PERSONA_SIGNALS = Object.freeze({
  'python-backend': Object.freeze(['python', 'pytest', 'pip', 'django', 'flask', 'uv ', 'asyncio', 'fastapi', 'pydantic', 'sqlalchemy', 'uvicorn']),
  'node-backend': Object.freeze(['express', 'nestjs', 'npm', 'node.js', 'route handler', 'api endpoint', 'fastify', 'typeorm', 'prisma']),
  'react-frontend': Object.freeze(['react', 'jsx', 'tsx', 'usestate', 'nextjs', 'redux', 'useeffect', 'tailwind css']),
  'ios-developer': Object.freeze(['swift', 'swiftui', 'xcode', 'ios', 'uikit', 'cocoapods']),
  'security-auditor': Object.freeze(['vulnerability', 'xss', 'sql injection', 'auth bypass', 'csrf', 'ssrf', 'idor', 'owasp', 'path traversal']),
  'data-engineer': Object.freeze(['airflow', 'dbt', 'etl', 'warehouse', 'kafka', 'parquet file', 'apache spark']),
  'devops-sre': Object.freeze(['kubernetes', 'helm', 'terraform', 'prometheus', 'grafana', 'ansible playbook', 'argocd', 'istio']),
  'java-backend': Object.freeze(['spring boot', 'spring framework', 'jvm', 'maven', 'gradle', 'kotlin', 'quarkus', 'hibernate orm']),
  'ml-engineer': Object.freeze(['training pipeline', 'model embedding', 'model inference', 'llm eval', 'pytorch', 'tensorflow', 'huggingface', 'scikit-learn']),
});

// Match a fixed table phrase against the (already-lowercased) haystack. A SINGLE alnum token
// (`/^[a-z0-9]+$/`) matches on a WORD BOUNDARY (no alnum immediately before/after) so it cannot
// hit inside a longer word ('ios' in "scenarios"). A multi-word / dotted / trailing-space phrase
// ('node.js', 'sql injection', 'uv ') stays a plain substring match (a boundary regex would
// mis-handle the '.' and the space). The boundary regex is built ONLY from a validated single
// alnum token from OUR frozen table (never untrusted input), so there is no regex-injection
// surface; `\b` is avoided because it treats '.' as a boundary, which a custom lookaround does not.
function wordMatch(haystack, phrase) {
  if (/^[a-z0-9]+$/.test(phrase)) {
    return new RegExp(`(?<![a-z0-9])${phrase}(?![a-z0-9])`).test(haystack);
  }
  return haystack.includes(phrase);
}

// The fixed persona-priority order for a SCORE TIE (lower index wins). Deterministic + total:
// two personas with the same distinct-phrase count resolve to the higher-priority one, never an
// arbitrary object-key-order pick. Security/correctness-leaning personas rank first.
const PERSONA_PRIORITY = Object.freeze([
  'security-auditor',
  'node-backend',
  'python-backend',
  'java-backend',
  'react-frontend',
  'ios-developer',
  'ml-engineer',
  'data-engineer',
  'devops-sre',
]);

function priorityIndex(persona) {
  const i = PERSONA_PRIORITY.indexOf(persona);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

// Scan the haystack (already lowercased) for each persona's phrases. Returns, per persona, the
// count of DISTINCT phrases hit plus the FIRST table phrase (in table order) that hit - the
// closed-enum `matched` value. A phrase that does not appear contributes nothing.
function scorePersona(persona, haystack) {
  const phrases = PERSONA_SIGNALS[persona];
  let count = 0;
  let firstMatch = null;
  for (const phrase of phrases) {
    if (wordMatch(haystack, phrase)) {
      count += 1;
      if (firstMatch === null) firstMatch = phrase; // table-order -> deterministic closed enum
    }
  }
  return { count, firstMatch };
}

/**
 * Classify a live-issue record to a builder persona, or null.
 *
 * @param {*} record - a live-issue record (problem_statement + repo are scanned).
 * @param {{knownPersonas?: string[]|Set<string>}} [opts] - validation-set override (tests).
 * @returns {{ persona: string|null, classify_signal: string, matched: string|null }}
 *   classify_signal in { 'matched', 'no-keyword-match', 'ambiguous-tie', 'matched-no-brief',
 *   'classify-threw' }. matched is a FIXED table phrase (closed enum) or null.
 */
function classifyIssue(record, opts = {}) {
  try {
    if (!record || typeof record !== 'object') {
      // A malformed record shape is a FAILURE signal (CodeRabbit), distinct from a valid record
      // with no keyword hit -> so the shadow data never confuses "bad upstream record" with "no match".
      return { persona: null, classify_signal: 'classify-threw', matched: null };
    }
    const problem = typeof record.problem_statement === 'string' ? record.problem_statement : '';
    const repo = typeof record.repo === 'string' ? record.repo : '';
    const haystack = `${problem}\n${repo}`.toLowerCase();

    // Score every builder persona; keep only those with at least one distinct phrase.
    const scored = [];
    for (const persona of Object.keys(PERSONA_SIGNALS)) {
      const { count, firstMatch } = scorePersona(persona, haystack);
      if (count > 0) scored.push({ persona, count, firstMatch });
    }
    if (scored.length === 0) {
      return { persona: null, classify_signal: 'no-keyword-match', matched: null };
    }

    // Pick the highest distinct-phrase count; break a tie by fixed persona-priority. Total +
    // deterministic (no reliance on object key order for the winner).
    scored.sort((a, b) => (b.count - a.count) || (priorityIndex(a.persona) - priorityIndex(b.persona)));
    const winner = scored[0];
    const topCount = winner.count;
    const tiedAtTop = scored.filter((s) => s.count === topCount).length > 1;

    // D2 - validate the chosen persona against the BUILDERS intersect resolvable set. A persona not in
    // that set -> null + 'matched-no-brief' (defensive; the table only holds builders).
    const known = opts.knownPersonas || materializablePersonas();
    const canonical = canonicalPersonaKey(winner.persona, { knownPersonas: known });
    if (canonical == null) {
      return { persona: null, classify_signal: 'matched-no-brief', matched: null };
    }

    return {
      persona: canonical,
      classify_signal: tiedAtTop ? 'ambiguous-tie' : 'matched',
      matched: winner.firstMatch,
    };
  } catch {
    return { persona: null, classify_signal: 'classify-threw', matched: null };
  }
}

module.exports = { classifyIssue, PERSONA_SIGNALS, PERSONA_PRIORITY };
