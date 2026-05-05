#!/usr/bin/env node

// PreToolUse:Write/Edit validator (H.4.2): blocks file writes that contain
// bare secret literals. Hook-layer enforcement complements actor-output-only
// triple-contract verification — operates at WRITE time, deterministically,
// against direct file edits by Claude.
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

const { log } = require('../_log.js');
const logger = log('validate-no-bare-secrets');

// Each pattern: { id, regex, description }. id is what the user sees.
const SECRET_PATTERNS = [
  { id: 'anthropic-api-key',  regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,           description: 'Anthropic API key' },
  { id: 'stripe-live-key',    regex: /sk_live_[A-Za-z0-9]{20,}/g,            description: 'Stripe live secret key' },
  { id: 'stripe-restricted',  regex: /rk_live_[A-Za-z0-9]{20,}/g,            description: 'Stripe restricted key' },
  { id: 'slack-token',        regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g,         description: 'Slack token' },
  { id: 'github-pat',         regex: /gh[posur]_[A-Za-z0-9]{36,}/g,           description: 'GitHub personal access token' },
  { id: 'aws-access-key-id',  regex: /\bAKIA[0-9A-Z]{16}\b/g,                 description: 'AWS access key ID' },
  { id: 'jwt-token',          regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, description: 'JWT-shape token' },
  // Generic assignment pattern. Trailing-value group requires ≥16 alphanumeric chars; excludes obvious placeholders.
  {
    id: 'literal-secret-assignment',
    regex: /\b([A-Z][A-Z0-9_]*_(?:SECRET|KEY|TOKEN|PASSWORD|PASSWD))\s*[:=]\s*['"]?([A-Za-z0-9+/=_-]{16,})['"]?/g,
    description: 'literal *_SECRET/*_KEY/*_TOKEN assignment',
    valueGroup: 2,
  },
];

// Strings that look secret-shaped but are clearly placeholders. If the matched
// value is one of these (case-insensitive), skip — false positives bother the
// user more than a true positive helps.
const PLACEHOLDER_VALUES = new Set([
  'your-key-here', 'your_key_here', 'changeme', 'change-me', 'replaceme',
  'replace-me', 'placeholder', 'todo', 'xxx', 'redacted', 'secret', 'password',
  'aaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', '0000000000000000',
  '1234567890abcdef', '1234567890123456',
]);

// Skip patterns: don't scan reads of common test fixtures, .env.example, etc.
// (No false positives on intentional documentation of the patterns themselves.)
const SKIP_PATH_PATTERNS = [
  /\.env\.example$/i,
  /\.env\.template$/i,
  /\.env\.sample$/i,
  /(?:^|\/)tests?\/fixtures\//i,
  /(?:^|\/)__tests__\/.*\.(test|spec|fixture)\./i,
  /(?:^|\/)hooks\/scripts\/validators\//i, // this validator + tests of it
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
    let scanText = '';
    if (toolName === 'Write') {
      scanText = toolInput.content || '';
    } else if (toolName === 'Edit') {
      // Scan only the new content, not what's being replaced — the old_string
      // is whatever was already on disk and has presumably already been read.
      scanText = (toolInput.new_string || '') + '\n' + (toolInput.replace_all_string || '');
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
    // Never block on parse errors — graceful degrade matches fact-force-gate.
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
