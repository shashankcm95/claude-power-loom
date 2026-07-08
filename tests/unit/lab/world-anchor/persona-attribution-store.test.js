#!/usr/bin/env node

// tests/unit/lab/world-anchor/persona-attribution-store.test.js
//
// Gap-8 review-loop Wave A0 — the content-addressed PR->PERSONA attribution map store. Template:
// review-outcome-store.test.js (verify-on-read) + merge-outcome-store's explicit-field conflict-reject.
//
// Contracts pinned here (the VERIFY board's folds):
//   - F1 CONFLICT-REJECT: a differing persona for the SAME (repo, pr_number) -> {ok:false, reason:'persona-conflict'}
//     (NOT a silent dedup — persona is out-of-basis, so a node_id-only compare would keep the first). A distinct
//     token from the tamper token 'existing-record-unverifiable'. Same persona re-write -> deduped ok.
//   - F3 CASE-FOLD: repo is folded into the node_id basis; a mixed-case slug resolves to the SAME record.
//   - F5 ROSTER VALIDATION: persona must be canonicalPersonaKey(persona) === persona — rejects kernel: / the
//     'changes-requested' sentinel / off-roster / the numbered-prefix form.
//   - F6 FAIL-SOFT: lookup on a tampered / malformed / absent record returns null and NEVER throws.
//   - #273 / SCAR-41: owns-basis re-derive on read rejects a divorced-key forge; content_hash seals persona.
//
// ENV-BEFORE-REQUIRE: the store resolves LOOM_LAB_STATE_DIR at module-load -> set first.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LAB_TMP = path.join(os.tmpdir(), 'pa-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = LAB_TMP; // BEFORE requires
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const {
  recordPersonaForPr, lookupPersonaForPr, listPersonaAttributions, derivePersonaNodeId,
} = require(P('lab', 'world-anchor', 'persona-attribution-store.js'));

const NOW = Date.parse('2026-07-08T12:00:00.000Z');

