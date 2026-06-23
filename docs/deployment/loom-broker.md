---
lifecycle: persistent
created: 2026-06-22
audience: operator (deploys + attests; NOT the build)
---

# Deploying the `loom-broker` signing broker under a separate uid (custody-real)

> **What this gets you, and what it does NOT (read first — NS-7 / NS-9).** The `loom-broker`
> (`packages/kernel/egress/loom-broker-sign.js`) keeps the egress-approval signing key out of the host process's
> heap. That is a *mechanism* — a VEHICLE. It becomes custody-**real** only when the broker runs under a
> **genuinely separate OS uid**, so the host (the autonomous actor) cannot read the key, `ptrace` the broker, or
> read its `/proc/<pid>/mem`. **No code and no green test proves this** — it is a deployment property *you*
> establish and verify **out-of-band**. The kernel's `EACCES` under a separate uid is the world-anchored signal.
> This runbook gets you there; the verifier (`loom-custody-verify.js`) checks every condition the host uid can
> observe; **you close the last step** by attesting the uid separation yourself.
>
> Everything here is **SHADOW** — `armedEmit` still throws, so no signed approval gates a live PR emission yet
> (that arms in ③.2.5c). This hardens *non-exfiltration* of the approval-signing key (an HSM-shaped property),
> NOT the human's judgment (see "Residuals").

## Why a DEDICATED `loom-broker` (separate from PACT's `pact-broker`)

This broker shares the *mechanism* with PACT's cross-uid broker but is a **separate trust domain** (its own uid,
key, wrapper, allowlist) for blast-radius isolation: a compromise of one substrate's broker cannot mint the
other's approvals. Do not reuse the `pact-broker` uid or key.

## 0. Prerequisites

- A POSIX host (Linux or macOS) where you can create a system user and edit `sudoers`.
- Node.js available to both the host uid and the broker uid.
- The Power Loom tree checked out at a path both uids can execute (e.g. `/opt/loom`).

## 1. Create the broker system user (no login, no shell)

```sh
# Linux
sudo useradd --system --no-create-home --shell /usr/sbin/nologin loom-broker

# macOS (pick an unused UID, e.g. 610)
sudo sysadminctl -addUser loom-broker -UID 610 -shell /usr/bin/false -home /var/empty
```

## 2. Generate the keypair; the PRIVATE key is owned by `loom-broker`, mode 0600

Generate an ed25519 keypair (`generateEdgeKeypair()` in `packages/kernel/_lib/edge-attestation.js`), then place
the **private** key where only `loom-broker` can read it, and pin the **public** key to the host custody file
(step 5).

```sh
sudo install -d -o loom-broker -g loom-broker -m 0755 /etc/loom            # traversable key DIR (key stays 0600) so the verifier can read the key's OWNER
sudo install -o loom-broker -g loom-broker -m 0600 broker.key /etc/loom/broker.key
sudo rm -f broker.key                                                      # remove the host-side copy
```

The key DIR is **0755** (the key itself is **0600**) on purpose: the host uid can then `lstat` the key and
CONFIRM it is owned by a *different* uid — the verifier's necessary condition. A **0700** dir would BLIND the
verifier (owner-unknown -> FAIL). **Additionally, the actor (autonomous) uid must gain nothing from a direct
invoke**: keep `/etc/loom` and the key un-readable to the actor uid (the actor is never the host/operator uid).
Custody comes from the key's `0600` + a different owner, NOT from the dir mode.

## 3. Install a wrapper the broker uid runs (owned root, NOT host-writable)

The host names only this wrapper — never the key path, never the interpreter. The wrapper sets the key path
**broker-side** and execs the broker. A **host-writable wrapper is a privilege-escalation hole** (the host could
edit the script `sudo` runs as `loom-broker`), so it MUST be owned by root and not group/world-writable.

```sh
sudo tee /usr/local/bin/loom-broker-sign >/dev/null <<'EOF'
#!/bin/sh
export LOOM_BROKER_KEY_FILE=/etc/loom/broker.key
export LOOM_BROKER_ALLOWED_UIDS=501          # caller-auth: the host/operator uid(s) allowed to request a signature (comma-separated). NEVER the actor uid.
exec /usr/bin/node /opt/loom/packages/kernel/egress/loom-broker-sign.js "$@"
EOF
sudo chown root:root /usr/local/bin/loom-broker-sign
sudo chmod 0755 /usr/local/bin/loom-broker-sign          # NOT group/world-writable (the verifier checks this)
```

