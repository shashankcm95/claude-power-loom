#!/usr/bin/env node

// scripts/scan-stale-artifacts.js
//
// Ghost Protocol Component E — workspace hygiene watchdog.
//
// Scans well-known transient-artifact directories (session snapshots,
// repo plans, slash-command plan outputs, legacy checkpoints) for stale
// files. Emits a JSON report with candidates grouped by directory + a
// per-candidate staleness rationale.
//
// Does NOT delete anything — output is for surfacing to the user (or the
// pre-compact hook, future integration). Per safety policy, permanent
// deletion is user-initiated.
//
// Staleness heuristics (in priority order):
//   1. Frontmatter `lifecycle: ephemeral` AND mtime > 14 days
//   2. Frontmatter `archive-after: <YYYY-MM-DD>` AND that date is past
//   3. Filename topic-suffix matches /(shipped|merged|pre-compact|checkpoint|complete|locked)/i
//      AND mtime > 14 days
//   4. Filename has a date prefix YYYY-MM-DD older than 30 days AND
//      a newer file in the same directory with the same topic prefix exists
//      (supersession heuristic; very conservative — only flags clear successors)
//   5. Directory-specific allowlist: anything tracked in the
//      KEEP_ALWAYS_NAMES list (mempalace-fallback.md, README.md, etc.)
//      is NEVER flagged
//
// Usage:
//   node scripts/scan-stale-artifacts.js [--json] [--days <N>]
//   node scripts/scan-stale-artifacts.js --bump-signal
//
// Exit codes:
//   0 — scan complete (stale-count may be > 0)
//   1 — scan error (directory unreadable, etc.)

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const STALE_DAYS_DEFAULT = 14;
const SUPERSESSION_DAYS = 30;

const SCAN_TARGETS = [
  {
    label: 'library/session-snapshots',
    dir: path.join(
      os.homedir(),
      '.claude',
      'library',
      'sections',
      'toolkit',
      'stacks',
      'session-snapshots',
      'volumes',
    ),
    pattern: /\.md$/,
    keepAlways: new Set(['mempalace-fallback.md']),
  },
  {
    label: 'library/honesty-audit',
    dir: path.join(
      os.homedir(),
      '.claude',
      'library',
      'sections',
      'toolkit',
      'stacks',
      'honesty-audit',
      'volumes',
    ),
    pattern: /\.md$/,
    keepAlways: new Set(), // append-only by convention; rarely stale
    // Override: honesty-audit volumes are EXPLICITLY kept regardless of age.
    skipScan: true,
  },
  {
    label: 'repo/packages/specs/plans',
    dir: path.resolve(__dirname, '..', 'packages', 'specs', 'plans'),
    pattern: /\.md$/,
    keepAlways: new Set(['README.md']),
  },
  {
    label: 'user/.claude/plans',
    dir: path.join(os.homedir(), '.claude', 'plans'),
    pattern: /\.md$/,
    keepAlways: new Set(),
  },
  {
    label: 'user/.claude/checkpoints',
    dir: path.join(os.homedir(), '.claude', 'checkpoints'),
    pattern: /-handoff.*\.md$/, // only flag handoff-style markdown
    keepAlways: new Set(['mempalace-fallback.md']),
  },
];

const TOPIC_SUFFIX_RE = /(shipped|merged|pre-compact|checkpoint|complete|locked|finished|completed)/i;
const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function parseFrontmatter(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function daysSince(mtime) {
  return (Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24);
}

function parseDatePrefix(filename) {
  const m = filename.match(DATE_PREFIX_RE);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function detectSupersession(filename, allFilenames) {
  // Conservative supersession: filename has YYYY-MM-DD-<topic>... and a
  // newer file with the same <topic> portion exists.
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+?)(?:-(?:shipped|merged|complete|pre-compact|checkpoint))?\.md$/);
  if (!m) return null;
  const myDate = m[1];
  const myTopic = m[2].toLowerCase();
  for (const other of allFilenames) {
    if (other === filename) continue;
    const om = other.match(/^(\d{4}-\d{2}-\d{2})-(.+?)\.md$/);
    if (!om) continue;
    if (om[1] > myDate && om[2].toLowerCase().includes(myTopic.split('-').slice(0, 3).join('-'))) {
      return other; // candidate successor
    }
  }
  return null;
}

