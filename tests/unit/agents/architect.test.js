#!/usr/bin/env node

// tests/unit/agents/architect.test.js — unit tests for the architect agent.
//
// Two test categories:
//   STATIC — assertions on agents/architect.md content (file-read; cheap)
//   BEHAVIORAL — spawn architect via claude -p with a fixture task and assert
//                on its response shape (token-spending; opt-in via BEHAVIORAL=1)
//
// Run static only:    node tests/unit/agents/architect.test.js
// Run all:           BEHAVIORAL=1 node tests/unit/agents/architect.test.js
//
// Baseline experiment context: these tests encode the CONTRACT the architect
// agent's output must satisfy. The agent fixing GAP-A (compliance fix branch)
// works WITHOUT TDD methodology — the agent doesn't see these tests; the
// code-reviewer validates that the agent's fix makes these tests pass.
//
// If a future TDD-treatment experiment shows TDD-by-default produces fewer
// rework loops, the workflow.md rule gets a TDD-by-default clause for HETS.

'use strict';

const {
  assert,
  assertMatch,
  assertContains,
  readAgentDefinition,
  describe,
  describeBehavioral,
  spawnAgentBehavioral,
  extractAgentResultText,
  run,
} = require('./_harness');

run(() => {
  const architectMd = readAgentDefinition('architect');

  // ============================================================
  // STATIC TESTS — assert on the agent's definition contract
  // ============================================================

  describe('architect.md — frontmatter contract', () => {
    assertMatch(architectMd, /^---\n/, 'has YAML frontmatter');
    assertMatch(architectMd, /name:\s*architect/i, 'declares name: architect');
    assertMatch(architectMd, /tools:/, 'declares tools field');
  });

  describe('architect.md — KB consultation discipline (H.9.20.0 v2.0.3)', () => {
    // This is the GAP-A contract. The architect MUST instruct the model to
    // cite kb: references in its response. Currently FAILS — the architect
    // definition either doesn't require KB output OR doesn't enforce the
    // citation format.
    const hasKbInstructions =
      /kb[:_-]?consult/i.test(architectMd) ||
      /knowledge base/i.test(architectMd) ||
      /kb:architecture/i.test(architectMd);
    assert(hasKbInstructions,
      'definition mentions KB consultation (kb_consult / knowledge base / kb:architecture)');

    const hasOutputContract =
      /## KB Sources Consulted/i.test(architectMd) ||
      /KB[- ]?(Sources|Cite|Reference)/i.test(architectMd) ||
      /kb_(sources|cite|refs)_consulted/i.test(architectMd);
    assert(hasOutputContract,
      'definition specifies an output contract for KB citations (e.g. "## KB Sources Consulted" section)');

    const requiresMinimumCite =
      /at least \d+ kb/i.test(architectMd) ||
      /minimum.*kb/i.test(architectMd) ||
      /must cite/i.test(architectMd);
    assert(requiresMinimumCite,
      'definition enforces a minimum citation count (e.g. "at least 1 kb: reference")');
  });

  describe('architect.md — design-review role contract', () => {
    assertMatch(architectMd, /architect|design|review/i, 'role mentions architecture / design / review');
  });

  // ============================================================
  // BEHAVIORAL TESTS — spawn the agent and assert on output
  // ============================================================

  describeBehavioral('architect — KB citation in response (live spawn)', () => {
    const fixtureTask = `
      I'm designing a small file-export feature for a CLI tool. The output path
      is untrusted user input. Should I use path.resolve + startsWith check, or
      a more sophisticated validation? Walk through the trade-offs and cite
      relevant architectural patterns.
    `.trim();

    const result = spawnAgentBehavioral('architect', fixtureTask, 180);
    assert(result.exitCode === 0, `claude -p exited 0 (got ${result.exitCode})`);

    const agentReply = extractAgentResultText(result.stdout);
    assert(agentReply.length > 100, `architect reply has substantive content (${agentReply.length} bytes)`);

    // The GAP-A acceptance criterion: architect MUST cite at least 1 kb: reference
    const kbRefs = agentReply.match(/kb:[a-z][a-z0-9\-/]+/gi) || [];
    assert(kbRefs.length >= 1,
      `architect cites at least 1 kb: reference (found ${kbRefs.length}: ${kbRefs.slice(0, 3).join(', ')})`);

    // Stronger: the architect should have a discoverable "KB Sources Consulted" section
    const hasKbSection = /KB Sources Consulted|KB-Sources|## KB/i.test(agentReply);
    assert(hasKbSection,
      'architect response contains a discoverable KB section (e.g. "## KB Sources Consulted")');
  });
});
