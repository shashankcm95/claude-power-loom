---
lifecycle: persistent
status: v1 PreToolUse:Bash KILLED (C1 RCE + H1 parser) -> USER chose git-native pivot -> v2 git-native pre-push re-VERIFIED (2-lens SOUND-WITH-CHANGES, C1+H1 confirmed CLOSED, must-fixes folded into §10.2) -> HELD for USER build go
created: 2026-07-03
plan-type: kernel-hook (substrate-meta)
depends-on: packages/kernel/validators/validate-config-redirect.js (the PreToolUse:Bash template) ; packages/specs/adrs/0001-substrate-fail-open-hook-discipline.md (FORK E) ; kb:design-pushback/syntactic-gate-extension-for-tool-bypass (the anti-pattern tension)
title: validate-lint-gate — a PreToolUse:Bash lint-before-push hook (promote the skipped best-effort rule to enforced)
---

# Plan — `validate-lint-gate` (a PreToolUse:Bash lint-before-push hook)

> **HONEST FRAMING (read first — do NOT over-claim).** This hook does **not** prevent bad code from merging — CI
> eslint already gates that at PR time, and CI is the real safety net. It closes the feedback loop EARLIER: it moves
> a lint failure from "minutes later, on a PR surface" to "the moment you type `git push`," reducing the
> `drift:lint-gate-not-run-pre-push` churn (a `risk:high` rule-candidate, converged 3x since 2026-05-30). Because it
> is **fast-feedback, not a security boundary**, its whole design optimizes for **helpful-not-obstructive** — a gate
> that false-positives or adds friction gets disabled, and a disabled gate IS the drift. This plan consciously
> diverges from the WARN-not-BLOCK precedent (`validate-config-redirect.js`) — the divergence is argued (§Design
> pushback), not assumed.

## Routing Decision

`node packages/kernel/algorithms/route-decide.js --task "..."` → **`recommendation: root`** (score_total 0,
confidence 1). ESCALATED to an architect design-exploration BY JUDGMENT per the H.7.16 substrate-meta catch-22 (the
scorer's lexicon does not contain the tokens this change would ADD, and route-decide's own load-bearing comment says
to escalate a genuinely-architect-shaped substrate change): authoring a KERNEL HOOK that BLOCKS git operations is
high-stakes (a bad hook could brick pushes / erode gate-trust), with 6 real design forks. The design-exploration ran
(this plan folds it); the 2-lens VERIFY runs next per the user's scope request. NOT a HETS team decomposition — the
standard per-wave cadence (design-exploration → plan → 2-lens VERIFY → TDD → 3-lens VALIDATE → PR).

## §1 Runtime Probes (firsthand)

- **claim:** a `PreToolUse:Bash` hook emitting `{decision:'block'}` deterministically PREVENTS the Bash command,
  even under `--dangerously-skip-permissions` (hooks are a separate layer from the permission system).
  **probe:** a live `claude -p` spike (scratchpad `spike-probe/`): a block-on-sentinel hook + a control command.
  **observed:** the sentinel command's side-effect file was NEVER created (blocked); the control command RAN
  (`allowed-proof.txt` = `controlvalue`); the block fired under `--dangerously-skip-permissions`. Marker log
  confirms both firings. → the mechanism is PROVEN; ADR-0012 (inert `updatedInput` on Agent spawns) does NOT apply
  (that is input-mutation on spawns; this is `decision:block` on Bash, the canonical deny).
- **claim:** there is NO local pre-push lint enforcement today (CI is the only net).
  **probe:** `grep PreToolUse:Bash git interception in hooks.json`; `ls .git/hooks/pre-push` (both repos); `grep husky`.
  **observed:** none — no interception, no git-native pre-push hook, no husky. CI eslint (on PR) is the sole net.
- **claim:** the toolkit lints via `install.sh --hooks --test`, NOT a `package.json scripts.lint` — so keying off
  `scripts.lint` would silently NOT-fire in the flagship repo.
  **probe:** Read root `package.json` scripts; `.github/workflows/ci.yml` lint steps.
  **observed:** `scripts` = `{test, test:unit, test:smoke}` — NO `lint`; CI runs eslint/markdownlint via hand-written
  `run:` steps. PACT uses `npm run lint`. → per-repo lint detection (FORK C) is load-bearing.
- **claim:** `validate-config-redirect.js` is the exact PreToolUse:Bash template (parse the command, approve/block).
  **probe:** Read it.
  **observed:** reads `data.tool_name`/`data.tool_input.command`, returns `{decision:'approve'}` or
  `{decision:'block', reason}` (`:131-137`); defaults WARN-not-BLOCK (`:9-20`) for false-positive safety; escalates
  under `STRICT_CONFIG_GUARD=1`. Reuses `_lib/_log.js`.

