---
lifecycle: persistent
created: 2026-06-24
audience: operator (deploys + attests; NOT the build)
---

# Deploying the `loom-actor` uid so the autonomous actor cannot mint an egress approval (#412)

> **What this gets you, and what it does NOT (read first — NS-9).** The autonomous resolution actor (`claude -p`,
> `runActorTrajectory`) today runs as the operator uid (501), which the signing broker (`loom-broker`) allowlists.
> So a host-level actor with a shell can `sudo -n -u loom-broker <wrapper>`, present an emission body it chose, and
> the broker signs an approval — bypassing the human "sign-what-you-see" gate. Running the actor as a **separate,
> non-allowlisted uid** (`loom-actor`/611) makes the OS itself refuse the actor at the broker: the broker's sudoers
> authorizes only the OPERATOR uid to `sudo -u loom-broker`, so 611 cannot reach the broker AT ALL. **No code and
> no green test proves the uid separation is real** — it is a deployment property *you* establish and verify
> **out-of-band**; the verifier (`loom-actor-custody-verify.js`) checks every condition the host uid can observe,
> and **you close the last step** by attesting the uid separation yourself.
>
> This is the symmetric twin of `loom-broker.md`: the broker put the SIGNER on a separate uid (610); this puts the
> ACTOR on a separate uid (611). It pairs with the broker deploy (#404) to make the human-gate a *real*
> authorization boundary against a rogue actor. The routing seam (`runActorTrajectory` -> the cross-uid launcher) is
> SHIPPED and fails CLOSED on a deployed-but-unconfigured box (step 7); until you run this deploy + dogfood, the
> actor still runs as the operator uid (clean box => `direct`), so #412 stays open until then.

## Why a DEDICATED `loom-actor` uid

Separate trust domain (its own uid, key, wrapper, allowlist entry) for blast-radius isolation. Do not reuse the
`loom-broker` uid (610) or the operator uid (501). The whole point is a uid that is **NOT** on the broker's
`LOOM_BROKER_ALLOWED_UIDS` and **NOT** in the broker's `operator ALL=(loom-broker)` sudoers rule.

## The structural barrier (what actually holds, and what is contingent)

- **The load-bearing gate (always holds): the broker's sudoers runas binding.** `operator ALL=(loom-broker)
  NOPASSWD: <wrapper>` authorizes only the operator uid to `sudo -u loom-broker`. 611 is not `operator`, so `sudo -n
  -u loom-broker` is denied by sudo itself, regardless of any env 611 controls. OS/sudoers-enforced (the runas
  binding), deploy-contingent — not a kernel hook.
- **A second, deploy-CONTINGENT layer (defense-in-depth): the broker's caller-auth allowlist.** `LOOM_BROKER_ALLOWED_UIDS`
  (operator only) rejects 611 — but only under the broker deploy's `env_reset, !setenv` (on a DIRECT non-sudo invoke
  `SUDO_UID` is forgeable; see `loom-broker-caller-auth.js`). Do NOT treat caller-auth as an independent guarantee;
  lean the structural claim on the sudoers gate.

## 0. Prerequisites (note the macOS wrinkle)

- A POSIX host where you can create a system user and edit `sudoers`.
- **A root-owned `claude` + `node` (paths you pass to the helper).** On a home-dir-locked dev box the operator's
  `claude` (`~/.local/bin/claude`) is operator-uid-writable, and a Homebrew node is owner-writable. A 501-writable
  `claude`/node that runs AS 611 is privilege-escalation, so the helper REQUIRES root-owned binaries and REFUSES a
  non-root-locked one (`loom-actor-custody-verify` C4 re-asserts it at verify time). Obtain them out-of-band — see
  step 3.
- **The macOS deploy helper `scripts/loom-actor-deploy-macos.sh` automates steps 1-4** (mirroring
  `scripts/loom-broker-deploy-macos.sh`; dry-run by default, `--apply` requires root, prints sudoers, never
  auto-edits it). It does NOT copy your `$HOME` claude (a deploy-time trojan surface — see step 3); you pass
  `--claude-bin` + `--node` (both root-owned):

  ```sh
  # preview (touches nothing):
  bash scripts/loom-actor-deploy-macos.sh --claude-bin /opt/loom-actor/claude --node /usr/local/bin/node
  # apply (creates the uid, prompts for the API key on STDIN, installs the wrapper, prints sudoers):
  sudo bash scripts/loom-actor-deploy-macos.sh --claude-bin /opt/loom-actor/claude --node /usr/local/bin/node --apply
  ```

  The manual steps below are the contract it implements.

## 1. Create the actor system user (no login, no shell)

```sh
# Linux
sudo useradd --system --no-create-home --shell /usr/sbin/nologin loom-actor

# macOS (pick an unused UID, e.g. 611)
sudo sysadminctl -addUser loom-actor -UID 611 -shell /usr/bin/false -home /var/empty
```

## 2. Install the actor's OWN `ANTHROPIC_API_KEY` custody (owned 611, 0600, host-unreadable)

The cross-uid `sudo` does `env_reset`, so 611 does NOT inherit the operator's `ANTHROPIC_API_KEY` — it needs its
own. Supply the key VALUE via **STDIN**, never argv (a `--api-key value` is visible in `ps`) and never a file the
host keeps:

```sh
sudo install -d -o root -g wheel -m 0755 /etc/loom                 # ROOT-owned, traversable key DIR (so the verifier can lstat the owner)
umask 077
printf '%s' "$ANTHROPIC_API_KEY" | sudo tee /etc/loom/actor-anthropic.key >/dev/null   # value on STDIN, not argv
sudo chown loom-actor:wheel /etc/loom/actor-anthropic.key
sudo chmod 0600 /etc/loom/actor-anthropic.key                      # owner(611)-only; the host/operator uid CANNOT read it
unset ANTHROPIC_API_KEY                                            # clear it from your shell
```

The key DIR is **root-owned 0755** (traversable so the host can `lstat` the key and CONFIRM a different owner — a
`0700` dir would BLIND the verifier); the key FILE is **0600 owned by 611** (the host/operator uid cannot read it).

## 3. Provide a root-owned `claude` + `node` (the helper REFUSES a `$HOME` source — the C1 privesc)

The wrapper execs `claude` (and its `node`) AS uid 611. A 501-writable `claude`/node — or any 501-writable ancestor —
that runs as 611 is privilege-escalation: a 501 actor swaps the binary at deploy time and runs arbitrary code as 611
with the API key. So the helper does **NOT** copy your `~/.local/bin/claude` (the source is operator-writable;
copying-then-root-locking only blesses a possible trojan). Provide root-owned binaries out-of-band and pass their paths:

```sh
# node: the nodejs.org .pkg installs a root-owned /usr/local/bin/node (a Homebrew /opt/homebrew node is owner-writable -> REFUSED).
stat -f '%Su %Sp' /usr/local/bin/node            # expect: root -rwxr-xr-x

# claude: obtain a ROOT-OWNED claude. Either install it at a root-level location, OR copy it as root ONLY at a moment
# you trust your $HOME copy (no autonomous actor running), into a root-owned dir, then confirm it is root-locked.
# NOTE: stock/older macOS `readlink -f` lacks -f; resolve the symlink portably with python3:
CLAUDE_SRC="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$(command -v claude)")"
sudo install -d -o root -g wheel -m 0755 /opt/loom-actor
sudo install -o root -g wheel -m 0755 "${CLAUDE_SRC}" /opt/loom-actor/claude
stat -f '%Su %Sp' /opt/loom-actor/claude         # expect: root -rwxr-xr-x
```

The helper `assert_root_locked`s both `--claude-bin` and `--node` (the resolved path + every ancestor) and REFUSES a
non-root-locked one under `--apply` — so a writable binary fails closed rather than being silently blessed. The
copy above still trusts your `$HOME` claude AT COPY TIME; that trust is yours to make (do it when no autonomous
actor is running), and the helper's refusal forces it to be a conscious step rather than a silent one.

## 4. Install the actor wrapper (root-owned 0755; no-Bash actor + tool-less judge; FAIL-CLOSED `case` dispatch)

A **host-writable wrapper is a privesc hole** — own it root, not group/world-writable. The wrapper dispatches on `$1`
through an **explicit-allowlist `case`** (NOT a denylist): the actor modes are the three allowlisted models, the
judge modes (#430) are the `--loom-judge*` sentinels, and **anything else — an empty / whitespace / leading-dash /
unknown `$1` — FAILS CLOSED (`exit 2`)**, never the tool-bearing actor recipe (the launcher validates `$1` before it
gets here; the `case` is the defense-in-depth backstop). The prompt rides STDIN; the actor toolset is hardcoded
no-Bash; the judge recipe is tool-less (a prompt-injected judge gets no host action):

```sh
sudo tee /usr/local/bin/loom-actor-run >/dev/null <<'EOF'
#!/bin/sh
# $1 selects the mode (the prompt rides STDIN). Anything not listed -> FAIL CLOSED.
PATH=<dir-of-your---node>:/usr/bin:/bin                             # so claude's node shebang resolves under sudo env_reset (the helper fills this from --node)
case "$1" in
  --loom-actor-version-probe) exec /opt/loom-actor/claude --version ;;                                            # C3: free, no key
  --loom-judge-version-probe) export ANTHROPIC_API_KEY="$(cat /etc/loom/actor-anthropic.key)"; exec /opt/loom-actor/claude -p --tools "" --strict-mcp-config --disallowedTools LSP --model claude-sonnet-4-6 --output-format stream-json --verbose ;;  # C5: tool-less probe
  --loom-judge) export ANTHROPIC_API_KEY="$(cat /etc/loom/actor-anthropic.key)"; exec /opt/loom-actor/claude -p --tools "" --strict-mcp-config --disallowedTools LSP --model claude-sonnet-4-6 --max-budget-usd 0.50 ;;            # #430 PR-2: the tool-less, PLAIN-output judge
  claude-sonnet-4-6|claude-opus-4-8|claude-haiku-4-5) export ANTHROPIC_API_KEY="$(cat /etc/loom/actor-anthropic.key)"; exec /opt/loom-actor/claude -p --output-format stream-json --verbose --model "$1" --allowedTools Read,Grep,Glob,Edit,Write ;;  # the actor
  *) echo "loom-actor-run: unrecognized mode '$1' — refusing (fail-closed)" >&2; exit 2 ;;
