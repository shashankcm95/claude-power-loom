#!/usr/bin/env node

// kb-resolver — content-addressed knowledge base resolver for agent-team.
// Implements the Shared Knowledge Base + Content-Addressed References patterns
// (skills/agent-team/patterns/{shared-knowledge-base, content-addressed-refs}.md).
//
// Storage:
//   ~/Documents/claude-toolkit/skills/agent-team/kb/
//     ├── manifest.json              — kb_id → {path, version, hash, tags}
//     └── <topic>/<doc>.md           — KB docs with frontmatter
//
// Snapshots:
//   ~/Documents/claude-toolkit/swarm/run-state/<run-id>/kb-snapshot.json
//
// Override locations via env vars:
//   HETS_KB_DIR              — KB root (default: ~/Documents/claude-toolkit/skills/agent-team/kb)
//   HETS_RUN_STATE_DIR       — run-state root (default: ~/Documents/claude-toolkit/swarm/run-state)
//
// Subcommands:
//   cat <kb_id>              — print doc body
//   hash <kb_id>             — print SHA-256 of body
//   list [--tag X]           — list registered KB docs
//   resolve kb:<id>[@<h>]    — resolve a ref string; verify hash if pinned
//   scan                     — walk kb/ tree, refresh manifest
//   snapshot <run-id>        — freeze manifest to run-state
//   register <kb_id>         — register a single file (alt to scan)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withLock } = require('./_lib/lock'); // H.3.2 (CS-1 code-reviewer X-3)

const KB_BASE = process.env.HETS_KB_DIR ||
  path.join(process.env.HOME, 'Documents', 'claude-toolkit', 'skills', 'agent-team', 'kb');
const MANIFEST_PATH = path.join(KB_BASE, 'manifest.json');
// H.5.5 (CS-2/CS-3 theo HIGH): single-source RUN_STATE_BASE via _lib/runState.
const { runStateDir } = require('./_lib/runState');

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

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: text };
  const fm = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    fm[m[1]] = v;
  }
  return { frontmatter: fm, body: text.slice(end + 4).trim() };
}

function shaHashBody(body) {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { version: 1, entries: {} };
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); }
  catch (e) {
    console.error(`Corrupt manifest at ${MANIFEST_PATH}: ${e.message}. Refusing to advance.`);
    process.exit(2);
  }
}

// H.3.2 (CS-1 code-reviewer X-3): withLock wraps the read-modify-write
// to prevent two concurrent `scan` invocations from clobbering each other.
const MANIFEST_LOCK = MANIFEST_PATH + '.lock';
function writeManifestAtomic(manifest) {
  fs.mkdirSync(KB_BASE, { recursive: true });
  withLock(MANIFEST_LOCK, () => {
    const tmp = MANIFEST_PATH + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, MANIFEST_PATH);
  });
}

// H.3.2 (CS-1 hacker.zoe CRIT-3 + code-reviewer H-4):
// Path-traversal fix. `kbId` containing `..` would join to a path outside
// KB_BASE; `kb-resolver cat ../../etc/secrets` reads outside the KB. Boundary
// check via `path.resolve` ensures the resolved file lives under KB_BASE.
//
// H.3.6 (CS-2 hacker.ren CRIT-2): the lexical check above is symlink-blind.
// A symlink at `KB_BASE/escape -> /etc` lexically lives under KB_BASE, so
// `path.resolve(KB_BASE, "escape")` returns `KB_BASE/escape`; the check
// passes; the file read goes to /etc. Fix: after lexical check, follow
// symlinks via fs.realpathSync and re-verify the canonical path lives under
// realpath(KB_BASE). Lexical check is kept as the cheap first-pass defense
// for paths that don't exist (realpath throws on ENOENT).
function findDocPath(kbId) {
  const candidate = path.resolve(KB_BASE, kbId + '.md');
  const baseResolved = path.resolve(KB_BASE);
  // Lexical first-pass — refuses `..`-traversal even on missing files.
  // Trailing path.sep guard prevents `KB_BASE_extra` from matching `KB_BASE` as a prefix.
  if (!candidate.startsWith(baseResolved + path.sep) && candidate !== baseResolved) {
    return null;
  }
  if (!fs.existsSync(candidate)) return null;
  // Symlink-aware second-pass: canonicalize both sides and re-check boundary.
  let realCandidate, realBase;
  try {
    realCandidate = fs.realpathSync(candidate);
    realBase = fs.realpathSync(baseResolved);
  } catch {
    // realpath failed (broken symlink, race-deleted, perms) → refuse.
    return null;
  }
  if (!realCandidate.startsWith(realBase + path.sep) && realCandidate !== realBase) {
    return null;
  }
  return candidate;
}

