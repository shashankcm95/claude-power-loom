// packages/kernel/_lib/secret-patterns.js
//
// ③.0-W2 (2026-06-17): the SINGLE source of truth for the HIGH-PRECISION,
// prefix-anchored secret-token classes that BOTH the coarse redaction scrubber
// (spawn-record.js scrubSecrets) AND the strict edit-blocking validator
// (validators/validate-no-bare-secrets.js) must cover. Before this module the two
// lists drifted: the scrubber missed github_pat_ / ghs_/ghr_/ghu_ / glpat- / AIza,
// and both missed glpat- / AIza. Adding a class once here closes both seams; the
// cross-test (tests/unit/kernel/_lib/secret-patterns-crosstest.test.js) fails if a
// consumer stops covering a canonical class.
//
// WHY A FACTORY, NOT A SHARED CONST ARRAY (VERIFY ARCH-HIGH-1 + hacker M1, both
// PROVEN): every pattern is GLOBAL (/g). A global RegExp carries a MUTABLE
// `lastIndex` that advances on .exec()/.test() and is a writable own property
// Object.freeze does NOT freeze. If a single RegExp OBJECT were shared by the
// scrubber's .replace() and the validator's .exec()-loop (and the cross-test's
// .test()), stale lastIndex would intermittently skip a real token => a security
// FALSE NEGATIVE on the credential path this wave exists to protect. So this module
// holds only string SOURCES + flags and hands each caller a FRESH RegExp per call.
// Do NOT "optimize" this into a shared module-level array of RegExp objects.
//
// SCOPE: these are the shared no-FP classes only. Each consumer keeps its own
// purpose-specific extras (scrubber: broad coarse `sk-`, URL-password, AWS-assign,
// stripe TEST; validator: openai `sk-(proj-)?`, literal `*_SECRET/_KEY/_TOKEN`
// assignment). scrubSecrets stays a COARSE defense-in-depth net, NOT a primary
// control (a real secret-management discipline + the ③.2 PR-egress pre-scrubber are
// the primary controls).

'use strict';

