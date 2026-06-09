# Security Audit

Run a security audit on the current codebase or recent changes.

## Steps

1. Run `npm audit --audit-level=high` to check dependencies
2. Search for hardcoded secrets using grep patterns
3. Delegate to the **hacker** agent (read-only, adversarial lens) for the OWASP Top 10 review — review passes use read-only personas per `rules/core/workflow.md`; the Write-capable **security-auditor** is reserved for APPLYING remediations after findings are triaged, never as the reviewer (a Write-capable reviewer invites mid-review scope leak)
4. Present findings in structured format with severity levels
5. For CRITICAL findings: stop all other work and fix immediately (this is where **security-auditor** comes in, with user approval)
