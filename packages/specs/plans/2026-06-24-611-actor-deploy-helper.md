# Plan — #412 PR 2: the macOS `loom-actor` deploy helper

- **Issue**: [#412](https://github.com/shashankcm95/claude-power-loom/issues/412) — PR 2 of 3 (vehicle #425 merged; this = the operator deploy script; PR 3 = the routing seam). Mirrors the broker arc's #413.
- **Branch**: `feat/611-actor-deploy-helper` (off fresh `origin/main` @ 519f39d).
- **Deliverable**: `scripts/loom-actor-deploy-macos.sh` — the operator helper that stands up `loom-actor`@611 exactly as
  `docs/deployment/loom-actor.md` (merged #425) specifies, mirroring `scripts/loom-broker-deploy-macos.sh`. Dry-run by
  default; `--apply` requires root; PRINTS sudoers (never auto-edits). Single security-sensitive file.
- **Treatment**: privesc-sensitive (sudoers + cross-uid key custody + root-locked exec chain) -> focused VERIFY
  (architect + hacker) + 4-lens-lite VALIDATE (hacker LIVE dry-run probes + code-reviewer + honesty) + CodeRabbit.
  Matches the broker helper's #413 treatment, plus a pre-build hacker pass on the ONE genuinely new surface below.

## What mirrors the broker helper VERBATIM (preserve, do not re-derive)

From `scripts/loom-broker-deploy-macos.sh` (read firsthand):
- `set -euo pipefail`; dry-run `run()` wrapper; `--apply` gating; **macOS-only** guard.
- **M2**: `--apply` must run via sudo (so `SUDO_UID` = real operator) or explicit `--host-uid`; REFUSE uid 0.
- `assert_abs_safe` (absolute, no `..`, no whitespace/shell-metachar) on every interpolated path.
- `assert_root_locked` (the C1/C2 privesc gate): the target + EVERY ancestor up to `/` must be root-owned +
  not group/world-writable; HARD refuse under `--apply`, WARN-continue in dry-run. Run BEFORE node is ever executed.
- Key DIR root-owned 0755 (traversable so custody-verify can `lstat` the owner); key FILE 0600 owned by the system uid.
- Wrapper root-owned 0755; verify its PARENT dir is root-locked before writing.
- Sudoers PRINTED for `visudo` (never auto-edited) + the `env_keep`/`SUDO_*` audit one-liner (precise
  `SUDO_[A-Za-z0-9_]+`, not the greedy `.*` that false-fails on `/etc/sudo_lecture`).
- Trap-shred any temp on EXIT.

## The DELTAS from the broker helper (where the VERIFY board must focus) — REVISED per VERIFY

1. **API-key custody is an OPERATOR SECRET via STDIN — NOT a generated keypair (THE new surface).** The broker
   GENERATED an ed25519 keypair (no operator secret entered the script). The actor INSTALLS the operator's
   `ANTHROPIC_API_KEY` value. The SOUND pattern (folds VERIFY hacker H1+H2, architect H1+H2):
   - read via `read -rs` (hidden) from the TTY/stdin — **NEVER** an argv flag (`ps`/history) and never an echoed env var;
   - the read is **`--apply`-only**, gated AFTER all root-lock preflight, and **idempotent** (skip if the key file
     already exists — mirror broker `:153`); the **dry-run path NEVER reads or prints it**;
   - `umask 077` BEFORE any write (default umask 022 leaves a world-readable window — hacker H2);
   - write with a **builtin** `printf '%s' "$KEY" | tee "$KEY_FILE" >/dev/null` (printf is a shell builtin → no argv;
     tee gets the value on STDIN) into a **dest whose parent (`/etc/loom`) is already root-locked** (so 501 cannot
     pre-plant a symlink for a `tee`-follow TOCTOU), then `chown ACTOR:wheel` + `chmod 0600`;
   - **DROP `install /dev/stdin`** — probed BROKEN on macOS ("Inappropriate file type"); do NOT use it (hacker H1).
2. **DO NOT STAGE/COPY `claude` — REQUIRE a root-locked `--claude-bin` + `--node` (folds VERIFY hacker C1 — the
   CRITICAL).** On the real box `claude` resolves into 501-writable `~/.local/share/claude/...`; `install`-ing it
   validates only the DESTINATION, so a 501 actor trojans the source at deploy time and the root copy blesses the
   trojan -> runs as 611 with the API key -> the whole uid-611 barrier is moot. The fix: the helper NEVER copies a
   501-owned binary. It REQUIRES `--claude-bin <abs>` + `--node <abs>` (the operator provides root-owned binaries
   out-of-band, exactly as the broker required a root-owned `--node`), `assert_root_locked`s the **resolved** path +
   full ancestor chain of BOTH, and REFUSES a non-root-locked one under `--apply` (with guidance). The wrapper execs
   `--claude-bin` directly (no `/opt/loom-actor` stage); it sets `PATH` to the validated `--node` dir so claude's
   shebang finds the root node under sudo `env_reset`. (No copy -> no TOCTOU; C1 closed.)
3. **The wrapper body** is the actor wrapper from the runbook (no-Bash `--allowedTools Read,Grep,Glob,Edit,Write`;
   `--model "$1"`; the `--loom-actor-version-probe` sentinel branch execs `claude --version` BEFORE the key export;
   `ANTHROPIC_API_KEY="$(cat <keyfile>)"` then `exec <staged-claude> -p ...`). All interpolated paths `assert_abs_safe`.
4. **Sudoers**: `<hostuser> ALL=(loom-actor) NOPASSWD: <wrapper>` + `Defaults env_reset, !setenv` (env_reset is
   load-bearing here — it STRIPS the operator's `ANTHROPIC_API_KEY` so 611 uses its OWN from custody).
5. **Verify step** PRINTS the `loom-actor-custody-verify.js` invocation WITH `--claude-bin` + `--node-bin` (the CLI
   now REQUIRES them so C4 is never skipped) + the out-of-band attest.
6. **Defaults**: `--actor-uid 611`, `--actor-user loom-actor`, `KEY_DIR=/etc/loom`,
   `WRAPPER=/usr/local/bin/loom-actor-run`. (No `STAGE_DIR` — no staging per delta #2.)
7. **Carry verbatim + harden (folds VERIFY hacker M1/M2 + architect FLAGs)**: `assert_abs_safe` on EVERY interpolated
   value (`--claude-bin`, `--node`, `KEY_DIR`/key file, `WRAPPER`); validate `--actor-user` against the launcher's
   `USERNAME_RE` (`^[a-z_][a-z0-9_-]{0,31}$`) — it lands in the sudoers runas spec + printed text; carry the
   **two-pronged M2** (refuse `--apply` without sudo so `SUDO_UID` is real; refuse a resolved uid 0 BOTH via
   `SUDO_UID=0` AND explicit `--host-uid 0`); the precise `SUDO_[A-Za-z0-9_]+` audit; the PRINT-only sudoers in BOTH
   `Defaults:<user>` + `Defaults!<wrapper>` forms; the wrapper-PARENT root-lock before writing the wrapper. **ADD a
   distinct-uid refusal**: `--actor-uid` MUST NOT collide with 0 / the operator (`--host-uid`) / 610 (the broker) —
   a collision silently merges trust domains. **Wrapper body** (architect M3): the `--loom-actor-version-probe`
   sentinel branch execs `claude --version` BEFORE the key export; `--model "$1"` is QUOTED; `#!/bin/sh` no-Bash.

## Runtime Probes (firsthand)

- The broker helper's structure + every gate above: `scripts/loom-broker-deploy-macos.sh` (read full this session) —
  `assert_root_locked:75`, M2 uid-0 refusal `:100-107`, keypair custody `:151-171`, wrapper `:174-190`, sudoers
  PRINT `:193-206`, the precise `SUDO_[A-Za-z0-9_]+` audit `:205`.
- The runbook this helper implements: `docs/deployment/loom-actor.md` (merged #425) — steps 1-6 + the wrapper body.
- The custody-verify CLI now REQUIRES `--claude-bin`/`--node-bin` (PR 1 VALIDATE fold): `loom-actor-custody-verify.js`
  `main()` required-args check. The helper's printed verify command must pass both.

## Test plan

Shell scripts have no unit harness here (the broker helper shipped none — reviewed by hacker + CodeRabbit + dry-run).
The gate: `bash -n` (syntax) + ShellCheck if available + a real **dry-run smoke** (`bash scripts/loom-actor-deploy-macos.sh`
with no `--apply` -> prints every step, touches nothing, exits 0) + the hacker's LIVE dry-run probes at VALIDATE
(confirm the API-key value never reaches argv/stdout; the privesc gates WOULD-REFUSE a writable node/claude/stage in
dry-run). Add a `--help` self-doc (grep the header) mirroring the broker helper.

## HETS Spawn Plan

- **VERIFY (pre-build, parallel)**: `architect` (mirror-fidelity + the staging design + is the STDIN secret-handling
  the minimal sound surface?) + `hacker` (the API-key-secret leak surface: argv/ps/log/dry-run; the claude-staging
  privesc; the wrapper interpolation injection; the M2/uid-0/SUDO_* gates carried). Honesty deferred to VALIDATE.
- **VALIDATE (post-build, parallel)**: `hacker` (LIVE dry-run probes — secret never on argv/stdout, gates fire) +
  `code-reviewer` (shell correctness: `set -euo pipefail`, quoting, the `read -rs`, the trap-shred, exit codes) +
  `honesty-auditor` (does the helper match the runbook + never claim custody-real). Then CodeRabbit.

### Routing Decision

```json
{ "recommendation": "route", "rationale": "privesc-sensitive deploy script (sudoers + cross-uid key custody + an operator SECRET surface the broker helper lacked); the security review tier is mandatory (security.md). Mirrors the #413 hacker+CodeRabbit treatment plus a pre-build hacker pass on the new secret surface." }
```

## Risks / drift notes

- **R1 — the API-key value leaks** (argv / `ps` / shell history / a logged echo / a dry-run read). THE primary risk;
  the hacker lens gates it pre- AND post-build (LIVE probe: run the dry-run, grep the output + a `ps` snapshot for `sk-`).
- **R2 — claude/node staging privesc** (a 501-writable staged claude/node runs as 611). Mitigation: `assert_root_locked`
  on both + the resolved-target staging; the custody-verifier's C4 is the runtime backstop.
- **R3 — over-claim** (the helper must not imply custody-real; it stops at "deploy + print verify steps"; the operator
  attests out-of-band). Honesty lens.
- **R4 — mirror drift** (a gate present in the broker helper silently dropped here). Mitigation: the architect lens
  cross-checks against `loom-broker-deploy-macos.sh` gate-by-gate.
