---
pattern: validator-conventions
status: active
intent: Conventions for hook validators that mix repo-internal checks with external-dependency checks, plus self-documenting stderr message discipline. Codifies lessons learned from H.7.10 marketplace gating + H.7.12 plan-template enforcement.
related: [route-decision, structural-code-review, kb-scope-enforcement]
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

## Related Patterns

- [Route-Decision](route-decision.md) — also gates substantive work on environmental signals (the dictionary expansion v1.2 was about the gate being too aggressive in some cases; Convention A is the same lesson applied to validators)
- [Structural Code Review](structural-code-review.md) — the third leg of triple-contract verification; validators in this family follow the same separation-of-concerns principle
- [KB-Scope Enforcement](kb-scope-enforcement.md) — also distinguishes "did the actor read its declared scope?" (internal) from "are external KB sources fresh?" (environmental)

## Phase

Shipped: H.7.15
