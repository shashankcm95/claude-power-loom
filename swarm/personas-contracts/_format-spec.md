# Persona-Contract Output Format Specification

**Version**: 1.0.0 (v2.9.0 Phase B.1)
**Scope**: Canonical format that ALL persona output reports must follow so the `contract-verifier.js` checks (F1–F7 + anti-patterns) can read them. Referenced by every `*.contract.json` `_doc` field instead of being restated 18× with drift risk.

> **Why this doc exists**: empirical bench-run evidence (4 control runs, v2.8.2 → v2.8.5) showed actors emitting `### LOW-1: <title>` without the parent `## LOW` H2 bucket. `countFindings` walks only H2 buckets, so the orphan H3s counted as zero findings → F3 silently failed with no signal to the actor about what went wrong. The fix has two halves: a structured `hint` on F3 fail when orphan severity-shaped H3s are detected (so the failure is self-explaining), and this canonical doc so persona-contract maintainers don't have to redocument the format inline.

## Findings format — STRUCTURAL CONTRACT

Findings MUST be expressed as **H3 children of an H2 severity bucket**. The H2 is the *bucket*; the H3 is the *individual finding*. Without the H2 bucket, the H3 is invisible to the verifier and the contract fails F3.

### Correct shape

```markdown
## CRITICAL

### CRITICAL-1: prototype pollution via Object.assign on user input
**File**: `src/auth/login.js:42`
**Impact**: Attacker escalates to admin via crafted `__proto__` key.
**Fix**: Use `Object.create(null)` for the assign target.

### CRITICAL-2: SQL injection on profile-search endpoint
**File**: `src/api/profile.js:88`
**Impact**: Arbitrary read of `users` table.
**Fix**: Parameterize the query; remove the string-concat builder.

## HIGH

### HIGH-1: rate-limit bypass via X-Forwarded-For
...
```

The H2 line (`## CRITICAL`) is the **bucket**. The H3 lines (`### CRITICAL-1:` etc.) are the **findings**. `countFindings` counts only H3s that live under a matched H2; bare H3s are orphan and DO NOT COUNT.

### Common-failure shape — orphan H3s (FAILS F3)

```markdown
## Summary
Some prose about the audit.

### LOW-1: typo in README             ←  ORPHAN — no `## LOW` parent above.
Body of finding.
```

When this shape is detected, `F3.hint` will say:

> `<N>` H3 finding(s) found WITHOUT a parent `## <SEVERITY>` H2 bucket — see `swarm/personas-contracts/_format-spec.md` §Findings format. Add a `## <SEVERITY>` line above each `### <SEVERITY>-N:` group.

### Accepted H2 shapes (any of)

The verifier accepts ALL of these as the H2 severity bucket:

```markdown
## CRITICAL
## 🔴 CRITICAL
## HIGH
## 🟠 HIGH
## MEDIUM
## 🟡 MEDIUM
## LOW
## 🔵 LOW
```

Emoji prefix optional. Case-insensitive. The matched severity word MUST be `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW` — synonyms like `IMPORTANT`, `BUG`, `WARNING` are NOT recognized.

### Accepted H3 finding-item shapes (under a matched H2 bucket)

```markdown
### CRITICAL-1: title
### HIGH-2: title
### MEDIUM-3: title
### LOW-1: title
```

Or, equivalently (bullet form):

```markdown
- **CRITICAL-1: title** — body
- **HIGH-2: title** — body
```

Bullets must lead with `**` (bold-marker prefix) to count.

## Frontmatter — STRUCTURAL CONTRACT

Every actor report MUST open with YAML frontmatter between `---` fences:

```yaml
---
id: actor-architect-theo-2026-05-22
role: actor
depth: 1
parent: super-root
persona: 04-architect
identity: "04-architect.theo"
---
```

- `id`: unique within the run
- `role`: actor | orchestrator | super | challenger
- `depth`: integer ≥ 0
- `parent`: id of spawning node (or `super-root` at top)
- `persona`: `NN-name` (e.g. `04-architect`, `08-ml-engineer`)
- `identity`: full identity string. **MUST be YAML-quoted** if it contains a SynthId suffix (`~hex`) — the unquoted `~` is YAML null and silently drops the identity. (See FIX-I2 in v2.9.0 Phase B.2.)

