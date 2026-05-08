---
pattern: validator-conventions
status: active
intent: Conventions A-G for hook validators. A separates repo-internal from external-dependency concerns; B governs self-documenting stderr; C codifies tiered enforcement; D codifies PreToolUse-vs-PostToolUse placement; E codifies Edit-result-aware vs tool-agnostic content scanning; G codifies the forcing-instruction class taxonomy (H.7.25). Codifies lessons from H.7.10/H.7.12/H.7.18/H.7.19/H.7.20/H.7.21/H.7.25.
related: [route-decision, structural-code-review, kb-scope-enforcement, system-design-principles, forcing-instruction-family]
---

## Summary

Two conventions for hook validators in `hooks/scripts/validators/` and `scripts/agent-team/contracts-validate.js`. **Convention A**: separate repo-internal correctness from external-dependency presence — the latter must be gated on environmental signals (e.g., `MARKETPLACE_BASE` non-empty) rather than enforced unconditionally. **Convention B**: validator stderr output must self-document why a check is skipped or firing, not just report status. Both originated as drift-notes 7 + 8 from this session's H.7.10 + H.7.12 work; codified here for future validator authors.

## Convention A — Separation of repo-internal and external-dependency concerns

### Why this convention exists

H.7.10's `contract-skill-status-values` validator surfaced the original issue. The validator was checking TWO conflated concerns in a single validator pass:

1. **Repo-internal consistency** — every skill declared with `status: "available"` must exist at `skills/<name>/SKILL.md`. This works in any environment because the skills are part of the repo.
2. **External dependency presence** — every skill declared with `status: "marketplace:knowledge-work-plugins/engineering"` must exist at `~/.claude/plugins/marketplaces/knowledge-work-plugins/engineering/skills/<name>/SKILL.md`. This works only on machines where the user has installed the marketplace plugin.

CI runners (and minimal user installs) have the former but not the latter. Conflating them produces 38 false-positive "missing" violations when the validator runs in CI — even though the repo is internally consistent and only the external dependency is absent.

### The convention

Validators that include external-dependency checks **must gate the existence portion** on a clear environmental signal:

```javascript
const externalCheckEnabled = (() => {
  try {
    if (!fs.existsSync(EXTERNAL_BASE)) return false;
    return fs.readdirSync(EXTERNAL_BASE).some((d) => {
      try { return fs.statSync(path.join(EXTERNAL_BASE, d)).isDirectory(); }
      catch { return false; }
    });
  } catch { return false; }
})();
```

When the gate is closed (no external dependency installed), the validator **still runs syntax/format validation** of the declarations (e.g., that `marketplace:X/Y` is a well-formed string), but **skips the file-existence check** that would otherwise produce false positives.

### Reference implementation

`scripts/agent-team/contracts-validate.js`'s `contract-skill-status-values` (H.7.10):

```javascript
const marketplaceCheckEnabled = (() => {
  try {
    if (!fs.existsSync(MARKETPLACE_BASE)) return false;
    return fs.readdirSync(MARKETPLACE_BASE).some(/* ... */);
  } catch { return false; }
})();
// ... later, in the per-entry loop:
if (marketplaceCheckEnabled && !fs.existsSync(expectedPath)) {
  violations.push({ kind: 'marketplace-skill-missing', ... });
}
```

Syntax of the `marketplace:X/Y` declarations IS still validated unconditionally — only the existence check is gated.

### When this convention applies

Apply this pattern when a validator needs to check both:
- Something inside the repo (always available)
- Something in the user's broader environment (`~/.claude/`, marketplace plugins, CI runner state, etc.)

### Failure modes if violated

- **CI false positives**: validators that hard-enforce external-dependency presence will block PRs in environments that don't have those dependencies (the H.7.10 surfacing case).
- **User confusion**: minimal-install users see "missing" violations for things they didn't intend to install.
- **Validator distrust**: if the gate produces noise on legitimate-but-minimal setups, users will start ignoring or bypassing it.

## Convention B — Self-documenting stderr messages

### Why this convention exists

