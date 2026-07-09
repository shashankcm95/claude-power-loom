'use strict';

// generate-persona-stub-equality.test.js — the persona-depth W1 follow-up gate
// (M1 + L1). Guards that `--check` is a directory-INTEGRITY gate, not a presence
// check: every generator-managed agents/*.md is byte-identical to renderAgentMd,
// the 3 pinned-fat agents keep their tier + fat body, the two rosters partition
// the whole directory, and each check arm is NON-VACUOUS (proven to fail on a
// tampered fixture). Codifies the VERIFY board (the `orphaned` completeness arm,
// the FAT_AGENTS roster pin, kb-id resolvability). Sibling to
// generate-persona-model-field.test.js — that file is the tier-render oracle;
// this one is the content + directory-completeness oracle.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PERSONAS, FAT_AGENTS, renderAgentMd, modelLine, collectCheckProblems,
} = require('../../../scripts/generate-persona-agents');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const KB_DIR = path.join(REPO_ROOT, 'packages/skills/library/agent-team/kb');
const THIN_SENTINEL = 'This file is intentionally minimal';

function tmpAgentsCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-agents-'));
  fs.cpSync(AGENTS_DIR, dir, { recursive: true });
  return dir;
}

// --------------------------------------------------------------------------
// Invariant — the committed tree is clean under the gate
// --------------------------------------------------------------------------

test('collectCheckProblems() on the real tree returns every arm empty', () => {
  const r = collectCheckProblems();
  for (const [arm, hits] of Object.entries(r)) {
    assert.deepStrictEqual(hits, [], `${arm} must be empty on the committed tree (got ${JSON.stringify(hits)})`);
  }
});

test('every managed stub is byte-identical to renderAgentMd (generator is SSOT)', () => {
  for (const p of PERSONAS) {
    const onDisk = fs.readFileSync(path.join(AGENTS_DIR, `${p.agent}.md`), 'utf8');
    assert.strictEqual(onDisk, renderAgentMd(p), `${p.agent}.md drifts from the generator`);
  }
});

test('each fat agent exists at its pinned tier and is not thinned in place', () => {
  for (const [name, tier] of Object.entries(FAT_AGENTS)) {
    const fp = path.join(AGENTS_DIR, `${name}.md`);
    assert.ok(fs.existsSync(fp), `${name}.md exists`);
    const md = fs.readFileSync(fp, 'utf8');
    assert.strictEqual(modelLine(md), tier, `${name} model tier is ${tier}`);
    assert.ok(!md.includes(THIN_SENTINEL), `${name} is still fat (no thin-delegation sentinel)`);
  }
});

test('PERSONAS and FAT_AGENTS partition agents/ — no overlap, no orphan', () => {
  const governed = new Set([...PERSONAS.map((p) => p.agent), ...Object.keys(FAT_AGENTS)]);
  const onDisk = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  const overlap = PERSONAS.map((p) => p.agent).filter((n) => Object.prototype.hasOwnProperty.call(FAT_AGENTS, n));
  assert.deepStrictEqual(overlap, [], 'no agent is in both PERSONAS and FAT_AGENTS');
  for (const name of onDisk) assert.ok(governed.has(name), `agents/${name}.md is governed by a roster`);
  for (const name of governed) assert.ok(onDisk.includes(name), `roster entry ${name} has a stub file`);
});

// --------------------------------------------------------------------------
// Roster pin — the fat->thin demotion tripwire (hacker M1)
// --------------------------------------------------------------------------

test('FAT_AGENTS pins exactly the three bespoke fat agents', () => {
  assert.deepStrictEqual(
    Object.keys(FAT_AGENTS).sort(),
    ['architect', 'code-reviewer', 'security-auditor'],
    'demoting or adding a fat agent must be a deliberate, diff-visible edit to this pinned set + this test',
  );
});

