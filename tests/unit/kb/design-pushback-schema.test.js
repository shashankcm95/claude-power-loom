#!/usr/bin/env node
/**
 * design-pushback-schema.test.js — v2.8.6 schema validation
 *
 * Verifies every entry under skills/agent-team/kb/design-pushback/ conforms
 * to the schema defined in _index.md.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '../../../skills/agent-team/kb/design-pushback');
const REPO = path.resolve(__dirname, '../../..');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  return text.slice(4, end);
}

function yamlFieldExists(fm, key) {
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'm');
  return re.test(fm);
}

function yamlScalar(fm, key) {
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*([^\\n|>]+)', 'm');
  const m = fm.match(re);
  return m ? m[1].trim() : null;
}

const SCHEMA_REQUIRED = [
  'kb_id', 'version', 'tags', 'related', 'status',
  'pattern', 'severity', 'applies_when',
  'applies_NOT_when', 'preferred_alternative', 'why_better',
  'override_requires', 'empirical_origin',
];

const VALID_SEVERITY = new Set(['HIGH', 'MEDIUM', 'LOW']);

process.stdout.write('\n[v2.8.6] design-pushback KB schema validation\n');

assert(fs.existsSync(DIR), 'X1: design-pushback dir exists');
assert(fs.existsSync(path.join(DIR, '_index.md')), 'X2: _index.md present');

const entries = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.md') && f !== '_index.md');

assert(entries.length >= 5, 'X3: at least 5 anchor entries (got ' + entries.length + ')');

for (const file of entries) {
  const slug = file.replace(/\.md$/, '');
  const full = path.join(DIR, file);
  const text = fs.readFileSync(full, 'utf8');
  const fm = parseFrontmatter(text);

  assert(fm !== null, 'F[' + slug + ']: has frontmatter block');
  if (!fm) continue;

  const kbId = yamlScalar(fm, 'kb_id');
  assert(kbId === 'design-pushback/' + slug, 'F[' + slug + ']: kb_id matches filename (got "' + kbId + '")');

  for (const field of SCHEMA_REQUIRED) {
    assert(yamlFieldExists(fm, field), 'F[' + slug + ']: required field "' + field + '" present');
  }

  const sev = yamlScalar(fm, 'severity');
  assert(VALID_SEVERITY.has(sev), 'F[' + slug + ']: severity in {HIGH,MEDIUM,LOW} (got "' + sev + '")');

  const status = yamlScalar(fm, 'status');
  assert(status === 'active+enforced' || status === 'active', 'F[' + slug + ']: status valid');

  const version = yamlScalar(fm, 'version');
  assert(version === '1', 'F[' + slug + ']: version 1');

  const relatedBlock = fm.match(/^related:\n((?:\s{2}- [^\n]+\n)+)/m);
  if (relatedBlock) {
    const refs = relatedBlock[1].split('\n')
      .map((l) => l.replace(/^\s{2}- /, '').trim())
      .filter(Boolean);
    for (const ref of refs) {
      const refPath = path.join(REPO, 'skills/agent-team/kb', ref + '.md');
      assert(fs.existsSync(refPath), 'F[' + slug + ']: related "' + ref + '" exists');
    }
  }

  const body = text.slice(text.indexOf('\n---\n', 4) + 5);
  assert(/## Quick Reference/.test(body), 'F[' + slug + ']: "## Quick Reference" heading');
  assert(/## Full content/.test(body) || /## Related Patterns/.test(body), 'F[' + slug + ']: "## Full content" or "## Related Patterns" heading');
}

const idxText = fs.readFileSync(path.join(DIR, '_index.md'), 'utf8');
assert(parseFrontmatter(idxText) !== null, 'I1: _index.md has frontmatter');
assert(/Entry schema/.test(idxText), 'I2: _index.md has Entry schema section');
assert(/HIGH \| MEDIUM \| LOW/.test(idxText), 'I3: _index.md documents severity ladder');
assert(/applies_when/.test(idxText), 'I4: _index.md documents applies_when filter');
assert(/override_requires/.test(idxText), 'I5: _index.md documents override path');

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
