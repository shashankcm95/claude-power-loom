#!/usr/bin/env node

// Contract verifier — runs functional + anti-pattern checks against an
// agent's output. Returns JSON with verdict and per-check results.
// Also calls pattern-recorder.js to feed the self-learning loop.
//
// Usage:
//   node contract-verifier.js \
//     --contract path/to/contract.json \
//     --output path/to/agent-output.md \
//     [--previous-run path/to/prior/findings/dir] \
//     [--no-record]

const fs = require('fs');
const path = require('path');
// HT.1.2 — `parseFrontmatter` consolidated to canonical helper (was 1 of 4
// inline copies post-H.8.7 chaos-H4 extraction; the inline version here
// returned `null` on no-frontmatter while canonical returns
// `{frontmatter:{}, body:text}`. Caller code at the call site updated to
// the canonical shape; semantically identical for documentary outputs.
// HT.0.9-verify code-reviewer enumerated the 4 sites.
const { parseFrontmatter } = require('./_lib/frontmatter');
// v2.8.0.x — SynthId suffix validation. Observability-only: the verifier
// emits `synthIdValidation` in its JSON output so per-verdict records
// surface persona-contract drift since the agent was spawned. NEVER fails
// the verdict — drift is a signal, not a verification failure.
// parseSynthId also imported so the recorder forward block can split a
// suffixed identity into bare-form (--identity, store-key) + full-form
// (--synthid, forensic record).
const { validateSuffix, parseSynthId } = require('./_lib/synthid');