H.7.10's marketplace fix initially emitted `marketplace check skipped` to stderr — terse and unhelpful. A user seeing that in their hook output couldn't tell whether: (a) the check was skipped because their environment is normal, (b) a bug skipped a check that should fire, or (c) the validator is broken.

Reframed message: `"marketplace declarations treated as informational; no marketplaces installed at $MARKETPLACE_BASE (this is normal in CI / minimal installs)"` — explains WHY in one human-readable line.

### The convention

When a validator skips a check, fires a soft warning, or otherwise produces stderr output, the message must:

1. **Explain the WHY** — what condition triggered the skip/warn, not just that something happened
2. **Reference the gate variable or environmental signal** — `$MARKETPLACE_BASE` not "the path"
3. **Indicate the expected scenario** — "this is normal in CI / minimal installs" so the user knows to ignore vs investigate
4. **Be one line** — operators scan logs; multi-line stderr clutters CI output

### Reference implementations

`contracts-validate.js` H.7.10:
```
ℹ contract-skill-status-values: marketplace declarations treated as informational; no marketplaces installed at /home/runner/.claude/plugins/marketplaces (this is normal in CI / minimal installs)
```

`validate-plan-schema.js` H.7.12 — when Tier 3 sections are missing:
```
ℹ validate-plan-schema: aspirational Tier 3 sections missing (no enforcement): Out of Scope, Drift Notes
```

`contracts-validate.js` H.7.23 — `contract-marketplace-schema` validator:
```
ℹ contract-marketplace-schema: schemas: 2 validated
ℹ contract-marketplace-schema: vendored schemas missing in swarm/schemas/ (this is normal on fresh checkout / minimal install; run scripts/agent-team/refresh-plugin-schema.sh to vendor)
```

Both messages: explain why, reference the relevant context, indicate expected vs unexpected.

### When this convention applies

Apply to ALL stderr emissions from hook validators:
- Skip/conditional-firing messages
- Soft warnings (validator did its job but found a hint)
- Diagnostic info that operators may need

### Failure modes if violated

- **Operator confusion**: "validator emitted X — is that normal?" Unclear messages waste investigation time.
- **Message blindness**: terse messages train operators to ignore stderr; real warnings get missed.
- **CI log noise**: multi-line stderr inflates log size and makes scanning harder.

## How these two conventions relate

Convention A defines WHEN a validator should skip a check; Convention B defines HOW it announces that it did. Together they make validators that:
- Don't false-positive in minimal environments (Convention A)
- Tell users why they did or didn't fire (Convention B)
- Build operator trust through clear behavior

## Convention C — Tiered enforcement matches actual writing variance (H.7.18 reinforcement)

Originated in H.7.12 (`validate-plan-schema.js`); reinforced in H.7.18 (`validate-markdown-emphasis.js`).

When the validator's universe (e.g., "all markdown files" or "all plan files") is heterogeneous in author/intent, **single-strict-tier enforcement causes false positives** that erode trust. The fix is tiered enforcement: separate "definitely a problem" from "style suggestion" from "informational hint" so the validator's noise level matches the user's risk tolerance.

### Reference implementations

`validate-plan-schema.js` (H.7.12 + H.7.17):
- **Tier 1 (mandatory)**: Context, Verification Probes, (Files To Modify OR Phases) — missing → forcing instruction
- **Tier 2 (conditional)**: Routing Decision, HETS Spawn Plan — fires only if "Routing Decision" string detected (signals new-style plan)
- **Tier 3 (aspirational)**: Out of Scope, Drift Notes — stderr informational only

`validate-markdown-emphasis.js` (H.7.18):
- **Tier 1 (likely-MD037-triggering)**: 2+ unbackticked underscore-bearing tokens in same paragraph → forcing instruction
- **Tier 2 (style suggestion)**: 1 isolated unbackticked token → stderr informational only

### When this convention applies