// --------------------------------------------------------------------------
// kb-id resolvability — a folded typo would pass content-equality forever
// (validate-doc-paths does not scan agents/), so pin it here (hacker M3)
// --------------------------------------------------------------------------

test('every kbDefaults + kbExtra id resolves to a real KB doc', () => {
  const ids = new Set();
  for (const p of PERSONAS) {
    (p.kbDefaults || []).forEach((k) => ids.add(k));
    (p.kbExtra || []).forEach((e) => ids.add(e.id));
  }
  for (const id of ids) {
    const fp = path.join(KB_DIR, `${id.replace(/^kb:/, '')}.md`);
    assert.ok(fs.existsSync(fp), `${id} resolves to ${path.relative(REPO_ROOT, fp)}`);
  }
});

// --------------------------------------------------------------------------
// Non-vacuous — each arm fires on a tampered fixture tree
// --------------------------------------------------------------------------

test('drifted fires when a managed stub is tampered', () => {
  const dir = tmpAgentsCopy();
  try {
    fs.appendFileSync(path.join(dir, 'hacker.md'), '\n<!-- tamper -->\n');
    assert.ok(collectCheckProblems({ agentsDir: dir }).drifted.includes('hacker'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fatModel fires when a fat agent tier is flipped', () => {
  const dir = tmpAgentsCopy();
  try {
    const fp = path.join(dir, 'code-reviewer.md');
    fs.writeFileSync(fp, fs.readFileSync(fp, 'utf8').replace(/^model: sonnet$/m, 'model: opus'));
    assert.ok(collectCheckProblems({ agentsDir: dir }).fatModel.some((m) => m.startsWith('code-reviewer:')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fatBody fires when a fat agent carries the thin-template sentinel', () => {
  const dir = tmpAgentsCopy();
  try {
    fs.appendFileSync(path.join(dir, 'security-auditor.md'), `\n${THIN_SENTINEL} — x\n`);
    assert.ok(collectCheckProblems({ agentsDir: dir }).fatBody.includes('security-auditor'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fatBody fires on a method-agnostic in-place gutting (no sentinel, body collapsed)', () => {
  const dir = tmpAgentsCopy();
  try {
    // Gut the body entirely — keep valid frontmatter + the correct model tier, so
    // fatModel/malformed pass — replacing the Layer-1 output-contract sections with a
    // throwaway line. The sentinel is absent; only the body-size floor catches this.
    const gutted = '---\nname: security-auditor\ntools: ["Read","Write","Edit","Bash","Grep","Glob"]\nmodel: sonnet\ncolor: red\n---\n\nnot fat anymore\n';
    fs.writeFileSync(path.join(dir, 'security-auditor.md'), gutted);
    const r = collectCheckProblems({ agentsDir: dir });
    assert.ok(r.fatBody.includes('security-auditor'), 'body-size floor catches the gutting');
    assert.deepStrictEqual(r.fatModel, [], 'tier untouched, so fatModel stays quiet — proving fatBody is the arm that fired');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('orphaned fires on an ungoverned agents/*.md', () => {
  const dir = tmpAgentsCopy();
  try {
    fs.writeFileSync(path.join(dir, 'foo-orphan.md'), '---\nname: foo-orphan\nmodel: opus\n---\nbody\n');
    assert.ok(collectCheckProblems({ agentsDir: dir }).orphaned.includes('foo-orphan'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tableConflicts fires when a name is in both rosters', () => {
  const dir = tmpAgentsCopy();
  try {
    // hacker is a managed persona; injecting it into fatAgents creates the overlap
    assert.ok(collectCheckProblems({ agentsDir: dir, fatAgents: { hacker: 'opus' } }).tableConflicts.includes('hacker'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing fires when a managed stub is absent', () => {
  const dir = tmpAgentsCopy();
  try {
    fs.rmSync(path.join(dir, 'hacker.md'));
    assert.ok(collectCheckProblems({ agentsDir: dir }).missing.includes('hacker'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
