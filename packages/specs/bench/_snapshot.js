#!/usr/bin/env node

// bench/_snapshot.js — captures relevant ~/.claude/ state for pre/post diff.
//
// Called by runner.sh before + after the claude -p invocation. The diff between
// pre and post tells us which hooks fired (counter bumps, library writes, etc.)
// without needing to instrument the hooks themselves.
//
// Output: a JSON file with structured snapshot of:
//   - self-improve-counters.json (turnCounter, signalCount, top signals)
//   - prompt-patterns.json size
//   - library catalog sizes (per-stack volume counts)
//   - any new session-snapshot volumes
//
// Fail-soft: missing files are recorded as null, not thrown.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) { return { __error: err.message }; }
}

function statSafe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    const s = fs.statSync(p);
    return { size: s.size, mtime: s.mtimeMs };
  } catch { return null; }
}

function snapshot() {
  const out = {
    timestamp: new Date().toISOString(),
    claude_home: CLAUDE_HOME,
  };

  // 1. Self-improve counters (Stop hook bumps these every turn).
  const counters = readJsonSafe(path.join(CLAUDE_HOME, 'self-improve-counters.json'));
  if (counters) {
    out.self_improve_counters = {
      turnCounter: counters.turnCounter || 0,
      signalCount: counters.signalCount || 0,
      lastScanAt: counters.lastScanAt || null,
      signal_top5: Object.entries(counters.signals || {})
        .map(([k, v]) => [k, (v && v.count) || 0])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    };
  } else {
    out.self_improve_counters = null;
  }

  // 2. Prompt-patterns store size (enrichment hook may grow this).
  out.prompt_patterns = statSafe(path.join(CLAUDE_HOME, 'prompt-patterns.json'));

  // 3. Library catalog sizes (per-stack volume counts).
  const libraryRoot = path.join(CLAUDE_HOME, 'library');
  if (fs.existsSync(libraryRoot)) {
    out.library = { stacks: {} };
    walkLibrary(libraryRoot, out.library.stacks);
  } else {
    out.library = null;
  }

  // 4. Compact history size (pre-compact hook writes here).
  out.compact_history = statSafe(path.join(CLAUDE_HOME, 'checkpoints/compact-history.jsonl'));

  // 5. Number of project session JSONL files (each headless run creates one).
  // Useful to confirm the new run's transcript was created.
  const projectsRoot = path.join(CLAUDE_HOME, 'projects');
  if (fs.existsSync(projectsRoot)) {
    let totalJsonl = 0;
    for (const project of fs.readdirSync(projectsRoot)) {
      const projDir = path.join(projectsRoot, project);
      try {
        for (const file of fs.readdirSync(projDir)) {
          if (file.endsWith('.jsonl')) totalJsonl++;
        }
      } catch { /* skip */ }
    }
    out.project_transcripts_total = totalJsonl;
  } else {
    out.project_transcripts_total = 0;
  }

  return out;
}

function walkLibrary(libraryRoot, stacksOut) {
  const sectionsDir = path.join(libraryRoot, 'sections');
  if (!fs.existsSync(sectionsDir)) return;
  for (const section of fs.readdirSync(sectionsDir)) {
    const stacksDir = path.join(sectionsDir, section, 'stacks');
    if (!fs.existsSync(stacksDir)) continue;
    for (const stack of fs.readdirSync(stacksDir)) {
      const catPath = path.join(stacksDir, stack, '_catalog.json');
      const cat = readJsonSafe(catPath);
      const volumesDir = path.join(stacksDir, stack, 'volumes');
      let volumeCount = 0;
      if (fs.existsSync(volumesDir)) {
        try { volumeCount = fs.readdirSync(volumesDir).length; } catch { /* skip */ }
      }
      stacksOut[`${section}/${stack}`] = {
        catalog_entries: cat && Array.isArray(cat.entries) ? cat.entries.length : null,
        volume_count: volumeCount,
        catalog_size: statSafe(catPath)?.size || 0,
      };
    }
  }
}

function main(argv) {
  const args = argv.slice(2);
  let outPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') { outPath = args[++i]; }
  }
  const snap = snapshot();
  const text = JSON.stringify(snap, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, text);
    process.stderr.write(`snapshot written: ${outPath}\n`);
  } else {
    process.stdout.write(text + '\n');
  }
}

if (require.main === module) main(process.argv);

module.exports = { snapshot };
