#!/usr/bin/env node

// tests/unit/kernel/_lib/context-envelope.test.js
//
// Failing-test contract for packages/kernel/_lib/context-envelope.js + the
// schema at packages/kernel/schema/context-envelope.schema.json (K3.b, NEW in PR 1).
//
// Per Phase-1-alpha/1 TDD-treatment + post-compact R1 F-1 + FL-2 resolution:
//   - Schema MUST validate independently from `validate-adr-drift.js` (FL-8)
//   - Schema MUST carry top-level `schemaVersion` field for v3.1 handshake (FL-2)
//   - Module ships DORMANT in PR 1 — production importers land at v3.1; the
//     dormancy-assertion CI grep is in PR 1 verification probes (FL-5).
//
// At PR-1-author time this file is FAILING by design — neither the schema
// file nor the module exists yet. Tests pass once PR 1 phase 8 deliverables land.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'packages', 'kernel', 'schema', 'context-envelope.schema.json');
const MODULE_PATH = path.join(REPO_ROOT, 'packages', 'kernel', '_lib', 'context-envelope.js');

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

// --- Schema file contract ---

test('K3.b.schema: file exists at expected path', () => {
  assert.ok(
    fs.existsSync(SCHEMA_PATH),
    `expected schema at ${SCHEMA_PATH} — PR 1 phase 8 deliverable`,
  );
});

test('K3.b.schema: parses as JSON', () => {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const parsed = JSON.parse(raw); // throws on invalid JSON
  assert.strictEqual(typeof parsed, 'object');
});

test('K3.b.schema: declares JSON-Schema-draft-07 ($schema)', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  assert.ok(
    typeof schema.$schema === 'string' && schema.$schema.includes('draft-07'),
    'expected $schema to declare JSON-Schema-draft-07',
  );
});

test('K3.b.schema: top-level schemaVersion field present (FL-2 handshake)', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  assert.ok(schema.properties, 'schema must declare properties');
  assert.ok(
    schema.properties.schemaVersion,
    'schema.properties.schemaVersion required for v3.1 handshake (FL-2)',
  );
  // schemaVersion is REQUIRED (not optional) so v3.1 consumers can reject
  // unversioned envelopes deterministically.
  assert.ok(
    Array.isArray(schema.required) && schema.required.includes('schemaVersion'),
    'schemaVersion must be in schema.required[]',
  );
});

test('K3.b.schema: schemaVersion is "1.0.0-provisional" at v3.0-alpha', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const versionProp = schema.properties.schemaVersion;
  assert.ok(versionProp, 'schemaVersion property must exist');
  // Either declared as const, enum, or x-current-version metadata. The
  // contract: there must be a discoverable answer to "what version does
  // v3.0-alpha ship?" without reading ADR-0010.
  const hasDeclaredVersion =
    versionProp.const === '1.0.0-provisional' ||
    (Array.isArray(versionProp.enum) && versionProp.enum.includes('1.0.0-provisional')) ||
    versionProp['x-current-version'] === '1.0.0-provisional';
  assert.ok(
    hasDeclaredVersion,
    'schema must declare 1.0.0-provisional as the v3.0-alpha version (FL-2)',
  );
});

// --- Module contract (dormant in PR 1) ---

test('K3.b.module: file exists at expected path', () => {
  assert.ok(
    fs.existsSync(MODULE_PATH),
    `expected context-envelope.js at ${MODULE_PATH} — PR 1 phase 8 deliverable`,
  );
});

test('K3.b.module: exports validateEnvelope function', () => {
  const mod = require(MODULE_PATH);
  assert.strictEqual(typeof mod.validateEnvelope, 'function');
});

test('K3.b.module: validateEnvelope accepts well-formed envelope', () => {
  const { validateEnvelope } = require(MODULE_PATH);
  const envelope = {
    schemaVersion: '1.0.0-provisional',
    contextItems: [],
  };
  const result = validateEnvelope(envelope);
  assert.strictEqual(result.valid, true, 'errors: ' + JSON.stringify(result.errors || []));
});

test('K3.b.module: validateEnvelope rejects missing schemaVersion (FL-2)', () => {
  const { validateEnvelope } = require(MODULE_PATH);
  const envelope = { contextItems: [] };
  const result = validateEnvelope(envelope);
  assert.strictEqual(result.valid, false);
  assert.ok(
    JSON.stringify(result.errors || []).match(/schemaVersion/),
    'rejection reason must reference schemaVersion',
  );
});

test('K3.b.module: validateEnvelope rejects malformed envelope (random object)', () => {
  const { validateEnvelope } = require(MODULE_PATH);
  const result = validateEnvelope({ foo: 'bar' });
  assert.strictEqual(result.valid, false);
});

