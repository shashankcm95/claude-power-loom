#!/usr/bin/env node

// Pattern runner — extract testable validation scenarios from a pattern doc
// so the orchestrator can spin chaos-test runs targeted at a specific pattern.
// Implements the H.2.9 entry of `chaos-test --pattern <name>`. The chaos-test
// command (LLM-driven) consumes this script's JSON output to derive actor
// prompts.
//
// Subcommands:
//   list-patterns                — list every pattern + status + scenarios count
//   extract --pattern <name>     — return JSON { pattern, status, scenarios: [...] }
//   summary --pattern <name>     — human-readable summary (status + scenarios + related)
//   prompts --pattern <name>     — derive ready-to-paste actor prompts per scenario
//
// Env override (testability):
//   HETS_PATTERNS_DIR — root for pattern docs (default: ~/Documents/claude-toolkit/skills/agent-team/patterns)

const fs = require('fs');
const path = require('path');

const PATTERNS_BASE = process.env.HETS_PATTERNS_DIR ||
  path.join(process.env.HOME, 'Documents', 'claude-toolkit', 'skills', 'agent-team', 'patterns');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
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

function patternFilePath(name) {
  return path.join(PATTERNS_BASE, name + '.md');
}

function loadPattern(name) {
  const fp = patternFilePath(name);
  if (!fs.existsSync(fp)) return null;
  const text = fs.readFileSync(fp, 'utf8');
  return parseFrontmatter(text);
}

// Extract the "## Validation Strategy" section's bulleted scenarios.
// Each top-level `- ` bullet is a scenario; multi-line bullets are joined.
function extractScenarios(body) {
  // Case-insensitive header match — pattern docs vary on
  // "Validation Strategy" vs "Validation strategy". \Z is not a JS regex
  // metacharacter (per the H.2-bridge fix in contract-verifier.js); use
  // $(?![\s\S]) for true end-of-string regardless of /m flag.
  const m = body.match(/^##\s+Validation Strategy[\s\S]*?(?=^##\s|$(?![\s\S]))/im);
  if (!m) return [];
  const section = m[0];
  // Split into lines; collect bullets. A bullet starts with `- `; continuation
  // lines are indented or non-bullet text following.
  const lines = section.split('\n');
  const scenarios = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip the section header and intro lines like "Stress-test scenarios:"
    if (line.startsWith('##') || line.match(/^[A-Z][a-z].*scenarios:$/)) continue;
    // Bullet?
    const bulletMatch = line.match(/^-\s+(.*)$/);
    if (bulletMatch) {
      if (current) scenarios.push(current.trim());
      current = bulletMatch[1];
    } else if (line.match(/^\s+\S/) && current) {
      // Continuation of previous bullet
      current += ' ' + line.trim();
    } else if (line.trim() === '' && current) {
      // Blank line — flush current scenario
      scenarios.push(current.trim());
      current = null;
    }
  }
  if (current) scenarios.push(current.trim());
  return scenarios.filter((s) => s.length > 10); // filter cruft
}

function listAllPatterns() {
  if (!fs.existsSync(PATTERNS_BASE)) return [];
  const files = fs.readdirSync(PATTERNS_BASE)
    .filter((f) => f.endsWith('.md') && f !== 'README.md');
  const out = [];
  for (const f of files) {
    const name = f.replace(/\.md$/, '');
    const doc = loadPattern(name);
    if (!doc) continue;
    out.push({
      pattern: name,
      status: doc.frontmatter.status || 'unknown',
      intent: doc.frontmatter.intent || '',
      scenarioCount: extractScenarios(doc.body).length,
    });
  }
  return out;
}

function cmdListPatterns() {
  const list = listAllPatterns();
  console.log(JSON.stringify({ count: list.length, patterns: list }, null, 2));
}