function loadDoc(kbId) {
  const docPath = findDocPath(kbId);
  if (!docPath) return null;
  const text = fs.readFileSync(docPath, 'utf8');
  return parseFrontmatter(text);
}

function cmdCat(args) {
  const kbId = args._[0];
  if (!kbId) { console.error('Usage: cat <kb_id>'); process.exit(1); }
  const doc = loadDoc(kbId);
  if (!doc) { console.error(`Not found: ${kbId}`); process.exit(1); }
  process.stdout.write(doc.body);
  if (!doc.body.endsWith('\n')) process.stdout.write('\n');
}

function cmdHash(args) {
  const kbId = args._[0];
  if (!kbId) { console.error('Usage: hash <kb_id>'); process.exit(1); }
  const doc = loadDoc(kbId);
  if (!doc) { console.error(`Not found: ${kbId}`); process.exit(1); }
  const hash = shaHashBody(doc.body);
  console.log(JSON.stringify({ kb_id: kbId, hash, shortHash: hash.slice(0, 8) }, null, 2));
}

function cmdList(args) {
  const manifest = loadManifest();
  const tag = args.tag;
  const out = {};
  for (const [id, entry] of Object.entries(manifest.entries)) {
    if (tag && !(entry.tags || []).includes(tag)) continue;
    out[id] = { version: entry.version, shortHash: entry.shortHash, tags: entry.tags };
  }
  console.log(JSON.stringify({ count: Object.keys(out).length, entries: out }, null, 2));
}

function cmdResolve(args) {
  const ref = args._[0];
  if (!ref || !ref.startsWith('kb:')) {
    console.error('Usage: resolve kb:<id>[@<short-hash>]');
    process.exit(1);
  }
  const refBody = ref.slice(3);
  const [kbId, requestedHash] = refBody.split('@');
  const doc = loadDoc(kbId);
  if (!doc) {
    console.log(JSON.stringify({ ref, status: 'not_found', kb_id: kbId }, null, 2));
    process.exit(1);
  }
  const actualHash = shaHashBody(doc.body);
  if (requestedHash && !actualHash.startsWith(requestedHash)) {
    console.log(JSON.stringify({
      ref,
      status: 'hash_mismatch',
      requested: requestedHash,
      actual: actualHash.slice(0, 8),
    }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify({
    ref,
    status: 'ok',
    kb_id: kbId,
    hash: actualHash,
    shortHash: actualHash.slice(0, 8),
    bodyBytes: doc.body.length,
  }, null, 2));
  console.log('---BODY---');
  process.stdout.write(doc.body);
  if (!doc.body.endsWith('\n')) process.stdout.write('\n');
}

function walkKb(dir, base, out) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir)) {
    if (item.startsWith('.') || item === 'manifest.json' || item === 'README.md') continue;
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      walkKb(itemPath, base ? `${base}/${item}` : item, out);
    } else if (item.endsWith('.md')) {
      const text = fs.readFileSync(itemPath, 'utf8');
      const parsed = parseFrontmatter(text);
      const baseName = item.replace(/\.md$/, '');
      const expectedId = base ? `${base}/${baseName}` : baseName;
      const declaredId = parsed.frontmatter.kb_id;
      if (declaredId && declaredId !== expectedId) {
        console.error(`Warning: ${itemPath} declares kb_id "${declaredId}" but path implies "${expectedId}"`);
      }
      const id = declaredId || expectedId;
      const hash = shaHashBody(parsed.body);
      out[id] = {
        path: base ? `${base}/${item}` : item,
        version: parseInt(parsed.frontmatter.version || '1', 10),
        hash,
        shortHash: hash.slice(0, 8),
        tags: parsed.frontmatter.tags || [],
        lastUpdated: new Date().toISOString(),
      };
    }
  }
}

