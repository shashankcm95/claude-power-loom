---
date: 2026-06-02
status: complete
lifecycle: ephemeral
topic: "Contract-binding — make the 16 HETS archetypes' named instincts machine-visible + enforced"
related:
  - packages/runtime/personas/        # source of truth (numbered ## Mindset headings)
  - packages/runtime/contracts/        # mirror target (interface.instincts)
  - packages/runtime/orchestration/contracts-validate.js   # the reconciliation validator
  - packages/specs/research/2026-06-02-persona-instinct-kb-gap-harvest.md
---

# Plan — Contract-Instinct Binding (persona-depth follow-up item 2)

## Objective

PR #205 added a named-instinct `## Mindset` set to all 16 HETS archetype role-briefs
(descriptive prose). This follow-up makes those instincts **machine-visible and enforced**:
add an `interface.instincts` array to each of the 16 `*.contract.json`, and extend the
reconciliation validator (`contracts-validate.js`) to enforce **role-brief ↔ contract instinct
parity** so the two cannot drift.

This is the enforcement-level step the snapshot flagged: today the depth is descriptive only.

## Design decision — heading-normalization is the parity basis (NOT the referral prose)

The role-brief carries instincts in TWO forms: the numbered `## Mindset` headings
(`6. **Layer-boundary discipline**`) and the hand-written `Instinct → KB referral` slugs
(`layer-boundary`). A probe (`/tmp/extract-instincts.js`) proved the **referral-block prose is
NOT robustly machine-parseable** — it over-splits on `/` and `+`, misses some KB-gap slugs, and
double-counts grouped slugs (8/16 archetypes mis-counted).

The **numbered headings ARE robustly extractable** (section-scoped regex `^\d+\.\s+\*\*(name)\*\*`
within the `## Mindset` block). So the canonical instinct **slug = a deterministic normalization
of the heading**:

```
slug = heading.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
```