## File citations — STRUCTURAL CONTRACT

Recognized citation shapes (any of):

1. `path/to/file.ext:LINE` — e.g. `src/auth/login.js:42`
2. `**File**: <path>` — labeled form (preferred for tables)
3. ``` `path/to/file.ext` ``` — backtick-fenced filename

Extension length 1–10 chars (`.swift`, `.kotlin`, `.markdown`, `.dockerfile` all accepted; tighter limits caught at H.2.1).

## KB citations — STRUCTURAL CONTRACT (F7 `kb_scope_consumed`)

Recognized `kb:` reference shapes:

```markdown
- kb:agent-team/spawn-conventions
- See `kb:architecture/crosscut/idempotency`
- kb:security-dev/owasp-top-10
```

The verifier extracts kb_ids from the transcript JSONL by pairing `tool_use` blocks with their `tool_result` — text-pattern checks alone are insufficient (see CS-3 kai CRIT-1 hardening in `contract-verifier.js:121`). The doc body still needs a `kb:` mention to satisfy F7, but PROVENANCE (the actual tool-result) is what gates the count.

## Anti-patterns the verifier rejects

| Check ID | Anti-pattern | Effect on verdict |
|----------|--------------|-------------------|
| `A1` | `claimsHaveEvidence` violations (claim without nearby citation) | fail |
| `A2` | text similarity to a prior run > 0.6 | warn |
| `A3` | padding phrases ("In conclusion…", "Overall…", "It is worth noting…") | fail |

`A2` is intentionally a warn — re-running the same probe over a stable substrate WILL surface similar findings. The threshold catches verbatim copy-paste, not legitimate pattern recurrence.

## Code blocks — STRUCTURAL CONTRACT (F5 + F6)

Code blocks (fenced with triple backticks) are scanned by `noUnrolledLoops` (F5) and `noExcessiveNesting` (F6):

- **F5 maxRepetitions** — 5 by default. Lines ≥ 20 chars long are counted; shorter syntactic lines (closing braces, single-token imports) are skipped. (Updated v2.9.0 Phase B.3 — was ≥ 3.)
- **F6 maxDepth** — 4 by default. Brace-counting; only C-family languages (JS/TS/Java/Swift/Rust). Python indentation NOT inspected.

## Severity-tier thresholds (engineering vs audit)

| Contract template | F3 min findings | F4 min citations | F5/F6 active | Severity sections required |
|------------------|-----------------|-------------------|--------------|----------------------------|
| `engineering-task.contract.json` | 1 | 1 | yes | no |
| `04-architect.contract.json` | 3 | 6 | yes | CRITICAL+HIGH+MEDIUM |
| `03-code-reviewer.contract.json` | 3 | 6 | yes | CRITICAL+HIGH+MEDIUM |
| `01-hacker.contract.json` | 4 | 4 | yes | CRITICAL+HIGH+MEDIUM |
| `05-honesty-auditor.contract.json` | 3 | 4 | yes | CRITICAL+HIGH+MEDIUM |
| (others) | varies — see each contract | varies | yes | varies |

Engineering-task is the floor. Audit contracts raise the bar.

## Backwards-compatibility notes

- Pre-H.2.1 reports used `## H2 finding` without a `H2-N:` prefix on the H3. Those reports failed F3 silently. v2.9.0 Phase B.1 surfaces the failure with a hint.
- Reports that wrote findings as `## CRITICAL Finding 1` (treating severity + title as one H2) also failed silently — that shape is NOT supported. Use the H2-bucket + H3-finding nesting.
- Reports with `## Issues Found` or `## Findings` (no severity word) are NOT recognized. The H2 line MUST contain `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW`.

## Cross-references

- `scripts/agent-team/contract-verifier.js:77` — `countFindings` implementation (the function this spec describes)
- `scripts/agent-team/contract-verifier.js:248` — `minFindings` check wiring (F3)
- `scripts/agent-team/contract-verifier.js:252` — `hasSeveritySections` check wiring
- `bench/control-runs/v2.8.5-treatment/` — empirical evidence of the orphan-H3 failure mode
- v2.9.0 Phase B.1 plan — `flickering-crafting-star.md` § FIX-I1
