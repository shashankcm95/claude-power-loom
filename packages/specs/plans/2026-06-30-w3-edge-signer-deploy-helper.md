---
lifecycle: persistent
topic: pra2b-w3, edge-signer-deploy, cross-uid-custody, runbook, deploy-helper
---

# W3 — loom-edge-signer deploy helper (runbook + macOS script)

The autonomous-SDE ladder rung that makes the cross-uid EDGE custody **real**: provisions the
deployment so the `loom-edge-signer` runs under a genuinely separate OS uid (612). The edge signer
mechanisms (`loom-edge-sign.js`, `loom-edge-launch.js`, `loom-edge-custody-verify.js`) shipped in W2b
(#466-#470); W3 is the **DEPLOY/OPS layer** — a faithful PORT of the broker precedent to the edge
custody domain. **SHADOW**: `LIVE_SOURCES = Object.freeze([])`, so no live world-anchor mint signs an
edge yet — that arms in **PR-B** (the Rubicon). The deploy is still valuable now: it lets the operator
provision + verify custody + dogfood the C3 live-sign BEFORE PR-B flips the consumer.

## Scope (USER-decided 2026-06-30): deploy artifacts ONLY; the routing resolver defers to PR-B

Two new files, both ports. **No new kernel JS, no new resolver, no new unit tests** (the deploy
scripts are operator-run, gated by shellcheck + manual dry-run, not unit-tested — confirmed: zero tests
reference `*-deploy-macos.sh`). The runtime routing resolver (`LOOM_EDGE_REQUIRE_UID_SEP` deployed-
signal + asymmetric fail-closed parse) ships in **PR-B** where it has a live call site (the mint);
W3 only DOCUMENTS that arming flag as a forward-contract. Building it caller-less in W3 would guess a
contract against a consumer that does not exist yet.

| Artifact | Path | Action |
|---|---|---|
| Runbook | `docs/deployment/loom-edge.md` | BUILD — port `docs/deployment/loom-broker.md` |
| Deploy helper | `scripts/loom-edge-deploy-macos.sh` | BUILD — port `scripts/loom-broker-deploy-macos.sh` |
| signer / launcher / verifier / caller-auth | `packages/kernel/egress/loom-edge-*.js` | REUSE (merged W2b) |

## The broker→edge substitution map (every token; the port must preserve EVERY security gate)

| Broker | Edge |
|---|---|
| user `loom-broker`, uid `610` | `loom-edge-signer`, uid `612` (610=broker, 611=actor) |
| wrapper `/usr/local/bin/loom-broker-sign` | `/usr/local/bin/loom-edge-sign` |
| `LOOM_BROKER_KEY_FILE` / `LOOM_BROKER_ALLOWED_UIDS` | `LOOM_EDGE_KEY_FILE` / `LOOM_EDGE_ALLOWED_UIDS` |
| key `/etc/loom/broker.key` | `/etc/loom/edge.key` (0600, owned by 612) |
| verify `/etc/loom/verify.pem` | `/etc/loom/edge-verify.pem` (0644 root) |
| entrypoint `loom-broker-sign.js` | `loom-edge-sign.js` |
| verifier `loom-custody-verify.js --broker-user` | `loom-edge-custody-verify.js --edge-user` (CLI: `--key --verify-key --edge-user --wrapper [--sudo] [--attested-cross-uid]`) |
| wire `crossUidLoomBrokerSigner` | `crossUidLoomEdgeSigner({ edgeUser, wrapperPath })` → world-anchor store `opts.signer` seam (SHADOW; PR-B wires) |
| `--broker-uid` flag | `--edge-uid` flag |
| keygen `generateEdgeKeypair` | SAME (broker already uses it — no change) |

**Edge-specific divergences (NOT mechanical renames):**
- **WHAT gate** = `loom-edge-bind` recompute-bind (re-derive the edge-id basis from `{from_node_id,
  to_delta_ref, edge_type}` on stdin), NOT the broker's approval-context preimage.
- **SHADOW framing** = `LIVE_SOURCES` empty → no edge signed by a live mint (PR-B arms), NOT the
  broker's `armedEmit`/③.2.5c.
- **Verify-key consumer** = the edge custody-verify C3 sig-check + (future) PR-B world-anchor edge-sig
  verification, NOT the egress emit gate's `custodyVerifyKeyPath`.
- **Residual** = the cross-uid IS the #273 integrity-vs-provenance NARROW→CLOSE for the edge weight;
  same-uid co-forge survives un-deployed; NO live consumer until PR-B.
- **Arming-flag forward-contract** = document `LOOM_EDGE_REQUIRE_UID_SEP` (the PR-B deployed-signal,
  asymmetric strict-truthy-to-arm / lenient-non-falsey-to-fail-closed, typo-fails-CLOSED) as future,
  clearly marked "PR-B ships the resolver; SHADOW until then."

## Load-bearing security gates to PORT VERBATIM (drop none — a port-drop is the failure mode)

From `loom-broker-deploy-macos.sh` (every one must survive the port; the VALIDATE hacker diffs for drops):
- `set -euo pipefail`; dry-run BY DEFAULT; `--apply` requires root (`id -u`==0).
- `assert_abs_safe` — reject non-absolute / `..` / whitespace / shell-metachar paths (M1).
- `assert_root_locked` — refuse a node/stage/wrapper-dir whose ancestor chain to `/` is non-root-owned
  OR group/world-writable (C1/C2 privesc gate); HARD refuse under `--apply`, WARN in dry-run.
- C1 node root-lock runs BEFORE the first `node` execution (the `--version` probe); C2 re-asserts the
  staged entrypoint after staging.
- M2 — never allowlist uid 0: demand sudo (`SUDO_UID`) or explicit `--host-uid`, AND reject a resolved 0.
- Symlink-key refuse; existing-key ownership+mode (0600) validation (fail closed on either).
- `trap`-shred the keygen temp on ANY exit (H1).
- Existing-user uid-mismatch refuse.
- sudoers PRINT ONLY (never auto-edit) + the `env_reset, !setenv` block + the case-sensitive
  `SUDO_[A-Za-z0-9_]+` env_keep audit.

## Verify / gate (no unit tests — this is docs + an operator script)

- **shellcheck** the new `.sh` (CI gate in `.github/workflows/ci.yml`; run `shellcheck` locally).
- **markdownlint** the new `.md` (docs/ is NOT excluded — only packages/specs is); MD037/MD004 discipline.
- **doc-path gate** (CI): every path the `.md` cites must exist (or be a documented placeholder). The
  `.md` cites `packages/kernel/egress/loom-edge-*.js` (all present) + the new `scripts/loom-edge-deploy-macos.sh`.
- **dry-run smoke**: `bash scripts/loom-edge-deploy-macos.sh` (no `--apply`) renders the full preview,
  touches nothing, exits 0. The wrapper body + sudoers block render with edge tokens.
- New `.js`? NO → no signpost regen. New `.sh`/`.md` only.
- **`bash install.sh --hooks --test`** green (eslint/yaml/markdownlint 129/0).

## VALIDATE (the load-bearing pass for a PORT — Rule 2a: attack the BUILT artifact)

- **hacker** re-probes the BUILT `loom-edge-deploy-macos.sh`: diff vs the broker source, confirm NO
  privesc gate was DROPPED or WEAKENED in the port; check the edge wrapper body has no injection seam,
  uid 612 free, the verify command flags match the edge verifier's actual CLI, no edge-specific hole.
- **architect** port-fidelity: every broker→edge substitution applied, every edge-specific divergence
  correct, the SHADOW + arming-flag forward-contract framing honest (no over-claim of what W3 delivers).
- Lens scaling: this PROVISIONS a privileged path → the hacker lens IS warranted (per Rule 2 the
  kernel/security class), but it is a PORT of an already-hacker-reviewed script, so the hacker's job is
  drop/weaken detection + edge-specific holes, not a from-scratch audit.

## Runtime Probes (claims this plan rests on)

- `Probe: ls docs/deployment/loom-edge.md scripts/loom-edge-deploy-macos.sh → neither exists` (W3 builds both). ✓ done
- `Probe: grep -rln deploy-macos tests → (empty)` — deploy scripts have no unit tests. ✓ done
- `Probe: grep shellcheck .github/workflows/ci.yml → present` — shellcheck CI gate exists. ✓ done
- `Probe: edge custody-verify usage → --key --verify-key --edge-user --wrapper [--sudo] [--attested-cross-uid]`. ✓ done
- `Probe: uid convention 610 broker / 611 actor → 612 free for edge`. ✓ done