// --- K3.b buildEnvelope + version handshake (v3.1 PR-2a additions) ---
//
// PR-2a ADDS buildEnvelope({contextItems}) + SCHEMA_VERSION + acceptsSchemaVersion
// to the module. buildEnvelope's ONLY importer in PR-2a is THIS test file (the
// K8 production consumer that flips dormancy lands in PR-2b) — so the dormancy
// assertion below MUST stay GREEN after these additions.

test('K3.b.buildEnvelope: exports buildEnvelope function', () => {
  const mod = require(MODULE_PATH);
  assert.strictEqual(typeof mod.buildEnvelope, 'function');
});

test('K3.b.buildEnvelope: round-trips through validateEnvelope (valid===true)', () => {
  const { buildEnvelope, validateEnvelope } = require(MODULE_PATH);
  const env = buildEnvelope({
    contextItems: [
      { source: 'parent-spawn', scope: 'task', content: 'do X', precedence: 1 },
      { source: 'kb', scope: 'global', content: 'ref', precedence: 2 },
    ],
  });
  const result = validateEnvelope(env);
  assert.strictEqual(result.valid, true, 'errors: ' + JSON.stringify(result.errors || []));
});

test('K3.b.buildEnvelope: stamps the exported SCHEMA_VERSION', () => {
  const { buildEnvelope, SCHEMA_VERSION } = require(MODULE_PATH);
  assert.strictEqual(typeof SCHEMA_VERSION, 'string');
  const env = buildEnvelope({ contextItems: [] });
  assert.strictEqual(env.schemaVersion, SCHEMA_VERSION);
});

test('K3.b.buildEnvelope: SCHEMA_VERSION equals the schema const (1.0.0-provisional)', () => {
  const { SCHEMA_VERSION } = require(MODULE_PATH);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  assert.strictEqual(SCHEMA_VERSION, schema.properties.schemaVersion.const);
});

test('K3.b.buildEnvelope: does not mutate the input contextItems array', () => {
  const { buildEnvelope } = require(MODULE_PATH);
  const items = [{ source: 's', scope: 'task', content: 'c', precedence: 1 }];
  const frozen = Object.freeze(items.slice());
  assert.doesNotThrow(() => buildEnvelope({ contextItems: frozen }));
});

test('K3.b.buildEnvelope: tolerates missing contextItems (defaults to empty array)', () => {
  const { buildEnvelope, validateEnvelope } = require(MODULE_PATH);
  const env = buildEnvelope({});
  assert.ok(Array.isArray(env.contextItems));
  assert.strictEqual(validateEnvelope(env).valid, true);
});

test('K3.b.acceptsSchemaVersion: 1.x accepted, 2.x rejected (MAJOR handshake)', () => {
  const { acceptsSchemaVersion } = require(MODULE_PATH);
  assert.strictEqual(acceptsSchemaVersion('1.0.0-provisional'), true);
  assert.strictEqual(acceptsSchemaVersion('1.4.2'), true);
  assert.strictEqual(acceptsSchemaVersion('2.0.0'), false);
  assert.strictEqual(acceptsSchemaVersion('0.9.0'), false);
  // Non-string inputs must be rejected without throwing.
  assert.strictEqual(acceptsSchemaVersion(undefined), false);
  assert.strictEqual(acceptsSchemaVersion(1), false);
  assert.strictEqual(acceptsSchemaVersion(null), false);
});

// --- FL-5 dormancy assertion (PR 1 ships module dormant) ---

test('K3.b.dormancy: zero production importers in packages/ outside tests/', () => {
  // Mirror the CI grep step from PR 1 verification probes FL-5.
  // Walk packages/ looking for production-code references to context-envelope.
  // Should return zero hits; any production importer = K3.b dormancy violation.
  const packagesDir = path.join(REPO_ROOT, 'packages');
  const violations = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // Skip tests/, node_modules/, .git/
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'tests' ||
          entry.name === 'fixtures'
        ) {
          continue;
        }
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        // Skip the module itself
        if (full === MODULE_PATH) continue;
        const content = fs.readFileSync(full, 'utf8');
        if (/require\([^)]*_lib\/context-envelope/.test(content) || /from\s+['"][^'"]*_lib\/context-envelope/.test(content)) {
          violations.push(full);
        }
      }
    }
  }

  walk(packagesDir);
  assert.deepStrictEqual(
    violations,
    [],
    `K3.b dormancy violation — production importers found: ${violations.join(', ')}`,
  );
});

process.stdout.write(`\ncontext-envelope.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