A second probe (`/tmp/normalize-instincts.js`) confirmed this yields **170 unique slugs across all
16 archetypes, zero collisions**. The validator recomputes the slug from the brief and compares
exactly to `interface.instincts` — no dependence on the fragile referral prose. The referral block
(human-facing KB linking, shipped in #205) is left untouched; the contract layer is a separate,
mechanically-verifiable mirror.

Trade-off: the contract slug (`layer-boundary-discipline`) differs from the referral slug
(`layer-boundary`). Accepted: they serve different layers (machine enforcement vs human KB-link),
each is internally consistent, and the deterministic derivation is what makes the validator robust.

## Runtime Probes (claims verified against the actual repo before building)

- **Validator auto-enumerates** — `contracts-validate.js` runs `Object.keys(validators)` and exits 1
  on any violation; a new `validators['persona-instinct-reconcile']` needs NO CI wiring.
  Probe: read `contracts-validate.js:1219-1248`.
- **No validator-count assertion** — only `agent-contract-reconcile.test.js:148` checks a *named*
  validator is present, not a total. Adding one breaks nothing. Probe: `grep length/count` in tests.
- **CI runs the test dir** — `.github/workflows/ci.yml:199` finds `tests/unit/runtime/contracts/*.test.js`;
  a new test file auto-runs (+ a vacuous-pass guard). Probe: `grep tests/unit/runtime ci.yml`.
- **1:1 brief↔contract mapping** — `NN-name.contract.json` ↔ `packages/runtime/personas/NN-name.md`;
  all 16 numbered pairs exist; `challenger`/`engineering-task` have no numbered brief → skip
  (mirrors the existing reconcile validator's un-numbered skip). Probe: `ls` both dirs.
- **Additive-safe field** — no JSON schema validates persona contracts (no ajv; `_format` points to a
  markdown doc); no consumer iterates a closed set of `interface` keys. `interface.instincts` is
  ignored by every existing reader. Probe: `ls packages/kernel/schema` (no persona-contract schema).
- **Importable refactor is safe** — nothing `require()`s `contracts-validate.js` (tests exec it as a
  subprocess); wrapping the CLI main in `if (require.main === module)` + exporting helpers is safe.
  Probe: `grep -rn "require.*contracts-validate"` → none.

## TDD-treatment arc (validator is the substrate rewrite; test-first)

1. **Test first** — `tests/unit/runtime/contracts/persona-instinct-reconcile.test.js`, mirroring
   `agent-contract-reconcile.test.js`: synthetic `HETS_TOOLKIT_DIR` roots for negative paths +
   a real-repo zero-violation regression. Cases:
   - validator registered in the dictionary
   - brief has instincts but contract has no `interface.instincts` → `instinct-binding-missing`
   - brief `[a,b,c]`, contract `[a,b]` → `instinct-missing-from-contract` (c)
   - brief `[a,b]`, contract `[a,b,c]` → `instinct-not-in-brief` (c)
   - brief `[a,b,c]` == contract `[a,b,c]` → 0 violations
   - un-numbered template (no brief) → skipped, 0 violations
   - (real) all 16 real contracts → 0 violations  ← GREEN only after population
2. **Run red** — validator missing → all fixture tests fail.
3. **Impl validator** — add `PERSONAS_DIR`, `slugifyInstinct()`, `mindsetInstinctSlugs(briefText)`,
   `validators['persona-instinct-reconcile']`; wrap CLI main in `require.main === module`; export
   helpers. Fixture tests go green; the real-repo test stays red (contracts not yet populated).
4. **Populate** — a one-time script imports `mindsetInstinctSlugs` from the validator (guarantees
   the populated slugs EXACTLY match what the validator computes) and writes `interface.instincts`
   into all 16 contracts, in heading order, preserving JSON formatting.
5. **Run green** — `contracts-validate.js --scope persona-instinct-reconcile` → 0 violations; the
   real-repo regression test passes.

## Files touched (~19)

- NEW `tests/unit/runtime/contracts/persona-instinct-reconcile.test.js`
- EDIT `packages/runtime/orchestration/contracts-validate.js` (validator + helpers + main-guard + exports)
- EDIT 16× `packages/runtime/contracts/NN-name.contract.json` (add `interface.instincts`)
- EDIT `packages/runtime/schema/_format-spec.md` (1 short subsection documenting the field — discoverability)
- Role-briefs are NOT touched (slugs derive from existing headings).

## Verification

- `node tests/unit/runtime/contracts/persona-instinct-reconcile.test.js` → all pass
- `node packages/runtime/orchestration/contracts-validate.js` → totalViolations 0 (full suite, no regressions)
- Full kernel suite `find tests/unit/kernel -name '*.test.js' -print0 | xargs -0 -n1 node` → unchanged
- `bash install.sh --hooks --test` (eslint/yaml/markdownlint) → green
- code-reviewer pass (substrate change to a CI-gating validator + 16 data files)

## Deferred (out of scope for this PR — KISS / reviewable)

- The **optional output-check** (a `required:false` functional check in `contract-verifier.js`
  rewarding an actor for naming an instinct slug in its report). Touches the spawn-output path +
  needs a new check type; assess separately after this lands.
- The ~10 single-lens KB-gaps (follow-up item 1).

## Outcome (code-reviewer pass: Warning → addressed)

A `code-reviewer` spawn returned **Warning** (no blockers) with hardening findings, all folded in:

- **HIGH** duplicate-slug collision (two headings normalizing to one slug passed silently) → now a
  `instinct-duplicate-slug` violation (`duplicateSlugs` helper + test).
- **HIGH** brief read-error failed open (existing-but-unreadable brief → silent clean) → now
  fail-closed: read errors propagate to a distinct `brief-unreadable` violation (+ EISDIR test).
- **MEDIUM** mutable `validators` export + **PRINCIPLE/SRP** (slug helpers in the validator file) →
  resolved together by extracting the helpers to `_lib/instinct-slug.js`; the validator no longer
  exports anything (the `main()`/`require.main` wrap was reverted — nothing imports the validator).
- **MEDIUM** numbered-contract-no-brief path untested + **LOW**s (loose `>=1`, misleading test name)
  → added the missing cases; test now 17 (4 unit + 13 integration).
- Added `instinct-binding-malformed` for a non-array `interface.instincts`.

Final: 17/17 test; all runtime/contracts tests pass; kernel 44/44; eslint clean; markdownlint clean;
`install.sh --hooks --test` 118/0; validator `persona-instinct-reconcile` 0 violations (the 26
pre-existing `contract-plugin-hook-deployment`/`contract-skill-status-values` violations are
env-dependent and unchanged — identical on pristine main).

## Risks

- **Slug churn**: if a brief heading is later reworded, the slug changes and the validator fails
  until the contract is re-synced — that is the intended drift-catch, with a clear `fix` message.
- **Apostrophe/punctuation edge**: only `03-code-reviewer`'s "Cite-or-it-didn't-happen" has an
  apostrophe; the `replace(/['']/g,'')` pre-step keeps it clean (`cite-or-it-didnt-happen`).