esac
EOF
sudo chown root:wheel /usr/local/bin/loom-actor-run
sudo chmod 0755 /usr/local/bin/loom-actor-run                       # NOT group/world-writable (the verifier checks this)
```

The version-probe branch runs `claude --version` BEFORE the key export — the custody-verifier's C3 exec-liveness
proves the cross-uid exec path without ever touching the API key. The model-arm allowlist MUST stay in sync with
`ALLOWED_ACTOR_MODELS` (`packages/kernel/egress/loom-actor-launch.js`) — a drift fails CLOSED. The judge model
(`claude-sonnet-4-6`) duplicates `JUDGE_MODEL` in the JS chokepoints; the cross-ref is the SOLE model-drift guard
(custody-verify C5 checks the judge `tools[]`, NOT the model). `scripts/loom-actor-deploy-macos.sh` installs exactly
this body — prefer the helper; this manual form is the contract it implements.

## 5. Authorize the operator uid to run ONLY that wrapper as `loom-actor` — and PIN the env policy

```sh
sudo visudo -f /etc/sudoers.d/loom-actor
```

```sudoers
# <hostuser> may run ONLY the actor wrapper, as loom-actor, no password.
<hostuser> ALL=(loom-actor) NOPASSWD: /usr/local/bin/loom-actor-run