## §2 The design — `packages/kernel/validators/validate-lint-gate.js`

**Shape (SRP split): a PURE decision core + a thin I/O shell** (mirrors `validate-config-redirect.js:103-153`).

- **`decideLintGate({command, changedFiles, lintResult, env}) -> {decision, reason?, logTag}`** — PURE, fully
  unit-testable. Applies FORK B (is-a-push parse), FORK A (env escape hatch), FORK D (changed-files scope), FORK E
  (error routing). No I/O.
- **The I/O shell** — reads stdin JSON; resolves the FORK C marker; computes FORK D changed-files (`git diff`); spawns
  the lint (bounded); routes the result through `decideLintGate`; logs via `_lib/_log.js`. Top-level try/catch →
  FORK E fail-open.

### The 6 forks (FOLDED from the architect design-exploration)

- **FORK A — block-by-default WITH an opt-OUT escape hatch `LOOM_SKIP_LINT_GATE=1`** (the `--no-verify` analog).
  A WARN reproduces the drift (a nudge the model already ignores); block-no-escape trains "disable the whole hook."
  The env var is scoped to THIS gate (bypassing lint for one WIP push does NOT drop `config-guard`/secrets),
  greppable, and **LOUDLY LOGGED** (the observability defense, §Sharpest risk). STRICT (even-the-escape-disabled CI
  mode) is deferred YAGNI.
- **FORK B — two-stage `git push` parse, honestly best-effort.** (1) permissive matcher `/\bgit\b[^\n]*?\bpush\b/`
  (catches `git -C dir push`, `cd X && git push`, `-u`/`--force-with-lease`); (2) FP guards — strip quoted segments
  first (so `git commit -m "push it"` / `echo git push` do NOT match), reject `git push --help`/`-h` + `git help
  push`. **Named residuals:** heredoc/`bash -c` nesting, shell aliases, wrapper-script pushes (`./deploy.sh`) are
  undetectable by command-line parsing — accepted (CI backstops; cost-of-a-miss is low).
- **FORK C — opt-in via a per-repo marker `.loom-lint`** (repo-root; contents = the exact lint command). Resolution
  order: (1) `.loom-lint` marker → run its command; (2) else `package.json scripts.lint` (convenience fallback);
  (3) else **APPROVE (pass-through)**. No marker = no opinion = never surprise a stranger's repo. THIS repo ships a
  `.loom-lint` = `bash install.sh --hooks --test` (dogfood).
- **FORK D — scope the lint to changed files** via `git diff @{u}...HEAD --name-only`; if none match the
  lint-relevant globs (`.js`/`.yml`/`.md`) → approve WITHOUT invoking lint (the latency defense). **Unset-upstream
  (fresh branch):** `@{u}` errors → fall back to `git merge-base origin/HEAD HEAD` then diff; if THAT fails → run the
  FULL lint (fail-toward-running, never skip). The git read is behind try/catch → routes to FORK E.
