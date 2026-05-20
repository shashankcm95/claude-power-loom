#!/usr/bin/env node

// bench/collect.js — extracts boot-test metrics from a single headless run.
//
// Inputs (all flags):
//   --stream <path>          stream.jsonl from `claude -p --output-format stream-json`
//   --pre    <path>          pre-snapshot JSON (from _snapshot.js)
//   --post   <path>          post-snapshot JSON
//   --workdir <path>         work copy of fixture after claude operated on it
//   --fixture <path>         original fixture (for diff baseline)
//   --wallclock-seconds <n>  shell-measured wallclock
//   --claude-exit <n>        claude -p exit code
//   --mode <plugin-on|plugin-off-bare>
//   --out  <path>            metrics.json output
//
// Output: metrics.json with structured fields:
//   { mode, claude_exit, latency, tokens, turns, tool_uses, subagent_spawns,
//     hook_bumps, fixture_diff, deterministic_pass, transcript_path }
//
// The deterministic_pass evaluation uses ONLY filesystem post-state + counters,
// not LLM judgment.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- arg parsing -------------------------------------------------------------
function parseArgs(argv) {
  const opts = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { opts[key] = next; i++; }
      else { opts[key] = true; }
    }
  }
  return opts;
}

// --- stream-json parsing -----------------------------------------------------
//
// stream-json from `claude -p` is newline-delimited; each line is a JSON event.
// Event types (per docs):
//   {type: "system", subtype: "init", ...}        // session init; has session_id
//   {type: "assistant", message: {...}}           // assistant text + tool_use blocks
//   {type: "user", message: {...}}                // tool results echoed back
//   {type: "result", subtype: "success"|"error", usage: {...}, duration_ms, ...}

function parseStream(streamPath) {
  if (!fs.existsSync(streamPath)) {
    return { error: `stream file not found: ${streamPath}`, events: 0 };
  }
  const raw = fs.readFileSync(streamPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);

  const out = {
    events: lines.length,
    session_id: null,
    transcript_path: null,
    result_event: null,
    tool_uses: {},
    subagent_spawns: 0,
    text_messages: 0,
  };

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') {
      out.session_id = ev.session_id || (ev.data && ev.data.session_id) || null;
      // Some versions include cwd/project info that helps locate transcript.
    }
    if (ev.type === 'result') {
      out.result_event = ev;
    }
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      out.text_messages++;
      for (const block of ev.message.content) {
        if (block.type === 'tool_use') {
          const name = block.name || 'unknown';
          out.tool_uses[name] = (out.tool_uses[name] || 0) + 1;
          if (name === 'Task') out.subagent_spawns++;
        }
      }
    }
  }

  return out;
}

// --- counter diff ------------------------------------------------------------
function diffCounters(pre, post) {
  if (!pre || !post) return { error: 'missing snapshot' };
  const preCounters = (pre.self_improve_counters || {});
  const postCounters = (post.self_improve_counters || {});
  return {
    turn_counter_delta: (postCounters.turnCounter || 0) - (preCounters.turnCounter || 0),
    signal_count_delta: (postCounters.signalCount || 0) - (preCounters.signalCount || 0),
    last_scan_changed: preCounters.lastScanAt !== postCounters.lastScanAt,
    transcripts_added: (post.project_transcripts_total || 0) - (pre.project_transcripts_total || 0),
  };
}

// --- library diff ------------------------------------------------------------
function diffLibrary(pre, post) {
  if (!pre || !post) return { error: 'missing snapshot' };
  const preLib = (pre.library && pre.library.stacks) || {};
  const postLib = (post.library && post.library.stacks) || {};
  const changes = {};
  const allStacks = new Set([...Object.keys(preLib), ...Object.keys(postLib)]);
  for (const stack of allStacks) {
    const before = preLib[stack] || { volume_count: 0, catalog_entries: 0 };
    const after = postLib[stack] || { volume_count: 0, catalog_entries: 0 };
    const volDelta = (after.volume_count || 0) - (before.volume_count || 0);
    const entryDelta = (after.catalog_entries || 0) - (before.catalog_entries || 0);
    if (volDelta !== 0 || entryDelta !== 0) {
      changes[stack] = { volumes_delta: volDelta, entries_delta: entryDelta };
    }
  }
  return changes;
}

// --- fixture diff ------------------------------------------------------------
function diffFixture(workdir, fixture) {
  const out = { modified_files: [], created_files: [], deleted_files: [] };
  if (!fs.existsSync(workdir) || !fs.existsSync(fixture)) return out;

  function listFiles(dir, base = dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(base, full);
      if (ent.isDirectory()) listFiles(full, base, acc);
      else if (ent.isFile()) acc.push(rel);
    }
    return acc;
  }
  const workFiles = new Set(listFiles(workdir));
  const fixFiles = new Set(listFiles(fixture));
  for (const f of workFiles) {
    if (!fixFiles.has(f)) {
      out.created_files.push(f);
    } else {
      try {
        const a = fs.readFileSync(path.join(workdir, f));
        const b = fs.readFileSync(path.join(fixture, f));
        if (!a.equals(b)) out.modified_files.push(f);
      } catch { /* skip binary issues */ }
    }
  }
  for (const f of fixFiles) {
    if (!workFiles.has(f)) out.deleted_files.push(f);
  }
  return out;
}