Apply when:
- Validator detects shapes that range from "definitely a CI failure" to "style preference"
- False-positive cost > miss cost (e.g., over-firing on prose mentions of `_underscore` is worse than missing one stale doc)
- The ratio of "high-risk" to "low-risk" matches in real usage warrants graduated response

### Failure modes if violated

- **Single-strict-tier**: validator over-fires on edge cases; users disable or bypass
- **Single-loose-tier**: real bugs get treated as "advisory"; CI catches them later at higher cost
- **Tier explosion**: more than 3 tiers creates ambiguity ("is Tier 4 worse than Tier 2?"); cap at 2-3

## Convention D — PreToolUse for gates, PostToolUse for advisory (H.7.19)

Originated in H.7.12 → H.7.17 migration cycle, codified in H.7.19 after audit confirmed all 4 existing PreToolUse hooks are correctly placed.

When adding a new validator hook, choose the layer based on **what happens if you DON'T block**.

### Use PreToolUse when

- The operation would cause **silent-failure** (e.g., skill silently doesn't load without frontmatter; H.5.2 fail-CLOSED on parse error to prevent secrets leakage on parse-error fallback)
- The operation is a **security violation** (bare secrets in code; protected config modification with sensitive contents)
- Recovery from the bad state is hard or expensive (file already on disk, secret already committed, skill already broken)
- Output: `{decision: 'block', reason: '...'}` JSON to stdout. The `reason` explains how to fix.

### Use PostToolUse when

- The operation is fine to complete; you're surfacing **nuance** (style suggestions, schema reminders, MD037 catches)
- The user can **iterate** (re-Write with backticks; re-Write with missing sections)
- Forcing-instruction text on stdout suffices — no JSON gate needed
- Output: forcing instruction text to stdout (no `decision:` JSON; PostToolUse doesn't expect it)

### Decision tree

```text
Q: Does the bad operation cause silent failure or security violation?
├── YES → PreToolUse (block to prevent it)
└── NO  → Does the user need a nudge, schema reminder, or style hint?
         ├── YES → PostToolUse (advisory; emit forcing instruction)
         └── NO  → Don't add a hook
```

### Reference implementations

**PreToolUse gates** (4 hooks, audited H.7.19):

| Hook | Scope | Reason |
|------|-------|--------|
| `fact-force-gate` | Read\|Edit\|Write | Silent-failure-prevention — blocks Edit/Write of unread files (would assume stale state) |
| `config-guard` | Edit\|Write | Security gate — blocks edits to protected config files (.env, .npmrc with secrets) |
| `validators/validate-no-bare-secrets` | Edit\|Write | Security gate — blocks writes containing bare API keys/tokens. Per H.5.2: fail-CLOSED on parse error. H.7.21 extension: Edit scans post-edit result (existing file + applied edit), not just `new_string` — see Convention E. |
| `validators/validate-frontmatter-on-skills` | Edit\|Write | Silent-failure-prevention — blocks Write/Edit of skill files without YAML frontmatter (skill silently doesn't load). H.7.20 extension: Edit reads file + applies proposed edit + checks result — see Convention E. |

**PostToolUse advisory** (3 hooks):

| Hook | Scope | Purpose |
|------|-------|---------|
| `error-critic` | Bash | Repeat-failure consolidation; emits `[FAILURE-REPEATED]` at threshold |
| `validators/validate-plan-schema` | Edit\|Write | Tiered enforcement of plan-template schema (H.7.12 + H.7.17 migrated from PreToolUse) |
| `validators/validate-markdown-emphasis` | Edit\|Write | MD037 catch via underscore-emphasis detection (H.7.18) |

### Common deviation pattern (H.7.12 → H.7.17 lesson)

H.7.12 chose PreToolUse:Write for `validate-plan-schema.js` because Phase 1 inventory found "no PostToolUse:Write entries in toolkit." This was a **conservative deviation** from theo's H.7.9 Section C original spec which said PostToolUse. The deviation persisted until H.7.17 when `claude-code-guide` consultation confirmed PostToolUse:Write IS supported.

**Lesson**: "no examples in our toolkit" ≠ "not supported by Claude Code." When uncertain about Claude Code behavior, consult docs (or `claude-code-guide` agent — drift-note 24) rather than inferring from absence.

### Failure modes if violated

- **PostToolUse-when-should-be-PreToolUse**: silent failure or security incident reaches the file system before being caught. PostToolUse can't undo writes — only flag them.
- **PreToolUse-when-should-be-PostToolUse**: friction (every edit waits for blocking validation when advisory was sufficient); validator complexity (must always emit `decision: approve` JSON for non-blocking paths; H.7.17's migration removed this complexity from `validate-plan-schema`).

## Convention E — Edit-result-aware vs tool-agnostic validation (H.7.20 + H.7.21)

Originated in H.7.19 audit (drift-note 28: `validate-frontmatter-on-skills` only fired on Write, missed Edit removing frontmatter). Closed in H.7.20. Drift-note 29 captured the sibling concern: do OTHER PreToolUse validators have similar Edit-coverage gaps? H.7.21 audited all 4 PreToolUse validators and found the gap is real for content-scanning validators but a non-issue for tool-agnostic ones.

### Why this convention exists

A validator that fires on `Edit|Write` (per Convention D's matcher choice) sees two different `tool_input` shapes:

- **Write**: full file content in `tool_input.content`. Validator scans `content`, sees the entire post-write state.
- **Edit**: only the diff in `tool_input.old_string` + `new_string` (or an `edits[]` array for MultiEdit). Validator scanning ONLY `new_string` sees the inserted bytes in isolation, missing surrounding file context.

For content-scanning validators this asymmetry creates a coverage gap. Concrete examples found in the audit:

- A file already contains a `*_KEY=` placeholder. Edit replaces the placeholder with a 16+ char value. The post-edit file has a complete secret-assignment line, but `new_string` alone is just the bare value (no key prefix) — the secret-assignment regex doesn't match.
- A skill file with valid frontmatter. Edit removes the `---\n...\n---\n` block. The post-edit file has no frontmatter (skill silently doesn't load), but `new_string` is empty/whitespace — the validator sees nothing wrong.

Path-based or session-state-based validators don't have this gap because they don't inspect content at all.

### The convention

Every PreToolUse validator that fires on Edit must declare which pattern it follows:

**Pattern 1 — Content-scan (Edit-result-aware required)**

The validator scans `tool_input.content` for Write. For Edit, it must:

1. Read existing file from disk via `fs.readFileSync(filePath, 'utf8')` (wrap in try/catch — file may not exist for Edit semantics, fall back to `new_string`-only scan)
2. Apply the proposed edit:
   - Single edit, default: `result = existing.replace(old_string, new_string)`
   - Single edit with `replace_all: true`: `result = existing.split(old_string).join(new_string)` (Node-safe `replaceAll` equivalent)
   - MultiEdit (`edits[]`): apply each in sequence on the running result
3. Scan the result instead of (or in addition to) the bare `new_string`

Reference: `validate-frontmatter-on-skills.js` (H.7.20), `validate-no-bare-secrets.js` (H.7.21).

**Pattern 2 — Tool-agnostic (no Edit-result concern)**

The validator's check doesn't depend on file content at all. It inspects:

- `tool_input.file_path` (path-based gating; e.g., "is this a protected config?")
- Session state (e.g., "was this file Read before?")

For these validators, Edit and Write trigger the same logic with no asymmetry. No code change needed for Edit coverage.

Reference: `config-guard.js` (path-based), `fact-force-gate.js` (read-tracker).

### Decision tree

```text
Q: Does the validator inspect tool_input.content / new_string?
├── YES → Pattern 1 (content-scan): MUST handle Edit-result-aware scan
│         - Read file + apply edit + scan result
│         - Falls back to new_string-only if file unreadable
└── NO  → Pattern 2 (tool-agnostic): no Edit-coverage concern
          - Path-based: check file_path against patterns
          - Session-state: check tracker / external signal
```

### Reference implementations

H.7.21 audit findings — all 4 existing PreToolUse content/path validators classified:

| Validator | Pattern | Edit-result-aware? | Status |
|-----------|---------|---------------------|--------|
| `validate-frontmatter-on-skills.js` | 1 (content-scan) | yes (H.7.20) | Closed |
| `validate-no-bare-secrets.js` | 1 (content-scan) | yes (H.7.21) | Closed |
| `config-guard.js` | 2 (tool-agnostic, path-based) | N/A | By design |
| `fact-force-gate.js` | 2 (tool-agnostic, read-tracker) | N/A | By design |

### When this convention applies

Apply this convention at validator-creation time:

- New validator scans content → declare Pattern 1 in header comment + implement read-file + apply-edit + scan-result for Edit branch
- New validator only checks path or session state → declare Pattern 2 in header comment + no special Edit handling needed

### Failure modes if violated

- **Pattern 1 without Edit-result scan**: silent coverage gap. Edits that complete a violation by leveraging surrounding context bypass the validator entirely. Discovered via drift-notes 28 + 29.
- **Pattern 2 with unnecessary Edit-result scan**: wasted complexity. The validator does work it doesn't need; risks introducing bugs in the file-read path that don't help the actual check.
- **No declaration**: future maintainers (including a future Claude session) can't tell at a glance whether the validator needs Edit-result handling. Header-comment declaration is cheap insurance against drift.

### How Convention E relates to the others

Convention E is the runtime/coverage twin of Convention D's placement decision:

- **Convention D**: Where does this hook fire? (PreToolUse vs PostToolUse)
- **Convention E**: How does it actually inspect Edit operations? (Pattern 1 vs Pattern 2)

A validator's correctness requires BOTH conventions. Wrong placement (D violation) misses the security/silent-failure window. Wrong content handling (E violation) silently passes Edit-completed violations.

## Convention G — Forcing-instruction class taxonomy (H.7.25)

Originated in H.7.25 retrospective on the 11-instruction count growth (drift-note 21 closure). Codifies the mechanism choice that earlier instructions made implicitly. Sibling document: `skills/agent-team/patterns/forcing-instruction-family.md` (per-instruction catalog).

### Why this convention exists

Between H.4.x and H.7.23.1, eleven `[BRACKET-MARKER]` text blocks accumulated across 9 hook scripts. They share visual shape but differ semantically along three axes: (a) does Claude take action, (b) where does the text go, (c) does the operation gate or pass through. Without explicit taxonomy, future hooks risk misclassification — and one already did (`[MARKDOWN-EMPHASIS-DRIFT]`, mechanical fix shoehorned into advisory shape).

### The two classes (plus one variant)

**Class 1 — Advisory forcing instruction** (deterministic detect + semantic recovery)

- Use when: detection is deterministic but the recovery action requires Claude-side judgment (read context, decide between options, synthesize fix).
- Layer: stdout (UserPromptSubmit or PostToolUse).
- Marker shape: `[CATEGORY-NAME] ... [/CATEGORY-NAME]`.
- Operation: pass-through (UserPromptSubmit) or already-completed (PostToolUse).
- Reference: `[PROMPT-ENRICHMENT-GATE]`, `[ROUTE-DECISION-UNCERTAIN]`, `[FAILURE-REPEATED]`, `[PLAN-SCHEMA-DRIFT]`, `[ROUTE-META-UNCERTAIN]`.

**Class 2 — Operator notice** (status surface, no Claude action)

- Use when: substrate state changes that the human operator should know about, but no Claude-side semantic work is expected.
- Layer: stderr (SessionStart) preferred; UserPromptSubmit stdout *only* when the notice's resolution requires Claude to perform an Edit (rare; documented in the hook's header comment).
- Marker shape: same `[CATEGORY-NAME]` for visual consistency, but the body uses imperative language directed at the user, not at Claude.
- Reference: `[SELF-IMPROVE QUEUE]`, `[MARKETPLACE-STALE]`.

**Variant — Class 1 textual conventions on hard-gate substrate** (PreToolUse `decision: block`)

- Use when: silent-failure or security violation would result if the operation proceeded; the recovery is well-defined and re-invocable.
- Layer: PreToolUse, JSON `{decision: 'block', reason: '<forcing-shape text>'}`.
- Marker shape: same `[CATEGORY-NAME]` block inside the `reason` field for textual consistency; Claude reads, complies, retries.
- This is **not a peer Class 3** — single-instance is variant, not class. Document as Class 1 textual conventions applied to a different substrate (PreToolUse hard-gate).
- Reference: `[PRE-APPROVAL-VERIFICATION-NEEDED]`.

### Class selection decision tree

```text
Q: Does the operation already proceed (pass-through or post-completion)?
├── NO  → Use Class 1 textual conventions on a PreToolUse decision:block
│         (variant; reference: PRE-APPROVAL-VERIFICATION-NEEDED)
└── YES → Q: Is Claude-side semantic work expected?
          ├── YES → Class 1 (advisory forcing instruction)
          └── NO  → Class 2 (operator notice)
```

### Failure modes if violated

- **Class 1 with mechanical recovery**: operator drift (`[MARKDOWN-EMPHASIS-DRIFT]` pre-H.7.25) — Claude is asked to do work a script could do. Symptom: low landing rate, Claude ignoring instruction, misclassification by reviewers. **H.7.27 commitment**: migrate `[MARKDOWN-EMPHASIS-DRIFT]` to markdownlint pipeline absorption (preferred) or PreToolUse hard-gate (fallback).
- **Class 2 dressed as Class 1**: contributes to false count growth; future readers expect Claude-side action that never comes. Symptom: marker appears in retros but has no Claude-side work history. Pre-H.7.25, instructions 5+10 were mis-tagged as Class 1; reclassified by Convention G (no behavior change).
- **Class 1 when variant fits**: silent failure. The bad operation already completed. Convention D's PreToolUse-vs-PostToolUse decision tree applies orthogonally.
- **Variant when Class 1 fits**: friction. Every operation waits for blocking validation when advisory was sufficient (Convention D failure mode).

### Family cap rule

When the active forcing-instruction count crosses **N=15** (current 9 active post-H.7.26 consolidation + 6 headroom), the next phase MUST include a family audit before adding a 16th. Cap rationale: 6-headroom over current 9 = ~7 phases at the observed 0.85-instructions/phase growth rate. Wider than 3-headroom (the original draft) which would have triggered within 1-2 phases — defeating the cap's purpose as a forcing function. Drift-note 56 captures the magic-number concern; revisit after first cap-triggered audit.

### Reference implementations

See `skills/agent-team/patterns/forcing-instruction-family.md` for per-instruction class assignment, landing-rate observations, phase-tag origins, and verdicts. Cross-reference comments in each emission file (`hooks/scripts/...`) point at this convention.

### Phase

Shipped: H.7.25 (closes drift-note 21 — forcing-instruction architectural smell retrospective + taxonomy + catalog) + H.7.26 (closes drift-note 57 — consolidation execution; 11 → 9 active markers).

## Related Patterns

- [Route-Decision](route-decision.md) — also gates substantive work on environmental signals (the dictionary expansion v1.2 was about the gate being too aggressive in some cases; Convention A is the same lesson applied to validators)
- [Structural Code Review](structural-code-review.md) — the third leg of triple-contract verification; validators in this family follow the same separation-of-concerns principle
- [KB-Scope Enforcement](kb-scope-enforcement.md) — also distinguishes "did the actor read its declared scope?" (internal) from "are external KB sources fresh?" (environmental)
- [Plan-Mode HETS Injection](plan-mode-hets-injection.md) — Convention C originated in this pattern's enforcement layer (H.7.12 tiered plan template)

## Phase

Shipped: H.7.15 (Conventions A + B); reinforced H.7.18 (Convention C); extended H.7.19 (Convention D); extended H.7.21 (Convention E — closes drift-note 29); extended H.7.25 (Convention G — closes drift-note 21); executed H.7.26 (Convention G consolidation — closes drift-note 57; 11 → 9 active markers).