# PIN the env policy. env_reset strips the operator's ANTHROPIC_API_KEY (611 uses its OWN from custody) and forbids
# code-loading vars; !setenv stops the command line injecting any.
Defaults:<hostuser> env_reset, !setenv
Defaults!/usr/local/bin/loom-actor-run env_reset, !setenv
```

## 6. Verify — AS THE HOST UID — then attest OUT-OF-BAND (the step only you can do)

```sh
node /opt/loom/packages/kernel/egress/loom-actor-custody-verify.js \
  --key /etc/loom/actor-anthropic.key --actor-user loom-actor \
  --wrapper /usr/local/bin/loom-actor-run \
  --claude-bin /opt/loom-actor/claude --node-bin /usr/local/bin/node
```

Expect `C0`/`C1`/`C2`/`C3`/`C2.5`/`C4`/`C5` and `hostObservableChecksPassed: true` with
`requiresOutOfBandUidConfirmation: true`. The tool **deliberately exits non-zero** until you attest. A `C3` "did
NOT run" under otherwise-correct wiring most likely means the operator uid is not authorized in the sudoers (step
5), NOT a key failure. **`C5` (#430) is the judge tool-lessness + judge-aware-wrapper gate** — it runs the
`--loom-judge-version-probe` arm (a real, cheap `claude -p`) AS 611 and asserts the init `tools[]` is empty; a `C5`
FAIL means either an OLD wrapper without the judge arm (re-install step 4) or a tool leak. Now do the out-of-band
check the tool structurally cannot:

```sh
id                                       # note YOUR uid
ls -l /etc/loom/actor-anthropic.key      # the OWNER must be `loom-actor`, NOT you
cat /etc/loom/actor-anthropic.key        # MUST print: Permission denied
```

Only if the owner is a **different** uid AND the read is denied is custody real. Record your attestation:

```sh
node .../loom-actor-custody-verify.js ... --attested-cross-uid     # exits 0 ONLY now
```

## 7. Wire the routing seam (the env the deployed box MUST export)

The routing seam in `runActorTrajectory` is SHIPPED. It routes the host actor through `crossUidActorArgs` (run as
611) when this env is set, and **fails CLOSED on a deployed-but-unconfigured box** (the H1 polarity trap: unlike the
broker's arm-check, a launcher that defaulted benign-on-unset would run the actor as the *privileged* uid-501). The
resolver's precedence (firsthand — `defaultActorLauncher`): BOTH set => cross-uid; exactly-one (or empty/whitespace,
which counts as unset) => REFUSE `half-configured`; both unset + a deployed-signal => REFUSE `deployed-unconfigured`;
clean box (no signal) => direct (unchanged).

**Export BOTH the config AND the explicit pin, and PERSIST them** (in the SAME environment that launches the
orchestration, so the actor child inherits — and cannot unset — them):

```sh
export LOOM_ACTOR_USER=loom-actor
export LOOM_ACTOR_WRAPPER=/usr/local/bin/loom-actor-run
export LOOM_ACTOR_REQUIRE_UID_SEP=1     # MANDATORY: the explicit deployed-signal (the PRIMARY backstop). Without it,
                                        # the fail-closed guarantee on env-loss rests only on the default key-marker
                                        # path existing — set the flag so "never run as 501" holds by construction.
