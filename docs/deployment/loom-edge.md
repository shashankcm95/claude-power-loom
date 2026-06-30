---
lifecycle: persistent
created: 2026-06-30
audience: operator (deploys + attests; NOT the build)
---

# Deploying the `loom-edge-signer` world-anchor edge signer under a separate uid (custody-real)

> **What this gets you, and what it does NOT (read first — NS-7 / NS-9).** The `loom-edge-signer`
> (`packages/kernel/egress/loom-edge-sign.js`) keeps the world-anchor EDGE-signing key out of the host process's
> heap. That is a *mechanism* — a VEHICLE. It becomes custody-**real** only when the edge signer runs under a
> **genuinely separate OS uid**, so the host (the autonomous actor) cannot read the key, `ptrace` the signer, or
> read its `/proc/<pid>/mem`. **No code and no green test proves this** — it is a deployment property *you*
> establish and verify **out-of-band**. The kernel's `EACCES` under a separate uid is the world-anchored signal.
> This runbook gets you there; the verifier (`loom-edge-custody-verify.js`) checks every condition the host uid can
> observe; **you close the last step** by attesting the uid separation yourself.
>
> Everything here is **SHADOW** — the world-anchor store passes `signer:undefined` in production
> (`LIVE_SOURCES = Object.freeze([])`), so no signed edge gates a live action yet (that arms in **PR-B**, the
> Rubicon). This hardens *non-exfiltration* of the edge-signing key (an HSM-shaped property) and is the deployment
> half of the **#273 integrity-vs-provenance** close for the edge weight — un-deployed (same-uid), a host process
> co-forges a byte-valid signed edge; cross-uid, a signed edge means "the actor did not mint it".

## Why a DEDICATED `loom-edge-signer` (separate from `loom-broker` and PACT's `pact-broker`)

This signer shares the *mechanism* with the egress-approval broker (`loom-broker`, uid 610) but is a **separate
trust domain** (its own uid 612, key, wrapper, allowlist) for blast-radius isolation: a compromise of one
substrate's signer cannot mint the other's artifacts. The broker signs egress-approval freshness; the edge signer
signs world-anchor EDGE ids (the `(from_node_id, to_delta_ref, edge_type)` basis). Do not reuse the `loom-broker`
(610), `loom-actor` (611), or `pact-broker` uid or key.

## The WHAT gate (recompute-bind) is ALWAYS-ON

The recompute-bind in `loom-edge-sign.js` (via `loom-edge-bind`) is ALWAYS-ON — there is no toggle and no
blind-oracle mode. The signer reads the edge ctx preimage (`{from_node_id, to_delta_ref, edge_type}`) on stdin,
re-derives the edge-id basis (the SAME `deriveWorldAnchorEdgeId` the lab store uses), and signs ONLY the recomputed
basis — never the caller-asserted argv. The host wiring (step 7) presents the context.

## 0. Prerequisites

- A POSIX host (Linux or macOS) where you can create a system user and edit `sudoers`.
- Node.js available to both the host uid and the edge-signer uid.
- The Power Loom tree checked out at a path both uids can execute (e.g. `/opt/loom`).
- **The macOS deploy helper `scripts/loom-edge-deploy-macos.sh` automates steps 1-4** (mirroring
  `scripts/loom-broker-deploy-macos.sh`; dry-run by default, `--apply` requires root, prints sudoers, never
  auto-edits it, refuses a non-root-locked node/stage path). The manual steps below are the contract it implements.

  ```sh
  # preview (touches nothing):
  bash scripts/loom-edge-deploy-macos.sh --node /usr/local/bin/node
  # apply (creates the uid, generates the keypair, installs the wrapper, prints sudoers):
  sudo bash scripts/loom-edge-deploy-macos.sh --node /usr/local/bin/node --apply
  ```

## 1. Create the edge-signer system user (no login, no shell)

```sh
# Linux
sudo useradd --system --no-create-home --shell /usr/sbin/nologin loom-edge-signer

# macOS (pick an unused UID, e.g. 612)
sudo sysadminctl -addUser loom-edge-signer -UID 612 -shell /usr/bin/false -home /var/empty
```

## 2. Generate the keypair; the PRIVATE key is owned by `loom-edge-signer`, mode 0600