// v2.8.0.x — plugin version reader, mirrors lifecycle-spawn.js. Falls
// back to '0.0.0' if plugin.json is unreadable (dev-without-install).
function _readPluginVersion() {
  try {
    const { findToolkitRoot } = require('./_lib/toolkit-root');
    const fp = path.join(findToolkitRoot(), '.claude-plugin', 'plugin.json');
    const pkg = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const _PLUGIN_VERSION = _readPluginVersion();

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

const args = parseArgs(process.argv.slice(2));

if (!args.contract || !args.output) {
  console.error('Usage: contract-verifier.js --contract X.json --output Y.md [--previous-run Z]');
  process.exit(1);
}

const contract = JSON.parse(fs.readFileSync(args.contract, 'utf8'));
const output = fs.readFileSync(args.output, 'utf8');

// HT.1.2 — caller simplified from `parsed ? parsed.body : output` ternary
// pattern (the inline copy returned `null` on no-frontmatter; canonical
// always returns `{frontmatter:{}, body:text}` so the ternary becomes
// straight destructuring). Semantically identical: when no frontmatter
// present, `body === text === output`; when present, `body` is the post-
// `---` trimmed text — same as the original.
const { frontmatter, body } = parseFrontmatter(output);

function countFindings(text) {
  const sections = text.match(/^##\s+(?:🔴|🟠|🟡|🔵)?\s*(CRITICAL|HIGH|MEDIUM|LOW)\b/gim) || [];
  let total = 0;
  // Capture each H3-under-H2 we COUNT so we can compute orphans below
  // (orphan = severity-shaped H3 that lives outside any H2 severity bucket).
  for (const sec of sections) {
    const after = text.slice(text.indexOf(sec) + sec.length);
    const next = after.search(/\n##\s+/);
    const segment = next === -1 ? after : after.slice(0, next);
    const items = (segment.match(/^###\s+/gm) || []).length + (segment.match(/^[*-]\s+\*\*/gm) || []).length;
    total += items;
  }
  return total;
}

// v2.9.0 Phase B.1 (FIX-I1) — orphan severity-shaped H3 detector.
// Empirical bench-run failure mode: actors wrote "### LOW-1: foo" WITHOUT
// the parent "## LOW" H2 bucket. countFindings walks only H2 buckets, so
// the orphan H3s counted as zero. F3 then failed silently with no signal
// about WHY. This detector identifies those orphans so the F3 check can
// emit a structured hint pointing at swarm/personas-contracts/_format-spec.md.
//
// "Orphan" means: a line matching `^### (CRITICAL|HIGH|MEDIUM|LOW)-\d+:`
// that does NOT sit beneath a matching `^## ... (CRITICAL|HIGH|MEDIUM|LOW)`
// H2 bucket in the document order. We compute per-severity: any H3 whose
// severity-word has zero same-severity H2 ancestors counts as orphan.
function detectOrphanSeverityH3s(text) {
  // Build a list of (offset, kind, sev) markers, then scan in order.
  const markers = [];
  const reH2 = /^##\s+(?:🔴|🟠|🟡|🔵)?\s*(CRITICAL|HIGH|MEDIUM|LOW)\b/gim;
  const reH3 = /^###\s+(CRITICAL|HIGH|MEDIUM|LOW)-\d+\b/gim;
  let m;
  while ((m = reH2.exec(text)) !== null) {
    markers.push({ offset: m.index, kind: 'h2', sev: m[1].toUpperCase() });
  }
  while ((m = reH3.exec(text)) !== null) {
    markers.push({ offset: m.index, kind: 'h3', sev: m[1].toUpperCase() });
  }
  markers.sort((a, b) => a.offset - b.offset);
  // Track which severities have an open H2 bucket as we walk. An H2 of any
  // severity closes prior open buckets (since H2s aren't nested in markdown).
  let openSev = null;
  const orphans = []; // { offset, sev }
  for (const mk of markers) {
    if (mk.kind === 'h2') {
      openSev = mk.sev;
    } else {
      // h3
      if (openSev === null || openSev !== mk.sev) {
        orphans.push({ offset: mk.offset, sev: mk.sev });
      }
    }
  }
  return orphans;
}

function countFileCitations(text) {
  // Extension length [1, 10] covers .js (2), .py (2), .swift (5), .kotlin (6),
  // .markdown (8), .dockerfile (10). Original [1, 4] silently rejected anything
  // longer than .yaml — surfaced by H.2.1 vertical slice when 06-ios-developer
  // outputs cited .swift files and the verifier reported zero citations.
  const matches = text.match(/(?:[a-zA-Z_./-]+\.[a-z]{1,10}):\d+|\*\*File\*\*:\s*\S+|`[a-zA-Z_./-]+\.[a-z]{1,10}`/g) || [];
  return matches.length;
}

// H.2.6 — extract Skill tool invocations from an actor's transcript JSONL.
// Each line is a Claude Code transcript message. We look for assistant messages
// whose content blocks include `{ type: 'tool_use', name: 'Skill', input: { skill: '<name>' } }`.
// Returns a Set of skill names invoked.
function extractSkillsFromTranscript(transcriptPath) {
  const invokedSkills = new Set();
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const content = msg && msg.message && msg.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_use' && block.name === 'Skill') {
        const skillName = block.input && block.input.skill;
        if (skillName) invokedSkills.add(skillName);
      }
    }
  }
  return invokedSkills;
}

// H.4.0 — extract KB document reads from an actor's transcript JSONL.
// H.5.2 (CS-3 hacker.kai CRIT-1) — provenance hardening:
//   The original H.4.0 implementation was a TEXT-PATTERN check on the
//   actor-controlled command string, not a PROVENANCE check on tool execution.
//   An actor could emit `echo "kb-resolver cat foo/bar"` and credit the read
//   without ever running kb-resolver. The verifier now:
//     1. Pairs every `tool_use` with its matching `tool_result` (by id)
//     2. Requires `tool_result.is_error !== true` AND non-empty content
//     3. Rejects Bash commands that contain shell-evasion shapes
//        (`echo`, `printf`, leading `#`, heredoc `<<`, comment-piped `| cat`)
//     4. Rejects result content that looks like an error (kb-resolver writes
//        "Not found: <id>" to stderr — captured by Bash tool's stderr+stdout merge)
//     5. Rejects path-traversal shapes in captured ids (`..` or leading `/`)
//   Without ALL of these, the H.4.0 closure is cosmetic per kai CRIT-1.
//
// Detected invocation shapes (each requires successful tool_result above):
//   1. Bash: `kb-resolver(.js)? cat <id>`           — bare or kb:-prefixed id
//   2. Bash: `kb-resolver(.js)? resolve kb:<id>[@<short-hash>]`
//   3. Read: file_path matching `skills/agent-team/kb/<domain>/<doc>.md`
// Returns a Set of normalized `kb:<domain>/<doc>` strings.
function extractKbReadsFromTranscript(transcriptPath) {
  const kbReads = new Set();
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);

  // Pass 1: index tool_results by tool_use_id. Claude transcripts have
  // tool_use blocks in assistant messages; the matching tool_result is in
  // the next user message's content, keyed by `tool_use_id`.
  const toolResults = new Map();
  for (const line of lines) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const content = msg && msg.message && msg.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_result' || !block.tool_use_id) continue;
      let resultText = '';
      if (typeof block.content === 'string') {
        resultText = block.content;
      } else if (Array.isArray(block.content)) {
        resultText = block.content.map((c) => (c && typeof c.text === 'string') ? c.text : '').join('');
      }
      toolResults.set(block.tool_use_id, {
        is_error: block.is_error === true,
        content: resultText,
      });
    }
  }

  // Shell-evasion patterns that would let the kb-resolver substring appear
  // in a command without actually invoking the resolver. Not exhaustive (an
  // adversary can always be more creative), but catches the obvious cases
  // kai CRIT-1 enumerated.
  const SHELL_EVASION = /\becho\b|\bprintf\b|\bcat\s*<<|^\s*#|\|\s*cat\b/;
  // Error-shape patterns in tool_result content. kb-resolver's cmdCat writes
  // "Not found: <kb_id>" to stderr on miss, which Bash tool captures.
  const RESULT_ERROR = /^Not found:|^Error:|kb-resolver: error|MODULE_NOT_FOUND/im;

  // Pass 2: scan tool_use blocks; only credit successful reads.
  for (const line of lines) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const content = msg && msg.message && msg.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use' || !block.id) continue;
      const result = toolResults.get(block.id);
      // Provenance gate: require a successful, non-empty tool_result.
      if (!result) continue;
      if (result.is_error) continue;
      if (!result.content || !result.content.trim()) continue;
      if (RESULT_ERROR.test(result.content)) continue;

      const input = block.input || {};
      if (block.name === 'Bash' && typeof input.command === 'string') {
        const cmd = input.command;
        // Reject shell-evasion shapes that let the regex match without execution.
        if (SHELL_EVASION.test(cmd)) continue;
        // `kb-resolver cat <id>` — bare id (no kb: prefix) per cmdCat signature
        for (const m of cmd.matchAll(/kb-resolver(?:\.js)?\s+cat\s+(?:kb:)?([a-zA-Z][\w./-]+)/g)) {
          const id = m[1];
          if (id.includes('..') || id.startsWith('/')) continue;
          kbReads.add('kb:' + id);
        }
        // `kb-resolver resolve kb:<id>[@<hash>]` — kb: prefixed
        for (const m of cmd.matchAll(/kb-resolver(?:\.js)?\s+resolve\s+(kb:[\w./-]+?)(?:@[a-f0-9]+)?(?=\s|$)/g)) {
          const id = m[1];
          if (id.includes('..')) continue;
          kbReads.add(id);
        }
      }
      if (block.name === 'Read' && typeof input.file_path === 'string') {
        const m = input.file_path.match(/skills\/agent-team\/kb\/([\w-]+\/[\w.-]+?)\.md$/);
        if (!m) continue;
        const id = m[1];
        if (id.includes('..')) continue;
        kbReads.add('kb:' + id);
      }
    }
  }
  return kbReads;
}