```

Persist them so env-loss is the abnormal case (a launchd `EnvironmentVariables` dict in the orchestration's plist,
or an export in the service's profile). On env-loss WITH the deployed-signal present, the seam REFUSES (fails closed)
rather than silently running as 501. (The key-marker `/etc/loom/actor-anthropic.key` is the *backstop* deployed-signal;
`LOOM_ACTOR_REQUIRE_UID_SEP=1` is the primary, explicit one — set it. Override the marker path with `LOOM_ACTOR_KEY_MARKER`.)

### Persisting the env (the first dogfood proved this necessary)

The four vars are read from the process env per spawn, so the SERVICE that launches the orchestration must carry them,
not just an interactive shell. A fresh login shell that loses them makes the seam fail CLOSED (correct behavior, not an
error): the first operator dogfood hit exactly this, refusing with
`[LOOM-EGRESS-ALERT] {"launchMode":"deployed-unconfigured","reason":"judge-launch-refused"}` because the key-marker is a
deployed-signal while the presence-pair was unset. Re-export (or fix the plist) and re-run. Persist via the
orchestration's launchd plist `EnvironmentVariables` (add `LOOM_JUDGE_REQUIRE_UID_SEP` here ONLY after C5 is green, step 8):

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>LOOM_ACTOR_USER</key><string>loom-actor</string>
  <key>LOOM_ACTOR_WRAPPER</key><string>/usr/local/bin/loom-actor-run</string>
  <key>LOOM_ACTOR_REQUIRE_UID_SEP</key><string>1</string>
  <key>LOOM_JUDGE_REQUIRE_UID_SEP</key><string>1</string>
</dict>
```

(Tracking: have `scripts/loom-actor-deploy-macos.sh` emit this plist template so it is not hand-authored, in #435.)

The #422 armed-refusal guard stays UNCONDITIONAL and FIRST (never relaxed by uid-611 — `isEmitArmed` reads custody
the guard cannot prove is wired, so "611 ⇒ safe to run armed" would couple correctness to an unobservable deploy
property). uid-611 is purely additive: the belt to #422's suspenders.