Generate an ed25519 keypair (`generateEdgeKeypair()` in `packages/kernel/_lib/edge-attestation.js`), then place
the **private** key where only `loom-edge-signer` can read it, and pin the **public** key to the host custody file
(step 5).

```sh
sudo install -d -o root -g wheel -m 0755 /etc/loom                         # ROOT-owned, traversable key DIR (so the verifier can lstat the owner); key file stays 0600
sudo install -o loom-edge-signer -g loom-edge-signer -m 0600 edge.key /etc/loom/edge.key
sudo rm -f edge.key                                                        # remove the host-side copy
```

The key DIR is **root-owned, 0755** (the key itself is **0600**) on purpose: it is traversable so the host uid can
`lstat` the key and CONFIRM it is owned by a *different* uid (the verifier's necessary condition — a **0700** dir
would BLIND the verifier, owner-unknown -> FAIL), and it is **root-owned** so no non-root principal (not the
edge-signer uid, not the operator, not the actor) can rename/replace the pinned `edge-verify.pem` entry inside it.
**Additionally, the actor (autonomous) uid must gain nothing from a direct invoke**: keep `/etc/loom` and the key
un-readable to the actor uid. Edge-key custody comes from the key's `0600` + a different owner; `edge-verify.pem`
swap-resistance comes from the **root-owned dir**. (Matches `scripts/loom-edge-deploy-macos.sh`.)

## 3. Install a wrapper the edge-signer uid runs (owned root, NOT host-writable)

The host names only this wrapper — never the key path, never the interpreter. The wrapper sets the key path
**edge-side** and execs the signer. A **host-writable wrapper is a privilege-escalation hole** (the host could
edit the script `sudo` runs as `loom-edge-signer`), so it MUST be owned by root and not group/world-writable.

```sh
sudo tee /usr/local/bin/loom-edge-sign >/dev/null <<'EOF'
#!/bin/sh
export LOOM_EDGE_KEY_FILE=/etc/loom/edge.key
export LOOM_EDGE_ALLOWED_UIDS=501          # caller-auth: the host/operator uid(s) allowed to request a signature (comma-separated). NEVER the actor uid.
exec /usr/bin/node /opt/loom/packages/kernel/egress/loom-edge-sign.js "$@"
EOF
sudo chown root:root /usr/local/bin/loom-edge-sign
sudo chmod 0755 /usr/local/bin/loom-edge-sign          # NOT group/world-writable (the verifier checks this)
```

