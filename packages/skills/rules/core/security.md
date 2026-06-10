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
