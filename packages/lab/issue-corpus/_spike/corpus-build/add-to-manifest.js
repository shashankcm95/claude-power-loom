#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 bootcamp Phase 1 — accrete VERIFIED staged records into bootcamp-manifest.json. Enforces the
// corpus invariant: a record enters the manifest ONLY if its sibling <id>.verdict.json exists AND
// verified===true (so an un-gated record can never silently inflate N). Idempotent by id. Manual
// spike, OUT of CI.
//
// Usage: node add-to-manifest.js staged/<id>.json [staged/<id2>.json ...]

'use strict';

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, 'bootcamp-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const byId = new Map((manifest.records || []).map((r) => [r.id, r]));

const args = process.argv.slice(2);
if (args.length === 0) { console.error('usage: node add-to-manifest.js staged/<id>.json ...'); process.exit(2); }

let added = 0;
let skippedExisting = 0;
let refused = 0;
for (const recPath of args) {
  const record = JSON.parse(fs.readFileSync(recPath, 'utf8'));
  const verdictPath = recPath.replace(/\.json$/, '.verdict.json');
  if (!fs.existsSync(verdictPath)) { console.error(`REFUSED ${record.id}: no verdict (run verify-record.js first)`); refused += 1; continue; }
  const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
  if (verdict.verified !== true) { console.error(`REFUSED ${record.id}: verdict.verified=${verdict.verified} (${verdict.reason || ''})`); refused += 1; continue; }
  if (byId.has(record.id)) { console.log(`skip (already present): ${record.id}`); skippedExisting += 1; continue; }
  byId.set(record.id, record);
  added += 1;
  console.log(`added: ${record.id}`);
}

manifest.records = Array.from(byId.values());
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nmanifest: ${manifest.records.length}/${manifest.target_n}  (+${added} added, ${skippedExisting} already present, ${refused} refused)`);