function cmdExtract(args) {
  if (!args.pattern) { console.error('Usage: extract --pattern <name>'); process.exit(1); }
  const doc = loadPattern(args.pattern);
  if (!doc) { console.error(`Pattern not found: ${args.pattern} (looked at ${patternFilePath(args.pattern)})`); process.exit(1); }
  const scenarios = extractScenarios(doc.body);
  console.log(JSON.stringify({
    pattern: args.pattern,
    status: doc.frontmatter.status,
    intent: doc.frontmatter.intent,
    related: doc.frontmatter.related || [],
    scenarioCount: scenarios.length,
    scenarios,
  }, null, 2));
}

function cmdSummary(args) {
  if (!args.pattern) { console.error('Usage: summary --pattern <name>'); process.exit(1); }
  const doc = loadPattern(args.pattern);
  if (!doc) { console.error(`Pattern not found: ${args.pattern}`); process.exit(1); }
  const scenarios = extractScenarios(doc.body);
  console.log(`Pattern:     ${args.pattern}`);
  console.log(`Status:      ${doc.frontmatter.status || '(unset)'}`);
  console.log(`Intent:      ${doc.frontmatter.intent || '(unset)'}`);
  console.log(`Related:     ${(doc.frontmatter.related || []).join(', ') || '(none)'}`);
  console.log(`Scenarios (${scenarios.length}):`);
  scenarios.forEach((s, i) => {
    const truncated = s.length > 200 ? s.slice(0, 200) + '...' : s;
    console.log(`  ${i + 1}. ${truncated}`);
  });
}

function cmdPrompts(args) {
  if (!args.pattern) { console.error('Usage: prompts --pattern <name>'); process.exit(1); }
  const doc = loadPattern(args.pattern);
  if (!doc) { console.error(`Pattern not found: ${args.pattern}`); process.exit(1); }
  const scenarios = extractScenarios(doc.body);
  // For each scenario, emit a structured prompt-skeleton the orchestrator
  // can hand to a spawned actor. The actor's job is to EXECUTE the scenario
  // and report whether the pattern's defense fired correctly.
  const prompts = scenarios.map((scenario, i) => ({
    scenarioIndex: i + 1,
    scenario,
    actorPromptSkeleton: [
      `You are validating the pattern \`${args.pattern}\` (intent: ${doc.frontmatter.intent || 'see pattern doc'}).`,
      ``,
      `## Scenario`,
      scenario,
      ``,
      `## Your task`,
      `1. Set up the conditions described in the scenario (mocks / fixtures / synthetic outputs as needed).`,
      `2. Run the relevant HETS infrastructure against the conditions.`,
      `3. Observe whether the pattern's defense fired correctly (i.e., the failure mode was caught) OR whether the pattern silently failed.`,
      `4. Report findings with:`,
      `   - Setup: what you configured`,
      `   - Run: what command(s) you executed`,
      `   - Observed: actual vs expected`,
      `   - Verdict: pattern-defense-fired | pattern-silent-failure | pattern-not-applicable`,
      ``,
      `Use the existing HETS scripts at \`scripts/agent-team/\` (no new code authoring needed). Read \`patterns/${args.pattern}.md\` for full design context.`,
    ].join('\n'),
  }));
  console.log(JSON.stringify({
    pattern: args.pattern,
    promptCount: prompts.length,
    prompts,
  }, null, 2));
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (cmd) {
  case 'list-patterns': cmdListPatterns(); break;
  case 'extract': cmdExtract(args); break;
  case 'summary': cmdSummary(args); break;
  case 'prompts': cmdPrompts(args); break;
  default:
    console.error('Usage: pattern-runner.js {list-patterns|extract|summary|prompts} [args]');
    console.error('  list-patterns                — list all patterns with status + scenario count');
    console.error('  extract --pattern <name>     — JSON output of pattern + scenarios');
    console.error('  summary --pattern <name>     — human-readable summary');
    console.error('  prompts --pattern <name>     — actor-prompt skeletons per scenario (for chaos-test --pattern flow)');
    console.error('Env: HETS_PATTERNS_DIR overrides pattern docs root.');
    process.exit(1);
}
