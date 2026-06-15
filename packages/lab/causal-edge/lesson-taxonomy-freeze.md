<!-- lifecycle: persistent -->

# Lesson-signature taxonomy — the FROZEN axis (v3.11 W1 freeze record)

> **Status: FROZEN (2026-06-15).** This is the committed audit record (artifact 3 of the D1 one-way-door
> freeze). Artifacts (1) the enum values and (2) the `lessonClusterKey` constructor are committed in
> [`lesson-signature.js`](lesson-signature.js) **in the same wave/commit as this record** (resolving the
> audit-vs-code ordering: the doc and the code land together, so "frozen as above" is true at commit time).
> Source design: RFC
> [`packages/specs/rfcs/2026-06-15-v3.11-experience-layer.md`](../../specs/rfcs/2026-06-15-v3.11-experience-layer.md)
> Sec 6 (which labels its values PROPOSED and delegates the final audit to this W1 freeze). Plan:
> [`packages/specs/plans/2026-06-15-v3.11-w1-experience-organ.md`](../../specs/plans/2026-06-15-v3.11-w1-experience-organ.md).
> Reviewed by a 2-lens adversarial board (architect FREEZE-WITH-CHANGES + honesty-auditor Grade-C-OVERCLAIMS);
> all findings folded (see "Board folds" at the foot). USER ratified the **minimal reachable append-only floor**.

## Why this is a one-way door

The lesson signature `lesson:trigger-class | gotcha-class | corrective-class` is the **dedup / recurrence /
retrieval key** for every lesson node. Once nodes are minted against a value, **removing or renaming** it orphans
those nodes (their `lesson_signature` no longer re-derives, so `verifyNode` rejects them). **Adding** a value is
cheap and forward-compatible; **removing** one is the irreversible direction. The whole freeze discipline follows
from that asymmetry.

## The decomposition (architect fold): two freezes of different reversibility

1. **Mechanism + shape** — the constructor, the `lesson:` namespace, the colon/pipe delimiter reservation, the
   3-axis shape, and the content-hash basis. Genuinely irreversible (persisted nodes address on it) and
   **independent of the specific values**. Frozen HARD.
2. **The value set** — the specific entries below. Frozen as an **append-only FLOOR**: the floor is the minimal
   set the actual W1 data source (the OSS capture re-run) can mint and confirm. **Removal/rename is forbidden once
   any node is minted on a value; adding a value is permitted and cheap** (re-run the each-value-assignable audit
   for the new value only). This converts "did we guess the right value set against thin evidence?" (high-stakes)
   into "is this a defensible floor we will grow?" (low-stakes). See "Value-set evolution protocol" below.

## The freeze rule (strict)

**Every retained value must be derivable from a candidate-vs-accepted CODE diff (the W1 derivation leg's actual
input — `calibration-issue-run.js` `makeReferenceTeacher`), and assignable to a real resolved-issue fix attempt
the corpus can reach. Drop anything that can only describe how the *team/test/design process* fails (a
meta-lesson, not a code bug) OR that no v3.11 data source can exercise. Do not "keep in case."**

This is the same cut the RFC already applied when it trimmed `survivorship-bias` / `branch-off-main-first` /
`dogfood-before-claim`. The honesty board found four more meta-lessons had survived into the proposal
(`mock-not-real`, `harness-capability-assumed`, `probe-the-real-path`, `premise-probe-the-mitigation`,
`narrow-not-block`) — a `claude -p` contrast over an OSS itertools/wcwidth/parse diff cannot derive "you trusted a
green mock the real path falsified" or "you assumed a harness capability that doesn't exist." Those are dropped.

## The reconciliation target (firsthand census, 2026-06-15)

`~/.claude/lab-state/recall-graph-backtest/` holds 11 seed nodes; **7 carry a real `friction_signature_ref`**
(the floor is reconciled against these, not a blank slate). The friction axis is **orthogonal** to the lesson axis
(friction = how the *attempt* failed; lesson = what the *bug* was). Reconciliation = "can the lesson floor
classify the *bug* behind each of the 7 nodes?"

| Seed issue (repo) | bug | `trigger` / `gotcha` / `corrective` |
|---|---|---|
| nth-combination incorrect-exception (more-itertools) | guard caught some invalid inputs, not all | `boundary-contract` / `unguarded-edge-case` / `fail-closed` |
| sync-recipe eliminate-quadratic-fallback (more-itertools) | quadratic fallback on an ordering path | `api-shape` / `ordering-dependency` / `handle-edge-explicitly` |
| windowed invalid-size raise-exception (more-itertools) | guard caught `n<0` but not `n==0` | `boundary-contract` / `unguarded-edge-case` / `fail-closed` |
| numeric_range negative-step slice (more-itertools) | negative-step slice silently returned empty | `api-shape` / `silent-coercion` / `handle-edge-explicitly` |
| prepended-concatenation-mark-176 (wcwidth) | a codepoint category mis-routed in width calc | `data-parse` / `silent-coercion` / `handle-edge-explicitly` |
| empty-range numeric reversed (more-itertools) | empty/edge range reversed wrong | `boundary-contract` / `unguarded-edge-case` / `handle-edge-explicitly` |
| virama-width-capped-225 (wcwidth) | width silently capped | `data-parse` / `silent-coercion` / `handle-edge-explicitly` |

