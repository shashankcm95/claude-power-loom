# Security Audit

Run a security audit on the current codebase or recent changes.

## Steps

1. Run `npm audit --audit-level=high` to check dependencies
2. Search for hardcoded secrets using grep patterns
3. Delegate to the **security-auditor** agent for OWASP Top 10 review
4. Present findings in structured format with severity levels
5. For CRITICAL findings: stop all other work and fix immediately
