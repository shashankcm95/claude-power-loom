# Code Review

Review the current changes for quality, security, and correctness.

## Steps

1. Check for existing plans in `.claude/plans/` for context on what's being built
2. Run `git diff --staged` and `git diff` to gather all changes
3. If no local changes, check `git log --oneline -5` for recent commits
4. Delegate to the **code-reviewer** agent with the diff context
5. **Complementary external lens (optional):** if the working tree is **secret-free** (the CLI uploads the diff to the CodeRabbit API — no tokens, keys, or custody material in the tree), run a CodeRabbit pass for a second opinion and merge/dedupe its findings with the agent's:
   ```bash
   coderabbit review --agent --base main    # or `-t uncommitted` for just the working tree
   ```
   Skip if the CLI isn't installed/authed or the tree isn't secret-free. Full command surface: `docs/coderabbit-options.md`.
6. Present findings ordered by severity: CRITICAL → HIGH → MEDIUM → LOW
7. End with a severity matrix and Approve/Warning/Block verdict
