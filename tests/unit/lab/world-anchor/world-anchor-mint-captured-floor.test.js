#!/usr/bin/env node

// tests/unit/lab/world-anchor/world-anchor-mint-captured-floor.test.js
//
// Autonomous-SDE ladder item-3-live, PR-2 (Half A) - the MINT-SIDE half of the captured-lesson merge
// wire (SHADOW, widens #273; Half B deferred). The mint floor now resolves a lesson from TWO explicit
// branches (a deliberate KISS / security-over-DRY split, NOT one unified abstraction):
//   - Branch A (static grandfather): the issue-bound LESSON_2137 seed, built INSIDE the try/catch.
//   - Branch B (captured): a content-verified live_pending node (listLivePendingLessons), consumed
//     VERBATIM (the store already content-address-verified it on read; it has no enum axes to rebuild).
// The join is an EXACT-SET (repo-slug, issueRef, lesson_signature); the matched signature must be one of
// the 24 canonical lessonClusterKey keys; the floor resolves to EXACTLY ONE candidate or refuses
// (no-floor-lesson / ambiguous-floor-lesson / off-taxonomy-lesson - each fail-closed + OBSERVABLE).
//
// Mirrors world-anchor-mint.test.js STYLE (node:assert + a light test() runner + LOOM_LAB_STATE_DIR
// pinned BEFORE the store modules are required + the attest()/recordOutcome() fixtures + the
// stderr-capture pattern). Run via `node <file>`, NOT node:test (the lab convention).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store modules are required
// (they read LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER write
// to the real ~/.claude/lab-state store (the cli.test.js dogfood lesson, carried verbatim).
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const MINT_FILE = path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-mint.js');
const { mintFromMergeOutcome } = require(MINT_FILE);
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const outcomeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'merge-outcome-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const pendingStore = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));
const { LESSON_2137 } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'lesson.js'));
const { lessonClusterKey } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-signature.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-wacf-')); }

// The captured lane stores a URL repo (GH_REPO_RE); the attestation + merge-outcome store a slug. The
// repoSlug() join normalization is the bug fix under test. spec-kitty is the grandfather's issue-bound seed.
const SPEC_KITTY_SLUG = 'Priivacy-ai/spec-kitty';
const SPEC_KITTY_URL = 'https://github.com/Priivacy-ai/spec-kitty';
const SPEC_KITTY_ISSUE = 2097;
// The grandfather's canonical signature (LESSON_2137 maps to this cluster key).
const LESSON_2137_SIG = lessonClusterKey({
  trigger_class: LESSON_2137.trigger_class,
  gotcha_class: LESSON_2137.gotcha_class,
  corrective_class: LESSON_2137.corrective_class,
});

// A DISTINCT canonical signature for captured-lane fixtures (NOT the grandfather's; a different cluster
// so a captured node and the grandfather seed never collide unless a test deliberately constructs it).
const CAPTURED_SIG = 'lesson:data-parse|silent-coercion|fail-closed';
// A non-canonical (off-taxonomy) signature: a co-forged node can carry one (validateBlock only
// length-bounds the field). It is NOT one of the 24 lessonClusterKey keys.
const OFF_TAXONOMY_SIG = 'lesson:INVALID|silent-coercion|fail-closed';

// A captured-lane test repo (URL form) + issue used for the generic captured cases (NOT spec-kitty, so
// the grandfather seed is uncontested in these buckets).
const CAP_REPO_SLUG = 'octo/widget';
const CAP_REPO_URL = 'https://github.com/octo/widget';
const CAP_ISSUE = 314;
const CAP_PR_URL = 'https://github.com/octo/widget/pull/77';
const CAP_PR_NUMBER = 77;

const APPROVAL = 'a'.repeat(64);
const DIFF_HASH = 'b'.repeat(64);
const MERGE_SHA = 'c0ffee'.repeat(6) + 'cafe';   // 40 hex chars
const OBSERVED_AT = '2026-06-28T12:00:00.000Z';
const CANDIDATE_SHA = 'f'.repeat(64);