function scanDirectory(target, opts) {
  const staleDays = opts.staleDays || STALE_DAYS_DEFAULT;
  const result = { label: target.label, dir: target.dir, candidates: [], skipped: false };
  if (target.skipScan) {
    result.skipped = true;
    return result;
  }
  let entries;
  try {
    entries = fs.readdirSync(target.dir, { withFileTypes: true });
  } catch (err) {
    result.error = err.message;
    return result;
  }
  const files = entries
    .filter((e) => e.isFile() && target.pattern.test(e.name))
    .map((e) => e.name)
    .filter((n) => !target.keepAlways.has(n));

  for (const filename of files) {
    const fullPath = path.join(target.dir, filename);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    const ageDays = daysSince(stat.mtime);
    const reasons = [];

    // Heuristic 1+2: frontmatter signals
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const fm = parseFrontmatter(content);
      if (fm) {
        if (fm.lifecycle === 'ephemeral' && ageDays > staleDays) {
          reasons.push(`lifecycle:ephemeral + age ${Math.floor(ageDays)}d > ${staleDays}d`);
        }
        if (fm['archive-after']) {
          const cutoff = new Date(fm['archive-after']);
          if (!isNaN(cutoff) && cutoff < new Date()) {
            reasons.push(`archive-after:${fm['archive-after']} elapsed`);
          }
        }
      }
    } catch {
      // best-effort; missing/unreadable frontmatter is not a stale signal
    }

    // Heuristic 3: topic-suffix + age
    if (TOPIC_SUFFIX_RE.test(filename) && ageDays > staleDays) {
      const m = filename.match(TOPIC_SUFFIX_RE);
      reasons.push(`topic-suffix "${m[1]}" + age ${Math.floor(ageDays)}d > ${staleDays}d`);
    }

    // Heuristic 4: supersession by newer dated file
    if (parseDatePrefix(filename) && ageDays > SUPERSESSION_DAYS) {
      const successor = detectSupersession(filename, files);
      if (successor) {
        reasons.push(`superseded-by:${successor}`);
      }
    }

    if (reasons.length > 0) {
      result.candidates.push({
        path: fullPath,
        filename,
        age_days: Math.floor(ageDays),
        size_bytes: stat.size,
        reasons,
      });
    }
  }

  return result;
}

function main() {
  const args = process.argv.slice(2);
  const opts = {
    json: args.includes('--json'),
    bumpSignal: args.includes('--bump-signal'),
    staleDays: STALE_DAYS_DEFAULT,
  };
  const daysIdx = args.indexOf('--days');
  if (daysIdx >= 0 && args[daysIdx + 1]) {
    opts.staleDays = Number(args[daysIdx + 1]);
  }

  const report = {
    scanned_at: new Date().toISOString(),
    stale_days_threshold: opts.staleDays,
    targets: SCAN_TARGETS.map((t) => scanDirectory(t, opts)),
  };

  const totalCandidates = report.targets.reduce(
    (acc, t) => acc + (t.candidates ? t.candidates.length : 0),
    0,
  );
  const totalBytes = report.targets.reduce(
    (acc, t) =>
      acc +
      (t.candidates || []).reduce((b, c) => b + c.size_bytes, 0),
    0,
  );
  report.summary = {
    total_candidates: totalCandidates,
    total_bytes: totalBytes,
    debt_level: totalCandidates > 20 ? 'HIGH' : totalCandidates > 10 ? 'MEDIUM' : totalCandidates > 0 ? 'LOW' : 'CLEAN',
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  // Human-readable
  process.stdout.write(`# Workspace hygiene scan — ${report.scanned_at}\n\n`);
  process.stdout.write(`Stale-threshold: ${opts.staleDays} days. Total candidates: ${totalCandidates}. Bytes: ${totalBytes}. Debt: ${report.summary.debt_level}.\n\n`);
  for (const t of report.targets) {
    if (t.skipped) {
      process.stdout.write(`## ${t.label}\n  (skip-scan — kept-by-default per convention)\n\n`);
      continue;
    }
    if (t.error) {
      process.stdout.write(`## ${t.label}\n  (scan-error: ${t.error})\n\n`);
      continue;
    }
    process.stdout.write(`## ${t.label} (${t.dir})\n`);
    if (!t.candidates.length) {
      process.stdout.write(`  ✓ clean\n\n`);
      continue;
    }
    for (const c of t.candidates) {
      process.stdout.write(`  • ${c.filename} (age=${c.age_days}d, ${c.size_bytes}B)\n`);
      for (const r of c.reasons) process.stdout.write(`      reason: ${r}\n`);
    }
    process.stdout.write('\n');
  }

  if (opts.bumpSignal && totalCandidates >= 10) {
    // Best-effort: bump drift:workspace-hygiene-debt via the existing CLI
    const { spawnSync } = require('child_process');
    const candidates = [
      path.join(__dirname, '..', 'packages', 'kernel', 'spawn-state', 'self-improve-store.js'),
      path.join(os.homedir(), '.claude', 'scripts', 'self-improve-store.js'),
    ];
    for (const storePath of candidates) {
      if (fs.existsSync(storePath)) {
        spawnSync('node', [storePath, 'bump', '--signal', 'drift:workspace-hygiene-debt'], { stdio: 'inherit' });
        break;
      }
    }
  }
}

if (require.main === module) main();

module.exports = { scanDirectory, SCAN_TARGETS };
