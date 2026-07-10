# Design: the K12 layer-lint is vacuous, and it hides one real kernel to runtime import

Status: DESIGN / proposed. Surfaced by the multi-lens bug-bounty audit
(architect + QA lenses, findings #18 + #19), then re-investigated by a
three-lens design pass (architect / code-reviewer / honesty-auditor). This
is a decision doc: it puts the break-vs-allowlist choice, and the
detector-fix scope, in front of the maintainer. No code ships with it.

## The two findings

**#18 (vacuous detector).** `packages/kernel/_lib/layer-boundary-lint.js` is the
K12 advisory lint that is supposed to catch Dependency-Rule violations (an inner
layer importing an outer one). It walks the tree and, per its own header comment,
reports a `0-on-main "empirical-zero baseline"`. But its extractor is:

```js
const IMPORT_RE = /(?:require\(\s*|from\s+)(['"])(\.[^'"\n]{0,512})\1/g;
```

Capture group 2 is anchored to start with `.`, so it matches **static, relative,
string-literal** specifiers only. Every real cross-layer edge in this repo is a
**dynamically-composed absolute** require, e.g.
`require(path.join(findToolkitRoot(), 'packages', 'runtime', ...))`. The regex is
structurally blind to that shape. "0 findings" is a false negative, not a clean
tree. The lint is wired into CI as a non-blocking `layer-boundary-advisory` job
(`.github/workflows/ci.yml:416`), so it runs, reports 0, and reassures on the
basis of a blind spot.

**#19 (the coupling the blind spot hides).** ADR-0008
(`packages/specs/adrs/0008-phase-0-workspace-restructure.md`) declares a named
invariant: **"kernel has zero workspace deps; runtime depends on kernel; lab
depends on kernel + runtime"**. The DAG points inward only. Yet a kernel
validator reaches into runtime.

## What the probe established (accurate edge count)

The triage said "kernel to runtime coupling in contract-verifier". Probing the
actual code narrows it sharply. There are three kernel to runtime edges, but only
**one** is a genuine in-process source-dependency (import) coupling:

| # | Site | Mechanism | Is it an import edge? |
|---|---|---|---|
| 1 | `contract-verifier.js:769-776` | `require(_lifecyclePath)` -> `runtime/.../lifecycle-spawn.js`, calls `_readPersonaMd()` | **YES** — in-process require |
| 2 | `contract-verifier.js:788-831` | `child_process.spawn(node, [pattern-recorder.js, ...])` | No — subprocess boundary |
| 3 | `validate-adr-drift.js:92-107` | `invokeNodeJson(adr.js)` (execFileSync) | No — subprocess boundary |

Edges #2 and #3 fork a fresh node process; no runtime symbol enters the kernel
module graph. Per `kb:architecture/crosscut/dependency-rule`, the Dependency Rule
governs **source-code** dependencies; a process boundary is control-flow crossing,
not a compile-time edge. Both are additionally fail-soft (adr.js falls back to an
inline scan; pattern-recorder is best-effort and `unref`'d). They are a **distinct,
lower-severity coupling class** (the kernel still hard-codes a `packages/runtime/...`
path and each CLI's argv contract, a knowledge dependency), not the same violation
as edge #1.

> Note: the audit's own phrasing, and an earlier framing in this investigation,
> said "two in-process requires". That was wrong; the probe corrected it. The real
> in-process surface is a single edge. This is the runtime-claim probe discipline
> biting an abstract premise, and it is load-bearing here: it turns "break the
> coupling" from a big refactor into a one-function relocation (below).

### Edge #1, in detail

`contract-verifier.js` was moved kernel-side in the ADR-0008 Phase 0 restructure,
but its collaborator `_readPersonaMd` stayed runtime-side in `lifecycle-spawn.js`.
The comment at `contract-verifier.js:767` records that the layering-respecting
`require('./identity/lifecycle-spawn')` threw `MODULE_NOT_FOUND`, so the code
routes around it via `findToolkitRoot()` and a dynamically-composed absolute
`require` — which is exactly the mechanism the K12 regex cannot see.

`_readPersonaMd` itself (`lifecycle-spawn.js:76-82`) is a **6-line reader**:

```js
function _readPersonaMd(persona) {
  const { findToolkitRoot } = require('../../../kernel/_lib/toolkit-root');
  const personasBase = process.env.HETS_PERSONAS_DIR ||
    path.join(findToolkitRoot(), 'packages', 'runtime', 'personas');
  const fp = path.join(personasBase, `${persona}.md`);
  try { return fs.readFileSync(fp, 'utf8'); } catch { return null; }
}
```

Its only non-builtin dependency is `findToolkitRoot`, which **already lives
kernel-side**. It reads `packages/runtime/personas/<persona>.md` as a **data file**
by path; it drags zero runtime *code*. The SynthId primitive it feeds
(`computeContentHash` / `validateSuffix` / `parseSynthId`) also already lives
kernel-side in `_lib/synthid.js`. Only the reader is stranded runtime-side. It has
exactly two consumers: `lifecycle-spawn.js:181` (internal) and
`contract-verifier.js:773` (the cross-layer edge).

## The honesty verdict

The honesty-auditor lens rated the `0-on-main` claim **misleading**, and the
reasoning is worth preserving because it decides how much this matters:

- The header's `"ZERO observed cross-layer drift; acyclic-by-construction"`
  (`layer-boundary-lint.js:9-13`) is affirmatively false. A live kernel to runtime
  import exists; it is simply unobservable to the tool.
- The baseline test (`tests/unit/kernel/_lib/layer-boundary-lint.test.js:147-150`)
  does not verify "the tree respects the Dependency Rule". It verifies "the
  detector stays blind to the mechanism the tree uses". **The test protects the
  blind spot.**
- The OQ-19 upgrade-to-mandatory trigger (">= 3 observed drift events") can never
  fire on couplings that are unobservable by construction. The escalation path is
  dead.
- The `"span the cross-layer hop"` comments frame a documented Dependency-Rule
  violation as neutral intentional design, and cite ADR-0008 as authorization for
  precisely what ADR-0008 forbids. It is documented debt costumed as design; the
  chosen mechanism keeps the automated gate silent.

This is a **non-vacuous-guard** problem (per `security.md`: "a guard must be able
to fail; a check that never exercised its failure path is theater"). The K12 lint
has never once fired on the edge class it exists to catch.

## Decision D1 — fix the detector so it can SEE dynamic cross-layer requires

The detector fix is required **regardless** of how edge #1 is resolved; a blind
guard is the deeper defect. The code-reviewer lens assessed feasibility:

- **Recommended: a bounded two-step regex.** Regex #1 finds a
  `path.join(<expr>, 'packages', '<layer>', ...)` call and captures the assignment
  target identifier; a follow scan checks whether that identifier is later passed
  to `require(<identifier>)`. This matches the repo's actual two-line shape
  (`_lifecyclePath` built on one line, required on the next). No AST, no new
  dependency (the module is stdlib-only by design). Both regexes are bounded and
  ReDoS-safe, and reuse the existing `isCommentedMatch` suppression heuristic.
- **Rejected: an inline-only regex** (`require\(\s*path\.(join|resolve)\(`). Trivial,
  but catches zero of the real edges, which all build the path into a named
  variable first. Ships as a no-op.
- **Rejected: a full AST parse** (acorn/espree). The only fully-sound option, but it
  contradicts the module's stated stdlib-only / KISS-over-AST constraint, and adding
  a parser to close a one-instance residual gap on an advisory lint is
  disproportionate (YAGNI).

**False-positive surface (checked):** 17 kernel `.js`/doc hits mention
`packages/runtime` or `packages/lab`, but all are comments or contiguous-string
literals (e.g. a printed hint `'packages/runtime/schema/_format-spec.md'`). None use
the separate-argument `path.join(x, 'packages', '<layer>', ...)` call shape, so the
call-shape anchor structurally cannot match them. A naive contiguous-string detector
would do the opposite of what we want: false-positive on all ~15 comments and miss
the 3 real sites (whose `'packages'` and `'runtime'` are separate call arguments).

## Decision D2 — resolve edge #1 (the one real import coupling)

The architect lens evaluated four options. Summary:

| Option | What changes | Acyclicity | Effort | Risk | Makes ADR-0008 honest? |
|---|---|---|---|---|---|
| **A — BREAK / relocate** | Move `_readPersonaMd` into a kernel `_lib` (new `persona-md-reader.js`, or fold into `_lib/synthid.js`). `contract-verifier` imports it same-layer; `lifecycle-spawn` imports it back from kernel (legal inward edge), callsite unchanged | Strictly improves | **LOW** | **LOW** | **Yes, genuinely** |
| B — INVERT / re-home the validator tail | Move the SynthId-drift tail of `contract-verifier` out to runtime | Neutral to worse | MED-HIGH | MED | Capable, but wrong question |
| C — SUBPROCESS-IFY | Make edge #1 a CLI like #2/#3 | Removes the import | MED | MED | No — launders it past the blind lint |
| D — ALLOWLIST | Named-file exception in the lint + an ADR note | Unchanged (edge persists) | LOW | LOW mech / HIGH honesty | No — papers over |

**Recommended: Option A.** The fix is roughly 10-15 lines and strictly improves the
DAG. `_readPersonaMd` is the ideal relocation candidate: its sole non-builtin dep is
already kernel-side, it reads a data file (not an import), and the hash primitive it
feeds is already kernel-owned. `lifecycle-spawn` imports the reader back from kernel
rather than keeping a copy, restoring a single source of truth. Behavior is
invariant (same file read, same fail-soft).

- **B** fights gravity: the validation logic (`validateSuffix` / `parseSynthId`) is
  already kernel-imported, so re-homing the tail splits a cohesive output object
  across the boundary and, if done as a call-out, re-introduces the very edge we are
  removing.
- **C** is cargo-culting here. A subprocess boundary is honest decoupling when the
  callee is heavy or side-effecting (which is why #2/#3 legitimately are one). For a
  synchronous pure 6-line `readFileSync`, forking a node process turns a nanosecond
  read into a ~30-70ms spawn on the verification path, to buy nothing but
  invisibility to the lint. It launders a real coupling into a shape the already-blind
  detector cannot see.
- **D** is silencing. An allowlist is legitimate only when the edge is irreducible;
  here the fix is trivial and strictly better, so an allowlist institutionalizes the
  false negative. Do not conflate "allowlist the edge" with "fix the blind detector":
  the detector fix (D1) is mandatory either way.

## Sequencing — one honest tension to decide

The reviewer and architect lenses differ on staging, and it is a real choice:

- **Architect (recommended): bundle D1 + Option A, detector fires RED first.** Extend
  the detector so it counts edge #1 as a real finding, watch the baseline test go RED
  on main (proving the guard can fail, per the non-vacuous discipline), then apply
  Option A in the same change so the now-seeing detector returns to GREEN for a real
  reason (the edge is gone, not merely unseen). Landing them together is what makes
  the fix honest: detector-alone turns main red (or forces the D-style allowlist that
  re-silences); A-alone leaves the blindness so the next dynamically-composed edge
  re-opens the same false negative silently.
- **Reviewer (more conservative): land D1 in the non-counting `notes` tier first.**
  The module already ships an unused `notes: []` seam whose docstring says it "NEVER
  feeds the exit code". Emit the new dynamic-require detections there, so the edge
  becomes visible in CI advisory output with zero risk to the exit-code baseline or
  the coverage-twin's `findings.length === 0` assertion, then decide count-vs-allowlist
  vs resolve as a deliberate follow-up.

The two reconcile if the maintainer accepts the end-state (Option A + the edge
counted, with the baseline test asserting the specific removal). The `notes` tier is
then only an optional intermediate if you want the detector-fix PR split from the
coupling-fix PR. My recommendation is the architect's bundle, because the `notes`
tier is itself a soft version of the non-vacuous-guard problem: a finding that never
counts has, again, never proven it can fail.

Both lenses agree on one guardrail: **do not add the subprocess detector (#2/#3) in
the same pass.** It is a different coupling class; conflating it with `inner-imports-outer`
risks flagging a deliberate process-boundary decoupling as if it were an in-process
violation. The require-graph is genuinely acyclic across #2/#3.

## Scope guard — what this RFC does NOT touch

- **No egress / arming surface.** This is entirely within the kernel validator +
  advisory-lint layer. It does not touch `packages/kernel/egress/`, any arming flag,
  `/etc/loom`, or `--attested-cross-uid`. Those remain operator-only.
- **#20 (429 backpressure) is out of scope.** That is the live emit path with its own
  arming sensitivity and deserves its own 3-lens egress review.
- **The subprocess NOTE class for #2/#3 is a deferred follow-up** (YAGNI until there
  is a third process edge or a reason to track path-contract coupling).

## Open questions for the maintainer

1. **D2 direction:** Option A (relocate, recommended) or Option D (allowlist edge #1
   with a documented rationale)? A is the honest close; D is only right if there is a
   reason the reader must stay runtime-side that the probe missed.
2. **Sequencing:** bundle D1 + A (architect, recommended), or stage D1 in the `notes`
   tier first (reviewer)?
3. **Relocation home:** a new `packages/kernel/_lib/persona-md-reader.js`, or fold the
   6-line reader into the existing `_lib/synthid.js` (which it exists to feed)?

On approval of a direction, the implementation is a single small PR (the kernel
validator, the detector, and the baseline-test update), TDD-first, with the detector
proven to fire RED on the pre-fix tree before Option A turns it GREEN.