- **FORK E — fail-OPEN on hook-internal error, fail-CLOSED only on `lint-ran-nonzero`** (ADR-0001). THREE DISTINCT
  logged paths (never collapse): `lint exited non-zero` → **block** (reason names the lint + the escape hatch);
  `LOOM_SKIP_LINT_GATE=1` → **approve + LOUD skip-log**; any hook error (no lint cmd, git unreadable, spawn fail,
  **lint timeout**) → **approve + error-log**. A lint-gate that failed-closed on its OWN error would be skippable by
  inducing an error AND could brick a legit push (the ADR-0001 marketplace-user-can't-patch rationale).
- **FORK F — PreToolUse:Bash (proven), GLOBAL registration gated to a no-op by the FORK C marker.** File at
  `packages/kernel/validators/validate-lint-gate.js` (the `validate-*` content-inspecting-gate directory, sibling to
  `validate-config-redirect.js`); `hooks.json` matcher `"Bash"`, timeout **20s** (spawns a lint subprocess; internal
  lint timeout < 20s routes to approve so the harness never kills the hook). A git-native `pre-push` hook (covers
  HUMAN pushes too) is a COMPLEMENTARY future add, NOT a replacement — the drift is Claude's pushes, which
  PreToolUse:Bash covers, and it fits the version-controlled/install.sh-distributed kernel-hook architecture.

## §3 Principle Audit (SOLID/DRY/KISS/YAGNI)

- **SRP:** the parser (git syntax, one reason to change) is split from the decision logic (lint policy) — two
  separately-testable units; the I/O shell holds neither. **DRY:** reuses `_lib/_log.js` + the stdin-read/try-catch
  shape from `validate-config-redirect.js`; the `.loom-lint` marker is the single source of the per-repo lint command
  (no inference duplication). **KISS:** a marker file + a pure decision fn, no config framework. **YAGNI:** no STRICT
  CI-mode in v1 (deferred until a CI consumer exists); no git-native pre-push hook (deferred); no CI-parity guarantee
  claimed. **Open/Closed:** a new gate ADDED alongside the existing Bash hooks, editing none. **DIP:** depends on
  `_log.js`/git-via-subprocess abstractions, injected into the pure core as `{changedFiles, lintResult}` for testing.

## §4 Deliverables (for the build, if greenlit)

1. `packages/kernel/validators/validate-lint-gate.js` — the pure `decideLintGate` + I/O shell.
2. `packages/kernel/hooks.json` — a new PreToolUse `matcher:"Bash"` entry, timeout 20, with a `_comment` documenting
   the design-pushback tension + the `.loom-lint` / `LOOM_SKIP_LINT_GATE` contract.
3. `.loom-lint` in this repo — `bash install.sh --hooks --test` (dogfood; without it the hook is a no-op even here).
4. `tests/unit/kernel/validate-lint-gate.test.js` — table-driven over the pure core (the FORK B adversarial corpus +
   FORK A/D/E paths). Written FIRST (TDD; the failing set is the behavioral spec).
5. Install/signpost touchpoints — `node scripts/generate-signpost.js --check` must pass (new `.js` → CI Test 121);
   VERIFY `install.sh --hooks` actually copies `validators/` (the H.7.12 subdir-glob lesson — check the file lands).

## §5 Named residuals / out-of-scope

- Human (non-Claude) pushes — NOT covered (a complementary `pre-push` git hook is deferred, not built).
- Wrapper-script / heredoc / `bash -c` nested pushes — undetectable by command-line parsing (FORK B residual).
- Repos with no `.loom-lint` and no `scripts.lint` — zero enforcement BY DESIGN (the opt-in-safety contract).
- NO CI-parity guarantee — a `.loom-lint` running a subset of CI can pass locally + fail CI. Does NOT replace CI.
- Timeout-to-approve (FORK E) — a chronically-slow linter silently stops gating (accepted, logged).

## §6 Sharpest risk (for the VERIFY-hacker to attack)

**The escape hatch is the attack surface, and the drift is proof it will be over-used.** A model that skips lint 3x
may learn to prepend `LOOM_SKIP_LINT_GATE=1` to every push — converting block-by-default back to WARN-default and
reproducing the drift, while the gate's existence creates false confidence. **Defense:** (1) every skip-via-env path
emits a HIGH-VISIBILITY `logger` + stderr line (ADR-0001 + `security.md` "a fail-open/skip decision must be
OBSERVABLE") so over-use is DETECTABLE and resurfaces to `/self-improve` as a NEW drift signal rather than hiding;
(2) the three FORK E paths stay DISTINCT + individually-logged (never one collapsed `approve`). Second probe: a FORK
B false-negative silently never-fires — the unit suite MUST fuzz push spellings (`git -C`, aliases, `&&`-chains,
quoted-`push`-in-message) against `decideLintGate`, and the plan labels the parser best-effort, not airtight.

## §7 Test strategy (TDD)

- **Pure `decideLintGate` (the bulk, unit, write FIRST):** table-driven over the cross-product of FORK B command
  shapes (detected vs FP-guarded) × FORK A env × FORK D changed-files × FORK E lint-results. The adversarial FORK B
  corpus lives here.
- **Live/integration (cannot be unit-mocked — the Rule-2a-corollary):** the `git diff @{u}...HEAD` scoping against a
  REAL repo with (a) unset upstream on a fresh branch and (b) set upstream (a mock returns clean data a real
  `@{u}`-unset repo does not); and a live PreToolUse:Bash firing against a real `git push` to confirm OUR hook wires
  into the (already-proven) block mechanism.

## §8 VERIFY board (2-lens, pre-build) — DONE. VERDICT: **NEEDS-REDESIGN** (do NOT build this design as-is)

The two lenses CONVERGE on a foundational flaw: **auto-executing a repo-authored lint command on `git push` is an
RCE-on-push elevation, and a GLOBAL PreToolUse:Bash hook fires in untrusted repos.** The primitive is wrong.

- **hacker (adversarial LIVE-probe) — NEEDS-REDESIGN.** 12 attacks, live-probed:
  - **C1 (CRITICAL) — `.loom-lint`/`scripts.lint` is remote-triggered RCE.** A repo-root file whose contents run
    as a shell command on push; a stranger's clone / malicious branch owns the machine on `git push` (the user
    never opened the file). Strictly worse than `validate-config-redirect.js`, which only READS a command, never
    EXECUTES repo bytes. "The delta is byzantine input" — the marker is attacker-authorable state read back + run.
  - **H1 (HIGH) — one-backslash total bypass.** `git \<newline> push` defeats the `[^\n]` same-line regex
    completely (a multi-line command is one legal invocation). Fix needs newline-normalize + collapse.
  - **H2 (HIGH) — the escape hatch is repudiation, not deterrence.** `LOOM_SKIP_LINT_GATE=1` is one token cheaper
    than disabling the hook; the loud-log costs a later human auditor, never the bypasser at push-time =
    reproduces the drift. Fix: require a reason + rate-limit-to-fail-closed, don't claim the log "deters."
  - **H3 (HIGH) — 7 false-POSITIVES** (`git config alias.p push`, `git branch push-feature`, `git remote add
    push-mirror`, a `# git push` comment) → the parser blocks legit non-pushes → trains gate-disable (the drift).
    Fix: require `push` in git-SUBCOMMAND position, not any `\bpush\b`.
  - **M1/M2 (MEDIUM) — fail-open induction + scope false-greens.** A `.loom-lint` of `true` / `sleep 999` /
    a nonexistent binary silently self-approves (quieter than the env var); FORK D `@{u}...HEAD` reports empty
    under a tracking-ref-at-HEAD + force-push, and misses non-globbed lint-relevant files.
- **architect (plan-review) — SOUND-WITH-CHANGES (softer, but converges on C1's cause).**
  - **F1 (HIGH) — "enforced" over-claims.** Skippable 4 ways (env, induced error, parser miss, no-marker
    pass-through); it enforces against FORGETTING, not EVASION. Relabel; enforcement lives at CI.
  - **F2 (MEDIUM) — `.loom-lint` is a bespoke new file whose contents are spawned** (= H/C1's RCE surface) +
    KISS/YAGNI (both known repos have an npm lint path). Drop it for v1.
  - **F3 (MEDIUM) — the design-pushback KB checklist is met only 2 of 4** (gated ✓, but NOT a CI-audit context,
    NOT an attack surface, NOT a structured parser — H1/H3/L1 ARE the "unbounded regex edge cases" the KB names).
  - **F4/F5 (LOW) — range-semantics probe deferred to build; the install-copy is a non-risk (validators/ flat).**
    Layer placement (PreToolUse) + fork-composition CONFIRMED correct.

**Synthesis — the redesign direction (for the USER decision):** the VERIFY shows the PreToolUse:Bash primitive is
the WRONG one for this job. A **git-native `pre-push` hook** (install.sh-installed per-repo) structurally avoids all
three headline problems: it is opt-in BY INSTALLATION (only in repos the operator set up → NO C1 RCE-on-clone),
git invokes it natively (NO H1/H3 command-string parsing), and it has a native `--no-verify` (the understood bypass)
and catches HUMAN pushes too. Its only cost (per-repo/not-version-controlled) is exactly what makes it safe. The
alternative (harden PreToolUse:Bash: trust-gate + first-use approval + newline-normalize + subcommand-position
parse + reason-required escape) is far more surface for the same modest fast-feedback value. **HELD for the USER:
pivot to git-native pre-push, harden the PreToolUse design, or park it (the drift is CI-caught, low-cost).**

## §10 REDESIGN v2 — git-native `pre-push` hook (USER-chosen 2026-07-03; the pivot)

The USER chose the git-native pivot. It STRUCTURALLY dissolves the three v1 headliners: opt-in BY INSTALLATION
(no RCE-on-clone → C1 gone), git invokes it natively with the pushed refs on stdin (no command parsing → H1/H3
gone), and native `--no-verify` (no novel env var → H2's surface gone). Value framing UNCHANGED (fast-feedback,
CI is the real gate; enforces against forgetting, `--no-verify` remains an escape — do NOT relabel as full
enforcement, F1 carries).

### §10.1 Runtime Probe (firsthand — the git-native contract)

- **probe:** a real repo + bare remote + a `.git/hooks/pre-push` that logs stdin + exits 1 (scratchpad `gitprobe/`).
- **observed:** exit 1 BLOCKS (remote never received the ref — side-effect confirmed, not the pipe exit code);
  stdin = one line per ref `<localref> <localsha> <remoteref> <remotesha>`; a NEW branch has an **all-zeros
  remote-sha** (`refs/heads/main <sha> refs/heads/main 0000…0000`), an existing branch has the REAL prior
  remote-sha (→ `git diff <remotesha>..<localsha> --name-only` = exactly what is pushed, DETERMINISTIC); `git push
  --no-verify` bypasses cleanly (the hook does not fire). → no `@{u}` fragility (fixes M2/F4); no parsing (fixes
  H1/H3); the hook is the toolkit's OWN version-controlled file (fixes C1).

### §10.2 The git-native forks (to settle at re-VERIFY)

- **G-A — install mechanism: a per-hook `.git/hooks/pre-push` COPY (NOT `core.hooksPath`)** — CORRECTED per
  re-VERIFY architect-F1/F2 + hacker-H-B. `core.hooksPath` (the original pick) (i) CLOBBERS this repo's ALREADY-SET
  `.git/config` `hooksPath` pin, (ii) resolves inconsistently under the repo's `worktreeConfig=true` + many
  worktrees, and (iii) **silently disables every pre-existing `.git/hooks/*`** (a secret-scanner pre-commit the
  operator relied on stops firing — a security regression, live-proven). Instead: the SOURCE lives version-controlled
  in `.githooks/pre-push` (reviewed like any file); `install.sh` COPIES it to `.git/hooks/pre-push` + `chmod +x`
  (the toolkit's existing cp-model). The copy is NOT working-tree-relative, so it ALSO survives an orphan-branch /
  `git rm` checkout (fixes hacker-M-B) and does NOT touch `core.hooksPath` (no clobber). v1 = the toolkit's OWN hook;
  a generic `install.sh --git-hooks <repo>` template is DEFERRED (and revives the C1 RCE for a repo-authored `npm
  run lint` — needs its own trust-gate, F5).
- **G-B — lint command: the eslint/yaml/markdownlint SUBSET scoped to changed files, NOT `install.sh --hooks
  --test`** — CORRECTED per re-VERIFY architect-F4. `install.sh --hooks --test` is NOT a linter: it cp-installs the
  whole substrate to `~/.claude` + runs the full smoke suite (heavyweight, side-effecting, multi-second) — a
  self-denial-attack on the push path that trains `--no-verify`. Hardcode the actual eslint + yaml + markdownlint
  invocations (the toolkit's own reviewed commands), scoped to the G-C changed-file set, sub-second budget. NO
  marker-as-code (the C1 RCE surface stays gone). RESIDUAL M-A: the hardcoded glob set (`.js`/`.yml`/`.md`) can DRIFT
  from CI's lint targets (a `.sh`/`.json`/`.ts` break slips the local gate but CI catches it) — a named residual.
- **G-C — scope to the pushed range (deterministic, from stdin) — CORRECTED per re-VERIFY hacker-CR-1/H-A + F3.**
  Loop EVERY stdin ref-line (a push carries N lines): SKIP `refs/tags/*` (no lint scope); `localsha` all-zeros =
  DELETE → skip; `remotesha` all-zeros = NEW branch → diff against `git merge-base <localsha> main` (hardcoded
  `main` for toolkit v1; no-merge-base → FULL-lint floor); else `git diff <remotesha>..<localsha> --name-only`.
  **CR-1 (CRITICAL): a diff/merge-base that ERRORS (a `<remotesha>` the local repo lacks — a ref another clone
  advanced before you fetched) MUST full-lint (or fail-closed), NEVER collapse to an empty changed-set = silent
  APPROVE.** Distinguish "diff succeeded, 0 files" from "diff errored." **H-A (HIGH): lint each file against ITS OWN
  ref-line's sha** (`git show <that-sha>:<file>`), NEVER a unioned file-list against one surviving loop-sha (a
  multi-ref `git push a b` / `--all` else scrambles the sha↔file binding → a break under A linted against B → pass).
- **G-D — PINNED (re-VERIFY architect-F6): fail-OPEN on a hook-internal error (cannot determine the lint), but
  fail-toward-FULL-LINT (or fail-closed) on a git-range/diff ERROR (the CR-1 carve-out — a range error is NOT an
  empty changed-set), and fail-CLOSED on `lint ran → non-zero` with `--no-verify` NAMED in the reject message.** The
  divergence from ADR-0001's blanket fail-open is justified: ADR-0001's rationale is the marketplace-user-cannot-patch
  case; an operator-installed git hook with native `--no-verify` does not have that constraint.
- **G-E — escape + observability: LAND the Claude-side observer IN v1** — UPGRADED per re-VERIFY hacker-M-C. Native
  `git push --no-verify` is the escape (standard, per-invocation), but it fires NO hook → a skip leaves ZERO trace
  (an observability REGRESSION from v1's logged env-var skip). Since the whole drift-detection premise is "surface
  skip-over-use to `/self-improve`," a minimal `PostToolUse:Bash` OBSERVER that LOGS `git push --no-verify` usage
  (never blocks, never runs repo code, no enforcement-parser — so it does NOT reintroduce C1/H1) is NOT optional
  cleanup — it is the only surface that can see a `--no-verify` skip. Include it in v1, OR drop the "surfaces to
  /self-improve" claim as false for the git-native design.

### §10.3 Deliverables (v2, post-re-VERIFY — corrected)

1. **`.githooks/pre-push`** (version-controlled SOURCE, POSIX sh, `chmod +x`) — the stdin-range parse (G-C:
   per-ref-line, skip tags/deletes, all-zeros new-branch merge-base, CR-1 range-error→full-lint, H-A per-ref-sha
   lint) + the hardcoded eslint/yaml/markdownlint subset (G-B) + G-D error routing (`--no-verify` named in the
   reject). 2. **`install.sh`** — COPY `.githooks/pre-push` → `.git/hooks/pre-push` + `chmod +x` (the cp-model; NO
   `core.hooksPath` — F1/H-B); idempotent; uninstall = `rm .git/hooks/pre-push` (simple, since no config was set).
   3. **A minimal `PostToolUse:Bash` observer** (`hooks.json` + a small script) logging `git push --no-verify`
   usage → `/self-improve` (G-E/M-C; logs only, never blocks/parses/runs-repo-code). 4. **`tests/`** — unit over the
   pure range-decision (all-zeros new-branch / delete / tag / multi-ref sha-binding / range-error / non-globbed
   corpus) + a live integration push against a real bare remote (Rule-2a-corollary: a mock can't produce the
   all-zeros/missing-object shas). 5. **`shellcheck` on `.githooks/pre-push`** (add to the CI shellcheck surface) +
   `generate-signpost.js --check` if any new `.js` lands. 6. DEFERRED: the generic `--git-hooks <repo>` template
   (revives the C1 RCE for a repo-authored lint — needs its own trust-gate, F5).

### §10.4 re-VERIFY (2-lens, on the git-native design) — DONE. VERDICT: **SOUND-WITH-CHANGES** (the pivot is right; must-fix folds applied to §10.2)

Both lenses CONFIRM the pivot **CLOSES the v1 blockers live**: C1 (RCE-on-clone — a clone does not inherit
`core.hooksPath`; the marker-as-code surface is gone) and H1 (no command-string parser — git delivers STRUCTURED
stdin ref-lines, exiting the syntactic-gate anti-pattern per its own `applies_NOT_when` clause). The primitive is
correct. It trades the v1 findings for a NEW class of scope/fail-open false-greens, all localized + fixed in §10.2.

- **architect (plan-review) — SOUND-WITH-CHANGES.** F1 CRITICAL (the `core.hooksPath` clobber of the already-set
  `.git/config` hooksPath pin + `worktreeConfig=true`) → **G-A switched to the copy model.** F2 (copy over
  core.hooksPath). F3 (multi-ref/tags/default-branch enumeration) → **G-C.** F4 HIGH (`install.sh --hooks --test` is
  a heavyweight side-effecting non-linter) → **G-B subset.** F5 (the deferred template revives C1) → named. F6 (pin
  G-D). F7 (chmod +x, shellcheck on `.githooks/`, hooksPath-restoring/`rm` uninstall, the "disjoint from hooks.json"
  statement — a git hook is NOT a Claude Code hook, zero interaction). F8 (endorse the deferred... now-v1 observer).
  Confirmed: v2 EXITS the design-pushback anti-pattern (structured stdin) — the strongest argument for the pivot.
- **hacker (adversarial LIVE-probe) — SOUND-WITH-CHANGES.** 13 probes, 6 live bypasses; C1+H1 re-confirmed CLOSED.
  - **CR-1 (CRITICAL) — missing-object range-error → silent fail-open** (push a ref another clone advanced → diff
    errors → empty changed-set → APPROVE an unlinted branch, zero trace). → **G-C/G-D CR-1 carve-out** (a range
    error full-lints, never empty-approves).
  - **H-A (HIGH) — multi-ref push sha↔file scramble** (a break under branch A linted against B's sha → passes). →
    **G-C: lint each file against its OWN ref's sha.**
  - **H-B (HIGH) — `core.hooksPath` silently disables existing `.git/hooks/*`** (a secret-scanner pre-commit). →
    **G-A copy model** (no `core.hooksPath` set).
  - **M-A (MEDIUM) — non-globbed lint-relevant files** (`.sh`/`.json`/`.ts`) skip → named residual (G-B).
  - **M-B (MEDIUM) — a version-controlled hook is disabled by a checkout lacking it** (orphan branch / `git rm`) →
    RESOLVED by the G-A copy (the `.git/hooks/` copy is not working-tree-relative → survives checkouts).
  - **M-C (MEDIUM) — `--no-verify` invisible** (observability regression) → **G-E: land the observer in v1.**
  - **HELD:** the eslint-config-executes-repo-JS residual holds ONLY because the toolkit's eslint config is
    zero-dep/hand-rolled (no repo plugins) — a caveat the DEFERRED generic template must carry (F5).

**Net:** SOUND-WITH-CHANGES (NOT a redesign — the primitive is right, the fixes are concrete + folded). Ready for
the TDD build on the USER's go, with the must-fix set (CR-1, H-A, G-A copy, G-B subset, the v1 observer) already in
§10.2. The build cadence: TDD (the pure range-decision fn first — all-zeros/delete/multi-ref/range-error corpus) →
live integration (a real bare-remote push — the Rule-2a-corollary: a mock can't produce the all-zeros/missing-object
shas) → 3-lens VALIDATE → PR.

## §11 BUILD (2026-07-03) — done; build-time decisions + deviations (for VALIDATE to check)

The TDD build landed on the feat/lint-gate-prepush worktree. Deliverables + gates:

- **`packages/kernel/validators/lint-gate-prepush.js`** — the pure decision core
  (`parseRefLine` / `classifyRef` / `decideLintScope` / `planLint`) + the I/O shell
  (`realGit` / `runLint` + per-linter runners) + `main()`.
- **`.githooks/pre-push.sh`** — the thin POSIX-sh shim (fail-open, `exec node`).
- **`packages/kernel/hooks/post/observe-noverify-push.js`** + a `hooks.json`
  PostToolUse:Bash entry — the G-E `--no-verify` observer (logs-only).
- **`install.sh --git-hooks`** — the copy-model installer (`install_git_hooks`).
- **`tests/unit/kernel/lint-gate-prepush.test.js`** — table-driven tests over the pure
  core (CR-1 + H-A + the delete-filter pinned). **`tests/integration/lint-gate-prepush.integration.sh`**
  — a live bare-remote push test (moved out of scratchpad into the repo at VALIDATE).

**Gates:** see §12 for the LITERALLY-re-run post-fold gate results (unit 26/26; live
integration 11/11; kernel 117/117; shellcheck/eslint/signpost/doc-path clean;
contracts-validate 0 on a fresh CI-HOME — the local `hook-not-in-installed-cache` flag
is expected deployment-lag, resolves on `/plugin update`, never cache-hotfixed).

**Four build-time deviations from §10 (each a conscious call — VALIDATE, please adjudicate):**

1. **Node decision core behind a thin sh shim, NOT pure POSIX sh** (§10.3.1 wrote
   the whole thing in sh). WHY: §7/§10.3.4 require the range-decision (CR-1, H-A) to be
   unit-tested table-driven — pure sh can't cleanly table-test that. The shim is 4 lines;
   the Node core parses STRUCTURED stdin ref-lines (not a free-form command string), so it
   does NOT re-enter the v1 syntactic-gate anti-pattern. Node-absent → shim fail-opens.
2. **The linters run against the WORKING TREE at the changed paths, NOT the pushed blob
   at its ref-sha** (a partial of H-A). WHY: eslint/markdownlint config resolution needs
   real repo paths; materializing each blob at its sha (temp files, per-linter stdin
   asymmetry) is heavy for a fast-feedback tool. The `(path, sha)` binding IS computed +
   tested (so a future git-show pass can consume it); the divergence (non-HEAD / multi-ref
   push) is a NAMED residual, CI-backstopped. For the common single-branch HEAD push,
   working tree == pushed sha, so they coincide.
3. **Source named `.githooks/pre-push.sh` (not `pre-push`)** so the existing shellcheck
   smoke gate (Test 81, `*.sh` glob) auto-lints it; `install.sh` copies it to the correct
   `.git/hooks/pre-push` name. Avoided editing smoke-ht.sh (a pre-existing PEM fixture there
   trips the Edit-tool secrets gate on a whole-file rescan).
4. **All three linters (eslint/markdownlint/yaml) are built** (I considered deferring yaml
   for temp-dir simplicity but kept it for plan-fidelity; the temp dir has try/finally cleanup).

## §9 VALIDATE (post-build, 3-lens) — see §12 (run 2026-07-03)

## §12 VALIDATE (3-lens, post-build) — DONE 2026-07-03. VERDICT: SHIP after folds

Board: code-reviewer (correctness) + hacker (Rule-2a live re-probe, 12 throwaway probes against the
real module in bare-remote sandboxes) + honesty-auditor (claim-vs-evidence). CR-1 and H-A both HELD
under adversarial probing.

**Process incident (recorded honestly):** the board first reviewed a tree where install.sh, hooks.json,
and docs/SIGNPOST.md appeared MISSING their edits — because a `git stash` I ran in a worktree for a
contracts-validate A/B check was never popped (my own "never git stash in a worktree" rule). Recovered
via `git stash pop` (fsck showed only dangling objects, no corruption). Those three CRITICAL/HIGH
"not built" findings were stash artifacts and evaporated on recovery — verified firsthand, not dismissed.

**Real findings folded (survive recovery — the board Read the untracked files directly):**

- **[hacker MEDIUM] pure-delete false-block** — a commit that only DELETES a `.js` file listed the gone
  path in the diff → eslint on a missing file → false BLOCK (trains --no-verify). FIXED: `filterExisting`
  drops changed paths absent from the working tree before planLint. Unit-tested + a live delete-push
  integration check.
- **[hacker MEDIUM / honesty MEDIUM] working-tree-vs-pushed-sha framing** — the header over-claimed H-A
  as enforced. FIXED (framing, not code): the sha binding is COMPUTED + unit-tested at the decision
  layer but NOT consumed by the linters (they read the working tree). The pushed-sha divergence
  (exotic non-HEAD/multi-ref push) is now named as a fast-feedback gap — NOT a security bypass (CI lints
  the pushed result; the dev can --no-verify). `git show <sha>:<path>` materialization is the deferred close.
- **[code-reviewer MEDIUM] hardcoded `main`** — FIXED: `resolveMainRef` reads `origin/HEAD` (fallback `main`).
- **[hacker LOW] npx-unavailable silent skip** — FIXED: the fail-open path now emits a stderr NOTE (a
  fail-open must be observable, security.md).
- **[code-reviewer LOW] `shell:true` yaml glob** — FIXED: pre-expand via `fs.readdirSync`, explicit
  file list, no shell.
- **[honesty LOW] integration test in scratchpad** — FIXED: moved to
  `tests/integration/lint-gate-prepush.integration.sh` (durable, shellcheck-clean, 11 checks incl. the
  delete regression). Documented as a manual run (not auto-wired into `--test` to avoid npx latency in CI).
- **[honesty HIGH] plan MD004 line 182 wrapped `+`** — FIXED (reworded to `and`).
- **[code-reviewer NIT] `notExcluded` root-only prefix** — LEFT (documented non-issue: eslint's own
  `--ignore-pattern` + config handle nesting; a changed-set rarely contains node_modules).

**Post-fold gates (LITERALLY re-run, not from memory):** unit 26/26; live integration 11/11; shellcheck
clean (module + shim + integration); eslint clean; kernel suite 117/117; signpost up-to-date; doc-path
clean. The CR-1 + H-A invariants remain green.

**Full smoke gate (`install.sh --hooks --test`) = 128 passed, 1 failed — the 1 is EXPECTED, not a
defect.** Tests 80/81/82/83/84/84b (markdownlint/shellcheck/json/yaml/eslint over the whole substrate,
incl. the new files; Test 81 catches `.githooks/pre-push.sh` via its `*.sh` glob) all pass. The lone
failure is Test 123 (contracts-validate) under the REAL HOME: the SOLE violation is
`hook-not-in-installed-cache` for the new `observe-noverify-push.js` — my source hooks.json has a hook
the locally-installed plugin cache (3.11.0) does not yet. This is deployment-lag, NOT a code defect:
contracts-validate returns 0 on a fresh CI-HOME (verified — the deployment contract skips with no
install record, matching `plugin-hook-deployment.test.js`'s "CI/fresh => 0" case), so CI passes; it
resolves for users on `/plugin update`. Never cache-hotfixed.

**CodeRabbit CLI (pre-PR secondary lens, `--base origin/main`) — 7 findings, ALL premise-probed valid,
ALL folded:** (1) MAJOR — the observer attached stdin listeners at module load (a `require()` would
hang a test) → guarded behind `require.main === module`, `isNoVerifyPush`/`redactCredentials` still
exported; a new `tests/unit/hooks/observe-noverify-push.test.js` requires it in-process as the
regression proof. (2) MAJOR — no subprocess timeout (a stalled npx/git could hang the push forever) →
`LINT_TIMEOUT_MS`/`GIT_TIMEOUT_MS` on every spawn (timeout → the existing unavailable/full-lint paths).
(3) MAJOR — the observer logged a raw command that could persist a `user:token@` credential →
`redactCredentials` masks inline creds before logging. (4) MAJOR (== the board's working-tree residual)
→ the computed (path,sha) binding is now CONSUMED: if a pushed ref's sha differs from HEAD, a stderr
NOTE surfaces that the lint reflects the working tree, not the exact pushed content. (5) MINOR —
`parseRefLine` accepted >4 fields → exactly-4 (a >4 line is malformed → full-lint). (6) MINOR —
`extractFrontmatter` was CRLF-blind → split on `/\r?\n/`. (7) MINOR — the integration test wrote
predictable `/tmp` err files → moved into the random auto-cleaned `$SANDBOX`. Post-fold: unit 28/28
(kernel) + 7/7 (observer); integration 11/11; kernel 117/117; eslint/shellcheck/signpost/doc-path clean.
