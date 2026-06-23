# Security Guardrails

## Pre-Commit Checklist

- [ ] No hardcoded secrets (API keys, passwords, tokens, connection strings)
- [ ] All user inputs validated and sanitized
- [ ] SQL queries parameterized (no string concatenation)
- [ ] XSS prevented (output escaped, CSP configured)
- [ ] CSRF protection on state-changing endpoints
- [ ] Auth/authz verified on every protected route
- [ ] Rate limiting on public endpoints
- [ ] Error messages do not leak internal details

## Authorization & post-condition checks (exact-set, verify the real thing)

- **Exact-set equality, NOT a subset `.includes` / membership test, for any
  single-purpose authorization or security post-condition.** A subset check is
  superset-tolerant: a `[target, victim]` input passes `.includes(target)` and
  launders a single-target approval into a multi-record action. Compare the FULL
  set — compute `missing[]` + `unexpected[]` and require both empty — never "does it
  contain X." (Recurred: the v3.6 W2a CRITICAL was a superset poison-key decoy that
  beat a subset `.includes` post-condition; same class as the manage-promote IDOR.)
- **A content-addressed store must verify CONTENT on read, not just the key.** A
  filename-equals-field check alone is bypassable — re-derive the id from the body
  and reject a mismatch (the #273 record-store lesson). The store is not a sandbox.
- **Integrity is NOT provenance — never derive TRUST from a record's mere existence in an
  open-writable store.** Verify-on-read proves a record is *self-consistent* (integrity), NOT that
  the *legitimate producer* made it (provenance): anyone who can write the store can CO-FORGE a
  byte-indistinguishable record — a valid body plus a matching content-addressed key/sidecar
  re-derived via the SAME exported function — so any weight / score / authorization that reads
  "this record exists and verifies" is inflatable by an unauthorized writer. A trust input needs an
  AUTHENTICATED minter (a signed record, or a kernel-owned writer the caller cannot invoke), never a
  store re-hash. (The #273 family's THIRD face, after exact-set and verify-on-read: v3.11 W3 — a
  forged `confirmed-by` edge minted via the exported `deriveEdgeId` + a matching sidecar inflated the
  advisory confirmed-weight even though every store re-verified on read. Tolerable there ONLY because
  the weight was shadow/advisory and never gated an action; the moment such a weight gates, the
  authenticated writer is mandatory.)
- **A guard must be NON-VACUOUS — prove it can fail.** A check that never exercised its failure
  path is theater: inject the violation (a present, planted secret; a real bypass input), watch the
  assertion fire RED, then revert. An oracle asserted against an absent precondition — no secret to
  scrub, an empty `/proc/self/mountinfo` to attest, no mount to escape — passes vacuously and proves
  nothing. Require a present-target precondition so the pass is meaningful.
- **A guard must be NON-BYPASSABLE — a hard constant, not a caller-overridable default.** A "pinned"
  value left as a function parameter is a soft default any caller dials off from the call site; remove
  the parameter so the guarantee cannot be overridden.
- **A fail-CLOSED security decision must be OBSERVABLE, not a silent `{ok:false}`.** A bare reject
  (`{ok:false, reason}`) with no telemetry hides BOTH an attack (a tamper attempt — a forged/mismatched
  signature, a body-hash mismatch, a verify-key-fallback attempt) AND a bug (a misconfigured trust-anchor
  silently rejecting every *legitimate* approval). Emit a high-visibility signal on the reason-bearing
  reject path — cheap while the gate is SHADOW/advisory, load-bearing the moment it gates a live action:
  you cannot alert on, or debug, a gate whose failures never surface. (`drift:fail-silent` ×3; the
  v3.2.5a egress `verifyApproval` returns `sig-invalid` / `no-verify-key` / `body-hash-mismatch` /
  `expired` with no emit.)

## Secret Management

- NEVER hardcode secrets in source code
- Use environment variables or a secret manager
- Validate required secrets at startup
- Rotate any secrets that may have been exposed
- Add secrets patterns to .gitignore

## Security Response Protocol

If a security issue is found:
1. STOP current work immediately
2. Invoke the security-auditor agent
3. Fix CRITICAL issues before any other work continues
4. Rotate exposed secrets
5. Scan the full codebase for similar patterns
