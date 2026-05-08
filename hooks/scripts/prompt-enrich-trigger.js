#!/usr/bin/env node

// UserPromptSubmit hook: detects vague prompts and injects a forcing
// instruction that makes the prompt-enrichment skill impossible to skip.
//
// Architecture:
//   - Heuristic vagueness detection runs on every prompt
//   - Clear prompts: silent pass-through, zero overhead
//   - Vague prompts: inject additional context that forces 4-part enrichment
//   - Always evaluates — does NOT skip based on conversation continuity
//
// Detection is intentionally conservative: better to miss some vague prompts
// than to over-flag every clear instruction.
//
// Forcing-instruction class: 1 (advisory) — emits [PROMPT-ENRICHMENT-GATE]
// with `tier:` discriminator (`tier: short-confirm` or `tier: full-enrichment`).
// H.7.26 consolidated [CONFIRMATION-UNCERTAIN] into [PROMPT-ENRICHMENT-GATE]
// per drift-note 57 (closes performative differentiation between same-hook
// same-layer same-semantic markers). Per Convention G (skills/agent-team/
// patterns/validator-conventions.md). Catalog: skills/agent-team/patterns/
// forcing-instruction-family.md.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log: makeLogger } = require('./_log.js');
const log = makeLogger('prompt-enrich-trigger');

// Vague action verbs followed by generic referents.
// Phase-G7: extended referent group `REF` to include plural quantifiers
// (those, these, all, any, every, everything, things, stuff). Centralizes
// the pattern so all verbs benefit from the same set.
const REF = '(?:the|this|that|it|some|a|those|these|all|any|every|everything|things|stuff)';

const VAGUE_KEYWORDS = [
  new RegExp(`\\bfix\\s+${REF}\\b`, 'i'),                // "fix all the bugs"
  new RegExp(`\\bfix\\s+all\\s+(?:the\\s+)?\\w+s?\\b`, 'i'),  // "fix all the bugs"
  /\bmake\s+(?:it|this|that)\s+(?:better|faster|cleaner|nicer|work)/i,
  new RegExp(`\\bimprove\\s+${REF}\\b`, 'i'),
  new RegExp(`\\boptimi[sz]e\\s+${REF}\\b`, 'i'),
  new RegExp(`\\bupdate\\s+${REF}\\b`, 'i'),
  /\bclean\s+(?:up|this|that|it)\b/i,
  /\brefactor\s+(?:the|this|that|it)(?!\s+\S+\.\w+)/i,
  /\bdo\s+(?:something|the\s+thing|stuff)\b/i,
  new RegExp(`\\bhandle\\s+${REF}\\b`, 'i'),
  /\bsort\s+(?:the|this|that|it|things?)\s+out\b/i,
  new RegExp(`\\bcheck\\s+${REF}\\b`, 'i'),
  new RegExp(`\\breview\\s+${REF}\\b`, 'i'),
  new RegExp(`\\bship\\s+${REF}\\b`, 'i'),
  new RegExp(`\\btweak\\s+${REF}\\b`, 'i'),
  new RegExp(`\\brework\\s+${REF}\\b`, 'i'),
  new RegExp(`\\bredo\\s+${REF}\\b`, 'i'),
  new RegExp(`\\bdeal\\s+with\\s+${REF}\\b`, 'i'),
  new RegExp(`\\baddress\\s+${REF}\\b`, 'i'),
  new RegExp(`\\blook\\s+into\\s+${REF}\\b`, 'i'),
  /\bsmooth\s+(?:this|that|it|things?)\s+out\b/i,
  new RegExp(`\\bpolish\\s+${REF}\\b`, 'i'),
  /\btidy\s+(?:up|this|that|it|things?)\b/i,
  /\bthe\s+thing\b/i,
  /\bsome\s+(?:things|stuff|changes)\b/i,
  /\btak(?:e|ing|en)\s+a\s+(?:quick\s+)?look\b/i,
  /\bhav(?:e|ing)\s+a\s+(?:quick\s+)?look\b/i,
];