const CAPTURED_BODY = 'A captured live-solve lesson hypothesis (oracle-free); NOT LESSON_2137.';

function liveDir(d) { return path.join(d, 'live'); }
function edgeDir(d) { return path.join(d, 'edges'); }
function outcomeDir(d) { return path.join(d, 'outcomes'); }
function pendingDir(d) { return path.join(d, 'pending'); }

// All five per-store dirs the all-or-nothing wiring guard requires (production passes 0; a test passes
// ALL of them - the FOLD-B isolation invariant, now including pendingDir for the captured floor).
function allDirs(d) {
  return { anchorDir: d, outcomeDir: outcomeDir(d), liveDir: liveDir(d), edgeDir: edgeDir(d), pendingDir: pendingDir(d) };
}

// Suppress + capture the egress alerts every refuse path emits (observable refuses).
function captureAlerts(fn) {
  const alerts = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => {
    const s = String(chunk);
    if (s.startsWith('[LOOM-EGRESS-ALERT]')) {
      try { alerts.push(JSON.parse(s.slice('[LOOM-EGRESS-ALERT]'.length).trim())); } catch { /* ignore */ }
      return true;
    }
    return true;
  };
  let r;
  try { r = fn(); } finally { process.stderr.write = orig; }
  return { r, alerts };
}

// Write the attestation the minter resolves by the record's (repo, pr_number, pr_url) tuple. The repo is
// a SLUG (the attestation/merge-outcome form). over.lesson_signature drives the floor lookup. Returns the
// anchor_id.
function attest(dir, over = {}) {
  const att = {
    repo: CAP_REPO_SLUG, issueRef: CAP_ISSUE,
    pr_url: CAP_PR_URL, pr_number: CAP_PR_NUMBER, branch: 'b',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0', diff_hash: DIFF_HASH,
    lesson_signature: CAPTURED_SIG,
    built_by: 'anonymous-actor', approval_hash: APPROVAL, emitted_at: '2026-06-25T00:00:00.000Z',
    ...over,
  };
  const w = store.recordAttestation(att, { dir });
  assert.strictEqual(w.ok, true, `fixture attestation lands (got ${w.reason})`);
  return w.anchor_id;
}

// Write a gh-verified merge-outcome RECORD whose (repo, pr_number, pr_url) tuple matches the attestation.
// The merge-outcome store enforces repo===owner/repo slug + pr_url cross-check, so the tuple must be
// internally consistent. Returns the join_key_id.
function recordOutcome(dir, over = {}) {
  const rec = {
    join_key_id: over.join_key_id || ('d'.repeat(64)),
    repo: CAP_REPO_SLUG, pr_number: CAP_PR_NUMBER, pr_url: CAP_PR_URL,
    approval_hash: APPROVAL,
    outcome: 'merged',
    merge_commit_sha: MERGE_SHA,
    observed_at: OBSERVED_AT,
    ...over,
  };
  const w = outcomeStore.recordMergeOutcome(rec, { dir });
  assert.strictEqual(w.ok, true, `fixture merge-outcome lands (got ${w.reason})`);
  return w.join_key_id;
}

// Write a captured live_pending node into the pending store (the captured floor source). repo is a URL
// (the captured-lane GH_REPO_RE form) - the repoSlug() join must normalize it to compare against the
// attestation slug. Returns the node_id.
function capture(dir, over = {}) {
  const block = {
    repo: CAP_REPO_URL, issue_ref: CAP_ISSUE, candidate_patch_sha: CANDIDATE_SHA,
    lesson_signature: CAPTURED_SIG, lesson_body: CAPTURED_BODY,
    ...over,
  };
  const w = pendingStore.mintLivePendingLesson(block, { dir });
  assert.strictEqual(w.ok, true, `fixture live_pending node lands (got ${w.reason})`);
  return w.node_id;
}

