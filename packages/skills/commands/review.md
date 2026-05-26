# Code Review

Review the current changes for quality, security, and correctness.

## Steps

1. Check for existing plans in `.claude/plans/` for context on what's being built
2. Run `git diff --staged` and `git diff` to gather all changes
3. If no local changes, check `git log --oneline -5` for recent commits
4. Delegate to the **code-reviewer** agent with the diff context
5. Present findings ordered by severity: CRITICAL → HIGH → MEDIUM → LOW
6. End with a severity matrix and Approve/Warning/Block verdict