`LOOM_BROKER_ALLOWED_UIDS` is the **caller-auth allowlist** — the uid(s) the broker will sign for. **It is
MANDATORY: the Loom broker is DENY-on-unset** (unlike PACT's opt-in). Omitting the line denies ALL callers
(the broker prints `caller-auth misconfigured: allowlist-unset` and refuses). It MUST be a **hardcoded literal**
here in the root-owned wrapper (the host can't tamper it; sudo `env_reset` also strips any host-supplied value).
Its VALUE's provenance — not just the wrapper file's integrity — is the trust anchor (integrity != provenance):
never interpolate it from a host-influenced source (a `/tmp` file, a host env var). **Set it to the host/operator
uid only — NEVER the autonomous actor uid** (the whole point is that the actor cannot mint an approval).

The **recompute-bind (WHAT gate) is ALWAYS-ON** in `loom-broker-sign.js` — there is no toggle and no blind-oracle
mode. The broker reads the approval-context preimage on stdin, re-derives the freshness basis from the emission
body, and signs only the recomputed basis. The host wiring (step 6) presents the context automatically.

## 4. Authorize the host uid to run ONLY that wrapper as `loom-broker` — and PIN the env policy

```sh
sudo visudo -f /etc/sudoers.d/loom-broker
```

```sudoers
# <hostuser> may run ONLY the broker wrapper, as loom-broker, no password.
<hostuser> ALL=(loom-broker) NOPASSWD: /usr/local/bin/loom-broker-sign

# PIN the env policy. env_reset is the default, but DO NOT rely on the default — make it explicit, and forbid
# SETENV so neither the host nor the command line can inject code-loading / key-path vars.
Defaults:<hostuser> env_reset, !setenv
Defaults!/usr/local/bin/loom-broker-sign env_reset, !setenv
```

**Then verify the env policy holds** (an out-of-band audit the verifier does NOT perform — it does not parse
`sudoers`):

```sh
sudo -l -U <hostuser>           # human-scan: NO env_keep carries NODE_OPTIONS / BASH_ENV / LD_* / DYLD_*

# SUDO_* is the LOAD-BEARING one for caller-auth — assert it explicitly. Match the env-var token PRECISELY
# (case-sensitive SUDO_<NAME>): a loose `env_keep.*SUDO_` FALSE-fails on stock macOS because the greedy `.*`
# reaches `lecture_file=/etc/sudo_lecture` (a sudo CONFIG PATH, not an env var). This should print `OK`:
sudo -l -U <hostuser> | grep -oE 'SUDO_[A-Za-z]+' \
  && echo 'FAIL: env_keep carries a SUDO_* var -- the caller-auth premise is VOID; fix the policy before trusting this deployment' \
  || echo 'OK: no SUDO_* preserved'
```

**`SUDO_UID` is load-bearing for caller-auth:** the whole WHO gate rests on sudo SETTING `SUDO_UID` from the real
caller uid. On a direct (non-sudo) invoke the actor forges `SUDO_UID` freely — so caller-auth is **NOT** an
independent control; its soundness rests on (a) sudo injecting an unforgeable `SUDO_UID` under `env_reset, !setenv`
and (b) the cross-uid KEY CUSTODY making a direct invoke pointless (the actor can't read the key). If `env_keep`
carried a host-supplied `SUDO_UID`, the gate is void.

## 5. Pin the broker's PUBLIC key to the host custody file

Write the broker's **public** key PEM to a host-readable custody file (the host never sees the private key). This
is BOTH the `loom-custody-verify` `--verify-key` AND the egress emit gate's `custodyVerifyKeyPath` (the verify key
`verifyApproval` checks the broker signature against, with NO env fallback):

```sh
sudo install -m 0644 broker.pub /etc/loom/verify.pem      # the pinned verify key (public; selects the authoritative sig)
```

## 6. Wire the host (zero seam change)

```js
const { crossUidLoomBrokerSigner } = require('/opt/loom/packages/kernel/egress/loom-broker-launch');
const signFn = crossUidLoomBrokerSigner({ brokerUser: 'loom-broker', wrapperPath: '/usr/local/bin/loom-broker-sign' });
// signFn plugs straight into the existing recordApproval signFn seam — recordApproval(dir, draft, { signFn, ... }).
// (The approve-CLI of ③.2.5b.2 is the human "sign-what-you-see" gate that drives this.)
```

## 7. Verify — AS THE HOST UID — then attest OUT-OF-BAND (the step only you can do)

**Sequence note:** set `LOOM_BROKER_ALLOWED_UIDS` (step 3) to include the **operator's own uid FIRST** — the C3
live-sign goes through `sudo` and will be DENIED (reported as "broker returned NO signature") if the operator uid
is not on the allowlist. A C3 "no signature" under otherwise-correct wiring most likely means the operator uid is
not allowlisted, NOT a key failure.

```sh
node /opt/loom/packages/kernel/egress/loom-custody-verify.js \
  --key /etc/loom/broker.key --verify-key /etc/loom/verify.pem \
  --broker-user loom-broker --wrapper /usr/local/bin/loom-broker-sign
```

Expect: `C0`/`C1`/`C2`/`C3`/`C2.5` and `hostObservableChecksPassed: true` with
`requiresOutOfBandUidConfirmation: true`. The tool **deliberately exits non-zero** until you attest — its exit
code is never greener than the truth. Now do the out-of-band check the tool structurally cannot:

```sh
id                           # note YOUR uid
ls -l /etc/loom/broker.key   # the OWNER must be `loom-broker`, NOT you
cat /etc/loom/broker.key     # MUST print: Permission denied
```

Only if the owner is a **different** uid AND the read is denied is custody real. Record your attestation:

```sh
node .../loom-custody-verify.js ... --attested-cross-uid   # exits 0 ONLY now
```

## 8. Verify caller-auth actually rejects a non-member

> Remember (step 4): caller-auth is CONTINGENT, not independent — a passing flip-test below proves the gate
> rejects a non-member *under sudo*, but on a direct (non-sudo) invoke `SUDO_UID` is forgeable; the cross-uid key
> custody is the real control.

```sh
# A. your uid signs a probe (the happy path; node prints a base64 sig):
HEX=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
printf '{}' | sudo -n -u loom-broker /usr/local/bin/loom-broker-sign "$HEX"
#   -> NOTE: with a bare '{}' ctx the recompute-bind REFUSES (request not authorized) — that is correct; the
#      real context comes from the approve-CLI. To prove caller-auth specifically, temporarily flip the allowlist:
# B. flip the allowlist to a uid that is NOT yours and confirm the broker REFUSES, then RESTORE:
#   sudo sed -i '' 's/ALLOWED_UIDS=501/ALLOWED_UIDS=999/' /usr/local/bin/loom-broker-sign
#   printf '{}' | sudo -n -u loom-broker /usr/local/bin/loom-broker-sign "$HEX"  # -> "caller not authorized", empty stdout, exit 1
#   sudo sed -i '' 's/ALLOWED_UIDS=999/ALLOWED_UIDS=501/' /usr/local/bin/loom-broker-sign   # RESTORE
```

## Residuals (open — NOT closed by this deployment)

- **Single-operator payload authority (BY DESIGN — PATH-1).** The entitled human (at the approve-CLI) can sign ANY
  well-formed emission — the broker makes the human's approval un-forgeable by the actor, it does NOT adjudicate
  the human's judgment. "Did a human SEE this exact draft" is the approve-CLI's sign-what-you-see job (③.2.5b.2).
- **caller-auth is CONTINGENT, not independent.** It holds only under the deployed sudo `env_reset, !setenv` (so
  `SUDO_UID` is unforgeable) + the cross-uid key custody (so a direct invoke gains nothing). On either failure the
  WHO gate is void; the cross-uid key custody is the real control.
- **Single-uid is identical to in-process at rest.** If you skip the separate uid (run the broker as your own /
  the actor's uid), the file mode + `sudoers` buy NOTHING — the host uid still reads the key. Only a genuinely
  separate uid makes it custody.
- **The verifier checks the necessary condition, not the sufficient one.** It confirms the key file is owned by a
  different uid and the host can't read it; it cannot confirm the *running broker process* is that uid. That is
  the out-of-band attestation in step 7 — there is no substitute for it.
- **integrity != provenance (the verify half, ③.2.5a).** `verifyApproval` proves an approval is self-consistent
  and broker-signed; the cross-uid deployment here is what makes "broker-signed" mean "the actor did not mint it."
  Un-deployed (same-uid), a host process co-forges a byte-valid signed approval. SHADOW until ③.2.5c arms emission.