**No gap:** all 7 bugs classify in the floor; **5 distinct cells** over the 7 nodes (a 4x3x2 = 24-cell space) — real
separation, not collapse. (`fail-closed` and `handle-edge-explicitly` co-cover boundary fixes that raise vs fixes
that handle-the-edge — a real distinction the seed exercises.)

## Artifact (1) — the FROZEN floor

`friction_phase` is deliberately **NOT** a lesson key axis (YAGNI — no consumer filters on it; keeping it out of
the key is also the *reversible* direction: a future phase axis is an additive new key, never an orphaning edit).

### `TRIGGER_CLASS` (the situation the bug lives in) — 4

| value | meaning | seed anchor |
|---|---|---|
| `boundary-contract` | invalid-input handling, edge values, exception contracts | nth-combination, windowed, empty-range |
| `data-parse` | parsing / serialization / encoding / classification | wcwidth (x2), parse |
| `api-shape` | function signature / return shape / public surface | numeric_range, sync-recipe |
| `state-mutation` | shared / iterator / in-place state consumed wrong | two-repeat-iterator (seed-11) |

### `GOTCHA_CLASS` (the trap) — 3

| value | meaning | seed anchor |
|---|---|---|
| `unguarded-edge-case` | a missing boundary guard / off-by-one / unhandled edge value (the guard caught *some* cases, not all) | windowed (`n==0`), nth-combination, empty-range |
| `silent-coercion` | a type / precision coercion that drops data without erroring | numeric_range, wcwidth width-cap, parse precision |
| `ordering-dependency` | order / sequence sensitivity (iteration or sequence order) | sync-recipe quadratic, empty-range reversed |

### `CORRECTIVE_CLASS` (the principle) — 2

| value | meaning | seed anchor |
|---|---|---|
| `fail-closed` | raise / reject on invalid or unknown input — never silently fall through | windowed, nth-combination (raise on invalid) |
| `handle-edge-explicitly` | handle the boundary case correctly rather than fall through to a wrong default | numeric_range, empty-range, wcwidth, parse |

**Cardinality note (architect):** the floor is small (4/3/2) by design — it is what the W1 OSS data can *prove*,
not an aspirational set. The DEF-3 raw-collision diagnostic watches for under-separation; when distinct traps
start colliding in one cell, that is the empirical SIGNAL to append a value (the taxonomy grows in response to
data, exactly as designed). `fail-closed` and `handle-edge-explicitly` are the two most likely to need a sibling
first.

## Artifact (2) — the `lessonClusterKey` constructor + namespacing

```
lessonClusterKey(block) =
  'lesson:'
  + safeEnumKey(block.trigger_class,    TRIGGER_CLASS)    + '|'
  + safeEnumKey(block.gotcha_class,     GOTCHA_CLASS)     + '|'
  + safeEnumKey(block.corrective_class, CORRECTIVE_CLASS)
```

- **Open/Closed:** a NEW function + NEW frozen enums; `frictionClusterKey` (in `trajectory-friction.js`, which
  emits a PREFIX-LESS `class|phase|leg` key) and its callers + fixtures are **untouched**. The exact-key tally uses a NEW generic `groupByKey(blocks, keyFn)`,
  NOT `clusterFriction` (which is closed over `friction_*` field names and would collapse every lesson to
  `INVALID|INVALID|INVALID`). `clusterFriction` could be retrofitted onto `groupByKey` in a future non-frozen
  wave; NOT in W1 (it would break the 5 friction fixtures).
- **Shared primitive in a neutral module (architect fold):** `safeEnumKey` + the `INVALID` sentinel are extracted
  to [`packages/lab/_lib/enum-key.js`](../_lib/enum-key.js); BOTH the friction key and the lesson key import it
  from there. A primitive feeding two one-way-door key spaces must not live inside one of them (blast-radius /
  dependency-rule: both key modules depend inward on `_lib`, never sideways friction<->lesson). An off-enum /
  non-string field collapses to the literal `INVALID` — a deterministic, closed key component, never attacker
  bytes.
