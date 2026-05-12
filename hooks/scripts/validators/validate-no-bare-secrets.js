#!/usr/bin/env node

// PreToolUse:Write/Edit validator (H.4.2): blocks file writes that contain
// bare secret literals. Hook-layer enforcement complements actor-output-only
// triple-contract verification — operates at WRITE time, deterministically,
// against direct file edits by Claude.
//
// H.7.21 EXTENSION: For Edit, scans the post-edit RESULT (existing file +
// applied edit), not just `new_string`. Catches assignment completions —
// e.g., Edit fills `*_KEY=` placeholder with a 16+ char value — where the
// pre-H.7.21 validator only saw the bare inserted value and missed the
// surrounding key prefix. Mirrors H.7.20 read-file + apply-edit + scan-
// result pattern in validate-frontmatter-on-skills.js. Convention E in
// skills/agent-team/patterns/validator-conventions.md documents the
// 4-validator audit + decision tree (closes drift-note 29).
//
// Detected shapes (tunable; see SECRET_PATTERNS below):
//   - Anthropic API keys:    sk-ant-...
//   - Stripe live keys:      sk_live_..., rk_live_...
//   - Slack tokens:          xoxb-/xoxa-/xoxp-/xoxr-/xoxs-...
//   - GitHub PATs:           ghp_..., gho_..., ghu_..., ghs_..., ghr_..., gh\..._...
//   - AWS access key IDs:    AKIA[16 alphanumerics]
//   - JWT-shape tokens:      eyJ...<base64>.<base64>.<base64>
//   - Assignment with literal value: NAME_(SECRET|KEY|TOKEN|PASSWORD)=<≥16 chars>
//     (excludes placeholders like ${...}, $X, <PLACEHOLDER>, "your-key-here")
//
// IMPORTANT: never echoes the matched literal in the block reason — only
// reports the detection pattern + offset, so log files / chat transcripts
// don't preserve the exposed secret.

const fs = require('fs');
const { log } = require('../_log.js');
const logger = log('validate-no-bare-secrets');

// Each pattern: { id, regex, description }. id is what the user sees.
// H.9.15 SEC-5/SEC-6 documented intentional gaps (audited at chaos test):
//   - Base64-encoded secrets: same surface as base64-encoded non-secrets
//     (PNG images, encoded UTF-8). False-positive cost exceeds true-positive
//     benefit at substrate scope. User-side detection via language-specific
//     linters (gitleaks, truffleHog) covers this.
//   - Stripe pk_live_ (publishable keys): NOT secret by Stripe design. Leakage
//     enables fraud but mitigation is rate-limiting + WAF, not substrate.
//     The sk_live_ + rk_live_ patterns DO block (those are secret keys).
//   - Hex blobs (64-char): same surface as SHA-256 commit hashes; pattern
//     ambiguous; substrate cannot disambiguate. User-side scanning tooling
//     covers this layer.