// ---------------------------------------------------------------------------
// 1. CAPTURED lesson world-anchored end-to-end via a CRAFTED attestation. This is a MECHANISM proof, NOT
//    a real-path proof (Rule-2a-corollary): the attestation here is hand-crafted to carry the captured
//    signature, MOCKING the absent Half-B producer (production attestations still carry the static
//    LESSON_2137 signature). It proves the mint half of the future wire, not an end-to-end live connection.
// ---------------------------------------------------------------------------

test('CAPTURED (mechanism, crafted attestation): the minted node body === the captured body, NOT LESSON_2137', () => {
  const dir = tmp();
  // a crafted attestation carrying the CAPTURED signature (mocks Half B) + the matching captured node
  attest(dir, { lesson_signature: CAPTURED_SIG });
  capture(pendingDir(dir));
  const jkid = recordOutcome(outcomeDir(dir));
  const r = mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir));
  assert.strictEqual(r.minted, true, 'the captured lesson world-anchors');
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  assert.ok(node, 'the node is readable');
  assert.strictEqual(node.lesson_signature, CAPTURED_SIG, 'the node binds the captured signature');
  assert.strictEqual(node.lesson_body, CAPTURED_BODY, 'the node body is the CAPTURED body (consumed verbatim)');
  assert.notStrictEqual(node.lesson_body, LESSON_2137.lesson_body, 'NOT the static LESSON_2137 body');
});

// ---------------------------------------------------------------------------
// 2. 0 floor matches -> no-floor-lesson (the existing reason). The attestation carries a canonical
//    signature that matches NEITHER the grandfather seed (different issue/repo) NOR any captured node.
// ---------------------------------------------------------------------------

test('0 floor matches -> no-floor-lesson refuse + emit (no node)', () => {
  const dir = tmp();
  // a canonical signature that no floor entry carries (no captured node; not the grandfather tuple)
  attest(dir, { lesson_signature: CAPTURED_SIG });
  // NO captured node written
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir)));
  assert.strictEqual(r.minted, false);
  assert.strictEqual(r.mint_reason, 'no-floor-lesson');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('no-floor-lesson')), 'the no-floor-lesson refuse is observable');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 0, 'no node minted');
});

// ---------------------------------------------------------------------------
// 3. >1 floor matches -> ambiguous-floor-lesson refuse + emit (fail-closed). Two captured records sharing
//    the SAME (repo, issue_ref, sig) tuple but distinct candidate_patch_sha -> two distinct node ids ->
//    two candidates for the one attestation tuple -> ambiguity. Protects the grandfather from silent
//    substitution (denial of a shadow mint, never a substitution).
// ---------------------------------------------------------------------------

test('>1 floor matches -> ambiguous-floor-lesson refuse + emit (fail-closed, no node)', () => {
  const dir = tmp();
  attest(dir, { lesson_signature: CAPTURED_SIG });
  // two captured records, same (repo, issue, sig), distinct candidate_patch_sha -> two distinct nodes
  capture(pendingDir(dir), { candidate_patch_sha: 'a'.repeat(64) });
  capture(pendingDir(dir), { candidate_patch_sha: 'b'.repeat(64) });
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir)));
  assert.strictEqual(r.minted, false);
  assert.strictEqual(r.mint_reason, 'ambiguous-floor-lesson');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('ambiguous-floor-lesson')), 'the ambiguous-floor-lesson refuse is observable');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 0, 'no node minted on ambiguity');
});