// Verb-less observation patterns ("X broken on main", "users can't log in")
// — these are bug reports without an action ask. They satisfy length checks
// but are still vague because they don't say what to do.
// Phase-G7 additions: symptom reports without prepositions
// ("the page is white", "tests are red", "memory usage spiking").
const OBSERVATION_PATTERNS = [
  /\b(broken|failing|down|red|hanging|stuck|slow|crashing)\s+(on|in|at)\s+\w+/i,
  /\bcan'?t\s+(log\s+in|sign\s+in|connect|access|reach|see|find)\b/i,
  /\bis\s+(broken|failing|down|red|stuck|hanging|crashing|spiking|wrong|off|weird)\b/i,
  /\bare\s+(broken|failing|down|red|stuck|hanging|crashing|spiking|wrong|off|weird)\b/i,
  /\bhas\s+a\s+(bug|deadlock|race|leak|issue|problem)\b/i,
  /\b(memory|cpu|disk|network|latency)\s+(usage|use)\s+(spiking|climbing|growing|leaking)\b/i,
  /\bsomething\s+(is\s+)?(wrong|off|broken|weird)\b/i,
];

const SKIP_PATTERNS = [
  // H.7.24 — drift-note 52: single-char `?` interjections (and `??`, `???`)
  // are conversation-continuation queries that need full context to interpret;
  // deterministic enrichment can't help. Per H.7.24 plan code-reviewer FAIL #3,
  // narrowed from over-inclusive `^\s*[?!.]+\s*$` to `?`-only — single `.`,
  // `!`, `...`, `?!` etc. may be legitimate prompts and stay subject to the
  // length-based catch-all.
  /^\s*\?+\s*$/,
  // Slash commands
  /^\s*\//,
  // Confirmation responses (Phase-C: extended with combinations and common phrases)
  /^\s*(yes|yep|yeah|y|sure|ok|okay|approve|approved|confirm|confirmed|go|go ahead|proceed|continue|do it|please)\s*[.!?]?\s*$/i,
  /^\s*(please\s+)?(proceed|continue|go ahead|do it|carry on|carry on then)\s*[.!?]?\s*$/i,
  /^\s*(sounds?\s+good|looks?\s+good|lgtm|nice|perfect|great|thanks|thank\s+you|ty)\s*[.!?]?\s*$/i,
  /^\s*(no|nope|n|cancel|stop|skip|pass|nvm|never\s*mind)\s*[.!?]?\s*$/i,
  // H.4.3: confirmation + brief continuation. Affirmation possibly followed by
  // a confirmation-shape action phrase. Capped to confirmation-shape
  // continuations so "yes the thing is broken" still reaches enrichment.
  // Trailing tokens (now/please/if you can) accepted.
  /^\s*(yes|yep|yeah|yup|sure|ok|okay|absolutely|of course|definitely|cool|nice|perfect|great|awesome|alright|got it)[\s,.!]*((let'?s\s+)?(go|do|ship|proceed|continue|carry)\s*(for it|ahead|on|it|this|that|the thing|with (it|this|that|[a-z]+))?)?(\s+(now|please|if you can))?\s*[.!?]?\s*$/i,
  // H.4.3: standalone action-word confirmations (no leading affirmation).
  // "go for it", "let's ship it", "make it so", "let's go with b".
  /^\s*(go for it|do (it|that|this|the thing)|ship it|let'?s\s+(go|ship|do (it|this|that|the thing)|go with (it|this|that|[a-z]+)|ship it)|make it so|carry on(?:\s+then)?|that works|works for me)(\s+(now|please|if you can))?\s*[.!?]?\s*$/i,
  // Numeric / option selection: "1", "option 1", "(a)", "1.", "a.", etc.
  /^\s*\(?[a-z0-9]\)?\s*[.!?]?\s*$/i,
  /^\s*option\s+\(?\w\)?\s*[.!?]?\s*$/i,
  // Wh-questions
  /^\s*(what|how|where|why|when|who|which)\s/i,
  // Aux-verb questions: subject pronoun OR article (e.g., "is the file ready")
  // Note: "do" is excluded — "do the X" is imperative, not a question
  /^\s*(is|are|was|were|will|should|may|might|must|has|have|had|does|did)\s+(you|i|we|they|it|he|she|the|this|that|these|those|there|a|an)\b/i,
  // "do" as question prefix: only when followed by a subject pronoun (not article)
  /^\s*do\s+(you|i|we|they|it|he|she|there)\b/i,
  // Direct verb-first commands
  /^\s*(run|execute|test|build|deploy|commit|push|pull|merge|rebase|stash|install|undo|revert)\s/i,
  // Tool-prefixed commands (git push, npm install, etc.)
  // Phase-C: tightened — "node fix it" should NOT skip. The matched word
  // after the tool name must look like a sub-command (lowercase, ASCII).
  /^\s*(git|npm|yarn|pnpm|bun|cargo|python|deno|docker|kubectl|make|cmake|gradle|mvn|dotnet|rustc|tsc|eslint|prettier)\s+(install|run|test|build|push|pull|exec|status|log|init|add|remove|update|start|stop|fmt|check|publish|version|completion)\b/i,
  // Show/explain (informational)
  /^\s*(show|explain|describe|list|tell|display)\s/i,
];

// Phase-C: aux-verb question prefixes that should NOT auto-skip if the body
// contains a vague keyword. ("could you fix the auth" → still flag.)
const POLITENESS_PREFIXES = [
  /^\s*(?:hey\s+)?(?:could|would|can|will)\s+you\s+(?:please\s+)?(?:if\s+(?:its|it'?s)\s+not\s+too\s+much\s+trouble\s+)?/i,
  /^\s*(?:would|could)\s+you\s+mind\s+/i,
  /^\s*(?:please\s+)/i,
  /^\s*(?:hey\s+|hi\s+|sorry\s+)/i,
];

/**
 * Iteratively strip leading politeness phrases from a prompt. Caps at 3
 * passes to handle stacked politeness ("hey could you please ..."). Used
 * by `isVague` to check whether an underneath-the-padding prompt is
 * still vague (e.g., "would you mind fixing the auth" → "fixing the
 * auth" → still vague verb-only).
 *
 * @param {string} prompt User prompt
 * @returns {string} Prompt with leading politeness phrases removed and trimmed
 */
function stripPolitenessPadding(prompt) {
  let stripped = prompt;
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const pattern of POLITENESS_PREFIXES) {
      const newStripped = stripped.replace(pattern, '');
      if (newStripped !== stripped) {
        stripped = newStripped;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return stripped.trim();
}

/**
 * Detect whether the prompt contains a file path or recognizable
 * project-structure path. URLs are stripped first (Phase-G hardening:
 * "https://example.com" was previously matching `/example.com` and
 * bypassing the vagueness gate). Recognizes:
 * - Multi-segment Unix paths (`/foo/bar`)
 * - Files with extensions (`/foo.ts`, `bar.js`)
 * - Common project dirs (`src/`, `app/`, `tests/`, etc.)
 *
 * @param {string} prompt User prompt (URLs will be stripped before matching)
 * @returns {boolean} true if a path-like signal is detected
 */
function hasFilePath(prompt) {
  // Phase-G: strip URLs FIRST before checking for paths. Otherwise
  // "https://example.com" matches hasFilePath via /example.com and
  // bypasses the vagueness gate.
  const noUrls = prompt.replace(/https?:\/\/[^\s]+/gi, '');
  return /(?:\/[\w.-]+){2,}/.test(noUrls) ||
         /\/[\w.-]+\.\w{1,10}\b/.test(noUrls) ||
         /\b\w+\.(ts|tsx|js|jsx|py|rs|go|rb|md|json|yaml|yml|toml|sh|sql|css|scss|html|vue|svelte|tf|hcl|proto)\b/i.test(noUrls) ||
         /\b(src|app|lib|components?|pages?|api|tests?|hooks?|utils?|services?|controllers?|models?)\/\w+/i.test(noUrls);
}

/**
 * Detect substantive specificity signals in the prompt. Phase-G8 tightened
 * version — URLs alone, lone-token camelCase ("fixIt"), and fenced code
 * blocks no longer count (those used to let "fix it" + URL escape the
 * vagueness gate). Recognizes:
 * - PascalCase identifier ≥8 chars total ("MyController", "UserService")
 * - camelCase identifier ≥8 chars total ("doSomething", "validateInput")
 * - Function call syntax (`foo()`, `bar(x, y)`)
 * - Substantive backtick code (≥4 chars between backticks)
 * - Quoted string literals (≥5 chars between quotes)
 *
 * @param {string} prompt User prompt (URLs will be stripped before matching)
 * @returns {boolean} true if a specificity signal is detected
 */
function hasSpecificEntity(prompt) {
  // Strip URLs first — they're not specificity (per Phase-G hacker finding).
  const text = prompt.replace(/https?:\/\/[^\s]+/gi, '');

  // PascalCase ≥8 chars total (catches "MyController", "UserService" but
  // not short "MyAa" or "fixIt"). Length check is programmatic since
  // regex can't naturally express min-total-length.
  const pascalMatches = text.match(/\b[A-Z][a-z]+[A-Z]\w*/g) || [];
  if (pascalMatches.some((m) => m.length >= 8)) return true;
  // camelCase ≥8 chars total ("doSomething", "isReady" wouldn't count)
  const camelMatches = text.match(/\b[a-z]+[A-Z]\w*/g) || [];
  if (camelMatches.some((m) => m.length >= 8)) return true;
  // Function calls with explicit parens
  if (/\b\w+\([^)]*\)/.test(text)) return true;
  // Substantive backtick code (≥4 chars)
  if (/`[^`]{4,}`/.test(text)) return true;
  // Quoted strings ≥5 chars
  if (/"[^"]{5,}"|'[^']{5,}'/.test(text)) return true;
  return false;
}

/**
 * Test whether the prompt matches an observation-only pattern (verb-less
 * bug report like "build broken on main", "tests are failing").
 * Observation-only prompts get treated as vague because they describe a
 * symptom without specifying what action is wanted.
 *
 * @param {string} prompt User prompt
 * @returns {boolean} true if prompt matches an OBSERVATION_PATTERNS regex
 */
function isObservationOnly(prompt) {
  return OBSERVATION_PATTERNS.some((p) => p.test(prompt));
}

/**
 * The core vagueness gate. Returns true when the prompt should trigger
 * enrichment. Logic order is significant:
 *
 *   1. Vague keywords (highest signal — fires before SKIP_PATTERNS so
 *      "build broken" still gets caught despite verb-first form)
 *   2. Observation-only patterns (verb-less bug reports)
 *   3. Politeness-padded vague prompts (strips padding, re-checks)
 *   4. SKIP_PATTERNS — clear command shapes that always pass
 *   5. Length-based catch-all for very short prompts
 *
 * @param {string} prompt User prompt (raw, not pre-trimmed)
 * @returns {boolean} true if enrichment should fire
 */
function isVague(prompt) {
  const trimmed = prompt.trim();

  // 1. Vague keywords are the highest-signal flag — check first, even before
  //    skip patterns, so "build broken on main" (which starts with the
  //    verb-first command word "build") still gets caught.
  if (
    VAGUE_KEYWORDS.some((p) => p.test(trimmed)) &&
    !hasFilePath(trimmed) &&
    !hasSpecificEntity(trimmed)
  ) {
    return true;
  }

  // 2. Observation-only patterns (verb-less bug reports). Same rationale:
  //    catch BEFORE the verb-first command skip (which would falsely match
  //    "build broken on main" because of the leading "build").
  if (isObservationOnly(trimmed) && !hasFilePath(trimmed) && !hasSpecificEntity(trimmed)) {
    return true;
  }

  // 3. Politeness padding around vague verbs. ALWAYS check, regardless of
  //    whether a skip pattern matches — politeness questions like "would
  //    you mind fixing the auth" are still vague underneath.
  const looksLikePolitenessQuestion = /^\s*(?:hey\s+)?(?:could|would|can|will|do)\s+you\b/i.test(trimmed);
  if (looksLikePolitenessQuestion) {
    const stripped = stripPolitenessPadding(trimmed);
    if (
      VAGUE_KEYWORDS.some((p) => p.test(stripped)) ||
      isObservationOnly(stripped) ||
      (stripped.length < 15 && !hasFilePath(stripped) && !hasSpecificEntity(stripped))
    ) {
      return true;
    }
  }

  // 4. Now check explicit skip patterns. If matched, the prompt is clear.
  if (SKIP_PATTERNS.some((p) => p.test(trimmed))) return false;

  // 5. Length-based catch-all for very short prompts.
  if (trimmed.length < 15 && !hasFilePath(trimmed) && !hasSpecificEntity(trimmed)) {
    return true;
  }

  return false;
}

// H.4.3 / H.7.26: short ambiguous confirmation detector. When the
// deterministic regex layer abstains on a short prompt that has
// confirmation-shape signals, emit [PROMPT-ENRICHMENT-GATE] with
// `tier: short-confirm` body field (telling Claude to consult the prior turn
// for intent rather than running the heavier full enrichment ceremony). NOT
// a subprocess LLM call — same forcing-instruction-injection pattern as
// [PROMPT-ENRICHMENT-GATE]/full / [ROUTE-DECISION-UNCERTAIN] / [SELF-IMPROVE
// QUEUE]. Per H.7.26 (drift-note 57): unified under PROMPT-ENRICHMENT-GATE
// with tier discriminator instead of separate [CONFIRMATION-UNCERTAIN]
// marker — same hook, same layer, same semantic; performative differentiation
// removed.
const SOFT_CONFIRMATION_SIGNALS = /\b(yes|yep|yeah|yup|sure|ok|okay|absolutely|definitely|cool|nice|perfect|great|alright|got it|do|ship|proceed|continue|carry|go|let'?s|that)\b/i;

/**
 * Detect short ambiguous confirmation prompts that the strict SKIP_PATTERNS
 * regex doesn't quite catch but that look confirmation-shaped enough to
 * warrant the [CONFIRMATION-UNCERTAIN] forcing instruction (rather than
 * the heavier full enrichment ceremony). Criteria:
 * - Word count between 1 and 5 inclusive
 * - At least one SOFT_CONFIRMATION_SIGNAL token (yes/yep/sure/ok/etc.)
 * - No file path or specific entity (those signal a real request)
 *
 * @param {string} prompt User prompt
 * @returns {boolean} true if short + confirmation-shaped + lacks specificity
 */
function isShortAmbiguousConfirmation(prompt) {
  const trimmed = prompt.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount === 0 || wordCount > 5) return false;
  // Must contain at least one soft confirmation signal AND lack file paths
  // / specific entities (those would clearly be a real request, not a
  // confirmation).
  if (hasFilePath(trimmed) || hasSpecificEntity(trimmed)) return false;
  return SOFT_CONFIRMATION_SIGNALS.test(trimmed);
}

/**
 * Build the [PROMPT-ENRICHMENT-GATE] forcing instruction with
 * `tier: short-confirm` discriminator (H.7.26 consolidation of the former
 * [CONFIRMATION-UNCERTAIN] marker — drift-note 57). Lightweight nudge —
 * tells Claude to consult the prior turn for intent rather than triggering
 * full enrichment. Mirrors the forcing-instruction family pattern:
 * deterministic substrate detected uncertainty; Claude makes the semantic
 * call. No subprocess LLM.
 *
 * @param {string} rawPrompt User prompt (will be truncated to 200 chars + escaped)
 * @returns {string} Forcing instruction text suitable for stdout injection
 */
function buildShortConfirmInstruction(rawPrompt) {
  const safeSlice = rawPrompt.slice(0, 200).replace(/"/g, '\\"');
  return `[PROMPT-ENRICHMENT-GATE]
tier: short-confirm

This short prompt has confirmation-shape signals but didn't match strict skip regex. Before enriching, consult the PRIOR turn:

- If the prior turn proposed a concrete action / recommendation, treat this prompt as approval and proceed with that action (skip enrichment).
- If the prior turn was a question or asked the user to choose, this prompt is the answer — handle accordingly without enrichment.
- ONLY enrich (via the standard 4-part flow) if the prior turn provided NO concrete proposal AND this prompt's intent is genuinely unclear.

Raw user prompt: "${safeSlice}"

This is the short-confirm tier of [PROMPT-ENRICHMENT-GATE] (H.7.26 consolidated the former [CONFIRMATION-UNCERTAIN] marker into this tier). Mirrors [ROUTE-DECISION-UNCERTAIN] (H.7.5) — deterministic layer abstained; root makes the semantic call by reading the prior turn rather than the bare prompt.

[/PROMPT-ENRICHMENT-GATE]`;
}

/**
 * Build the [PROMPT-ENRICHMENT-GATE] forcing instruction (the full
 * enrichment ceremony). Tells Claude to look up existing patterns, build
 * the 4-part enriched prompt wrapped in [ENRICHED-PROMPT-START/END]
 * markers (which auto-store-enrichment.js consumes), show to the user,
 * and wait for approval. Mirrors the broader forcing-instruction family.
 *
 * @param {string} rawPrompt User prompt (will be truncated to 200 chars + escaped)
 * @returns {string} Forcing instruction text suitable for stdout injection
 */
function buildForcingInstruction(rawPrompt) {
  // Phase-C: slice BEFORE escape (avoids trailing backslash from \" at boundary)
  const safeSlice = rawPrompt.slice(0, 200).replace(/"/g, '\\"');
  return `[PROMPT-ENRICHMENT-GATE]
tier: full-enrichment

The user's prompt has been flagged as VAGUE by the deterministic enrichment hook. Before acting, you MUST:

1. **Check existing patterns**: \`node ~/.claude/scripts/prompt-pattern-store.js lookup --raw "<raw prompt>"\`
2. **Build the 4-part enriched prompt** wrapped in [ENRICHED-PROMPT-START]...[ENRICHED-PROMPT-END] markers (the auto-store hook reads these to persist the pattern):
\`\`\`
[ENRICHED-PROMPT-START]
RAW: <original user prompt>
CATEGORY: <refactor|bugfix|feature|review|docs|other>
TECHNIQUES: <comma-separated, e.g. chain-of-thought,rag>
INSTRUCTIONS: <what to do, how, constraints>
CONTEXT: <relevant background>
INPUT: <files/data involved>
OUTPUT: <expected deliverable>
[ENRICHED-PROMPT-END]
\`\`\`
3. **Show this to the user** unless a pattern lookup found 5+ approvals (auto-apply with one-line summary).
4. **Wait for approval** before executing.

Raw user prompt: "${safeSlice}"

This is a deterministic gate — do NOT skip enrichment based on conversation context. Vagueness is the only criterion.

[/PROMPT-ENRICHMENT-GATE]`;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const userPrompt = data.prompt || '';

    log('invoked', { promptPreview: userPrompt.slice(0, 100), promptLen: userPrompt.length });

    if (!userPrompt) {
      log('skipped', { reason: 'no_prompt' });
      return;
    }

    const vague = isVague(userPrompt);
    log('classified', { vague });

    if (!vague) {
      return;
    }

    // H.4.3 / H.7.26: short ambiguous confirmation → short-confirm tier of
    // PROMPT-ENRICHMENT-GATE. This catches the long tail of confirmation
    // variants ("yeah do that", "go on then") that fail strict-regex skip
    // but shouldn't trigger the full 4-part enrichment ceremony. Per H.7.26
    // (drift-note 57) the former [CONFIRMATION-UNCERTAIN] marker collapsed
    // into this tier — same hook, same layer, same semantic.
    if (isShortAmbiguousConfirmation(userPrompt)) {
      log('injected', { instruction: 'PROMPT-ENRICHMENT-GATE', tier: 'short-confirm' });
      process.stdout.write(buildShortConfirmInstruction(userPrompt));
      return;
    }

    log('injected', { instruction: 'PROMPT-ENRICHMENT-GATE', tier: 'full-enrichment' });
    process.stdout.write(buildForcingInstruction(userPrompt));
  } catch (err) {
    log('error', { error: err.message });
  }
});
