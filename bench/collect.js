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
    subagent_types: [],          // values from Agent tool input's subagent_type field
    subagent_result_texts: [],   // sub-agent reply text (for KB-ref scanning)
    skill_invocations: [],       // skill names from Skill tool calls
    bash_commands: [],           // Bash command strings (for route-decide detection)
    ask_user_question_errors: 0, // count of AskUserQuestion calls that errored back
    text_messages: 0,
    askq_tool_use_ids: new Set(),
    agent_tool_use_ids: new Set(), // map Agent tool_use_ids → their results
  };

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') {
      out.session_id = ev.session_id || (ev.data && ev.data.session_id) || null;
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
          // Sub-agent spawn tool — name changed across Claude Code versions:
          //   Claude Code 1.x: "Task"
          //   Claude Code 2.x: "Agent"
          // Support both for forward/backward compat.
          if (name === 'Agent' || name === 'Task') {
            out.subagent_spawns++;
            const subType = (block.input && (block.input.subagent_type || block.input.subagent || block.input.type)) || 'unspecified';
            out.subagent_types.push(subType);
            out.agent_tool_use_ids.add(block.id);
          }
          if (name === 'Skill') {
            const skillName = (block.input && (block.input.skill || block.input.name)) || 'unspecified';
            out.skill_invocations.push(skillName);
          }
          if (name === 'AskUserQuestion') {
            out.askq_tool_use_ids.add(block.id);
          }
          if (name === 'Bash') {
            const cmd = (block.input && block.input.command) || '';
            out.bash_commands.push(cmd);
          }
        }
      }
    }
    // User messages can carry tool_result blocks (echoed by the runtime).
    if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result') {
          if (block.is_error && out.askq_tool_use_ids.has(block.tool_use_id)) {
            out.ask_user_question_errors++;
          }
          // Capture sub-agent reply text for downstream KB-ref scanning.
          if (out.agent_tool_use_ids.has(block.tool_use_id)) {
            const content = block.content;
            let text = '';
            if (typeof content === 'string') text = content;
            else if (Array.isArray(content)) {
              text = content.map(c => (c && typeof c === 'object' ? (c.text || '') : String(c))).join('\n');
            }
            if (text) out.subagent_result_texts.push(text);
          }
        }
      }
    }
  }

  // Don't serialize the Sets; downstream consumers only need the captured data.
  delete out.askq_tool_use_ids;
  delete out.agent_tool_use_ids;
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
function evaluatePassCriteria(workdir, claudeExit, streamMetrics, hookBumps) {
  const checks = {};

  // === Output correctness — the work itself ===

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

  // 3. cli.js handles both JSON and CSV formats (v0.2 task expansion)
  const hasJsonHandling = /\.json|JSON\.stringify|application\/json/i.test(cliContent);
  const hasCsvHandling = /\.csv|csv/i.test(cliContent);
  checks.cli_has_both_formats = {
    pass: hasJsonHandling && hasCsvHandling,
    detail: `json=${hasJsonHandling ? 'yes' : 'no'} csv=${hasCsvHandling ? 'yes' : 'no'}`,
  };

  // 4. cli.test.js has at least 1 new test
  const testPath = path.join(workdir, 'cli.test.js');
  const testContent = fs.existsSync(testPath) ? fs.readFileSync(testPath, 'utf8') : '';
  const testCount = (testContent.match(/^\s*test\s*\(/gm) || []).length;
  checks.test_added = {
    pass: testCount > 3,  // fixture starts with 3 tests
    detail: `${testCount} test(s); fixture started with 3`,
  };

  // 5. smoke tests still pass
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

  // 6. README mentions the new feature AND at least one format
  const readmePath = path.join(workdir, 'README.md');
  const readmeContent = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
  const readmeHasExport = /\bexport\b/i.test(readmeContent);
  const readmeHasFormat = /\b(csv|json)\b/i.test(readmeContent);
  checks.readme_mentions_export = {
    pass: readmeHasExport && readmeHasFormat,
    detail: `export=${readmeHasExport ? 'yes' : 'no'} format-named=${readmeHasFormat ? 'yes' : 'no'}`,
  };

  // 7. Some form of path validation in cli.js
  // Heuristic: look for any of: path.isAbsolute, path.normalize, traversal check,
  // path.resolve usage, or an explicit throw on bad input.
  const validationPatterns = [
    /path\.isAbsolute/,
    /path\.normalize/,
    /path\.resolve/,
    /\.\.\//,                          // checks for traversal pattern
    /['"]\.\.['"]/,
    /throw new Error.*path/i,
    /invalid path/i,
    /traversal/i,
  ];
  const hasValidation = validationPatterns.some(re => re.test(cliContent));
  checks.cli_has_path_validation = {
    pass: hasValidation,
    detail: hasValidation ? 'validation pattern present' : 'no obvious path-validation pattern',
  };

  // === Plugin behavioral evidence — the orchestration happened ===

  // 8. At least 1 sub-agent spawn (Task tool invoked)
  const spawnCount = (streamMetrics && streamMetrics.subagent_spawns) || 0;
  checks.subagent_spawned = {
    pass: spawnCount >= 1,
    detail: `${spawnCount} sub-agent spawn(s) via Agent tool`,
  };

  // 9. AskUserQuestion did NOT trigger errors (proves permission-mode worked)
  // Look in the stream for AskUserQuestion tool calls that resulted in error tool_results.
  const aukCount = (streamMetrics && streamMetrics.tool_uses && streamMetrics.tool_uses.AskUserQuestion) || 0;
  const aukErrors = (streamMetrics && streamMetrics.ask_user_question_errors) || 0;
  checks.no_ask_user_question_errors = {
    pass: aukErrors === 0,
    detail: `${aukCount} AskUserQuestion call(s); ${aukErrors} errored — should be 0`,
  };

  // 10. Stop hook fired (turnCounter delta >= 1)
  const turnDelta = (hookBumps && hookBumps.turn_counter_delta) || 0;
  checks.stop_hook_fired = {
    pass: turnDelta >= 1,
    detail: `turnCounter delta=${turnDelta} (Stop hook bumps once per turn)`,
  };

  return checks;
}

// --- soft signals (reported but don't fail the boot test) -------------------
//
// These detect plugin discipline compliance. They are observational — a `no`
// here is NOT a boot-test failure, but IS a meaningful signal that the
// plugin's auto-trigger behaviors may not be firing under headless mode OR
// may not be enforced for the path the user's task exercised.
//
// Distinguish strict-mode (parent transcript only) from inclusive-mode
// (parent + sub-agent reply texts). Sub-agent KB consultation surfaces in
// agent_result_texts, not the parent's own transcript — so inclusive-mode
// catches it.

function evaluateSoftSignals(workdir, streamMetrics, transcriptPath) {
  const signals = {};

  // Build a combined search corpus: parent transcript JSONL + all sub-agent
  // reply texts captured from Agent tool_results.
  let transcriptContent = '';
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try { transcriptContent = fs.readFileSync(transcriptPath, 'utf8'); } catch { /* skip */ }
  }
  const subagentResults = ((streamMetrics && streamMetrics.subagent_result_texts) || []).join('\n');
  const combinedCorpus = transcriptContent + '\n' + subagentResults;

  // 1. KB consultation — search parent + sub-agent results for kb:architecture refs.
  const kbRefs = combinedCorpus.match(/kb:[a-z][a-z0-9\-\/]+/gi) || [];
  signals.kb_consultation = {
    observed: kbRefs.length > 0,
    detail: kbRefs.length > 0
      ? `${kbRefs.length} kb refs: ${[...new Set(kbRefs)].slice(0, 5).join(', ')}`
      : 'no kb: references in parent transcript OR sub-agent results',
  };

  // 2. Specialist agent spawns — architect / code-reviewer / security-auditor
  const subagentTypes = (streamMetrics && streamMetrics.subagent_types) || [];
  const hasArchitect = subagentTypes.some(t => /architect/i.test(t));
  const hasCodeReviewer = subagentTypes.some(t => /code.?review|reviewer/i.test(t));
  const hasSecurityAuditor = subagentTypes.some(t => /security/i.test(t));
  signals.specialist_agents_spawned = {
    observed: hasArchitect || hasCodeReviewer || hasSecurityAuditor,
    detail: `subagent_types=[${subagentTypes.join(', ')}]; architect=${hasArchitect ? 'yes' : 'no'} code-reviewer=${hasCodeReviewer ? 'yes' : 'no'} security=${hasSecurityAuditor ? 'yes' : 'no'}`,
  };

  // 3. Plan-mode evidence — Claude Code 2.x emits EnterPlanMode/ExitPlanMode
  //    tool calls when plan-mode fires. Earlier versions used the Skill tool
  //    for the plan skill. Check both.
  const toolUses = (streamMetrics && streamMetrics.tool_uses) || {};
  const skillCalls = (streamMetrics && streamMetrics.skill_invocations) || [];
  const planModeTools = (toolUses.EnterPlanMode || 0) + (toolUses.ExitPlanMode || 0);
  const hasPlanSkill = skillCalls.some(s => /plan/i.test(s));
  signals.plan_mode_evidence = {
    observed: planModeTools > 0 || hasPlanSkill,
    detail: `EnterPlanMode/ExitPlanMode calls=${planModeTools}; plan-skill=${hasPlanSkill ? 'yes' : 'no'}`,
  };

  // 4. Route-decide gate consulted — workflow rule says to run route-decide.js
  //    before spawning sub-agents. Search Bash commands.
  const bashCmds = (streamMetrics && streamMetrics.bash_commands) || [];
  const routeDecideHit = bashCmds.some(cmd => /route-decide(\.js)?/.test(cmd));
  signals.route_decide_consulted = {
    observed: routeDecideHit,
    detail: routeDecideHit
      ? 'route-decide.js invoked via Bash'
      : `route-decide.js NOT invoked across ${bashCmds.length} Bash call(s) — workflow rule may not be firing in headless`,
  };

  // 5. Research-mode citations — factual claims about APIs/libraries should
  //    cite a source (URL, file:line, docs link). Heuristic: look for
  //    citation patterns in the combined corpus.
  const citationPatterns = [
    /https?:\/\/[a-z0-9.-]+/i,
    /[a-z][a-z0-9_\-]+\.[a-z]+:\d+/i,         // file.ext:line
    /per\s+(the\s+)?docs/i,
    /per\s+RFC\s+\d+/i,
    /MDN/,
  ];
  const citationCount = citationPatterns.reduce(
    (acc, re) => acc + (combinedCorpus.match(new RegExp(re.source, 'gi')) || []).length, 0
  );
  signals.research_mode_citations = {
    observed: citationCount > 0,
    detail: citationCount > 0
      ? `${citationCount} citation-like pattern(s) found`
      : 'no citations (URLs, file:line, "per docs", RFC refs)',
  };

  return signals;
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

  const hookBumps = diffCounters(pre, post);
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
    subagent_types: stream.subagent_types,
    skill_invocations: stream.skill_invocations,
    ask_user_question_errors: stream.ask_user_question_errors,
    hook_bumps: hookBumps,
    library_diff: diffLibrary(pre, post),
    fixture_diff: diffFixture(opts.workdir, opts.fixture),
    deterministic_pass: evaluatePassCriteria(opts.workdir, claudeExit, stream, hookBumps),
    soft_signals: evaluateSoftSignals(opts.workdir, stream, transcriptPath),
  };

  fs.writeFileSync(opts.out, JSON.stringify(metrics, null, 2));
  process.stderr.write(`metrics written: ${opts.out}\n`);
}

if (require.main === module) main(process.argv);

module.exports = { parseStream, diffCounters, diffLibrary, diffFixture, evaluatePassCriteria };