test('>1 floor matches via grandfather collision -> ambiguous-floor-lesson (captured tuple collides with the seed)', () => {
  const dir = tmp();
  // a spec-kitty attestation on the grandfather signature + a captured node colliding on the SAME
  // (spec-kitty slug, 2097, LESSON_2137 sig) tuple -> grandfather candidate + captured candidate -> ambiguous
  attest(dir, {
    repo: SPEC_KITTY_SLUG, issueRef: SPEC_KITTY_ISSUE,
    pr_url: 'https://github.com/Priivacy-ai/spec-kitty/pull/2137', pr_number: 2137,
    lesson_signature: LESSON_2137_SIG,
  });
  capture(pendingDir(dir), {
    repo: SPEC_KITTY_URL, issue_ref: SPEC_KITTY_ISSUE, lesson_signature: LESSON_2137_SIG,
    lesson_body: 'an attacker-planted competing body for the grandfather tuple',
  });
  const jkid = recordOutcome(outcomeDir(dir), {
    repo: SPEC_KITTY_SLUG, pr_url: 'https://github.com/Priivacy-ai/spec-kitty/pull/2137', pr_number: 2137,
  });
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir)));
  assert.strictEqual(r.minted, false, 'a captured node colliding with the grandfather tuple -> ambiguous (no silent substitution)');
  assert.strictEqual(r.mint_reason, 'ambiguous-floor-lesson');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('ambiguous-floor-lesson')), 'observable');
});

// ---------------------------------------------------------------------------
// 4. cross-ISSUE non-match: a captured node for issue B, the attestation for issue A -> no captured
//    match (and no grandfather match) -> no-floor-lesson. The exact-set join keys on issue_ref.
// ---------------------------------------------------------------------------

test('cross-ISSUE non-match: a captured node for a different issue does NOT mint', () => {
  const dir = tmp();
  attest(dir, { lesson_signature: CAPTURED_SIG, issueRef: CAP_ISSUE });
  capture(pendingDir(dir), { issue_ref: CAP_ISSUE + 1 });   // captured for a DIFFERENT issue
  const jkid = recordOutcome(outcomeDir(dir));
  const { r } = captureAlerts(() => mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir)));
  assert.strictEqual(r.minted, false, 'a cross-issue captured node does not satisfy the exact-set join');
  assert.strictEqual(r.mint_reason, 'no-floor-lesson');
});

// ---------------------------------------------------------------------------
// 5. cross-REPO non-match: a captured node for a different repo (same issue + sig) does NOT mint.
// ---------------------------------------------------------------------------

test('cross-REPO non-match: a captured node for a different repo does NOT mint', () => {
  const dir = tmp();
  attest(dir, { lesson_signature: CAPTURED_SIG });
  capture(pendingDir(dir), { repo: 'https://github.com/other/repo' });   // different repo
  const jkid = recordOutcome(outcomeDir(dir));
  const { r } = captureAlerts(() => mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir)));
  assert.strictEqual(r.minted, false, 'a cross-repo captured node does not satisfy the exact-set join');
  assert.strictEqual(r.mint_reason, 'no-floor-lesson');
});

// ---------------------------------------------------------------------------
// 6. The GRANDFATHER still mints: a spec-kitty attestation carrying the LESSON_2137 signature, no
//    competing captured node -> the static LESSON_2137 body world-anchors (the grandfather seed survives).
// ---------------------------------------------------------------------------

test('GRANDFATHER still mints: a spec-kitty attestation w/ LESSON_2137 sig mints the LESSON_2137 body', () => {
  const dir = tmp();
  attest(dir, {
    repo: SPEC_KITTY_SLUG, issueRef: SPEC_KITTY_ISSUE,
    pr_url: 'https://github.com/Priivacy-ai/spec-kitty/pull/2137', pr_number: 2137,
    lesson_signature: LESSON_2137_SIG,
  });
  // NO captured node for this tuple
  const jkid = recordOutcome(outcomeDir(dir), {
    repo: SPEC_KITTY_SLUG, pr_url: 'https://github.com/Priivacy-ai/spec-kitty/pull/2137', pr_number: 2137,
  });
  const r = mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir));
  assert.strictEqual(r.minted, true, 'the grandfather seed still world-anchors');
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  assert.strictEqual(node.lesson_signature, LESSON_2137_SIG, 'the grandfather signature');
  assert.strictEqual(node.lesson_body, LESSON_2137.lesson_body, 'the static LESSON_2137 body (grandfather)');
});