`LOOM_EDGE_ALLOWED_UIDS` is the **caller-auth allowlist** — the uid(s) the signer will sign for. **It is
MANDATORY: the edge signer is DENY-on-unset.** Omitting the line denies ALL callers (the signer prints
`caller-auth misconfigured: allowlist-unset` and refuses). It MUST be a **hardcoded literal** here in the
root-owned wrapper (the host can't tamper it; sudo `env_reset` also strips any host-supplied value). Its VALUE's
provenance — not just the wrapper file's integrity — is the trust anchor (integrity != provenance): never
interpolate it from a host-influenced source (a `/tmp` file, a host env var). **Set it to the host/operator uid
only — NEVER the autonomous actor uid** (the whole point is that the actor cannot mint an edge).

## 4. Authorize the host uid to run ONLY that wrapper as `loom-edge-signer` — and PIN the env policy

```sh
sudo visudo -f /etc/sudoers.d/loom-edge
```

```sudoers
# <hostuser> may run ONLY the edge wrapper, as loom-edge-signer, no password.
<hostuser> ALL=(loom-edge-signer) NOPASSWD: /usr/local/bin/loom-edge-sign

# PIN the env policy. env_reset is the default, but DO NOT rely on the default — make it explicit, and forbid
# SETENV so neither the host nor the command line can inject code-loading / key-path vars.
Defaults:<hostuser> env_reset, !setenv
Defaults!/usr/local/bin/loom-edge-sign env_reset, !setenv
```

**Then verify the env policy holds** (an out-of-band audit the verifier does NOT perform — it does not parse
`sudoers`):

```sh
sudo -l -U <hostuser>           # human-scan: NO env_keep carries NODE_OPTIONS / BASH_ENV / LD_* / DYLD_*

# SUDO_* is the LOAD-BEARING one for caller-auth — assert it explicitly. Match the env-var token PRECISELY
# (case-sensitive SUDO_<NAME>): a loose `env_keep.*SUDO_` FALSE-fails on stock macOS because the greedy `.*`
# reaches `lecture_file=/etc/sudo_lecture` (a sudo CONFIG PATH, not an env var). This should print `OK`:
sudo -l -U <hostuser> | grep -oE 'SUDO_[A-Za-z0-9_]+' \
  && echo 'FAIL: env_keep carries a SUDO_* var -- the caller-auth premise is VOID; fix the policy before trusting this deployment' \
  || echo 'OK: no SUDO_* preserved'
```

**`SUDO_UID` is load-bearing for caller-auth:** the whole WHO gate rests on sudo SETTING `SUDO_UID` from the real
caller uid. On a direct (non-sudo) invoke the actor forges `SUDO_UID` freely — so caller-auth is **NOT** an
independent control; its soundness rests on (a) sudo injecting an unforgeable `SUDO_UID` under `env_reset, !setenv`
and (b) the cross-uid KEY CUSTODY making a direct invoke pointless (the actor can't read the key). If `env_keep`
carried a host-supplied `SUDO_UID`, the gate is void.

## 5. Pin the edge signer's PUBLIC key to the host custody file

Write the edge signer's **public** key PEM to a host-readable custody file (the host never sees the private key).
This is the `loom-edge-custody-verify` `--verify-key` (the C3 live-sign verifies the produced signature against it)
AND, at **PR-B**, the world-anchor store's edge-signature verify key:

```sh
sudo install -m 0644 edge.pub /etc/loom/edge-verify.pem      # the pinned verify key (public; selects the authoritative sig)
```

This root-owned `edge-verify.pem` cannot be swapped by the actor or operator (root-owned dir, step 2).

## 6. Verify — AS THE HOST UID — then attest OUT-OF-BAND (the step only you can do)

**Sequence note:** set `LOOM_EDGE_ALLOWED_UIDS` (step 3) to include the **operator's own uid FIRST** — the C3
live-sign goes through `sudo` and will be DENIED (reported as "edge signer returned NO signature") if the operator
uid is not on the allowlist. A C3 "no signature" under otherwise-correct wiring most likely means the operator uid
is not allowlisted, NOT a key failure.

```sh
node /opt/loom/packages/kernel/egress/loom-edge-custody-verify.js \
  --key /etc/loom/edge.key --verify-key /etc/loom/edge-verify.pem \
  --edge-user loom-edge-signer --wrapper /usr/local/bin/loom-edge-sign
```

Expect: `C0`/`C1`/`C2`/`C3`/`C2.5` (the print order) and `hostObservableChecksPassed: true` with
`requiresOutOfBandUidConfirmation: true`. The tool **deliberately exits non-zero** until you attest — its exit
code is never greener than the truth. `C3` (edge sign-liveness) presents a genuine consistent edge ctx and asserts
the produced signature verifies against the pinned key — the load-bearing non-vacuity proof. `C2.5` (wrapper
integrity) **FAILs — not warns —** unless the wrapper is a regular, root-owned, non-group/world-writable file not
owned by the host uid (stricter than the broker's `loom-custody-verify`, which NOTEs an unobservable owner); a
`C2.5` FAIL means re-check the wrapper ownership/mode from step 3. Now do the
out-of-band check the tool structurally cannot:

```sh
id                          # note YOUR uid
ls -l /etc/loom/edge.key    # the OWNER must be `loom-edge-signer`, NOT you
cat /etc/loom/edge.key      # MUST print: Permission denied
```

Only if the owner is a **different** uid AND the read is denied is custody real. Record your attestation:

```sh
node .../loom-edge-custody-verify.js ... --attested-cross-uid   # exits 0 ONLY now
```

## 7. Wire the host (the forward seam — SHADOW until PR-B)

```js
const { crossUidLoomEdgeSigner } = require('/opt/loom/packages/kernel/egress/loom-edge-launch');
const signer = crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: '/usr/local/bin/loom-edge-sign' });
// signer plugs into the world-anchor store's opts.signer seam — writeWorldAnchorEdge(dir, edge, { signer, ... }).
// PRODUCTION passes signer:undefined today (LIVE_SOURCES = Object.freeze([])), so the cross-uid signer is NOT yet
// wired into a live mint. PR-B (the Rubicon) flips LIVE_SOURCES, wires this seam to a live world-anchor mint, and
// adds the recall consumer.
```

### The arming flag (forward-contract — PR-B ships the resolver)

PR-B will gate the direct-vs-cross-uid routing decision on a **deployed-signal** env flag, parsed
**asymmetrically** so an operator typo fails **CLOSED** (the H1 polarity trap — a launcher that defaulted
benign-on-unset would run the privileged direct path). The contract PR-B implements (mirroring the actor seam's
`LOOM_ACTOR_REQUIRE_UID_SEP`):

```sh
# PR-B (NOT YET LIVE — documented here so the deployed box is ready):
export LOOM_EDGE_REQUIRE_UID_SEP=1     # explicit deployed-signal: ARM the cross-uid edge signer.
```

- **ENABLING** the privileged cross-uid path needs a STRICT explicit-truthy (`1`/`true`/`yes`/`on`).
- **Deciding the box is DEPLOYED-and-must-fail-closed** needs only a LENIENT non-falsey token (anything not
  empty/`0`/`false`/`no`/`off`, **including an operator typo like `ture`**) — so a garbage value REFUSES (fails
  closed) rather than silently running the unprivileged direct path. Two predicates, never one shared parser.

Until PR-B ships the resolver + this flag, the edge signer is SHADOW (no live caller); setting the flag now is a
no-op.

## 8. Verify caller-auth actually rejects a non-member (prove the guard can FAIL)

> Remember (step 4): caller-auth is CONTINGENT, not independent — a passing flip-test below proves the gate
> rejects a non-member *under sudo*, but on a direct (non-sudo) invoke `SUDO_UID` is forgeable; the cross-uid key
> custody is the real control.

```sh
# A. your uid is on the allowlist (the happy path for caller-auth):
HEX=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
printf '{}' | sudo -n -u loom-edge-signer /usr/local/bin/loom-edge-sign "$HEX"
#   -> NOTE: with a bare '{}' ctx the recompute-bind (WHAT gate) REFUSES ("request not authorized") — that is
#      correct, and proves caller-auth (the WHO gate, which runs first) PASSED for your uid. A genuine edge ctx
#      (the {from_node_id,to_delta_ref,edge_type} preimage) comes from the world-anchor mint (PR-B).
# B. flip the allowlist to a uid that is NOT yours and confirm the edge signer REFUSES at the WHO gate, then RESTORE:
#   sudo sed -i '' 's/ALLOWED_UIDS=501/ALLOWED_UIDS=999/' /usr/local/bin/loom-edge-sign
#   printf '{}' | sudo -n -u loom-edge-signer /usr/local/bin/loom-edge-sign "$HEX"  # -> "caller not authorized", empty stdout, exit 1
#   sudo sed -i '' 's/ALLOWED_UIDS=999/ALLOWED_UIDS=501/' /usr/local/bin/loom-edge-sign   # RESTORE
```

## Residuals (open — NOT closed by this deployment)

- **No live consumer until PR-B.** This ships + provisions the VEHICLE. `LIVE_SOURCES` is empty, so no world-anchor
  mint signs an edge yet; the recall consumer that would READ a signed-edge weight is PR-B. The deploy is still
  valuable: provision + verify custody + dogfood the C3 live-sign before PR-B flips the consumer.
- **integrity != provenance — the cross-uid IS the close for the edge weight.** `verifyEdgeSig` proves an edge
  signature is self-consistent; the cross-uid deployment here is what makes "edge-signed" mean "the actor did not
  co-forge it". Un-deployed (same-uid), a host process re-derives the basis with the SAME exported function + signs
  it with a readable key — a byte-valid forged edge. SHADOW until PR-B arms a weight that reads it.
- **caller-auth is CONTINGENT, not independent.** It holds only under the deployed sudo `env_reset, !setenv` (so
  `SUDO_UID` is unforgeable) + the cross-uid key custody (so a direct invoke gains nothing). On either failure the
  WHO gate is void; the cross-uid key custody is the real control.
- **Single-uid is identical to in-process at rest.** If you skip the separate uid (run the signer as your own /
  the actor's uid), the file mode + `sudoers` buy NOTHING — the host uid still reads the key. Only a genuinely
  separate uid makes it custody.
- **The verifier checks the necessary condition, not the sufficient one.** It confirms the key file is owned by a
  different uid and the host can't read it; it cannot confirm the *running edge-signer process* is that uid. That
  is the out-of-band attestation in step 6 — there is no substitute for it.
