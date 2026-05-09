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
// H.8.7 (chaos H4): shared frontmatter parser; previously inline (see git
// history at H.8.6). kb-resolver's inline parser had different bug surfaces.
const { parseFrontmatter } = require('./_lib/frontmatter');
// H.8.7 (chaos H5): cmdNew ID race; lock the read-then-write cycle.
const { withLock } = require('./_lib/lock');

const ADRS_DIR = process.env.HETS_ADRS_DIR ||
  path.join(findToolkitRoot(), 'swarm', 'adrs');

// ============================================================================
// ADR LISTING + READING
// ============================================================================

function listAdrFiles() {
  if (!fs.existsSync(ADRS_DIR)) return [];
  return fs.readdirSync(ADRS_DIR)
    .filter((f) => /^\d{4}-.+\.md$/.test(f))
    // H.8.7 (chaos M3): symlink defense parity with kb-resolver. Skip any
    // entry that is a symlink — prevents an attacker-planted symlink to
    // outside ADRS_DIR from being loaded as an ADR. Use lstatSync (does
    // not follow links).
    .filter((f) => {
      try {
        const st = fs.lstatSync(path.join(ADRS_DIR, f));
        return !st.isSymbolicLink();
      } catch {
        return false;
      }
    })
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
  // H.8.7 (chaos L1): the prior canonical parser inconsistently translated
  // `null` literal — kb-resolver did not, adr.js did. The shared parser now
  // translates `null` → JS null (canonical). Defensive: accept both forms
  // for backward compat with existing on-disk ADRs that may have been
  // parsed by either prior implementation.
  const supersededIsEmpty = superseded === null
    || superseded === undefined
    || superseded === 'null'
    || superseded === '';
  return status === 'accepted' && supersededIsEmpty;
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

// H.8.7 (chaos H3): escape title for YAML interpolation. Previously, titles
// containing `"` corrupted the frontmatter (closed the title field early,
// injected attacker-controlled fields). Now escape `\` then `"` before
// interpolation. Reject newlines as invalid title input.
function escapeYamlString(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cmdNew(args) {
  const title = args.title;
  if (!title || title === true) {
    console.error('Usage: new --title "<title>"');
    process.exit(1);
  }
  // H.8.7 H3: reject titles containing newlines (cannot safely embed in
  // single-line YAML without block-scalar syntax).
  if (title.includes('\n') || title.includes('\r')) {
    console.error('Title cannot contain newlines. Use a single-line title.');
    process.exit(1);
  }

  // H.8.7 (chaos H5): wrap the read-then-write ID-claim cycle in a filesystem
  // lock so concurrent invocations don't claim the same ID. Uses the same
  // `_lib/lock.js` pattern as kb-resolver's manifest lock (H.3.2 lineage).
  const lockPath = path.join(ADRS_DIR, '.cmdNew.lock');
  fs.mkdirSync(ADRS_DIR, { recursive: true });

  const result = withLock(lockPath, () => {
    // Auto-increment ID (inside lock)
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
    // Replace placeholders. Title gets YAML-escaped per H.8.7 H3 fix.
    const safeTitle = escapeYamlString(title);
    template = template.replace('adr_id: NNNN', `adr_id: ${padded}`);
    template = template.replace('title: "Imperative-form short title (e.g., \'Adopt fail-open hook discipline\')"', `title: "${safeTitle}"`);
    template = template.replace('created: YYYY-MM-DD', `created: ${new Date().toISOString().slice(0, 10)}`);

    if (fs.existsSync(fpath)) {
      console.error(`ADR file already exists: ${fpath}. Refusing to overwrite.`);
      process.exit(1);
    }
    fs.writeFileSync(fpath, template);
    return { padded, filename, fpath };
  });

  console.log(JSON.stringify({
    action: 'new',
    adr_id: result.padded,
    filename: result.filename,
    fpath: result.fpath,
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
  // H.8.7 (chaos H2): path-segment-aware matching. Previous logic used
  // bare `endsWith(p)` which produced false positives — `barfoo.js` matched
  // an ADR entry `foo.js`; `passwd` matched `/etc/passwd`. Now require a
  // path-separator boundary (`/` + entry) for suffix matches.
  const matches = adrs.filter((a) => {
    const affected = a.frontmatter.files_affected || [];
    return affected.some((p) => {
      // Exact match
      if (p === file) return true;
      // file is a deeper path that ends in entry: require '/' boundary
      if (file.endsWith('/' + p)) return true;
      // entry is a deeper path that ends in file: require '/' boundary
      if (p.endsWith('/' + file)) return true;
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
module.exports = { loadAllAdrs, isActive, findAdrById };
