#!/usr/bin/env node

// adr.js — H.8.2 substrate primitive for managing Architecture Decision Records.
//
// ADRs live in swarm/adrs/<NNNN>-short-title.md. Each has structured
// frontmatter (adr_id, title, status, files_affected, invariants_introduced)
// + sections (Context / Decision / Consequences / Alternatives Considered).
//
// CLI subcommands:
//   new --title "<title>"       — create new ADR with auto-incremented ID
//   list [--status S]           — list ADRs (optionally filtered)
//   read <id>                   — print ADR content
//   active                      — list currently active ADRs (status=accepted, no superseded_by)
//   touched-by <file>           — list active ADRs whose files_affected include <file>
//
// The `touched-by` subcommand is consumed by validate-adr-drift.js
// (PreToolUse:Edit|Write hook) to determine when to emit [ADR-DRIFT-CHECK].
//
// Per ADR-0001: this script fails open on errors (logs via stderr; exits
// cleanly on subcommand errors with exit-1).

'use strict';

const fs = require('fs');
const path = require('path');
const { findToolkitRoot } = require('./_lib/toolkit-root');

const ADRS_DIR = process.env.HETS_ADRS_DIR ||
  path.join(findToolkitRoot(), 'swarm', 'adrs');

// ============================================================================
// FRONTMATTER PARSER (YAML subset; matches kb-resolver's parser style)
// ============================================================================

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: text };
  const fm = {};
  const fmText = text.slice(3, end);
  // Two-pass: scalar fields first, then list fields
  const lines = fmText.split('\n');
  let currentListKey = null;
  for (const line of lines) {
    if (line.match(/^\s+- /)) {
      // List item under previous key
      if (currentListKey) {
        const item = line.replace(/^\s+- /, '').trim().replace(/^["']|["']$/g, '');
        if (!Array.isArray(fm[currentListKey])) fm[currentListKey] = [];
        fm[currentListKey].push(item);
      }
      continue;
    }
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) {
      currentListKey = null;
      continue;
    }
    const key = m[1];
    let val = m[2].trim();
    if (val === '' || val === null) {
      // Likely start of a list block
      currentListKey = key;
      fm[key] = [];
      continue;
    }
    currentListKey = null;
    val = val.replace(/^["']|["']$/g, '');
    // Inline list: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    }
    if (val === 'null') val = null;
    fm[key] = val;
  }
  return { frontmatter: fm, body: text.slice(end + 4).trim() };
}

// ============================================================================
// ADR LISTING + READING
// ============================================================================

function listAdrFiles() {
  if (!fs.existsSync(ADRS_DIR)) return [];
  return fs.readdirSync(ADRS_DIR)
    .filter((f) => /^\d{4}-.+\.md$/.test(f))
    .sort();
}

function readAdr(filename) {
  const fpath = path.join(ADRS_DIR, filename);
  if (!fs.existsSync(fpath)) return null;
  const text = fs.readFileSync(fpath, 'utf8');
  const parsed = parseFrontmatter(text);
  return { filename, fpath, ...parsed };
}

function loadAllAdrs() {
  return listAdrFiles().map(readAdr).filter(Boolean);
}

function isActive(adr) {
  const status = adr.frontmatter.status;
  const superseded = adr.frontmatter.superseded_by;
  return status === 'accepted' && (!superseded || superseded === 'null');
}

function findAdrById(idStr) {
  // Accept "1" or "0001" or "ADR-0001"
  const numMatch = idStr.match(/(\d+)/);
  if (!numMatch) return null;
  const n = parseInt(numMatch[1], 10);
  const padded = String(n).padStart(4, '0');
  const adrs = loadAllAdrs();
  return adrs.find((a) => a.frontmatter.adr_id === padded || String(a.frontmatter.adr_id) === String(n));
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

function cmdNew(args) {
  const title = args.title;
  if (!title || title === true) {
    console.error('Usage: new --title "<title>"');
    process.exit(1);
  }
  // Auto-increment ID
  const existing = listAdrFiles();
  let nextId = 1;
  for (const f of existing) {
    const m = f.match(/^(\d{4})-/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= nextId) nextId = n + 1;
    }
  }
  const padded = String(nextId).padStart(4, '0');
  // Slug from title
  const slug = title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
  const filename = `${padded}-${slug}.md`;
  const fpath = path.join(ADRS_DIR, filename);

  // Read template
  const templatePath = path.join(ADRS_DIR, '_TEMPLATE.md');
  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found at ${templatePath}. Cannot create new ADR.`);
    process.exit(1);
  }
  let template = fs.readFileSync(templatePath, 'utf8');
  // Replace placeholders
  template = template.replace('adr_id: NNNN', `adr_id: ${padded}`);
  template = template.replace('title: "Imperative-form short title (e.g., \'Adopt fail-open hook discipline\')"', `title: "${title}"`);
  template = template.replace('created: YYYY-MM-DD', `created: ${new Date().toISOString().slice(0, 10)}`);

  fs.mkdirSync(ADRS_DIR, { recursive: true });
  if (fs.existsSync(fpath)) {
    console.error(`ADR file already exists: ${fpath}. Refusing to overwrite.`);
    process.exit(1);
  }
  fs.writeFileSync(fpath, template);
  console.log(JSON.stringify({
    action: 'new',
    adr_id: padded,
    filename,
    fpath,
    title,
  }, null, 2));
}

function cmdList(args) {
  const adrs = loadAllAdrs();
  const filter = args.status;
  let entries = adrs.map((a) => ({
    adr_id: a.frontmatter.adr_id,
    title: a.frontmatter.title,
    status: a.frontmatter.status,
    superseded_by: a.frontmatter.superseded_by,
    files_affected_count: (a.frontmatter.files_affected || []).length,
    invariants_count: (a.frontmatter.invariants_introduced || []).length,
    filename: a.filename,
  }));
  if (filter) entries = entries.filter((e) => e.status === filter);
  console.log(JSON.stringify({
    count: entries.length,
    filter: filter || 'all',
    adrs: entries,
  }, null, 2));
}

function cmdRead(args) {
  const id = args._[0];
  if (!id) { console.error('Usage: read <id>'); process.exit(1); }
  const adr = findAdrById(id);
  if (!adr) {
    console.error(`ADR not found: ${id}`);
    process.exit(1);
  }
  // Print the full doc body (frontmatter included for readability)
  process.stdout.write(fs.readFileSync(adr.fpath, 'utf8'));
}

function cmdActive() {
  const adrs = loadAllAdrs().filter(isActive);
  const out = adrs.map((a) => ({
    adr_id: a.frontmatter.adr_id,
    title: a.frontmatter.title,
    files_affected: a.frontmatter.files_affected || [],
    invariants_introduced: a.frontmatter.invariants_introduced || [],
    filename: a.filename,
  }));
  console.log(JSON.stringify({
    active_count: out.length,
    adrs: out,
  }, null, 2));
}

function cmdTouchedBy(args) {
  const file = args._[0];
  if (!file) { console.error('Usage: touched-by <file-path>'); process.exit(1); }
  const adrs = loadAllAdrs().filter(isActive);
  // Match file against each ADR's files_affected. Match types:
  //  - exact match
  //  - file is suffix of ADR entry (e.g., "fact-force-gate.js" matches "hooks/scripts/fact-force-gate.js")
  //  - ADR entry is suffix of file (rare, but possible if user passes absolute path)
  const matches = adrs.filter((a) => {
    const affected = a.frontmatter.files_affected || [];
    return affected.some((p) => {
      if (p === file) return true;
      if (file.endsWith('/' + p) || file.endsWith(p)) return true;
      if (p.endsWith('/' + file) || p.endsWith(file)) return true;
      return false;
    });
  });
  const out = matches.map((a) => ({
    adr_id: a.frontmatter.adr_id,
    title: a.frontmatter.title,
    invariants_introduced: a.frontmatter.invariants_introduced || [],
    filename: a.filename,
  }));
  console.log(JSON.stringify({
    file,
    matched_count: out.length,
    adrs: out,
  }, null, 2));
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (cmd) {
  case 'new': cmdNew(args); break;
  case 'list': cmdList(args); break;
  case 'read': cmdRead(args); break;
  case 'active': cmdActive(); break;
  case 'touched-by': cmdTouchedBy(args); break;
  default:
    console.error('Usage: adr.js {new|list|read|active|touched-by} [args]');
    console.error('  new --title "<title>"          — create new ADR with auto-incremented ID');
    console.error('  list [--status S]              — list ADRs (optionally filtered)');
    console.error('  read <id>                      — print ADR full content');
    console.error('  active                         — list currently active ADRs');
    console.error('  touched-by <file>              — list active ADRs affecting <file>');
    console.error('Env: HETS_ADRS_DIR overrides default swarm/adrs/ location.');
    process.exit(1);
}

// Export for testing / programmatic use
module.exports = { loadAllAdrs, isActive, findAdrById, parseFrontmatter };
