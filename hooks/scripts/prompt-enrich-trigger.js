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

const VAGUE_KEYWORDS = [
  // Generic action verbs without specifics
  /\bfix\s+(?:the|this|that|it|some)\b/i,
  /\bmake\s+(?:it|this|that)\s+(?:better|faster|cleaner|nicer|work)/i,
  /\bimprove\s+(?:the|this|that|it)\b/i,
  /\boptimi[sz]e\s+(?:the|this|that|it)\b/i,
  /\bupdate\s+(?:the|this|that|it)\b/i,
  /\bclean\s+(?:up|this|that|it)\b/i,
  /\brefactor\s+(?:the|this|that|it)(?!\s+\S+\.\w+)/i,  // "refactor it" but not "refactor src/file.ts"
  /\bdo\s+(?:something|the\s+thing|stuff)\b/i,
  /\bhandle\s+(?:the|this|that|it)\b/i,
  /\bsort\s+(?:the|this|that|it)\s+out\b/i,
  /\bcheck\s+(?:the|this|that|it)\b/i,
  /\breview\s+(?:the|this|that|it)\b/i,  // unless followed by specifics
];

const SKIP_PATTERNS = [
  // Slash commands
  /^\s*\//,
  // Confirmation responses (must match alone, not part of larger sentence)
  /^\s*(yes|yep|yeah|y|sure|ok|okay|approve|approved|confirm|confirmed|go|go ahead|proceed|continue|do it|please)\s*[.!?]?\s*$/i,
  /^\s*(no|nope|n|cancel|stop|skip|pass)\s*[.!?]?\s*$/i,
  // Wh-questions
  /^\s*(what|how|where|why|when|who|which)\s/i,
  // Aux-verb questions: subject pronoun OR article (e.g., "is the file ready")
  // Note: "do" is excluded — "do the X" is imperative, not a question
  /^\s*(is|are|was|were|will|would|should|could|can|may|might|must|has|have|had|does|did)\s+(you|i|we|they|it|he|she|the|this|that|these|those|there|a|an)\b/i,
  // "do" as question prefix: only when followed by a subject pronoun (not article)
  /^\s*do\s+(you|i|we|they|it|he|she|there)\b/i,
  // Direct verb-first commands
  /^\s*(run|execute|test|build|deploy|commit|push|pull|merge|rebase|stash|install|undo|revert)\s/i,
  // Tool-prefixed commands (git push, npm install, etc.)
  /^\s*(git|npm|yarn|pnpm|bun|cargo|go|python|node|deno|docker|kubectl)\s+\w/i,
  // Show/explain (informational)
  /^\s*(show|explain|describe|list|tell)\s/i,
];

function hasFilePath(prompt) {
  // Detect file paths or extensions
  return /\/[\w.-]+/.test(prompt) ||                      // /path/to/file
         /\b\w+\.(ts|tsx|js|jsx|py|rs|go|rb|md|json|yaml|yml|toml|sh|sql|css|scss|html)\b/i.test(prompt) ||
         /\b(src|app|lib|components?|pages?|api|tests?|hooks?|utils?|services?|controllers?|models?)\/\w+/i.test(prompt);
}

function hasSpecificEntity(prompt) {
  // Detect named entities, URLs, function names, etc.
  return /\b[A-Z][a-z]+[A-Z]\w+/.test(prompt) ||           // PascalCase or camelCase identifiers
         /\b[a-z]+[A-Z]\w+/.test(prompt) ||
         /https?:\/\//.test(prompt) ||                     // URLs
         /\b\w+\(\)/.test(prompt) ||                       // function calls
         /`[^`]+`/.test(prompt) ||                         // backtick code
         /"[^"]{3,}"/.test(prompt) ||                      // quoted strings
         /'[^']{3,}'/.test(prompt);
}

function isVague(prompt) {
  const trimmed = prompt.trim();

  // Skip if matches any skip pattern
  if (SKIP_PATTERNS.some((p) => p.test(trimmed))) return false;

  // Very short prompts (< 15 chars) without file path or entity = vague
  if (trimmed.length < 15 && !hasFilePath(trimmed) && !hasSpecificEntity(trimmed)) {
    return true;
  }

  // Matches a vague keyword pattern AND lacks specific scope = vague
  const matchesVagueKeyword = VAGUE_KEYWORDS.some((p) => p.test(trimmed));
  if (matchesVagueKeyword && !hasFilePath(trimmed) && !hasSpecificEntity(trimmed)) {
    return true;
  }

  return false;
}

function buildForcingInstruction(rawPrompt) {
  return `[PROMPT-ENRICHMENT-GATE]

The user's prompt has been flagged as VAGUE by the deterministic enrichment hook. Before acting, you MUST:

1. **Check MemPalace** \`prompt-patterns\` room (or \`~/.claude/prompt-patterns.json\` fallback) for similar past prompts.
2. **Build the 4-part enriched prompt**:
   - **Instructions**: What specifically to do, how to approach, what NOT to do
   - **Context**: Relevant project background (from MEMORY.md, MemPalace, conversation, recent files)
   - **Input Data**: Specific files, components, or data involved
   - **Output Indicator**: Expected deliverable type, format, quality criteria
3. **Show the enriched prompt to the user** unless an existing pattern has 5+ approvals (then auto-apply with one-line summary).
4. **Wait for approval** before executing — let the user modify, approve, or skip.
5. **On approval, store the pattern** for future reuse with confidence-tier learning.

Raw user prompt: "${rawPrompt.replace(/"/g, '\\"').slice(0, 200)}"

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

    if (!userPrompt) {
      // No prompt — pass through silently
      return;
    }

    if (!isVague(userPrompt)) {
      // Clear prompt — silent pass-through, zero overhead
      return;
    }

    // Vague prompt — inject forcing context
    process.stdout.write(buildForcingInstruction(userPrompt));
  } catch {
    // On error, never block the user's prompt
  }
});