function cmdScan() {
  const manifest = loadManifest();
  const newEntries = {};
  walkKb(KB_BASE, '', newEntries);
  manifest.entries = newEntries;
  writeManifestAtomic(manifest);
  console.log(JSON.stringify({
    action: 'scan',
    docCount: Object.keys(newEntries).length,
    docs: Object.keys(newEntries).sort(),
  }, null, 2));
}

function cmdSnapshot(args) {
  const runId = args._[0];
  if (!runId) { console.error('Usage: snapshot <run-id>'); process.exit(1); }
  const manifest = loadManifest();
  const snapshotPath = path.join(runStateDir(runId), 'kb-snapshot.json');
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const snapshot = {
    snapshotAt: new Date().toISOString(),
    runId,
    entries: Object.fromEntries(
      Object.entries(manifest.entries).map(([id, e]) => [id, {
        path: e.path,
        version: e.version,
        hash: e.hash,
        shortHash: e.shortHash,
      }])
    ),
  };
  const tmp = snapshotPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmp, snapshotPath);
  console.log(JSON.stringify({
    action: 'snapshot',
    runId,
    snapshotPath,
    entryCount: Object.keys(snapshot.entries).length,
  }, null, 2));
}

function cmdRegister(args) {
  const kbId = args._[0];
  if (!kbId) { console.error('Usage: register <kb_id>'); process.exit(1); }
  const doc = loadDoc(kbId);
  if (!doc) {
    console.error(`File not found at expected path: ${path.join(KB_BASE, kbId + '.md')}`);
    process.exit(1);
  }
  const manifest = loadManifest();
  const hash = shaHashBody(doc.body);
  const declaredId = doc.frontmatter.kb_id;
  if (declaredId && declaredId !== kbId) {
    console.error(`Frontmatter kb_id "${declaredId}" mismatches expected "${kbId}". Refusing to register.`);
    process.exit(1);
  }
  manifest.entries[kbId] = {
    path: kbId + '.md',
    version: parseInt(doc.frontmatter.version || '1', 10),
    hash,
    shortHash: hash.slice(0, 8),
    tags: doc.frontmatter.tags || [],
    lastUpdated: new Date().toISOString(),
  };
  writeManifestAtomic(manifest);
  console.log(JSON.stringify({
    action: 'register',
    kb_id: kbId,
    hash,
    shortHash: hash.slice(0, 8),
  }, null, 2));
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (cmd) {
  case 'cat': cmdCat(args); break;
  case 'hash': cmdHash(args); break;
  case 'list': cmdList(args); break;
  case 'resolve': cmdResolve(args); break;
  case 'scan': cmdScan(); break;
  case 'snapshot': cmdSnapshot(args); break;
  case 'register': cmdRegister(args); break;
  default:
    console.error('Usage: kb-resolver.js {cat|hash|list|resolve|scan|snapshot|register} [args]');
    console.error('  cat <kb_id>            — print doc body');
    console.error('  hash <kb_id>           — print SHA-256 of body');
    console.error('  list [--tag X]         — list registered KB docs');
    console.error('  resolve kb:<id>[@<h>]  — resolve a ref string');
    console.error('  scan                   — walk kb/ tree, refresh manifest');
    console.error('  snapshot <run-id>      — freeze manifest to run-state');
    console.error('  register <kb_id>       — register a single file (alt to scan)');
    console.error('Env: HETS_KB_DIR, HETS_RUN_STATE_DIR override defaults.');
    process.exit(1);
}