// ---------------------------------------------------------------------------
// 7. INERTNESS (mirrors #454 deriveFn=null): a PRODUCTION-shaped attestation carries the STATIC
//    LESSON_2137 signature (no Half-B sourcing). With a captured lesson present in a DIFFERENT bucket,
//    the captured lesson is NOT world-anchored. The grandfather (spec-kitty / 2097) mints LESSON_2137;
//    the captured branch is production-inert until Half B sources a captured signature onto an attestation.
// ---------------------------------------------------------------------------

test('INERTNESS: a production-shaped (LESSON_2137-sig) attestation does NOT world-anchor a captured body', () => {
  const dir = tmp();
  // production-shaped: spec-kitty attestation carrying the STATIC LESSON_2137 signature
  attest(dir, {
    repo: SPEC_KITTY_SLUG, issueRef: SPEC_KITTY_ISSUE,
    pr_url: 'https://github.com/Priivacy-ai/spec-kitty/pull/2137', pr_number: 2137,
    lesson_signature: LESSON_2137_SIG,
  });
  // a captured lesson exists in a DIFFERENT bucket (different repo/issue/sig) - it must NOT be anchored
  capture(pendingDir(dir));   // CAP_REPO_URL / CAP_ISSUE / CAPTURED_SIG - a different bucket
  const jkid = recordOutcome(outcomeDir(dir), {
    repo: SPEC_KITTY_SLUG, pr_url: 'https://github.com/Priivacy-ai/spec-kitty/pull/2137', pr_number: 2137,
  });
  const r = mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir));
  assert.strictEqual(r.minted, true, 'the grandfather still mints');
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  assert.strictEqual(node.lesson_body, LESSON_2137.lesson_body, 'the production attestation anchors the STATIC body');
  assert.notStrictEqual(node.lesson_body, CAPTURED_BODY, 'the captured body is NOT anchored (production-inert)');
});

// ---------------------------------------------------------------------------
// 8. OFF-TAXONOMY: a captured record + crafted attestation both carrying a NON-canonical lesson_signature
//    -> off-taxonomy-lesson refuse (validateBlock only length-bounds it; the matched signature must
//    round-trip the frozen 24-key taxonomy). Blocks a co-forged junk-signature node from anchoring.
// ---------------------------------------------------------------------------

test('OFF-TAXONOMY: a captured + attestation pair carrying a non-canonical sig -> off-taxonomy-lesson refuse', () => {
  const dir = tmp();
  attest(dir, { lesson_signature: OFF_TAXONOMY_SIG });
  capture(pendingDir(dir), { lesson_signature: OFF_TAXONOMY_SIG });
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir)));
  assert.strictEqual(r.minted, false, 'a non-canonical signature is refused');
  assert.strictEqual(r.mint_reason, 'off-taxonomy-lesson');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('off-taxonomy-lesson')), 'the off-taxonomy-lesson refuse is observable');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 0, 'no node minted off-taxonomy');
});

// ---------------------------------------------------------------------------
// 9. repoSlug NORMALIZATION (the join-bug fix): the captured record carries a URL repo, the attestation a
//    slug repo (same owner/repo) -> the join normalizes BOTH to the slug and matches -> world-anchored.
//    Without the fix (captured.repo === att.repo), the URL-vs-slug mismatch would silently never match.
// ---------------------------------------------------------------------------

