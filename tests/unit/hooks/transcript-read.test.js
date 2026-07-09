#!/usr/bin/env node

// tests/unit/hooks/transcript-read.test.js
//
// Covers the shared transcript-read helper AND the two hooks it revives.
//
// Bug: auto-store-enrichment.js (Stop) and pre-compact-save.js (PreCompact) both
// scanned raw hook stdin for markers / file paths — but Stop/PreCompact stdin is
// a small JSON envelope { transcript_path, ... }, not the conversation, so both
// were inert (always [] / empty). The fix reads transcript_path and scans the
// real conversation:
//   - #8 scans the LAST assistant message (the produced enrichment) — NOT the
//     injected instruction attachment (which also carries the marker template).
//   - #9 extracts mentioned file paths + a real contextLength from the transcript.
//
// Probe basis: real session transcripts DO contain [ENRICHED-PROMPT-START] in
// both an `attachment` (the template) and an `assistant` message (the produced
// enrichment) — verified against ~/.claude/projects/*/*.jsonl.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..', '..', '..');
const {
  parseEnvelope, readTranscriptText, lastAssistantText,
} = require(path.join(REPO, 'packages', 'kernel', 'hooks', '_lib', 'transcript-read'));
const { extractEnrichments } = require(path.join(REPO, 'packages', 'kernel', 'hooks', 'lifecycle', 'auto-store-enrichment'));
const { extractCheckpoint } = require(path.join(REPO, 'packages', 'kernel', 'hooks', 'lifecycle', 'pre-compact-save'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-read-'));
function writeTranscript(lines) {
  const p = path.join(TMP, 'transcript-' + crypto.randomBytes(4).toString('hex') + '.jsonl');
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

// A real assistant-produced enrichment block (NOT fenced, so extractEnrichments
// keeps it). File paths embedded for the #9 checkpoint test.
const ASSISTANT_TEXT = [
  "Here's the enriched prompt.",
  '[ENRICHED-PROMPT-START]',
  'RAW: refactor the auth module',
  'CATEGORY: feature',
  'TECHNIQUES: threat-model',
  'INSTRUCTIONS: harden the login path',
  '[ENRICHED-PROMPT-END]',
  'I referenced /Users/me/project/src/auth.js and /Users/me/project/src/db.js',
].join('\n');

// The injected instruction attachment ALSO carries the marker template (inside a
// fence). It must never be captured as a real enrichment.
const ATTACHMENT_TEXT = 'Build the 4-part prompt wrapped in ```\n[ENRICHED-PROMPT-START]\nRAW: <task>\n[ENRICHED-PROMPT-END]\n``` markers.';

const attachmentLine = { type: 'attachment', attachment: { text: ATTACHMENT_TEXT } };
const assistantLine = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ASSISTANT_TEXT }] } };
const userLine = { type: 'user', message: { role: 'user', content: 'please enrich this' } };

// ---- helper: parseEnvelope ----
test('parseEnvelope: valid envelope -> object; garbage/empty -> null', () => {
  assert.deepStrictEqual(parseEnvelope('{"transcript_path":"/x","hook_event_name":"Stop"}').hook_event_name, 'Stop');
  assert.strictEqual(parseEnvelope('not json'), null);
  assert.strictEqual(parseEnvelope(''), null);
  assert.strictEqual(parseEnvelope('42'), null); // non-object JSON
});

// ---- helper: readTranscriptText ----
test('readTranscriptText: reads a real file; absent/empty path -> ""', () => {
  const p = writeTranscript([userLine, assistantLine]);
  const text = readTranscriptText(p);
  assert.ok(text.includes('ENRICHED-PROMPT-START'), 'expected the transcript content');
  assert.strictEqual(readTranscriptText('/no/such/transcript.jsonl'), '');
  assert.strictEqual(readTranscriptText(''), '');
});

test('readTranscriptText: a FIFO/non-regular path -> "" (never blocks)', () => {
  // A directory is non-regular; withRegularFileFd rejects it -> ''.
  assert.strictEqual(readTranscriptText(TMP), '');
});

// ---- helper: lastAssistantText ----
test('lastAssistantText: returns the LAST assistant message text, not the attachment', () => {
  const text = readTranscriptText(writeTranscript([attachmentLine, userLine, assistantLine]));
  const got = lastAssistantText(text);
  assert.ok(got.includes('refactor the auth module'), 'expected the assistant-produced text');
  assert.ok(!got.includes('<task>'), 'must NOT include the attachment template placeholder');
});

test('lastAssistantText: no assistant message -> ""', () => {
  const text = readTranscriptText(writeTranscript([attachmentLine, userLine]));
  assert.strictEqual(lastAssistantText(text), '');
});

// ---- #8 chain: transcript -> last assistant -> extractEnrichments ----
test('#8: a produced enrichment in the assistant turn is extracted', () => {
  const text = readTranscriptText(writeTranscript([attachmentLine, userLine, assistantLine]));
  const enrichments = extractEnrichments(lastAssistantText(text));
  assert.strictEqual(enrichments.length, 1, `expected 1 enrichment, got ${enrichments.length}`);
  assert.strictEqual(enrichments[0].raw, 'refactor the auth module');
  assert.strictEqual(enrichments[0].category, 'feature');
});

test('#8: marker ONLY in the attachment (no assistant enrichment) -> nothing captured', () => {
  const plainAssistant = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Sure, done.' }] } };
  const text = readTranscriptText(writeTranscript([attachmentLine, userLine, plainAssistant]));
  const enrichments = extractEnrichments(lastAssistantText(text));
  assert.strictEqual(enrichments.length, 0, 'the injected attachment template must not be captured');
});

// ---- #9 chain: transcript -> extractCheckpoint ----
test('#9: extractCheckpoint pulls real file mentions + a real contextLength from the transcript', () => {
  const text = readTranscriptText(writeTranscript([userLine, assistantLine]));
  const cp = extractCheckpoint(text);
  assert.ok(cp.mentionedFiles.length > 0, 'expected file mentions from the transcript');
  assert.ok(cp.mentionedFiles.some((f) => f.includes('auth.js')), `expected auth.js among ${JSON.stringify(cp.mentionedFiles)}`);
  assert.strictEqual(cp.contextLength, text.length, 'contextLength must reflect the transcript, not the envelope');
});

test('#9: empty transcript -> empty checkpoint (no crash, no file mentions)', () => {
  const cp = extractCheckpoint('');
  assert.deepStrictEqual(cp.mentionedFiles, []);
  assert.strictEqual(cp.contextLength, 0);
});

try {
  process.stdout.write(`\ntranscript-read.test.js: ${passed} passed, ${failed} failed\n`);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
