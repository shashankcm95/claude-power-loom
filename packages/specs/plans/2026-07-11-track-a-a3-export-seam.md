# Track A A3-on-v1 — toolkit→Embers export seam (`bank`-ready node + meta pair)

**Status:** planned 2026-07-11. Closes **A3** of the external-readiness checklist
(`2026-07-10-external-readiness-checklist.md`) on **v1** per the single-user ratification (#569).

## Context

A3 is the last learning-substrate build before the external-readiness `/phase-close`: a toolkit-side export
seam that emits a `bank`-ready `(node.json, meta.json)` pair the Embers commons ingests via
`embers bank --node <node> --meta <meta> --key <ed25519.pem>`. The node is the frozen 7-key `world_anchored`
body emitted VERBATIM (Embers re-parses + re-derives its two seals); the design work is assembling + validating
the `meta` shape Embers requires — `minter:{persona_id, human_root}` + `prUrl` + `repoSlug` — by joining the
node to the already-sealed attestation + persona-attribution stores. SHADOW / weight-inert: the export writes
two JSON files, banks nothing, touches no network, arms nothing (OQ-NS-6: it hardens nothing).

## Routing Decision

`route-decide.js` → **borderline** (score 0.112, borderline-promoted; `[ROUTE-META-UNCERTAIN]` on the
substrate-meta token `attestation`). Verbatim decomposition: `compound_strong` matched `canonical-json`
(0.075) + `compound_weak` matched `design` (0.0375); `weights_version v1.3-dict-expanded-2026-06-12`;
thresholds route=0.6 root=0.3. Disposition: the design is already decided (byte-parity PROVEN, join map probed),
but the seam touches provenance labeling + #273 (integrity≠provenance), so it is driven through the full
per-wave workflow (plan → 3-lens VERIFY → TDD → 3-lens VALIDATE). The VERIFY/VALIDATE boards ARE the
architect involvement. (Route-decide's recurring borderline on this class — "schema migration", "signed
basis", now "export seam / attestation" — is a dictionary-expansion candidate, noted in Drift Notes.)

## HETS Spawn Plan

- **VERIFY (pre-build, on this plan)** — 3 read-only lenses in parallel: `architect` (seam shape + the
  verify-on-emit / DRY-vs-drift decision), `code-reviewer` (fail-closed join paths, dir-threading, exact-set
  meta), `hacker` (can the export launder a tampered node / a forged provenance label / breach a mint dam?).
- **VALIDATE (post-build, on the built diff, Rule 2a live probes)** — a Workflow fanning `code-reviewer` +
  `hacker` + `honesty-auditor` over the built module + CLI + tests, each building live probes against the real
  emitted pair (not the mocked seam).

## Files To Modify

| File | Change | Risk |
|---|---|---|
| `packages/lab/world-anchor/export-bank-pair.js` | **NEW** pure core: `buildBankPair({node, prUrl, repo, prNumber, personaId, humanRoot})` → `{ok, node, meta}` or `{ok:false, reason}`. Re-verifies the node body (reuse the store's verifier), validates meta exact-set + Embers field regexes, cross-checks repoSlug↔prUrl. | med (security-relevant boundary) |
| `packages/lab/world-anchor/live-recall-store.js` | Extract the pure body-verifier from `readNodeRaw` into an exported `verifyNodeBody(parsed) → reason\|null`; `readNodeRaw` calls it (behavior-preserving); export it for the emit-boundary reuse. Fallback if VERIFY prefers a smaller blast radius: export `computeContentHash` and re-check in the core. | med (edits a #273 verify-on-read path — must stay green) |
| `packages/lab/world-anchor/cli.js` | **NEW** `export-bank-pair` subcommand: `--node-id`, `--human-root` (required, operator config), `--out-dir` (else stdout), dir-threading opts, `--persona-id`/`--pr-url`/`--repo` overrides. Reads node→attestation→persona, fail-closed with a clear reason per missing join, calls the core, writes/emits the pair with an integrity≠provenance note. + USAGE. | med |
| `tests/unit/lab/world-anchor/export-bank-pair.test.js` | **NEW** core + the frozen byte-parity vector (Embers dogfood node → known node_id/content_hash) + fail-closed cases + round-trip. | low |
| `tests/unit/lab/world-anchor/live-recall-store.test.js` | Add `verifyNodeBody` unit tests; confirm the 37 existing stay green. | low |
| `tests/unit/lab/world-anchor/export-cli.test.js` | **NEW** the subcommand join + fail-closed + stdout/out-dir. | low |
| `packages/specs/plans/2026-07-10-external-readiness-checklist.md` | Mark A3 ✅ DONE + PR link (at PR time). | low |

## Phases (TDD)

1. **Verifier extraction** — extract `verifyNodeBody` from `readNodeRaw`; run the live-recall-store suite (must stay 100% green — behavior-preserving).
2. **Core (test-first)** — write `export-bank-pair.test.js` describing `buildBankPair`'s contract (valid pair; each fail-closed reason; the byte-parity vector; round-trip). Then impl `buildBankPair`.
3. **CLI wire** — the `export-bank-pair` subcommand + its join + `export-cli.test.js`.
4. **Full-suite + drift gates** green; VALIDATE board; PR.

## Verification Probes

- `node byte-parity-probe`: toolkit derivation reproduces BOTH Embers golden fixtures' node_id/content_hash (already run → MATCH ×2; frozen as the test vector).
- `buildBankPair` on the Embers dogfood node + a `{persona_id, human_root}` → a meta that re-validates against the Embers v1 field rules (prUrl `^https://github.com/`, repoSlug `owner/repo`, minter exactly 2 keys).
- fail-closed: a tampered node (mutated lesson_body, extra key, wrong provenance) → `{ok:false, reason}`, never an emitted pair; a missing attestation / persona join → clear CLI reason + non-zero exit.
- round-trip: mint → export node.json → `JSON.parse` → re-derive → seals still verify.
- full kernel + lab suites green; `install.sh --hooks --test`; eslint/markdownlint/release-surface/signpost gates.

## Runtime Probes (claims verified against the live repos, 2026-07-11)

| Claim | Probe | Result |
|---|---|---|
| The two seal algorithms are byte-identical across repos | ran the toolkit's `canonicalJsonSerialize` + seal derivation over BOTH Embers golden fixtures | `node_id` + `content_hash` MATCH ×2 (`byte-parity-probe.js`) |
| Embers re-parses the node and re-derives both seals (file byte-order irrelevant; value-parity is what matters) | read `build-lesson.js:43-63` + `content-address.js:49-63` firsthand | confirmed: `deriveLiveNodeId(node)` + `computeNodeContentHash(node)`, refuse on mismatch |
| Embers requires meta `minter:{persona_id, human_root}` (exact-2), `prUrl` (`^https://github.com/`), `repoSlug` (`owner/repo`) | read `build-lesson.js:28-33` + `lesson-v1.js:76-79` | confirmed; extra minter key is silently dropped at rebuild (contract C1) — the toolkit emits exactly 2 |
| Unsigned v1 node banks; `--key` is a throwaway integrity-only ed25519 key (no arming) | read `publish.js:25-35`, `mint-pipeline.js:33`, `inrepo-signer-adapter.js:3-4`, dogfood README | confirmed: node carries no DSSE; bank mints the sig; no custody/arming key for v1 |
| v1 is the frozen 7-key node; v2 pins are META-ONLY, node UNCHANGED; v2 is UNBUILT (`bank` hardwired to v1) | read `ember-v2-contract.md` §0/§2/§6/§8 + `lesson-v1.js:116` REGISTRY | confirmed → A3-on-v1 emits `predicate_version` NOTHING (Embers builds v1); never emit v2 |
| The join readers exist | grep | `readLiveNode`, `readAnchor(anchor_id)`→`{pr_url,repo,pr_number,built_by}`, `lookupPersonaForPr(repo,pr_number)`→`persona`; `deriveLiveNodeId` exported, `computeContentHash` NOT |
| node.anchor_id joins the attestation | `readAnchor` keyed by `anchor_id`=sha256({repo,issueRef,diff_hash}); node carries the same `anchor_id` | join key confirmed (VERIFY hacker to confirm node.anchor_id === attestation.anchor_id holds for a real minted node) |

## Out of Scope (Deferred)

- **The v2 advisory pins export** (`context_commons_ref`, `persona_def_ref`, `recall_graph_root`, `runtime`) — Embers `bank` is hardwired to v1 + no pin-consumer exists (single-user ratification). Emitting `predicate_version:2` would fail-closed `unknown-predicate-type` on the Embers side.
- **gap8-a0b** — binding persona into the `world_anchored` SIGNED basis at mint (the node is frozen; persona stays a self-asserted meta label). Multi-party only.
- **The actual `embers bank` invocation + `--key`** — operator-side (a throwaway ed25519 key); Claude never banks. The toolkit's job ends at the emitted pair.
- **The live recall round-trip / any weight hardening** — arming-gated by design.
- **An authenticated `human_root`** — v1 `human_root` is an operator-supplied single-user LABEL (the "operator vouches" model), not a cryptographic root. The export must NOT claim it is authenticated.

## Drift Notes

- route-decide returned **borderline** again on a schema/seam-shaped substrate task (token: `attestation`). Third instance this arc (after "schema migration" / "signed basis" on W1/W2). Dictionary-expansion candidate for the `stakes`/`compound_strong` lexicon — the export/attestation/bank-seam class is architect-shaped but under-scores. Batched for `/self-improve`.
- The byte-parity handshake is a FROZEN shared test vector, not a live cross-repo import — the Embers repo isn't a CI dependency. If either side's `canonical-json.js` drifts, the vector fails on the toolkit side (a regression guard). This mirrors the contract's "confirm with a shared test vector BEFORE the first real bank" (`ember-v2-contract.md:59-64`).

## Pre-Approval Verification

3-lens VERIFY board (architect + code-reviewer + hacker, parallel, read-only, on this plan + the
post-#568/#569 source). Verdicts: architect **SOUND-WITH-NOTES**; code-reviewer **NEEDS-REVISION**;
hacker **NEEDS-REVISION**. All findings folded into the revised design below.

**Confirmed premises** (board resolved the plan's two deferred probes):
- `node.anchor_id === attestation.anchor_id` HOLDS by construction — `world-anchor-mint.js:498-503` (the sole
  mint path) sets `anchor_id: resolved.anchor_id`. Promoted from "to confirm" to confirmed.
- The import-graph dam (`shadow-import-graph.test.js:100`) is DIRECTORY-based — the new module in
  `packages/lab/world-anchor/` is auto-exempt; no dam edit for the store imports.

**Keystone resolution — DROP the persona-map read (code-reviewer CRITICAL + hacker H1, converged):**
sourcing `persona_id` via `lookupPersonaForPr` would break the exactly-one-reader dam
(`persona-attribution-shadow.test.js:91-100`, a deterministic CI failure) AND egress a first-write-wins,
pre-seedable self-asserted label to an external commons. **Fix:** `persona_id` is OPERATOR-supplied
(`--persona-id`, required); the export does NOT read the persona store. Keeps the dam intact (zero test
change), moots the pre-seed poisoning (hacker M2), matches the operator-vouched v1 model, drops the store
count 3→2. No `persona-attribution-shadow.test.js` edit.

**Folded findings:**
- **hacker H2 [HIGH]** — `readAnchorRaw` re-derives only anchor_id + content_hash; it does NOT run
  `validateAttestation` on read (asymmetric with its siblings), so a planted attestation with a foreign/garbage
  `pr_url` reads back "verified". The export re-validates `pr_url` against the STRICT full shape
  `^https://github.com/<owner>/<repo>/pull/<n>$` + cross-checks `owner/repo === repo && n === pr_number` (the
  `merge-outcome-store.js:146-149` rigor, NOT Embers' loose `^https://github.com/` prefix). Never trust the
  attestation's returned fields.
- **hacker H3 + code-reviewer #4 + architect #1/#2** — verify-on-emit: extract the FULL pure body-verifier
  `verifyNodeBody(parsed) → reason|null` from `readNodeRaw` (provenance + validateBlock + exact-set BEFORE the
  two seal re-derivations — the exact-set ordering is load-bearing: an injected 8th key + a recomputed
  content_hash passes a seals-only check). `readNodeRaw` keeps its SEPARATE filename-tie check
  (`parsed.node_id === node_id`) after the call — verifyNodeBody is BODY-only, no filename in scope. Reject the
  "export computeContentHash + duplicate the sequence" fallback (Option B — duplicates the check sequence =
  drift leak). Reconstruct the emitted node from the 7 whitelisted `STORED_KEYS` (structurally drop any extra).
- **architect #4 [MED]** — add a `node.lesson_signature === attestation.lesson_signature` join cross-check in
  the CLI layer (fail-closed `lesson-signature-mismatch`). Cheap, strongest available node↔meta binding;
  honestly still integrity-not-provenance (a coordinated co-forge sets both equal).
- **architect #3 [MED]** — parse `prUrl` once; assert BOTH `owner/repo === repo` AND `pull/<n> === prNumber`.
- **architect #5 [MED] + hacker** — REMOVE the `--pr-url`/`--repo` overrides (they convert a fail-closed
  refusal into an operator bypass, decoupling the meta from the verified attestation). `pr_url`/`repo`/
  `pr_number` come STRICTLY from the `readAnchor` join. Only `--human-root` (+ `--persona-id`) are operator
  inputs — values no store holds.
- **architect #6 + code-reviewer #6 + hacker M1** — validate `human_root` + `persona_id` as bounded,
  non-empty, control-char-free (reuse `isBoundedPlainString`, `cli.js:210-213`, rejects C0/DEL/C1). Construct
  `minter` as an explicit exactly-2-key literal `{persona_id, human_root}`. Output filenames derive from
  `node_id` (hex64) ONLY — never `human_root`/`persona_id` (no `../` traversal). `--out-dir` exclusive-create
  (`wx`) so a re-run can't clobber.
- **code-reviewer #2 [HIGH]** — the 2 store dirs (live-recall + world-anchor) thread all-or-nothing (0 or 2),
  mirroring the mint's FOLD-B (`cli.js:321-330`); tests set `LOOM_LAB_STATE_DIR` to a tmpdir BEFORE require AND
  thread both dirs (never a subset — the documented `cli.test.js` cross-write incident).
- **code-reviewer #3 [MED]** — validate `repo` is a strict 2-segment `owner/repo` before emitting `repoSlug`
  (the attestation store only length-bounds it).
- **architect #7 [LOW]** — omitting `failureSignature` (Embers defaults it to `node.lesson_signature`) is the
  RIGHT call; note the forward-coupling to Embers' frozen default.
- **code-reviewer #5 + hacker L1 [LOW]** — tests assert output key casing (snake_case `persona_id`/`human_root`
  inside minter; camelCase `prUrl`/`repoSlug`) + the meta key-set is EXACTLY `{minter, prUrl, repoSlug}` with
  no auth-implying field; the CLI stdout carries the integrity≠provenance note.
- **hacker arming trip-line** — H1/H2/M2 are weight-0 residuals TODAY; they become CRITICAL the instant any
  weight/authz consumer reads the emitted `meta.minter`. The module header + stdout note carry this precondition
  forward.

### Revised Files To Modify (supersedes the table above)

| File | Change |
|---|---|
| `packages/lab/world-anchor/live-recall-store.js` | Extract `verifyNodeBody(parsed) → reason\|null` (full body chain) from `readNodeRaw`; `readNodeRaw` calls it + keeps the separate filename-tie check; export it. |
| `packages/lab/world-anchor/export-bank-pair.js` | **NEW** pure core: `buildBankPair({node, prUrl, repo, prNumber, personaId, humanRoot})`. verifyNodeBody → reconstruct 7-key node → bound/control-char persona_id+human_root → strict-full-shape prUrl + `owner/repo===repo && n===prNumber` + 2-segment repo → explicit 2-key minter → `{ok, node, meta}` / `{ok:false, reason}`. |
| `packages/lab/world-anchor/cli.js` | **NEW** `export-bank-pair` subcommand: `--node-id`, `--human-root`, `--persona-id` (all req), `--out-dir` (else stdout), 2-dir all-or-nothing threading, NO pr-url/repo overrides. Reads node→attestation, asserts lesson_signature match, calls the core, writes/emits with the integrity≠provenance note. + USAGE. |
| `tests/unit/lab/world-anchor/live-recall-store.test.js` | Add `verifyNodeBody` unit tests; the 37 existing (incl. the filename-forge guard `:129-138`) stay green. |
| `tests/unit/lab/world-anchor/export-bank-pair.test.js` | **NEW** core: the frozen byte-parity vector, every fail-closed reason, exact output key-set + casing, round-trip. |
| `tests/unit/lab/world-anchor/export-cli.test.js` | **NEW** the subcommand join + fail-closed + stdout/out-dir + dir-threading (LOOM_LAB_STATE_DIR before require). |
| `packages/specs/plans/2026-07-10-external-readiness-checklist.md` | Mark A3 ✅ DONE + PR link (at PR time). |

No `persona-attribution-shadow.test.js` change (persona read dropped). No dam edit.

## VALIDATE result

3-lens VALIDATE board (code-reviewer + hacker + honesty-auditor, parallel Workflow, Rule 2a live probes on
the BUILT diff). Verdicts: **all three SOUND-WITH-NOTES**, no CRITICAL/HIGH build defect. The two Bash-enabled
lenses ran extensive live probes (23 adversarial cases + byte-level egress inspection + a monkeypatched-fs
partial-write probe); the honesty-auditor (read-only persona) statically traced + CONFIRMED all five
load-bearing claims true against the code (verifyNodeBody genuinely reused not re-implemented; the export IS
the last pr_url well-formedness line; isolation atomic; integrity!=provenance emitted-and-true; deferred items
not half-built). Runtime evidence (suites GREEN + byte-parity MATCH x2) firsthand-run by the orchestrator + the
two Bash lenses.

**Folded (7):**
- **[MED, must_fix] writePair partial-write** — a meta.json write failure after node.json succeeded orphaned
  node.json and bricked the out-dir (every retry -> out-dir-occupied). FIX: rollback-unlink node.json on
  meta.json failure; mkdir failure gets its own `out-dir-unusable` reason. Regression test:
  monkeypatched-fs ENOSPC on the 2nd write -> node.json rolled back, retry succeeds.
- **[MED, hacker] Trojan-Source at the egress boundary** — `isBoundedPlainString` missed the Unicode
  bidi/zero-width/line-sep set (U+202E, U+2066-9, U+2028/9, U+200B-F, U+FEFF, U+00A0/AD) that landed RAW in the
  egressed meta.json crossing to the external commons. Also an over-claim (the guard bills itself as
  log-injection defense). FIX: `isForbiddenLabelChar` rejects the full dangerous set. 14 new tests.
- **[LOW] `--out-dir ''`** silently fell to stdout (falsy) -> now bad-args.
- **[LOW] non-trimmed pr_url** would diverge meta.prUrl from the sealed value -> rejected up front.
- **[NIT] PROVENANCE_NOTE** dropped from the write-failed refuse (the note rides ONLY a produced pair).
- **[NIT] node snapshot** — `{...node}` once at buildBankPair entry closes the getter-double-read window
  (honors the "self-defending even on an unverified call path" claim).
- **[NIT] loose test assertion** — the 4-malformed-repo case tightened from `|| repo-pr-url-mismatch` to the
  exact deterministic `bad-repo`.

**Accepted residuals (correctly weight-0, NOT folded):** the full #273 co-forge (both seals recomputed) admits
- documented integrity!=provenance, becomes CRITICAL only at arming (the authenticated minter, ladder item 5,
is the prerequisite); the PROVENANCE_NOTE is CLI-payload + module-header only, not inside meta.json (the meta
must stay the exact 3-key Embers shape; Embers enforces weight-0 by its own contract).

**Post-fold green:** live-recall-store 31 · export-bank-pair 42 · export-cli 14 · full world-anchor suite exit 0
· 159 lab suites exit 0 · eslint clean · signpost up-to-date · markdownlint 0 · release-surface clean · ASCII-clean.