- **Namespace invariant (the freeze guarantee):** `lessonClusterKey(b)` ALWAYS starts with `lesson:`.
  `frictionClusterKey` emits NO prefix, so the two key spaces are disjoint by construction. **The `:` character is
  RESERVED as the namespace separator across all cluster-key spaces:** a delimiter-safety test asserts no value in
  `TRIGGER_CLASS` / `GOTCHA_CLASS` / `CORRECTIVE_CLASS` **or** `FRICTION_CLASS` / `FRICTION_PHASE` / `DETECTION_LEG`
  contains `:` or `|`. (Protecting the colon symmetrically on both key spaces is stronger than asserting the
  prefix on the lesson side alone — board MED.) All values are kebab-case `[a-z][a-z0-9-]*`.

## Artifact entanglement — the content-hash basis carries a SECOND one-way door (architect fold)

The lesson layer's tamper-evidence field
`lesson_content_hash = sha256(canonical({lesson_signature, lesson_body, accepted_diff_ref, candidate_patch_sha}))`
is itself frozen the moment the first lesson node persists: every producer must serialize **the same field set in
the same order through the same `canonicalJsonSerialize`**, or `verifyNode` rejects legitimate nodes (the M1
forward-coupling invariant). Disciplines, frozen alongside the enums:

- **Additive-only / versioned:** adding a tamper-evident field requires a *versioned* hash, never an in-place
  field addition (which would orphan prior lesson nodes). `friction_signature_ref` is EXCLUDED (re-derivable).
- **Single content-address for the candidate patch:** the sidecar key (full `sha256(candidate_patch)`) and the
  `candidate_patch_sha` inside `lesson_content_hash` MUST be the identical digest of the identical bytes — a test
  asserts `sidecar_key === candidate_patch_sha` for the same patch (no silent two-site divergence).
- **Presence defined by `lesson_content_hash`, fail-closed:** "a node HAS a lesson layer" iff `lesson_content_hash`
  is present. If ANY lesson field (`lesson_signature`/`lesson_body`/`accepted_diff_ref`) is present but
  `lesson_content_hash` is absent, `verifyNode` REJECTS (does not downgrade-to-lessonless). This closes the
  strip-to-look-absent attack (a forged `lesson_signature`+`lesson_body` with the hash stripped) — the VALIDATE
  hacker's likely target. A genuinely lesson-less worked-example node (no lesson fields at all) still PASSES.

## Value-set evolution protocol (append-only)

1. **Append-only.** Values are added, never removed or renamed, once any node is minted on a value.
2. **Addition gate.** Adding a value requires re-running the each-value-assignable audit *for the new value only*
   (one row appended to the floor tables above + a one-line note here).
3. **Empirical zero-referent report.** The capture re-run reports which frozen values received zero real referents
   (`consolidation-report.json`). A zero-referent value is NOT removed (append-only) — it is a signal not to
   speculatively add its siblings, and a candidate for the (future) Power-Loom-dev-history data source.
4. **The deferred values.** The Power-Loom-substrate-engineering lessons (`mock-not-real`, `read-path-not-frozen`,
   `harness-capability-assumed`, `content-not-verified-on-read`, `probe-the-real-path`, `freeze-deep`,
   `verify-content-on-read`, `premise-probe-the-mitigation`, `narrow-not-block`; triggers `auth-or-gate`,
   `concurrency`, `external-io`, `test-harness`, `env-setup`, `path-or-fs`; gotchas `subset-not-exact-set`,
   `path-not-canonicalized`, `stale-premise`) are **deferred, not deleted** — they are real, named lessons with no
   v3.11 data path. They re-enter via gate 2 when a data source that can mint them ships (the deferred Sec 9
   lab->spawn bridge / the trap-seam re-run, which would capture Power Loom's own dev attempts), OR when the
   expanding OSS corpus first exhibits one (e.g. a real path-traversal or membership-vs-set bug).

## Board folds (provenance)

- **Architect (FREEZE-WITH-CHANGES):** reserve `:` symmetrically; extract `safeEnumKey`+`INVALID` to `_lib`; name
  `lesson_content_hash` as a second one-way door (additive/versioned) + sidecar-digest-equality test; define
  presence by `lesson_content_hash` + fail-closed on strip-to-look-absent; decompose into mechanism (freeze hard) +
  value-set (append-only floor); don't defer. ALL folded.
- **Honesty (Grade C, OVERCLAIMS):** the prior draft claimed `lesson-signature.js` was committed when it did not
  exist (now ships in-commit); `subset-not-exact-set`/`exact-set-equality` were single-sample over-reads on the
  off-by-one bugs (re-classified to `unguarded-edge-case`/`fail-closed`); ~10/28 values were unreachable by the
  W1 OSS data source (dropped to the floor + deferred). ALL folded; the floor is the honesty-recommended reachable
  set with the gotcha gap (`unguarded-edge-case`) added.

## Verdict

FROZEN: `TRIGGER_CLASS` (4), `GOTCHA_CLASS` (3), `CORRECTIVE_CLASS` (2), append-only. Committed in
`lesson-signature.js` with `Object.freeze` + a delimiter/colon-safety test (both key spaces) + a
namespace-invariant test.