const SECRET_PATTERNS = [
  { id: 'anthropic-api-key',  regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,           description: 'Anthropic API key' },
  // H.9.15 SEC-1: OpenAI sk- and sk-proj- formats. Ordering: must come AFTER
  // anthropic-api-key per architect ARCH-HIGH-1 review (sk-ant- starts with
  // sk- so regex precedence matters). Value char class is alphanumeric-only
  // (NO dash/underscore) — OpenAI keys are A-Za-z0-9 in the body; the
  // `sk-proj-` prefix is the only dashed segment. This avoids the
  // sk-ant-foo-bar overlap (anthropic body has dashes/underscores).
  { id: 'openai-api-key',     regex: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/g,     description: 'OpenAI API key' },
  { id: 'stripe-live-key',    regex: /sk_live_[A-Za-z0-9]{20,}/g,            description: 'Stripe live secret key' },
  { id: 'stripe-restricted',  regex: /rk_live_[A-Za-z0-9]{20,}/g,            description: 'Stripe restricted key' },
  { id: 'slack-token',        regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g,         description: 'Slack token' },
  { id: 'github-pat-classic', regex: /gh[posur]_[A-Za-z0-9]{36,}/g,           description: 'GitHub classic personal access token' },
  // H.5.2 (CS-3 hacker.kai CRIT-2): GitHub fine-grained PAT — primary modern
  // format since 2022, prefix `github_pat_` followed by 82 chars (verified per
  // GitHub docs). The classic regex above does NOT cover this; it's a separate
  // pattern. H.9.15 SEC-2: changed {82} (exact) → {82,} (at-least). Exact
  // quantifier was semantically wrong though accidentally worked because
  // engine finds the 82-char prefix in any longer match.
  { id: 'github-pat-fine-grained', regex: /github_pat_[A-Za-z0-9_]{82,}/g,    description: 'GitHub fine-grained personal access token' },
  { id: 'aws-access-key-id',  regex: /\bAKIA[0-9A-Z]{16}\b/g,                 description: 'AWS access key ID' },
  { id: 'jwt-token',          regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, description: 'JWT-shape token' },
  // H.9.15 SEC-1: PEM private key blocks. Catches all PEM private key variants
  // (RSA, EC, DSA, generic). Fires inside markdown code fences too — per
  // architect ARCH-MED-3: defense > documentation. Users wanting to document
  // PEM format should use ASCII art or describe-don't-paste.
  { id: 'pem-private-key',    regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g, description: 'PEM private key block' },
  // Generic assignment pattern. H.9.15 SEC-1: widened value char class from
  // [A-Za-z0-9+/=_-] to [A-Za-z0-9+/=_\-@!#$%^&*~] to cover realistic
  // password special chars (DB connection strings often have @!#$ etc.).
  // Trailing-value group requires ≥16 chars; excludes obvious placeholders.
  {
    id: 'literal-secret-assignment',
    regex: /\b([A-Z][A-Z0-9_]*_(?:SECRET|KEY|TOKEN|PASSWORD|PASSWD))\s*[:=]\s*['"]?([A-Za-z0-9+/=_\-@!#$%^&*~]{16,})['"]?/g,
    description: 'literal *_SECRET/*_KEY/*_TOKEN assignment',
    valueGroup: 2,
  },
];

// Strings that look secret-shaped but are clearly placeholders. If the matched
// value is one of these (case-insensitive), skip — false positives bother the
// user more than a true positive helps.
// H.9.15 SEC-3 expansion: added _HERE-suffixed conventions found in .env.example
// docs (your_api_key_here, your_secret_token_here, etc.).
const PLACEHOLDER_VALUES = new Set([
  'your-key-here', 'your_key_here',
  // H.9.15 SEC-3 additions:
  'your_api_key_here', 'your_secret_key_here', 'your_token_here',
  'your_secret_token_here', 'insert_key_here', 'insert_token_here',
  'your_api_token_here', 'your_password_here',
  // pre-existing:
  'changeme', 'change-me', 'replaceme',
  'replace-me', 'placeholder', 'todo', 'xxx', 'redacted', 'secret', 'password',
  'aaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', '0000000000000000',
  '1234567890abcdef', '1234567890123456',
]);

// Skip patterns: don't scan reads of common test fixtures, .env.example, etc.
// (No false positives on intentional documentation of the patterns themselves.)
//
// H.5.2 (CS-3 hacker.kai CRIT-2): the prior version skipped ALL writes under
// `hooks/scripts/validators/` — a self-permissive blind spot. Anyone editing
// the validator could store secrets there with zero hook resistance. Tightened
// to skip only test-fixture sub-paths, not the validator code itself.
const SKIP_PATH_PATTERNS = [
  /\.env\.example$/i,
  /\.env\.template$/i,
  /\.env\.sample$/i,
  /(?:^|\/)tests?\/fixtures\//i,
  /(?:^|\/)__tests__\/.*\.(test|spec|fixture)\./i,
  /(?:^|\/)hooks\/scripts\/validators\/.*\.(test|spec|fixture)\./i, // narrowed
  /(?:^|\/)hooks\/scripts\/validators\/fixtures\//i, // narrowed
];

function shouldSkipPath(filePath) {
  return SKIP_PATH_PATTERNS.some((p) => p.test(filePath || ''));
}

function isPlaceholder(value) {
  if (!value) return false;
  const v = value.toLowerCase();
  if (PLACEHOLDER_VALUES.has(v)) return true;
  // ${...}, $X, <X>, {{X}}
  if (/^\$\{?[A-Z][A-Z0-9_]*\}?$/i.test(value)) return true;
  if (/^<[A-Za-z][A-Za-z0-9_-]*>$/.test(value)) return true;
  if (/^\{\{[\s\S]+\}\}$/.test(value)) return true;
  // Sequences of repeated chars (aaaaa, 11111, etc.) under reasonable length
  if (/^(.)\1{15,}$/.test(value)) return true;
  // H.9.15 SEC-3 (per architect ARCH-HIGH-3 absorption): heuristic for the
  // `_HERE`-suffix English-placeholder convention common in .env.example
  // docs. Two-clause defense:
  //   (a) /^[a-z_]+_here$/i — lowercase-only words + underscores ending in
  //       `_here` (e.g., `your_api_key_here`); locked to alpha+underscore
  //       to prevent matching `sk-proj-MY_TOKEN_HERE` (has uppercase + dash)
  //   (b) length < 32 + `_here$` — short strings ending in `_here` are
  //       almost always placeholders; real secrets are typically 32+ chars
  // Combined: real-key-ending-in-HERE is NOT suppressed (length-floor) AND
  // mixed-case-key-ending-in-HERE is NOT suppressed (alpha-only restriction).
  if (/^[a-z_]+_here$/i.test(value)) return true;
  if (value.length < 32 && /_here$/i.test(value)) return true;
  // H.9.15 SEC-4 (per architect ARCH-LOW-4 absorption): `changeme` prefix
  // covers `changeme_v2`, `changeme_password`, `changeme_token`, etc.
  // Real secrets do not start with the literal English placeholder verb
  // "changeme"; the false-positive cost of blocking real `changeme_*` is
  // negligible.
  if (/^changeme/i.test(value)) return true;
  return false;
}

function scanContent(content) {
  if (!content || typeof content !== 'string') return [];
  const findings = [];
  for (const pat of SECRET_PATTERNS) {
    let m;
    pat.regex.lastIndex = 0;
    while ((m = pat.regex.exec(content)) !== null) {
      const value = pat.valueGroup ? m[pat.valueGroup] : m[0];
      if (isPlaceholder(value)) continue;
      findings.push({
        id: pat.id,
        description: pat.description,
        // Report offset only — never the literal value itself.
        offset: m.index,
        length: m[0].length,
      });
    }
  }
  return findings;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || '';

    if (shouldSkipPath(filePath)) {
      logger('approve', { toolName, filePath, reason: 'path_skip_list' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Build the content surface to scan based on tool variant.
    // H.5.2 (CS-3 code-reviewer.blair C-1): the Edit tool's payload is
    // `new_string` + boolean `replace_all` — NOT a `replace_all_string` field.
    // The previous code referenced a non-existent field; only `new_string`
    // was effectively scanned. Worse, future multi-edit payloads (e.g.,
    // `edits: [{old_string, new_string}]`) would silently bypass. H.5.2 fix:
    // scan `new_string` for Edit, and pessimistically scan the entire
    // `tool_input` JSON if the shape is unrecognized.
    //
    // H.7.21: extend Edit to scan post-edit RESULT (existing file + applied
    // edit), not just `new_string`. Catches assignment completions where
    // surrounding context creates the secret pattern. Falls back to
    // `new_string`-only scan if file read fails (defensive). Defense in
    // depth — false positives here are acceptable; missing a secret is not.
    let scanText = '';
    if (toolName === 'Write') {
      scanText = toolInput.content || '';
    } else if (toolName === 'Edit') {
      // Try to read existing file to produce post-edit result.
      let existing = null;
      try {
        existing = fs.readFileSync(filePath, 'utf8');
      } catch {
        /* file doesn't exist or unreadable — fall back to new_string-only */
      }

      if (existing !== null) {
        // Apply edit(s) to produce post-edit result.
        let result = existing;
        if (Array.isArray(toolInput.edits)) {
          // MultiEdit: apply each edit in sequence on the running result.
          for (const e of toolInput.edits) {
            if (e && typeof e.old_string === 'string' && typeof e.new_string === 'string') {
              if (e.replace_all === true) {
                result = result.split(e.old_string).join(e.new_string);
              } else {
                result = result.replace(e.old_string, e.new_string);
              }
            }
          }
        } else {
          const oldStr = toolInput.old_string || '';
          const newStr = toolInput.new_string || '';
          if (toolInput.replace_all === true) {
            result = result.split(oldStr).join(newStr);
          } else {
            result = result.replace(oldStr, newStr);
          }
        }
        scanText = result;
      } else {
        // Fallback: scan new_string only (pre-H.7.21 behavior).
        scanText = toolInput.new_string || '';
        if (Array.isArray(toolInput.edits)) {
          for (const e of toolInput.edits) {
            if (e && typeof e.new_string === 'string') scanText += '\n' + e.new_string;
          }
        }
      }
    } else if (toolName === 'NotebookEdit') {
      // NotebookEdit uses `new_source` for cell content; pessimistic scan covers
      // both the documented field + any future variants.
      scanText = (toolInput.new_source || '') + '\n' + JSON.stringify(toolInput);
    } else {
      // Other tools: not our jurisdiction.
      logger('approve', { toolName, reason: 'tool_out_of_scope' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    const findings = scanContent(scanText);
    if (findings.length === 0) {
      logger('approve', { toolName, filePath, contentLen: scanText.length });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Block. Reason includes pattern IDs + offsets, NEVER the literal value.
    const summary = findings
      .slice(0, 5)
      .map((f) => `  • ${f.description} (id: ${f.id}) at offset ${f.offset}`)
      .join('\n');
    const more = findings.length > 5 ? `\n  ... and ${findings.length - 5} more` : '';
    const reason = [
      `SECRETS GATE: detected ${findings.length} secret-shaped literal(s) in this ${toolName} content.`,
      summary + more,
      '',
      'Move secrets to environment variables (or a secrets manager) and reference them via process.env.X / os.environ["X"]. The hook never echoes the matched literal — re-read the file you were about to write to find + remove the secret yourself.',
    ].join('\n');

    logger('block', { toolName, filePath, findingCount: findings.length, ids: findings.map((f) => f.id) });
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } catch (err) {
    // H.5.2 (CS-3 hacker.kai CRIT-2): fail-CLOSED on parse error.
    // Prior version was `decision: 'approve'` — graceful-degrade is wrong
    // for a security gate. An attacker (or buggy upstream) emitting malformed
    // stdin bypassed the entire secrets gate. Now: block with a generic
    // INTERNAL ERROR reason; log the parse error for diagnostics. Compare to
    // fact-force-gate (which correctly approves on parse error since it's a
    // discipline check, not a security check). The two have different threat
    // models.
    logger('block', { error: err.message, reason: 'parse_error_fail_closed' });
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: 'SECRETS GATE: internal error parsing tool input — refusing to approve write. This is fail-closed by design; check ~/.claude/logs/validate-no-bare-secrets.log for the parse error.',
    }));
  }
});