function freshDir() {
  const d = path.join(os.tmpdir(), 'pa-store-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function fileFor(dir, node_id) { return path.join(dir, node_id + '.json'); }

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('1. record + lookup: a builder persona is attached to a PR and read back', () => {
  const d = freshDir();
  try {
    const r = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
    assert.strictEqual(r.ok, true, `record ok (reason=${r.reason || ''})`);
    assert.strictEqual(r.deduped, false, 'a fresh record is not a dedup');
    assert.strictEqual(lookupPersonaForPr('acme/widgets', 1, { dir: d }), 'node-backend', 'the mapped persona reads back');
    assert.strictEqual(lookupPersonaForPr('acme/widgets', 2, { dir: d }), null, 'a different PR is un-mapped');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('2. F1 one-per-PR conflict-reject: a DIFFERING persona -> {ok:false, persona-conflict}; SAME persona -> deduped', () => {
  const d = freshDir();
  try {
    const first = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
    assert.strictEqual(first.ok, true);
    // NON-VACUITY: the SAME persona dedups (the guard's PASS path)
    const same = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW + 1000 });
    assert.strictEqual(same.ok, true, 'a re-record of the same persona is idempotent');
    assert.strictEqual(same.deduped, true, 'same persona -> deduped, not a conflict');
    // the RED path: a DIFFERENT (also valid) persona for the same PR is REJECTED, not silently kept
    const conflict = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'code-reviewer' }, { dir: d, now: NOW + 2000 });
    assert.strictEqual(conflict.ok, false, 'a differing persona is rejected (NOT a silent dedup — persona is out-of-basis)');
    assert.strictEqual(conflict.reason, 'persona-conflict', 'the DISTINCT token, not the tamper token existing-record-unverifiable');
    // the first persona is unchanged (first-write-wins; the conflict does not overwrite)
    assert.strictEqual(lookupPersonaForPr('acme/widgets', 1, { dir: d }), 'node-backend', 'the original persona is retained');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('3. F5 roster validation: kernel: / sentinel / off-roster / numbered-prefix personas are REJECTED', () => {
  const d = freshDir();
  try {
    for (const persona of ['kernel:loom-integrator', 'changes-requested', 'zzz-made-up-persona', '13-node-backend']) {
      const r = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona }, { dir: d, now: NOW });
      assert.strictEqual(r.ok, false, `persona ${JSON.stringify(persona)} rejected`);
      assert.strictEqual(r.reason, 'bad-persona', `reason is bad-persona for ${JSON.stringify(persona)}`);
    }
    assert.strictEqual(lookupPersonaForPr('acme/widgets', 1, { dir: d }), null, 'nothing was recorded');
    assert.strictEqual(listPersonaAttributions({ dir: d }).length, 0, 'the store is empty after all rejects');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('4. F3 case-fold: a mixed-case repo resolves to the SAME record (producer-store and consumer-lookup agree)', () => {
  const d = freshDir();
  try {
    const r = recordPersonaForPr({ repo: 'Acme/Widgets', pr_number: 5, persona: 'node-backend' }, { dir: d, now: NOW });
    assert.strictEqual(r.ok, true);
    // the stored repo is FOLDED
    const rows = listPersonaAttributions({ dir: d });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].repo, 'acme/widgets', 'the stored repo is case-folded');
    // lookup finds it under any case
    assert.strictEqual(lookupPersonaForPr('acme/widgets', 5, { dir: d }), 'node-backend', 'folded lookup finds it');
    assert.strictEqual(lookupPersonaForPr('ACME/WIDGETS', 5, { dir: d }), 'node-backend', 'upper lookup finds it');
    // a case-variant re-record of the SAME persona is a dedup (same node_id), not a second record
    const dup = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 5, persona: 'node-backend' }, { dir: d, now: NOW + 1 });
    assert.strictEqual(dup.deduped, true, 'case-variant + same persona -> same node_id -> dedup');
    // a case-variant with a DIFFERENT persona is a conflict (proves the fold makes them ONE PR)
    const conflict = recordPersonaForPr({ repo: 'ACME/widgets', pr_number: 5, persona: 'code-reviewer' }, { dir: d, now: NOW + 2 });
    assert.strictEqual(conflict.reason, 'persona-conflict', 'a case-variant differing persona is the same-PR conflict');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('5. #273/SCAR-41 verify-on-read: a content-hash tamper and a divorced-key forge are BOTH rejected', () => {
  const d = freshDir();
  try {
    const r = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
    const f = fileFor(d, r.node_id);
    // (a) content-hash tamper: swap the persona to another VALID roster member, keep the stale content_hash
    const body = JSON.parse(fs.readFileSync(f, 'utf8'));
    const tampered = { ...body, persona: 'security-auditor' }; // node_id + content_hash unchanged (stale)
    fs.writeFileSync(f, JSON.stringify(tampered));
    assert.strictEqual(lookupPersonaForPr('acme/widgets', 1, { dir: d }), null, 'an in-place persona edit breaks content_hash -> null');
    // (b) divorced-key forge: a self-consistent body placed under a WRONG filename is skipped on list
    const d2 = freshDir();
    const r2 = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 9, persona: 'node-backend' }, { dir: d2, now: NOW });
    const good = fs.readFileSync(fileFor(d2, r2.node_id));
    fs.writeFileSync(path.join(d2, 'deadbeef'.repeat(8) + '.json'), good); // same bytes, wrong name (node_id != filename)
    const rows = listPersonaAttributions({ dir: d2 });
    assert.strictEqual(rows.length, 1, 'the divorced-key copy is rejected (re-derive != filename); only the honest record survives');
    fs.rmSync(d2, { recursive: true, force: true });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('6. F6 fail-soft: lookup on a malformed / absent record returns null and NEVER throws', () => {
  const d = freshDir();
  try {
    const r = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
    fs.writeFileSync(fileFor(d, r.node_id), '{ this is not valid json'); // corrupt the body
    let out;
    assert.doesNotThrow(() => { out = lookupPersonaForPr('acme/widgets', 1, { dir: d }); }, 'a malformed record must not throw');
    assert.strictEqual(out, null, 'a malformed record -> null (relocates the PR to the sentinel, never aborts)');
    // absent dir
    const missing = path.join(os.tmpdir(), 'pa-absent-' + crypto.randomBytes(6).toString('hex'));
    let out2;
    assert.doesNotThrow(() => { out2 = lookupPersonaForPr('acme/widgets', 1, { dir: missing }); });
    assert.strictEqual(out2, null, 'an absent store -> null, no throw');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('7. determinism + deep-frozen list; the returned record cannot be mutated', () => {
  const d = freshDir();
  try {
    recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
    const id1 = derivePersonaNodeId({ repo: 'acme/widgets', pr_number: 1 });
    const id2 = derivePersonaNodeId({ repo: 'acme/widgets', pr_number: 1 });
    assert.strictEqual(id1, id2, 'node_id derivation is deterministic');
    const rows = listPersonaAttributions({ dir: d });
    assert.strictEqual(rows.length, 1);
    assert.ok(Object.isFrozen(rows[0]), 'the listed record is deep-frozen (immutable read path)');
    assert.throws(() => { rows[0].persona = 'evil'; }, TypeError, 'a frozen record rejects mutation in strict mode');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('8. __proto__-bearing repo: a poison-key repo segment does not corrupt anything (hex64 filename)', () => {
  const d = freshDir();
  try {
    const r = recordPersonaForPr({ repo: '__proto__/foo', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
    assert.strictEqual(r.ok, true, 'a __proto__ repo segment is a valid 2-part slug, stored under a hex64 filename');
    assert.strictEqual(lookupPersonaForPr('__proto__/foo', 1, { dir: d }), 'node-backend', 'and reads back');
    assert.strictEqual(({}).polluted, undefined, 'Object.prototype is not polluted');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('9. M3 EEXIST race branch: raced-matching -> dedup; raced-differing -> persona-conflict; unreadable racer -> unverifiable', () => {
  // Force the TOCTOU catch(EEXIST) branch (never reached by sequential single-process writes) via a
  // writeFileSync seam: the pre-write read sees nothing, then the wx write hits EEXIST because a "racer"
  // planted the file. Locks in the currently-correct 3-outcome logic (VALIDATE code-reviewer MEDIUM).
  const tmpS = freshDir(); const tmpD = freshDir();
  // build the EXACT racer bytes deterministically (same repo/pr/now -> same node_id + body; persona is
  // out-of-basis so both personas share the node_id/filename).
  const rSame = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: tmpS, now: NOW });
  const sameBytes = fs.readFileSync(fileFor(tmpS, rSame.node_id));
  const rDiff = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'code-reviewer' }, { dir: tmpD, now: NOW });
  const diffBytes = fs.readFileSync(fileFor(tmpD, rDiff.node_id));
  const orig = fs.writeFileSync;
  function raceWith(racerBytes) {
    let fired = false;
    fs.writeFileSync = function patched(file, data, opts) {
      if (!fired && String(file).endsWith('.json')) {
        fired = true;
        if (racerBytes) orig.call(fs, file, racerBytes, { mode: 0o600 }); // the racer wrote first
        const e = new Error('EEXIST: file already exists'); e.code = 'EEXIST'; throw e;
      }
      return orig.call(fs, file, data, opts);
    };
  }
  const cases = [
    { racer: sameBytes, persona: 'node-backend', expect: (r) => r.ok === true && r.deduped === true, label: 'raced-matching -> dedup' },
    { racer: diffBytes, persona: 'node-backend', expect: (r) => r.ok === false && r.reason === 'persona-conflict', label: 'raced-differing -> persona-conflict' },
    { racer: null, persona: 'node-backend', expect: (r) => r.ok === false && r.reason === 'existing-record-unverifiable', label: 'unreadable racer -> unverifiable' },
  ];
  try {
    for (const c of cases) {
      const dd = freshDir();
      raceWith(c.racer);
      let out;
      try { out = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: c.persona }, { dir: dd, now: NOW }); }
      finally { fs.writeFileSync = orig; }
      assert.ok(c.expect(out), `${c.label} (got ${JSON.stringify(out)})`);
      fs.rmSync(dd, { recursive: true, force: true });
    }
  } finally {
    fs.writeFileSync = orig;
    fs.rmSync(tmpS, { recursive: true, force: true }); fs.rmSync(tmpD, { recursive: true, force: true });
  }
});

test('10. LOW5 fail-soft oversize: a >MAX_RECORD_BYTES map record -> lookup null (never throws)', () => {
  const d = freshDir();
  try {
    const r = recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
    fs.writeFileSync(fileFor(d, r.node_id), Buffer.alloc(5000, 0x41)); // >4096, valid-node_id filename
    let out;
    assert.doesNotThrow(() => { out = lookupPersonaForPr('acme/widgets', 1, { dir: d }); }, 'an oversize record must not throw');
    assert.strictEqual(out, null, 'an oversize record -> null (fail-soft, the fstat size gate fires before the read)');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('11. NIT7 slug realism: a "." / ".." / >2-part repo segment is REJECTED; a real slug with . _ - is accepted', () => {
  const d = freshDir();
  try {
    for (const repo of ['../x', 'a/..', './x', 'a/b/c', 'a b/c']) {
      const r = recordPersonaForPr({ repo, pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
      assert.strictEqual(r.ok, false, `repo ${JSON.stringify(repo)} rejected`);
      assert.strictEqual(r.reason, 'bad-repo', `reason bad-repo for ${JSON.stringify(repo)}`);
    }
    const ok = recordPersonaForPr({ repo: 'my-org/my.repo_v2', pr_number: 1, persona: 'node-backend' }, { dir: d, now: NOW });
    assert.strictEqual(ok.ok, true, 'a real GitHub slug with . _ - is accepted');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('12. M2 lookup dir-validation: a SYMLINKED store dir is REFUSED on lookup (parity with write/list)', () => {
  const real = freshDir();
  try {
    recordPersonaForPr({ repo: 'acme/widgets', pr_number: 1, persona: 'node-backend' }, { dir: real, now: NOW });
    const link = path.join(os.tmpdir(), 'pa-link-' + crypto.randomBytes(6).toString('hex'));
    fs.symlinkSync(real, link);
    try {
      assert.strictEqual(lookupPersonaForPr('acme/widgets', 1, { dir: link }), null, 'a symlinked store dir is refused on lookup (not silently followed)');
      assert.strictEqual(lookupPersonaForPr('acme/widgets', 1, { dir: real }), 'node-backend', 'control: the real dir still resolves');
    } finally { fs.rmSync(link, { force: true }); }
  } finally { fs.rmSync(real, { recursive: true, force: true }); }
});

process.stdout.write(`\npersona-attribution-store.test.js (Gap-8 Wave A0): ${passed} passed, ${failed} failed\n`);
fs.rmSync(LAB_TMP, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
