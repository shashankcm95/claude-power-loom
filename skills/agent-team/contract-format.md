# Agent Team Contract Format

Specification for `*.contract.json` files. These files define what an agent must produce (functional contract) and must NOT do (anti-pattern contract).

## Schema

```json
{
  "agentId": "string",
  "persona": "string (optional, references swarm/personas/{persona}.md)",
  "role": "actor | orchestrator | super-agent",
  "budget": {
    "tokens": 30000,
    "extensible": true,
    "maxExtensions": 1,
    "extensionAmount": 20000
  },
  "functional": [
    {
      "id": "F1",
      "check": "<check-name>",
      "args": { "...": "..." },
      "required": true
    }
  ],
  "antiPattern": [
    {
      "id": "A1",
      "check": "<check-name>",
      "args": { "...": "..." },
      "severity": "fail | warn"
    }
  ],
  "fallbackAcceptable": [
    "Bash blocked → source-inspection with file:line citations is acceptable",
    "Network blocked → mark as 'verification deferred' is acceptable"
  ],
  "skills": {
    "required": ["swift-development"],
    "recommended": ["engineering:debug", "engineering:testing-strategy", "swiftui"],
    "skill_status": {
      "swift-development": "available",
      "engineering:debug": "marketplace:knowledge-work-plugins/engineering",
      "swiftui": "not-yet-authored"
    }
  },
  "kb_scope": {
    "default": ["kb:mobile-dev/swift-essentials", "kb:hets/spawn-conventions"]
  }
}
```

## Skill status values

The `skills.skill_status` map records where each skill name resolves. Three values:

| Status | Meaning | Resolution path |
|--------|---------|-----------------|
| `available` | Skill is locally authored at `~/Documents/claude-toolkit/skills/<name>/SKILL.md` | Direct read |
| `marketplace:<marketplace>/<plugin>` | Skill ships with a Claude Code plugin marketplace (e.g., `marketplace:knowledge-work-plugins/engineering`) | Plugin must be installed; invoke via `Skill` tool with namespaced name (e.g., `engineering:debug`) |
| `not-yet-authored` | Promise mode — referenced but not yet written | H.2.5 skill-bootstrapping flow authors on first use (user-gated, per `patterns/skill-bootstrapping.md`) |

Skill names follow conventions:
- Locally authored: bare name, e.g., `swift-development`
- Marketplace: namespaced as `<plugin>:<skill>`, e.g., `engineering:debug`, `data:sql-queries`
- Promise-mode: bare name (will resolve to local once authored)

The verifier check `invokesRequiredSkills` (planned for H.2.6) will skip enforcement for `not-yet-authored` skills, validate marketplace skills by checking the actor's transcript for `Skill` tool invocations of the namespaced form, and require local skills to appear in invocations directly.

## Functional checks