**The clone must be 611-accessible** (R3): the throwaway repo clone the actor works in (the spawn `cwd`) is created
by the operator (501). uid-611 needs read+write there, or the cross-uid actor RUNS BUT PRODUCES ZERO EDITS — an
`ok:true` result with an empty trajectory that LOOKS like a weak actor, not a perms bug. The operator dogfood MUST
exercise an Edit/Write and confirm the diff lands; grant 611 access to the clone (e.g. an ACL or a shared group).

## 8. Wire the JUDGE routing seam (#430 PR-2 — set ONLY after C5 passes)

The four host-side judge/labeler/deriver `claude -p` chokepoints (the blind semantic judge + reference teacher, the
friction labeler, the rung-2 judge, the lesson deriver) route cross-uid through the SAME `loom-actor` uid + wrapper
(lean-B: no second uid). Because they reuse the actor wrapper, the routing has an extra **judge-aware confirmation**:
the runtime cannot probe the wrapper per-spawn, so an explicit operator flag is the signal — and a box on an OLD
(actor-only) wrapper must NOT route judges into it. The launcher is FAIL-CLOSED-on-deployed: presence pair set +
flag truthy => cross-uid; presence set + flag absent => REFUSE `judge-wrapper-unconfirmed`; flag set + presence
unset => REFUSE `deployed-unconfigured` (never silent 501); clean box => direct.

```sh
# ONLY after `loom-actor-custody-verify ... ` reports C5 PASS (the wrapper is confirmed judge-aware + tool-less):
export LOOM_JUDGE_REQUIRE_UID_SEP=1     # the judge-aware confirmation — DO NOT set it before C5 is green
```

Persist it in the SAME environment as the step-7 actor vars. Setting it BEFORE re-deploying the judge-aware wrapper
(step 4's `case` form) is the one hazard the runtime can't catch by itself — but it fails NOISILY, not openly: the
`--loom-judge` sentinel is dash-leading, so an OLD wrapper lands it in `--model "--loom-judge"`, which claude rejects
(the judge degrades to its fail-closed fallback), never a tool-bearing run over judge input. C5 is the gate that
prevents even that — confirm it green first.

**Until you set this flag, the judges run `direct` (as 501) — exactly the pre-#430 posture, held by the PR-1
armed-window guard + the PATH-1 human gate + the tool-less pin (NOT closed).** The structural close is in force only
once the judge-aware wrapper is deployed, C5 attested, and this flag set.

## Residuals (open — NOT closed by this deployment)

- **#412 is NOT flipped closed by this arc.** This ships the VEHICLE; the operator's deploy + dogfood (this runbook)
  is the close, exactly as #404 was for the broker. PATH-1 (human-at-push) is the backstop until then.
- **Host-compromise at uid-501 still mints.** A compromised orchestration, or the operator, can mint+emit — a
  DIFFERENT threat. uid-611 closes the autonomous *actor's* mint-ability, not a 501-equivalent.
- **Sibling judge/labeler `claude -p` spawns — now ADDRESSED by #430 (was a NAMED residual here).** PR-1 (#431)
  added the armed-window guard to all four (`assertHostClaudeAllowed` — they refuse to spawn while a live emit is
  armed); PR-2 (this) routes them cross-uid through the SAME `loom-actor` uid when deployed + confirmed (step 8), and
  pins the tool-less recipe in the direct path. The structural close is deploy-contingent exactly like the actor's:
  until step 8's flag is set on a judge-aware box, the judges run `direct` (as 501) held by the PR-1 armed guard +
  the PATH-1 human gate + the tool-less pin. The tool-less recipe is an ENUMERATED denylist (`claude-headless.js`) —
  a future always-on built-in would leak until added; the load-bearing close is the uid-separation, not the flag.
  The `--loom-judge` PLAIN-output branch's parseability is proven by the operator's judge dogfood (C5 proves the
  PROBE branch is tool-less, not the real branch's output shape).
- **The verifier checks the necessary condition, not the sufficient one.** It confirms the API-key is owned by a
  different uid, the host can't read it, and the cross-uid wrapper runs claude; it cannot confirm the *running actor
  process* is that uid. That is the out-of-band attestation in step 6.
