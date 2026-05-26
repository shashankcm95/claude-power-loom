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