// --- deterministic PASS criteria --------------------------------------------
function evaluatePassCriteria(workdir, claudeExit) {
  const checks = {};

  // 1. claude exited 0
  checks.claude_exit_zero = {
    pass: claudeExit === 0,
    detail: `exit=${claudeExit}`,
  };

  // 2. cli.js contains 'export' subcommand handler
  const cliPath = path.join(workdir, 'cli.js');
  const cliContent = fs.existsSync(cliPath) ? fs.readFileSync(cliPath, 'utf8') : '';
  const hasExportHandler = /['"]export['"]|cmdExport|function\s+\w*[Ee]xport|export.*=>/.test(cliContent);
  checks.cli_has_export = {
    pass: hasExportHandler,
    detail: hasExportHandler ? 'export reference found' : 'no export handler',
  };

  // 3. cli.test.js has at least 1 new test
  const testPath = path.join(workdir, 'cli.test.js');
  const testContent = fs.existsSync(testPath) ? fs.readFileSync(testPath, 'utf8') : '';
  const testCount = (testContent.match(/^\s*test\s*\(/gm) || []).length;
  checks.test_added = {
    pass: testCount > 3,  // fixture starts with 3 tests
    detail: `${testCount} test(s); fixture started with 3`,
  };

  // 4. smoke tests still pass
  let testExit = -1;
  let testOutput = '';
  try {
    testOutput = execSync(`node "${testPath}"`, { encoding: 'utf8', cwd: workdir, timeout: 30000 });
    testExit = 0;
  } catch (err) {
    testExit = err.status || 1;
    testOutput = (err.stdout || '') + (err.stderr || '');
  }
  checks.smoke_tests_pass = {
    pass: testExit === 0,
    detail: `exit=${testExit}; ${(testOutput.match(/(\d+) passed/) || ['?'])[0]}`,
  };

  // 5. README mentions 'export'
  const readmePath = path.join(workdir, 'README.md');
  const readmeContent = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
  checks.readme_mentions_export = {
    pass: /\bexport\b/i.test(readmeContent),
    detail: /\bexport\b/i.test(readmeContent) ? 'export mentioned' : 'not mentioned',
  };

  // 6. Some form of path validation in cli.js export handler
  // Heuristic: look for any of: path.isAbsolute, path.normalize, /\.\./ check,
  // path.resolve usage, or an explicit throw on bad input near 'export'.
  const validationPatterns = [
    /path\.isAbsolute/,
    /path\.normalize/,
    /path\.resolve/,
    /\.\.\//,                          // checks for traversal pattern
    /['"]\.\.['"]/,
    /throw new Error.*path/i,
    /invalid path/i,
  ];
  const hasValidation = validationPatterns.some(re => re.test(cliContent));
  checks.cli_has_path_validation = {
    pass: hasValidation,
    detail: hasValidation ? 'validation pattern present' : 'no obvious path-validation pattern',
  };

  return checks;
}

// --- main --------------------------------------------------------------------
function main(argv) {
  const opts = parseArgs(argv);
  const required = ['stream', 'pre', 'post', 'workdir', 'fixture', 'wallclock-seconds', 'claude-exit', 'mode', 'out'];
  for (const r of required) {
    if (opts[r] === undefined) {
      process.stderr.write(`collect: missing required --${r}\n`);
      process.exit(2);
    }
  }

  const pre = JSON.parse(fs.readFileSync(opts.pre, 'utf8'));
  const post = JSON.parse(fs.readFileSync(opts.post, 'utf8'));
  const stream = parseStream(opts.stream);

  const usage = (stream.result_event && stream.result_event.usage) || {};
  const claudeExit = parseInt(opts['claude-exit'], 10);
  const wallSecs = parseFloat(opts['wallclock-seconds']);

  // Look up transcript path by session_id.
  let transcriptPath = null;
  if (stream.session_id) {
    const projectsRoot = path.join(process.env.HOME, '.claude/projects');
    if (fs.existsSync(projectsRoot)) {
      outer:
      for (const proj of fs.readdirSync(projectsRoot)) {
        const candidate = path.join(projectsRoot, proj, `${stream.session_id}.jsonl`);
        if (fs.existsSync(candidate)) {
          transcriptPath = candidate;
          break outer;
        }
      }
    }
  }

  const metrics = {
    mode: opts.mode,
    timestamp: new Date().toISOString(),
    claude_exit: claudeExit,
    session_id: stream.session_id,
    transcript_path: transcriptPath,
    stream_events: stream.events,
    latency: {
      wallclock_seconds: wallSecs,
      duration_ms: stream.result_event ? stream.result_event.duration_ms : null,
      duration_api_ms: stream.result_event ? stream.result_event.duration_api_ms : null,
    },
    turns: stream.result_event ? stream.result_event.num_turns : null,
    tokens: {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cache_read: usage.cache_read_input_tokens || 0,
      cache_creation: usage.cache_creation_input_tokens || 0,
    },
    tool_uses: stream.tool_uses,
    subagent_spawns: stream.subagent_spawns,
    hook_bumps: diffCounters(pre, post),
    library_diff: diffLibrary(pre, post),
    fixture_diff: diffFixture(opts.workdir, opts.fixture),
    deterministic_pass: evaluatePassCriteria(opts.workdir, claudeExit),
  };

  fs.writeFileSync(opts.out, JSON.stringify(metrics, null, 2));
  process.stderr.write(`metrics written: ${opts.out}\n`);
}

if (require.main === module) main(process.argv);

module.exports = { parseStream, diffCounters, diffLibrary, diffFixture, evaluatePassCriteria };