function jaccard(a, b) {
  const aw = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const bw = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let inter = 0;
  for (const w of aw) if (bw.has(w)) inter++;
  return inter / (aw.size + bw.size - inter);
}

// C-1 fix: Object.create(null) so a contract with check: "constructor" (or any
// other Object.prototype member) cannot resolve to the inherited method, which
// would otherwise return a truthy function and force-pass every check.
const functionalChecks = Object.assign(Object.create(null), {
  // H.9.7 fix (code-reviewer FLAG-1 HIGH): HT.1.2 refactor eliminated the
  // `parsed` variable in favor of `{frontmatter, body}` destructuring at
  // line 54 (parseFrontmatter always returns an object — empty when no
  // frontmatter, per `_lib/frontmatter.js` docstring). These two closures
  // retained stale `parsed` references that would throw ReferenceError
  // at runtime whenever F1/F2 fire — dormant across ALL 18 substrate
  // contracts (every contract declares F1+F2 required:true). ESLint v9
  // no-undef caught at H.9.7 baseline; ADR-0006 invariant 1 fix.
  outputContainsFrontmatter: () => Object.keys(frontmatter).length > 0,
  frontmatterHasFields: (cArgs) => {
    if (Object.keys(frontmatter).length === 0) return false;
    return cArgs.fields.every((f) => frontmatter[f] !== undefined);
  },
  // v2.9.0 Phase B.1 (FIX-I1) — when F3 fails AND orphan severity-shaped H3s
  // are detected, emit a structured hint pointing at _format-spec.md so the
  // actor understands the failure mode without re-reading the spec wholesale.
  // Back-compat: pass case returns plain `true` (bool path; existing wiring).
  minFindings: (cArgs) => {
    const count = countFindings(body);
    if (count >= cArgs.min) return true;
    const orphans = detectOrphanSeverityH3s(body);
    if (orphans.length > 0) {
      const sevList = Array.from(new Set(orphans.map((o) => o.sev))).join(', ');
      const hint = `${orphans.length} H3 finding(s) found WITHOUT a parent "## <SEVERITY>" H2 bucket ` +
        `(orphan severities: ${sevList}). ` +
        'See `swarm/personas-contracts/_format-spec.md` §"Findings format". ' +
        'Add a `## ' + (orphans[0].sev) + '` line above each `### ' + (orphans[0].sev) + '-N:` group.';
      return { pass: false, hint, findingsCount: count, orphanH3s: orphans.length };
    }
    return { pass: false, findingsCount: count };
  },
  hasFileCitations: (cArgs) => countFileCitations(body) >= cArgs.min,
  // H-1 fix: .every — a contract listing all four severities must require all four,
  // not any one. Spec lives in contract-format.md.
  hasSeveritySections: (cArgs) => cArgs.severities.every((s) => new RegExp(`##\\s+(?:🔴|🟠|🟡|🔵)?\\s*${s}\\b`, 'i').test(body)),
  outputLengthMin: (cArgs) => body.length >= cArgs.min,
  outputLengthMax: (cArgs) => body.length <= cArgs.max,
  containsKeywords: (cArgs) => cArgs.keywords.every((k) => body.toLowerCase().includes(k.toLowerCase())),
  // H.2.7 — structural code-review checks (the third leg of the "triple
  // contract" defense from SKILL.md; closes the documentation-debt flag).
  // Operate on code blocks (```...```) embedded in actor findings — builder
  // personas write code as part of fix recommendations; pattern checks catch
  // the 1000-zeros family (functionally-correct output produced by an
  // architecturally-wrong approach).
  noUnrolledLoops: (cArgs) => {
    const codeBlocks = body.match(/```[\s\S]*?```/g) || [];
    const threshold = (cArgs && cArgs.maxRepetitions) || 5;
    // v2.9.0 Phase B.3 (FIX-I6) — min-line-length bumped from 3 to 20.
    // Empirical bug surface: bench/control-runs across v2.8.3 + v2.8.5
    // showed false-positives on:
    //   (a) 6+ stacked `});` closers in nested-handler code (H.2.7 caught
    //       a 6-closer case at threshold 3; widening the gap defends in depth)
    //   (b) ORM schema files with many short-line columns (Drizzle / Prisma)
    //   (c) TypeScript import manifests with identical-shape lines
    // Bump to 20 chars keeps the 1000-zeros / fizzbuzz family (where actual
    // pathological lines easily clear 20 chars) while removing the false
    // positive surface from short syntactic lines.
    const MIN_LINE_LENGTH = 20;
    for (const block of codeBlocks) {
      const lines = block.split('\n').slice(1, -1).map((l) => l.trim()).filter((l) => l.length >= MIN_LINE_LENGTH);
      if (lines.length < threshold) continue;
      const counts = Object.create(null);
      for (const line of lines) {
        counts[line] = (counts[line] || 0) + 1;
        if (counts[line] >= threshold) {
          return {
            pass: false,
            reason: 'unrolled_loop_detected',
            repeatedLine: line.length > 80 ? line.slice(0, 80) + '...' : line,
            repetitionCount: counts[line],
            threshold,
          };
        }
      }
    }
    return { pass: true, codeBlocksScanned: codeBlocks.length };
  },
  // Brace-counting nesting check. Limitation: C-family languages only
  // (Python uses indentation; not currently inspected). Documented in spec.
  noExcessiveNesting: (cArgs) => {
    const codeBlocks = body.match(/```[\s\S]*?```/g) || [];
    const maxDepth = (cArgs && cArgs.maxDepth) || 4;
    let worstDepth = 0;
    let worstBlock = null;
    for (const block of codeBlocks) {
      let depth = 0;
      let blockMax = 0;
      // Strip strings + comments (very rough — covers most cases) so braces
      // inside strings don't inflate depth.
      const stripped = block
        .replace(/```\w*\n/, '')
        .replace(/\n```$/, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      for (const ch of stripped) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        if (depth > blockMax) blockMax = depth;
      }
      if (blockMax > worstDepth) {
        worstDepth = blockMax;
        worstBlock = block.slice(0, 120) + (block.length > 120 ? '...' : '');
      }
    }
    return {
      pass: worstDepth <= maxDepth,
      maxObservedDepth: worstDepth,
      threshold: maxDepth,
      ...(worstDepth > maxDepth ? { sample: worstBlock } : {}),
    };
  },
  // For challenger contracts (asymmetric-challenger pattern). Counts
  // ### CHALLENGE-N headings; each represents a substantive disagreement
  // with the implementer's output. Functional check (must produce ≥N
  // challenges).
  noEmptyChallengeSection: (cArgs) => {
    const challenges = body.match(/^###\s+CHALLENGE-?\d+/gim) || [];
    const minChallenges = (cArgs && cArgs.min) || 1;
    return challenges.length >= minChallenges;
  },
  // H.2.6 — verify the actor invoked the required skills from its contract.
  // Source preference: --transcript (truth from JSONL) > --skills (manual
  // passthrough). When neither is supplied, returns pass=true with reason —
  // mirrors noTextSimilarityToPriorRun's "no source available" semantics.
  // Skills with skill_status: 'not-yet-authored' are skipped (promise mode —
  // bootstrap path applies; verifying invocation pre-bootstrap is meaningless).
  invokesRequiredSkills: (cArgs) => {
    const transcriptPath = (cArgs && cArgs.transcriptPath) || args.transcript;
    let invokedSkills;
    let source;
    if (transcriptPath) {
      if (!fs.existsSync(transcriptPath)) {
        return { pass: false, reason: 'transcript_not_found', path: transcriptPath };
      }
      invokedSkills = extractSkillsFromTranscript(transcriptPath);
      source = 'transcript';
    } else if (args.skills) {
      invokedSkills = new Set(args.skills.split(',').map((s) => s.trim()).filter(Boolean));
      source = 'cli-flag';
    } else {
      return { pass: true, reason: 'no_skills_source_supplied', source: 'none' };
    }
    const required = (contract.skills && contract.skills.required) || [];
    const skillStatus = (contract.skills && contract.skills.skill_status) || {};
    const missing = [];
    const skipped = [];
    for (const skill of required) {
      if (skillStatus[skill] === 'not-yet-authored') { skipped.push(skill); continue; }
      if (!invokedSkills.has(skill)) missing.push(skill);
    }
    return {
      pass: missing.length === 0,
      source,
      invokedSkills: Array.from(invokedSkills),
      missingRequired: missing,
      skippedPromiseMode: skipped,
      requiredCount: required.length,
    };
  },
  // H.4.0 — verify the actor read every KB doc declared in contract.kb_scope.default.
  // Closes the long-standing CS-1 + CS-2 architect finding "kb_scope is loaded into
  // spawn-time prompts but never enforced at verify-time", same shape as the H.2.6
  // invokesRequiredSkills precedent. Source preference: --transcript (truth from
  // JSONL) ONLY — there's no manual --kb-reads CLI fallback because the goal of this
  // check is to prevent self-reporting drift. Graceful pass when no transcript is
  // supplied (mirrors invokesRequiredSkills semantics) so spawn-time invocations
  // continue to work; enforcement triggers only when a transcript is fed in.
  kb_scope_consumed: (cArgs) => {
    const transcriptPath = (cArgs && cArgs.transcriptPath) || args.transcript;
    const kbScope = (contract.kb_scope && contract.kb_scope.default) || [];
    if (kbScope.length === 0) {
      return { pass: true, reason: 'no_kb_scope_declared', source: 'none' };
    }
    if (!transcriptPath) {
      return { pass: true, reason: 'no_transcript_supplied', source: 'none', declared: kbScope.length };
    }
    if (!fs.existsSync(transcriptPath)) {
      return { pass: false, reason: 'transcript_not_found', path: transcriptPath };
    }
    const kbReads = extractKbReadsFromTranscript(transcriptPath);
    const missing = kbScope.filter((id) => !kbReads.has(id));
    return {
      pass: missing.length === 0,
      source: 'transcript',
      declared: kbScope.length,
      consumed: kbScope.length - missing.length,
      kbReadsObserved: Array.from(kbReads),
      missingKbScope: missing,
    };
  },
});

const antiPatternChecks = Object.assign(Object.create(null), {
  noTextSimilarityToPriorRun: (cArgs) => {
    const priorDir = cArgs.priorRunDir || args['previous-run'];
    if (!priorDir || !fs.existsSync(priorDir)) return { pass: true, reason: 'no_prior_run' };
    const priorFiles = fs.readdirSync(priorDir).filter((f) => f.endsWith('.md'));
    let maxSim = 0;
    for (const pf of priorFiles) {
      const priorText = fs.readFileSync(path.join(priorDir, pf), 'utf8');
      const sim = jaccard(body, priorText);
      if (sim > maxSim) maxSim = sim;
    }
    return { pass: maxSim < (cArgs.threshold || 0.7), similarity: maxSim };
  },
  noTemplateRepetition: (cArgs) => {
    // \Z is not a JS regex metacharacter — with /i it matched lowercase 'z' in finding bodies.
    // Use $(?![\s\S]) — true end-of-string regardless of /m flag.
    const findings = (body.match(/^###\s+[^\n]+\n[\s\S]*?(?=^###|$(?![\s\S]))/gm) || []);
    if (findings.length < 2) return { pass: true, reason: 'too_few_findings' };
    const similarities = [];
    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        similarities.push(jaccard(findings[i], findings[j]));
      }
    }
    const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    const variation = 1 - avgSim;
    return { pass: variation >= (cArgs.minVariation || 0.3), variation };
  },
  claimsHaveEvidence: (cArgs) => {
    const markers = (cArgs && cArgs.markers) || ['file:line', 'verified by', 'lines '];
    // \Z fix: same as noTemplateRepetition above. The /i flag previously made \Z match lowercase z,
    // truncating sections like "## CRITICAL\n### C-1: Prototype pollution via unsani[zed...]" before
    // the file:line evidence could be scanned.
    const seriousSections = body.match(/##\s+(?:🔴|🟠)?\s*(CRITICAL|HIGH)\b[\s\S]*?(?=^##\s|$(?![\s\S]))/gim) || [];
    if (seriousSections.length === 0) return { pass: true, reason: 'no_serious_findings' };
    for (const section of seriousSections) {
      // Empty/none sections (e.g., "None this run") are valid — no claims means nothing to evidence
      const sectionBody = section.replace(/^##\s+[^\n]*\n/, '').trim();
      if (sectionBody.length < 100 && /\bnone\b/i.test(sectionBody)) continue;
      // Sections with no actual findings (no ###  or - **) don't need evidence
      const hasFindings = /^###\s+/m.test(section) || /^[*-]\s+\*\*/m.test(section);
      if (!hasFindings) continue;
      const hasEvidence = markers.some((m) => section.toLowerCase().includes(m.toLowerCase())) ||
                         /\.[a-z]{1,10}:\d+/i.test(section) ||
                         /`[a-zA-Z_./-]+\.[a-z]{1,10}`/.test(section) ||
                         /lines?\s+\d+/i.test(section);
      if (!hasEvidence) return { pass: false, reason: 'serious_finding_without_evidence', sample: section.slice(0, 200) };
    }
    return { pass: true };
  },
  noPaddingPhrases: (cArgs) => {
    const phrases = (cArgs && cArgs.phrases) || ['I reviewed everything', 'looks good overall', 'all is well', 'nothing to report'];
    for (const phrase of phrases) {
      if (body.toLowerCase().includes(phrase.toLowerCase())) return { pass: false, foundPhrase: phrase };
    }
    return { pass: true };
  },
  // HT.1.1 — implements the H.8.6 RPI documentary-discipline check.
  // Documentary personas (14-codebase-locator, 15-codebase-analyzer,
  // 16-codebase-pattern-finder) declare this antiPattern as A4 with
  // severity: warn. Until HT.1.1 the check name was unimplemented, so
  // contract-verifier's H.3.6 dispatch path returned `unknown_check`,
  // incrementing antiPatternWarns and locking documentary actor verdicts
  // at `partial` (line 552-555 verdict logic; warns > 0 → not `pass`).
  // Post-HT.1.1: clean documentary output → A4 pass → verdict can reach
  // `pass`. Output containing forbidden phrases → A4 warn → verdict
  // stays `partial`.
  //
  // Field naming: contracts declare `forbidden_phrases` (snake_case) per
  // existing 14/15/16 contract authoring; we accept `forbiddenPhrases`
  // (camelCase) defensively for forward compatibility. Default phrase
  // list is the union most commonly used across the 3 contracts.
  //
  // Substring case-insensitive match — mirrors `noPaddingPhrases`
  // convention above. Contract authors choose phrases unlikely to false-
  // positive in documentary output; tighten phrases in the contract
  // (NOT in code) if FP rate proves high in practice. Drift-note 60
  // tracks the 4-sub-decision intersection that motivated this check.
  noCritiqueLanguage: (cArgs) => {
    const phrases = (cArgs && (cArgs.forbidden_phrases || cArgs.forbiddenPhrases)) || [
      'should be', 'could be improved', 'recommend', 'we should',
      'consider', 'fix this', 'this is wrong', 'this is buggy',
      'needs refactoring', 'anti-pattern', 'smell', 'better approach',
    ];
    for (const phrase of phrases) {
      if (body.toLowerCase().includes(phrase.toLowerCase())) {
        return { pass: false, foundPhrase: phrase };
      }
    }
    return { pass: true };
  },
  acknowledgesFallback: () => {
    const constraintMentions = /\b(blocked|unavailable|denied|not\s+available|sandboxed)\b/i.test(body);
    if (!constraintMentions) return { pass: true, reason: 'no_constraints_encountered' };
    const acknowledgments = /\b(fell\s+back|instead\s+I|since\s+\w+\s+(?:was|is)\s+(?:unavailable|blocked)|methodology\s+note)\b/i.test(body);
    return { pass: acknowledgments, hadConstraints: true };
  },
  noDuplicateFindingIds: () => {
    const ids = (body.match(/^###\s+([A-Z]+-?\d+)/gm) || []).map((m) => m.replace(/^###\s+/, ''));
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) return { pass: false, duplicateId: id };
      seen.add(id);
    }
    return { pass: true };
  },
});

const result = {
  agentId: contract.agentId,
  persona: contract.persona,
  contractFile: args.contract,
  outputFile: args.output,
  ranAt: new Date().toISOString(),
  functional: {},
  antiPattern: {},
};

let functionalFailures = 0;
let antiPatternFailures = 0;
let antiPatternWarns = 0;

// H.2.4 — trust-tiered verification: --skip-checks lets the orchestrator
// skip expensive checks for high-trust identities. Skip set matches by
// EITHER check.id (e.g., "F4", "A2") OR check.check name (e.g.,
// "noTextSimilarityToPriorRun"). Skipped checks record status='skipped'
// (not pass/fail) so the audit trail remains explicit.
//
// H.3.1 fix (CS-1 hacker.zoe CRIT-2): a contract can opt OUT of being skipped
// via `mustNotSkip: true`. Without this, --skip-checks is a backdoor — any
// caller can skip every required check including security-critical ones.
// Default behavior (mustNotSkip absent) = skippable, preserving backwards
// compat with existing contracts.
const skipSet = new Set(
  (args['skip-checks'] || '').split(',').map((s) => s.trim()).filter(Boolean)
);
function shouldSkip(check) {
  if (check.mustNotSkip) return false;
  return skipSet.has(check.id) || skipSet.has(check.check);
}

for (const check of contract.functional || []) {
  if (shouldSkip(check)) {
    result.functional[check.id] = { check: check.check, status: 'skipped', reason: 'tier-policy' };
    continue;
  }
  const fn = functionalChecks[check.check];
  if (!fn) {
    // H.3.1 fix (CS-1 hacker.zoe CRIT-1, BACKLOG since H.2-bridge):
    // unknown_check on a REQUIRED check should fail, not silently pass.
    // Without this, a contract with all-invented check names verdicts as pass.
    result.functional[check.id] = { check: check.check, status: 'unknown_check' };
    if (check.required !== false) functionalFailures++;
    continue;
  }
  try {
    // H.2.6 — functional checks now support BOTH bool and rich {pass, ...meta}
    // returns, mirroring antiPattern checks. Backwards-compatible: existing
    // bool-returning checks continue to work; new rich checks (e.g.,
    // invokesRequiredSkills) carry per-check metadata into the result.
    const ret = fn(check.args || {});
    const passed = typeof ret === 'object' && ret !== null ? ret.pass : ret;
    result.functional[check.id] = {
      check: check.check,
      status: passed ? 'pass' : 'fail',
      ...(typeof ret === 'object' && ret !== null ? { ...ret, pass: undefined } : {}),
    };
    if (!passed && check.required !== false) functionalFailures++;
  } catch (err) {
    result.functional[check.id] = { check: check.check, status: 'error', error: err.message };
    if (check.required !== false) functionalFailures++;
  }
}

for (const check of contract.antiPattern || []) {
  if (shouldSkip(check)) {
    result.antiPattern[check.id] = { check: check.check, status: 'skipped', reason: 'tier-policy' };
    continue;
  }
  const fn = antiPatternChecks[check.check];
  if (!fn) {
    // H.3.6 (CS-2 architect.mira HIGH): symmetrize H.3.1's functional-path
    // unknown_check fix to the antiPattern dispatch. Without this, an
    // antiPattern referencing a non-existent check name silently passes —
    // identical bypass mechanism to the H.3.1 CRIT-1 just on a different loop.
    // Severity convention matches the per-check failure path below: 'fail'
    // increments antiPatternFailures; everything else (default 'warn')
    // increments antiPatternWarns.
    result.antiPattern[check.id] = { check: check.check, status: 'unknown_check' };
    if (check.severity === 'fail') antiPatternFailures++;
    else antiPatternWarns++;
    continue;
  }
  try {
    const ret = fn(check.args || {});
    const passed = typeof ret === 'object' ? ret.pass : ret;
    result.antiPattern[check.id] = {
      check: check.check,
      status: passed ? 'pass' : (check.severity === 'fail' ? 'fail' : 'warn'),
      ...(typeof ret === 'object' ? { ...ret, pass: undefined } : {}),
    };
    if (!passed) {
      if (check.severity === 'fail') antiPatternFailures++;
      else antiPatternWarns++;
    }
  } catch (err) {
    result.antiPattern[check.id] = { check: check.check, status: 'error', error: err.message };
  }
}

let verdict;
if (functionalFailures === 0 && antiPatternFailures === 0 && antiPatternWarns === 0) verdict = 'pass';
else if (functionalFailures === 0 && antiPatternFailures === 0) verdict = 'partial';
else verdict = 'fail';

result.verdict = verdict;
// H.7.0-prep — tokens_used in summary. Sum input + output + cache_creation +
// cache_read across all assistant messages in the transcript (mirrors the
// budget-tracker's record-from-transcript shape from H.2.8). Null when no
// transcript was supplied — backwards-compat. This is the load-bearing input
// for the findings-per-10K-tokens quality factor.
let tokensUsed = null;
if (args.transcript && fs.existsSync(args.transcript)) {
  try {
    const transcriptLines = fs.readFileSync(args.transcript, 'utf8').split('\n').filter(Boolean);
    let totalIn = 0, totalOut = 0, totalCacheCreate = 0, totalCacheRead = 0;
    for (const line of transcriptLines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const usage = entry?.message?.usage;
      if (usage && typeof usage === 'object') {
        if (typeof usage.input_tokens === 'number') totalIn += usage.input_tokens;
        if (typeof usage.output_tokens === 'number') totalOut += usage.output_tokens;
        if (typeof usage.cache_creation_input_tokens === 'number') totalCacheCreate += usage.cache_creation_input_tokens;
        if (typeof usage.cache_read_input_tokens === 'number') totalCacheRead += usage.cache_read_input_tokens;
      }
    }
    tokensUsed = totalIn + totalOut + totalCacheCreate + totalCacheRead;
  } catch { tokensUsed = null; /* best-effort; never fail the verdict on token-extraction issues */ }
}
result.summary = {
  functionalFailures,
  antiPatternFailures,
  antiPatternWarns,
  findingsCount: countFindings(body),
  fileCitations: countFileCitations(body),
  tokensUsed,  // H.7.0-prep — null when no transcript supplied
};
result.recommendation = verdict === 'pass' ? 'accept'
  : verdict === 'partial' ? 'accept-with-warning'
  : 'retry-with-tighter-prompt';

// v2.8.0.x — identity hoisted to module scope so the synthid validation
// (below) AND the recorder block (further down) both reference the same
// resolved value. Frontmatter takes precedence over CLI flag — frontmatter
// is set at spawn-time per chaos-test flow; CLI flag is an override.
//
// v2.9.0 Phase B.2 (FIX-I2) — precedence + recovery:
//   (1) frontmatter.identity wins when present (set by actor per
//       skills/agent-team/kb/hets/spawn-conventions.md §"YAML quoting
//       requirement"). CLI args.identity is an override path for ad-hoc
//       verifier calls (manual debugging; non-spawn flow).
//   (2) Null-fallback: when frontmatter.identity decodes to null AND the
//       raw frontmatter text DOES have an `identity:` line, fall back to
//       `_extractIdentityFromRaw` (bypasses YAML semantics — catches the
//       unquoted-`~` case from spec-compliant parsers).
//   (3) Drift-note: when frontmatter.identity AND args.identity are BOTH
//       set AND they DIFFER, log a drift-note to stderr (observability;
//       does NOT alter the verdict — caller wins per (1)).
let _resolvedIdentity = frontmatter.identity || args.identity || null;
if (_resolvedIdentity === null && typeof output === 'string') {
  try {
    const { _extractIdentityFromRaw } = require('./_lib/frontmatter');
    const recovered = _extractIdentityFromRaw(output);
    if (recovered) {
      _resolvedIdentity = recovered;
      process.stderr.write(`[contract-verifier] drift-note: identity recovered via raw-fallback (FIX-I2) — frontmatter parsed as null; raw extraction yielded "${recovered}"\n`);
    }
  } catch { /* fallback is best-effort */ }
}
if (frontmatter.identity && args.identity && frontmatter.identity !== args.identity) {
  process.stderr.write(`[contract-verifier] drift-note: identity-mismatch — frontmatter="${frontmatter.identity}" vs CLI --identity="${args.identity}" (frontmatter wins; FIX-I2 precedence)\n`);
}

// v2.8.0.x — SynthId suffix validation. Computes the expected hash from
// the current contract and compares to the suffix embedded in the
// identity. Observability ONLY: status === 'mismatch' emits a warning
// string in the result JSON but does NOT alter `verdict` or
// `result.summary.*Failures` — drift is a signal for callers
// (verification-policy.js's priority-2.5 trigger consumes it).
// agentMd wired through post-pair-run MEDIUM-1: persona .md changes now
// participate in drift detection. Best-effort read — falls back to null.
const _agentMd = (() => {
  try {
    const { _readPersonaMd } = require('./identity/lifecycle-spawn');
    return _readPersonaMd(contract.persona);
  } catch { return null; }
})();
result.synthIdValidation = validateSuffix({
  identity: _resolvedIdentity,
  contract,
  agentMd: _agentMd,
  pluginVersion: _PLUGIN_VERSION,
});

console.log(JSON.stringify(result, null, 2));

// Self-learning hook
if (!args['no-record']) {
  try {
    const recorderPath = path.join(__dirname, 'pattern-recorder.js');
    if (fs.existsSync(recorderPath)) {
      // v2.8.0.x — identity now hoisted to module scope above; reuse it
      // here instead of re-resolving (was: `frontmatter.identity || args.identity || null`).
      const identity = _resolvedIdentity;
      // Skills actually invoked. v1: not derived from transcript yet — caller
      // can pass --skills s1,s2 if known; future H.2 work pulls from JSONL.
      const skills = args.skills || null;
      const recorderArgs = [
        recorderPath, 'record',
        '--task-signature', `${contract.persona || 'unknown'}:${contract.agentId}`,
        '--agent-role', frontmatter.role || contract.role || 'actor',
        '--persona', contract.persona || 'unknown',
        '--verdict', verdict,
        '--findings-count', String(result.summary.findingsCount),
      ];
      if (identity) {
        // v2.8.0.x — split suffixed identity into bare + full forms.
        // Bare form (persona.name) becomes the --identity arg so the
        // recorder + downstream agent-identity.js forwarder use the
        // existing store-key shape. Full form (persona.name~hash) is
        // passed separately via --synthid for forensic record.
        // Bare identities (no suffix) pass through unchanged with no
        // --synthid arg (null in the recorded entry).
        const parsedIdentity = parseSynthId(identity);
        if (parsedIdentity && parsedIdentity.contentHash) {
          recorderArgs.push('--identity', `${parsedIdentity.persona}.${parsedIdentity.name}`);
          recorderArgs.push('--synthid', identity);
        } else {
          recorderArgs.push('--identity', identity);
        }
      }
      if (skills) recorderArgs.push('--skills', skills);
      // Use spawn (not spawnSync) so the recorder's lock-acquisition wait does NOT
      // block the verifier's exit — recorder is best-effort by design (see comment
      // at the catch below). Mitigates the H-3 spin-wait CPU saturation surfaced by
      // the chaos-20260502-060039 review.
      const { spawn } = require('child_process');
      const proc = spawn(process.execPath, recorderArgs, { stdio: 'ignore', detached: true });
      proc.unref();
    }
  } catch { /* recorder is optional */ }
}

process.exit(verdict === 'fail' ? 1 : 0);