test('repoSlug NORMALIZATION: a URL captured repo matches a slug attestation repo (same owner/repo)', () => {
  const dir = tmp();
  // attestation repo is a SLUG; captured repo is a URL of the same owner/repo
  attest(dir, { repo: CAP_REPO_SLUG, lesson_signature: CAPTURED_SIG });
  capture(pendingDir(dir), { repo: CAP_REPO_URL, lesson_signature: CAPTURED_SIG });
  const jkid = recordOutcome(outcomeDir(dir), { repo: CAP_REPO_SLUG });
  const r = mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir));
  assert.strictEqual(r.minted, true, 'the URL-vs-slug join normalizes and matches (the bug fix)');
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  assert.strictEqual(node.lesson_body, CAPTURED_BODY, 'the captured body world-anchors across the URL/slug form mismatch');
});

// 9b. repoSlug `.git` NORMALIZATION (VALIDATE M-1/L-1 fold): a captured repo in clone-URL `.git` form must
//     normalize to the same slug as a bare-slug attestation -> world-anchored. NON-VACUOUS: without the
//     `.git` strip, `octo/widget.git` !== `octo/widget` -> no candidate -> no-floor-lesson -> minted:false,
//     so this case fails RED on the unfixed repoSlug and proves the guard.
test('repoSlug NORMALIZATION: a `.git`-suffixed captured URL repo still joins a bare-slug attestation', () => {
  const dir = tmp();
  attest(dir, { repo: CAP_REPO_SLUG, lesson_signature: CAPTURED_SIG });
  capture(pendingDir(dir), { repo: `${CAP_REPO_URL}.git`, lesson_signature: CAPTURED_SIG });
  const jkid = recordOutcome(outcomeDir(dir), { repo: CAP_REPO_SLUG });
  const r = mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir));
  assert.strictEqual(r.minted, true, 'the `.git` clone-URL suffix normalizes to the canonical slug and joins');
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  assert.strictEqual(node.lesson_body, CAPTURED_BODY, 'the captured body world-anchors across the `.git` form');
});

// ---------------------------------------------------------------------------
// 10. WEIGHT-INERTNESS: the minted captured node body carries NO `source` field (the weight gate keys on
//     `source`; a live node never carries one). The live-recall store's closed-shape rejects any extra
//     key, so this is structurally guaranteed - assert it on the read-back node as a contract.
// ---------------------------------------------------------------------------

test('weight-inertness: the minted captured node carries NO `source` field (weight-inert)', () => {
  const dir = tmp();
  attest(dir, { lesson_signature: CAPTURED_SIG });
  capture(pendingDir(dir));
  const jkid = recordOutcome(outcomeDir(dir));
  const r = mintFromMergeOutcome({ join_key_id: jkid }, allDirs(dir));
  assert.strictEqual(r.minted, true);
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  assert.ok(node, 'the node is readable');
  assert.strictEqual('source' in node, false, 'a world_anchored node never carries a `source` token (weight-inert)');
  assert.strictEqual(node.provenance, 'world_anchored', 'its provenance, not a source, names why it is recorded');
});

// ---------------------------------------------------------------------------
// pendingDir wiring: pendingDir is part of the FOLD-B all-or-nothing dir-key set. Omitting it (passing
// only the prior four) is an incomplete wiring refuse (the test-isolation guard stays consistent).
// ---------------------------------------------------------------------------

test('pendingDir is part of the all-or-nothing dir set: omitting it refuses incomplete-dir-wiring', () => {
  const dir = tmp();
  attest(dir, { lesson_signature: CAPTURED_SIG });
  capture(pendingDir(dir));
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, outcomeDir: outcomeDir(dir), liveDir: liveDir(dir), edgeDir: edgeDir(dir) },   // NO pendingDir -> 4 of 5
  ));
  assert.strictEqual(r.minted, false, 'a partial (4 of 5) dir set refuses');
  assert.strictEqual(r.mint_reason, 'incomplete-dir-wiring');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('incomplete-dir-wiring')), 'the partial-wiring refuse is observable');
});

console.log(`world-anchor-mint-captured-floor.test.js: ${passed} passed`);