| Check | Description | Args |
|-------|-------------|------|
| `outputContainsFrontmatter` | Output starts with `---` YAML frontmatter | none |
| `frontmatterHasFields` | YAML has all required fields | `{ fields: ["id", "role", "depth", ...] }` |
| `minFindings` | Output has ≥N severity-section findings | `{ min: 5 }` |
| `hasFileCitations` | Output has ≥N `file:line` references | `{ min: 3 }` |
| `hasSeveritySections` | Output has **all** listed severity sections (each `severities` entry must appear as a `## SEVERITY` heading). Empty sections like `## CRITICAL\n_None this run._` count as present. | `{ severities: ["CRITICAL", "HIGH", ...] }` |
| `outputLengthMin` | Output body is at least N chars | `{ min: 500 }` |
| `outputLengthMax` | Output body is at most N chars | `{ max: 50000 }` |
| `containsKeywords` | Output contains specific keywords | `{ keywords: ["verified", "evidence"] }` |
| `noEmptyChallengeSection` | Counts `### CHALLENGE-N` headings; ≥`min` required. For challenger contracts (asymmetric-challenger pattern). | `{ min: 1 }` |
| `invokesRequiredSkills` | Reads actor transcript JSONL (or falls back to `--skills` CLI flag), verifies each `skills.required` was invoked via `Skill` tool. Skips skills with `skill_status: 'not-yet-authored'` (promise mode). Returns rich result `{ pass, source, invokedSkills, missingRequired, skippedPromiseMode, requiredCount }`. | none — auto-reads `--transcript` or `--skills` |
| `noUnrolledLoops` (H.2.7 — third-contract leg) | Scans code blocks (` ```...``` `) for ≥`maxRepetitions` identical lines = fail. Catches the 1000-zeros family (manual unrolling instead of loop/abstraction). Use for builder personas (06-12) writing code in findings. | `{ maxRepetitions: 5 }` (default 5) |
| `noExcessiveNesting` (H.2.7) | Brace-counting depth check on code blocks; fails if any block exceeds `maxDepth`. C-family languages only (Python's indentation-based nesting is a known limitation). Strips string literals + comments before counting. | `{ maxDepth: 4 }` (default 4, matches CLAUDE.md) |

## Anti-pattern checks

| Check | Description | Args |
|-------|-------------|------|
| `noTextSimilarityToPriorRun` | Output text is not too similar to prior-run text | `{ threshold: 0.7, priorRunDir: "..." }` |
| `noTemplateRepetition` | Output sections aren't templated copies of each other | `{ minVariation: 0.3 }` |
| `claimsHaveEvidence` | Claims are backed by `file:line` or `verified by:` markers | `{ markers: ["file:line", "verified by"] }` |
| `noPaddingPhrases` | Output doesn't use filler phrases without substance | `{ phrases: ["I reviewed everything", "looks good"] }` |
| `acknowledgesFallback` | If a fallback was used, it's explicitly stated | none |
| `noDuplicateFindingIds` | Each finding has a unique identifier | none |

## Verifier CLI flags

| Flag | Purpose | Introduced |
|------|---------|------------|
| `--contract <path>` | Path to contract JSON | H.1 |
| `--output <path>` | Path to agent output to verify | H.1 |
| `--previous-run <dir>` | Prior-run directory for `noTextSimilarityToPriorRun` | H.1 |
| `--no-record` | Don't forward to pattern-recorder | H.1 |
| `--identity <persona.name>` | Per-identity recording (forwards to agent-identity.js) | H.2-bridge |
| `--skills <s1,s2,...>` | Skills the actor invoked (forwards to recorder) | H.2-bridge |
| `--skip-checks <ids-or-names>` | Comma-separated `check.id` (e.g. `F4,A2`) or `check.check` (e.g. `noTextSimilarityToPriorRun`) to skip. Skipped checks record `status: 'skipped'`. Use with `agent-identity recommend-verification` output. | H.2.4 |
| `--transcript <path>` | Path to actor's transcript JSONL. Source for `invokesRequiredSkills` check. If omitted, that check falls back to `--skills` flag value, then to graceful no_skills_source_supplied pass. | H.2.6 |

## Verdict outcomes

After running all checks:

- **pass**: all functional checks passed, no anti-pattern checks failed
- **partial**: all functional checks passed, some anti-pattern warns
- **fail**: any required functional check failed, OR any anti-pattern with severity=fail

## Retry policy

When verdict is `fail`:
- Agent gets ONE retry attempt
- Retry prompt includes: which check failed, why (specific evidence), what's needed
- If retry also fails: escalate to orchestrator (or super-agent if at depth 1)
- Orchestrator can: accept-with-caveat OR mark agent as failed

## Self-learning integration

Every verification call appends to `~/.claude/agent-patterns.json`:

```json
{
  "patterns": [
    {
      "task_signature": "hacker:adversarial-bug-hunting",
      "agent_role": "actor",
      "persona": "01-hacker",
      "verdict": "pass",
      "evidence_quality": 0.85,
      "tokens_used": 28400,
      "checks_passed": ["F1", "F2", "F3", "A1", "A3"],
      "checks_failed": ["A2"],
      "ran_at": "2026-05-02T..."
    }
  ]
}
```

## Example contract: actor-hacker

```json
{
  "agentId": "actor-hacker",
  "persona": "01-hacker",
  "role": "actor",
  "budget": {
    "tokens": 30000,
    "extensible": true,
    "maxExtensions": 1,
    "extensionAmount": 15000
  },
  "functional": [
    { "id": "F1", "check": "outputContainsFrontmatter", "required": true },
    { "id": "F2", "check": "frontmatterHasFields", "args": { "fields": ["id", "role", "depth", "parent", "persona"] }, "required": true },
    { "id": "F3", "check": "minFindings", "args": { "min": 3 }, "required": true },
    { "id": "F4", "check": "hasFileCitations", "args": { "min": 5 }, "required": true },
    { "id": "F5", "check": "containsKeywords", "args": { "keywords": ["verified", "phase G"] }, "required": false }
  ],
  "antiPattern": [
    { "id": "A1", "check": "noTextSimilarityToPriorRun", "args": { "threshold": 0.6 }, "severity": "warn" },
    { "id": "A2", "check": "noTemplateRepetition", "args": { "minVariation": 0.25 }, "severity": "warn" },
    { "id": "A3", "check": "claimsHaveEvidence", "severity": "fail" },
    { "id": "A4", "check": "acknowledgesFallback", "severity": "warn" }
  ],
  "fallbackAcceptable": [
    "Bash blocked → source-inspection with file:line citations is acceptable",
    "Cannot run actual attacks → reasoning from source with explicit code path tracing is acceptable"
  ]
}
```
