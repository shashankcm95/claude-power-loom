# Scenario 02 — Security-Heavy Task

## The task (passed verbatim to `claude -p`)

> I have a small Node.js auth helper at `bench/scenarios/02-security-audit/fixture/`. Two requests:
>
> 1. Add a `rotateToken(currentToken)` function to `auth.js` that:
>    - Validates `currentToken` is a 64-char hex string (the format `generateToken` produces)
>    - Returns a new token if validation passes
>    - Throws a clear error if validation fails
>    - Uses constant-time comparison anywhere it checks token equality
> 2. Add tests for the new function in `auth.test.js` covering: valid input happy path, invalid-length input, non-hex input.
>
> Existing tests must continue to pass. The auth code touches secret material — please have a security audit done before finalizing. Cite the relevant security KB documents in your reasoning.

## Why this task

Security-heavy by design: the prompt explicitly mentions secrets, asks for constant-time comparison, and requests a security audit. This should trigger:

| Plugin feature | Trigger |
|---|---|
| `security-auditor` agent spawn | Explicit "security audit done before finalizing" |
| `validate-no-bare-secrets` hook | Edit on auth.js with API_KEY_FALLBACK present in file (control: should APPROVE; placeholder carve-out) |
| `architect` agent | Design choice on rotation strategy + validation pattern |
| `code-reviewer` agent | Post-write review |
| KB consultation | Security KB docs (`kb:architecture/discipline/error-handling-discipline`, `kb:security/*`) |
| `kb-citation-gate` hook | Should fire on each architect spawn (deterministic per GAP-D) |
| `route-decide` hook | Should fire per GAP-C |

## Deterministic PASS criteria

1. Exit 0 from `claude -p`
2. `auth.js` contains a `rotateToken` function definition
3. `auth.js` contains `crypto.timingSafeEqual` OR documented constant-time alternative
4. `auth.js` validates token format (regex for 64-hex, length check)
5. `auth.test.js` has at least 1 new test for `rotateToken` (test count > 3)
6. `node auth.test.js` exits 0
7. At least 1 sub-agent spawn (Agent tool fires)
8. **At least one of: `security-auditor` spawned OR security-related kb refs cited**
9. `validate-no-bare-secrets` did NOT block the run (API_KEY_FALLBACK is the SEC-3 placeholder carve-out)
10. Stop hook fired (turnCounter delta ≥ 1)

## Comparative dimensions (same as scenario 01)

Tokens / latency / turns / tool uses / sub-agent spawns / hook firings / fixture diff.

## What this scenario does NOT test

- Constant-time comparison correctness (smoke-level: presence of `timingSafeEqual` reference)
- Cryptographic implementation depth
- Real auth flow (this is a fixture — token rotation is the surface)