// id is what the validator reports to the user; reuse the validator's existing ids
// (anthropic-api-key, github-pat-classic, …) so the reported-id surface is unchanged.
// source/flags (not a RegExp object) so getCanonicalSecretClasses() can mint fresh
// instances — see the factory rationale in the header.
const CANONICAL_SECRET_CLASS_DEFS = Object.freeze([
  // Anthropic — kept BEFORE openai in the validator (the `sk-` precedence invariant);
  // see validate-no-bare-secrets.js spread-site comment.
  { id: 'anthropic-api-key',       source: 'sk-ant-[A-Za-z0-9_-]{20,}',          flags: 'g', description: 'Anthropic API key' },
  // GitHub classic family: ghp_/gho_/ghu_/ghs_/ghr_ (the [posur] char class). ghs_
  // is the GitHub App / Actions installation token the beta's `gh`/CI path mints.
  // CHARSET NOTE (W2 VALIDATE hacker H-NIT-1): the body is base62 (no '-'/'_') because
  // that is GitHub's CURRENT classic-token alphabet — narrower than glpat-/AIza's
  // [A-Za-z0-9_-] BY DESIGN (each class matches its real token's alphabet, not a
  // lowest-common-denominator). RE-CONFIRM this charset if GitHub ever changes token
  // format; a dash-bearing future token would slip both consumers until then.
  { id: 'github-pat-classic',      source: 'gh[posur]_[A-Za-z0-9]{36,}',         flags: 'g', description: 'GitHub classic personal/OAuth/app token' },
  // GitHub fine-grained PAT — the modern default `gh auth`/`git push` mints (prefix
  // + 82 chars). {82,} (floor) per the validator's own SEC-2 note (exact {82} was a bug).
  { id: 'github-pat-fine-grained', source: 'github_pat_[A-Za-z0-9_]{82,}',       flags: 'g', description: 'GitHub fine-grained personal access token' },
  // GitLab PAT. FLOOR {20,} (NOT exact {20}) — a >20-char token's tail would otherwise
  // survive .replace() into the world-readable spawn-record envelope (VERIFY hacker H1,
  // proven). \b cuts a mid-base64 collision without breaking `KEY=glpat-…`.
  // ROUTABLE-FORMAT tail (W2 post-VALIDATE user finding): GitLab 17.x+ routable PATs append
  // a dotted routing suffix `glpat-<base>.XX.YYYYYYY` (e.g. ...BD.01.6z70tqjnm). `.` is NOT in
  // [A-Za-z0-9_-], so without the optional `(?:\.[a-z0-9]{2}\.[a-z0-9]{7})?` group the base
  // redacts but the dotted tail SURVIVES into the envelope. Mirrors GitLab's own secret-detection
  // rule `glpat-[A-Za-z0-9_-]{27,300}(\.[a-z0-9]{2}\.[a-z0-9]{7})?` (we keep the looser {20,}
  // floor + unbounded upper so a redaction net never leaves a tail; suffix is OPTIONAL so legacy
  // non-routable tokens still match). The final segment is `{7,}` (FLOOR, not GitLab's exact {7}):
  // the observed routable example's final run is 9 chars, so a floor consumes the WHOLE tail
  // regardless of segment length — never leaving a partial token (the redaction-net invariant).
  { id: 'gitlab-pat',              source: '\\bglpat-[A-Za-z0-9_-]{20,}(?:\\.[a-z0-9]{2}\\.[a-z0-9]{7,})?', flags: 'g', description: 'GitLab personal/project access token (incl. 17.x routable suffix)' },
  // Google API key (Gemini etc.): AIza + 35. \b + floor reduces the mid-base64 FP the
  // validator's SEC-5 base64 policy already chose not to fight (documented at the spread site).
  { id: 'google-api-key',          source: '\\bAIza[A-Za-z0-9_-]{35,}',          flags: 'g', description: 'Google API key' },
  { id: 'slack-token',             source: 'xox[abprs]-[A-Za-z0-9-]{10,}',       flags: 'g', description: 'Slack token' },
  { id: 'stripe-live-key',         source: 'sk_live_[A-Za-z0-9]{20,}',           flags: 'g', description: 'Stripe live secret key' },
  { id: 'stripe-restricted',       source: 'rk_live_[A-Za-z0-9]{20,}',           flags: 'g', description: 'Stripe restricted key' },
  { id: 'aws-access-key-id',       source: '\\bAKIA[0-9A-Z]{16}\\b',             flags: 'g', description: 'AWS access key ID' },
  { id: 'jwt-token',               source: '\\beyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}', flags: 'g', description: 'JWT-shape token' },
  // PEM private key (SSH / RSA / GitHub-App). Moved into CANONICAL (VERIFY hacker H2,
  // bypass) so the SCRUBBER gains it too — the beta's git-push / App-token path. A
  // literal banner => zero FP.
  { id: 'pem-private-key',         source: '-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----', flags: 'g', description: 'PEM private key block' },
]);

/**
 * Mint a FRESH array of the canonical secret classes, each with a NEWLY-CONSTRUCTED
 * RegExp (no shared mutable lastIndex — see the factory rationale in the header).
 * Call once at a consumer's module load and own the returned instances.
 *
 * @returns {Array<{id: string, regex: RegExp, description: string}>}
 */
function getCanonicalSecretClasses() {
  return CANONICAL_SECRET_CLASS_DEFS.map((d) => ({
    id: d.id,
    regex: new RegExp(d.source, d.flags),
    description: d.description,
  }));
}

/** The canonical class ids (frozen) — for tests + the cross-test's expected-id assertions. */
const CANONICAL_SECRET_CLASS_IDS = Object.freeze(CANONICAL_SECRET_CLASS_DEFS.map((d) => d.id));

module.exports = { getCanonicalSecretClasses, CANONICAL_SECRET_CLASS_IDS };
