'use strict';

// v3.10-W1 — the MOCKED hardening-signal store. E5 (OQ-NS-6 firewall: mock-only, source in the
// content-address, reject-on-write AND fail-soft-on-read) + write/read/dedup. Uses opts.dir (a
// temp dir) so it never touches a real lane; the env-seam DEFAULT_DIR is covered by round.test.js.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../../../../packages/lab/persona-consumer/hardening-signal-store');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-signal-'));
const OPTS = { dir: TMP };
const NOW = '2026-06-15T00:00:00.000Z';
const mock = (over = {}) => ({ node_id: 'n1', outcome: 'support', source: 'mock', recorded_at: NOW, ...over });

test('writes a valid mock signal; loadSignal round-trips it (deep-frozen)', () => {
  const w = store.writeSignal(mock(), OPTS);
  assert.ok(w.ok && !w.deduped, 'write ok');
  const r = store.loadSignal(w.signal_id, OPTS);
  assert.strictEqual(r.node_id, 'n1');
  assert.throws(() => { r.outcome = 'refute'; }, 'read-back is frozen');
});

test('E5 firewall (write) — a source:"real" record is REJECTED on write', () => {
  const w = store.writeSignal(mock({ source: 'real' }), OPTS);
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'source-rejected');
});

test('E5 firewall — `source` is IN the content-address (a flipped tag changes the id)', () => {
  assert.notStrictEqual(store.deriveSignalId(mock({ source: 'mock' })), store.deriveSignalId(mock({ source: 'real' })), 'source must perturb signal_id');
});

test('E5 firewall (read) — a file hand-edited to source:"real" FAILS re-derivation -> null', () => {
  const w = store.writeSignal(mock({ node_id: 'tamper' }), OPTS);
  const file = path.join(TMP, `${w.signal_id}.json`);
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  body.source = 'real';                                  // launder attempt: flip the tag on disk
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  assert.strictEqual(store.loadSignal(w.signal_id, OPTS), null, 'a laundered source must fail-soft on read');
});

test('read — a signal_id/body mismatch (forged id) -> null (store is not a sandbox)', () => {
  const forged = { ...mock({ node_id: 'forge' }), signal_id: 'f'.repeat(64) };
  const file = path.join(TMP, `${forged.signal_id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(forged, null, 2)}\n`);
  assert.strictEqual(store.loadSignal(forged.signal_id, OPTS), null);
});

test('rejects a bad outcome on write', () => {
  assert.strictEqual(store.writeSignal(mock({ outcome: 'maybe' }), OPTS).reason, 'bad-outcome');
});

test('rejects an UNPARSEABLE recorded_at on write (the silent-null recency footgun)', () => {
  assert.strictEqual(store.writeSignal(mock({ node_id: 'bad-ts', recorded_at: 'not-a-date' }), OPTS).reason, 'bad-recorded-at-format');
  // a non-string / empty was already covered; this guards the parseable-ISO contract at the source
});

test('dedup — the same signal written twice is first-eligible-wins', () => {
  const a = store.writeSignal(mock({ node_id: 'dup' }), OPTS);
  const b = store.writeSignal(mock({ node_id: 'dup' }), OPTS);
  assert.ok(a.ok && !a.deduped);
  assert.ok(b.ok && b.deduped, 'second write deduped');
  assert.strictEqual(a.signal_id, b.signal_id);
});

test('listSignals returns valid records, SKIPS the tampered/forged files', () => {
  const all = store.listSignals(OPTS);
  assert.strictEqual(all.length, 2, 'EXACTLY n1 + dup valid; tamper/forge dropped, real/maybe/bad-ts never written');
  assert.ok(all.every((s) => s.source === 'mock'), 'only mock-source records are listed');
  assert.ok(!all.some((s) => s.node_id === 'tamper' || s.node_id === 'forge'), 'tampered/forged are dropped');
});

console.log(`hardening-signal-store.test.js: ${passed} passed`);
