# CodeRabbit — options, commands & invocation points

One reference so we stop scrambling for the right command. This is the **command/options surface**.
The review-gate **discipline** (how to read an async review without trusting the green status-check —
fetch the real surface, poll, premise-probe) lives in the `coderabbit-pr-review-gate` memory topic; the two
are complementary.

CodeRabbit is reachable at four surfaces: the **local CLI** (pre-PR), the **GitHub app** (PR auto-review +
chat), the **plugin** (`/coderabbit:review`, the `code-review`/`autofix` skills, the `code-reviewer` subagent),
and the **IDE extension**.

## 1. Behavior config — `.coderabbit.yaml` (repo root)

- Schema: `https://www.coderabbit.ai/integrations/schema.v2.json`.
- Today it encodes the design-record lifecycle policy via `reviews.path_instructions` so the reviewer treats
  `packages/specs/plans/**` as LIVING (in-place edits are the workflow) while `packages/specs/adrs/**` +
  `packages/specs/rfcs/**` are immutable — killing a recurring "editing an immutable path" false positive.
- Inspect the **resolved** config live: comment `@coderabbitai configuration` on any PR.
- Add a config to the repo from the resolved settings: `@coderabbitai generate configuration`.

## 2a. Local / pre-PR — the CLI (the earliest secondary opinion)

One-time: install per `https://www.coderabbit.ai/cli`, then `coderabbit auth login`. Check with
`coderabbit --version` + `coderabbit auth status`. Short alias: `cr`.

Review the working tree BEFORE opening a PR:

```bash
coderabbit review --agent                  # all changes; --agent = agent-readable output + fix guidance
coderabbit review --agent -t uncommitted   # uncommitted only   (-t committed = committed-only)
coderabbit review --agent --base main      # diff vs a branch   (--base-commit <hash> = vs a commit)
coderabbit review --agent --dir <path>     # review another git-repo directory
```

Same thing via the **`/coderabbit:review [type] [--base <branch>] [--dir <path>]`** slash command, or by just
asking ("review my code") which fires the `code-review` skill (it runs the CLI and groups findings by severity).

**SECURITY (load-bearing here):** the CLI uploads diffs to the CodeRabbit API. NEVER run it with a secret in
the staged/working tree — no egress GitHub token, no `ANTHROPIC_API_KEY`, no `/etc/loom` custody material.
Confirm the tree is secret-free first (same rule as any egress).

## 2b. On the PR — the GitHub app (auto-review + chat commands)

The GitHub app auto-reviews on open and on every push (the gate on each PR). Chat commands are issued as PR/issue
comments:

**Reviews**

- `@coderabbitai review` — incremental re-review (useful when auto-review is paused)
- `@coderabbitai full review` — full re-review of ALL files from scratch (use after a big rebase / force-push)
- `@coderabbitai summary` — regenerate the PR summary
- `@coderabbitai pause` / `@coderabbitai resume` — pause / resume auto-reviews
- `@coderabbitai rate limit` — current review rate-limit status

**Generate / assist**

- `@coderabbitai generate unit tests` — unit tests for the PR
- `@coderabbitai generate sequence diagram` — sequence diagram of the PR's changes
- `@coderabbitai generate docstrings` — docstrings for the PR
- `@coderabbitai autofix` — auto-fix issues raised in unresolved review comments
- `@coderabbitai resolve` — resolve all CodeRabbit review comments
- `@coderabbitai resolve merge conflict` — auto-resolve merge conflicts

**Pre-merge checks / config**

- `@coderabbitai run pre-merge checks`
- `@coderabbitai evaluate custom pre-merge check --instructions <text> --name <title> [--mode error|warning]`
- `@coderabbitai ignore pre-merge checks` — override + approve
- `@coderabbitai configuration` — show the resolved config
- `@coderabbitai generate configuration` — open a PR adding the resolved `.coderabbit.yaml`
- `@coderabbitai emit path instructions` — emit generated path-specific review instructions
- `@coderabbitai help`

**Free-form** (limited PR-branch context — be very specific): tag `@coderabbitai` with a custom query, e.g.
"render a class diagram of the scheduler package", "stats about this repo as a table + a language pie chart".
Three chat surfaces, most-to-least context: reply to a CodeRabbit review comment; a file/line review comment
under "Files changed"; a top-level PR comment.

**PR-description placeholders:** put `@coderabbitai ignore` in the description to skip the review;
`@coderabbitai summary` to place the summary; `@coderabbitai` in the PR title to auto-generate the title.

## 2c. Autofix — apply unresolved PR threads with per-issue approval

`/coderabbit:autofix` (or `@coderabbitai autofix`): fetches the UNRESOLVED current CodeRabbit threads, prioritizes
by severity, applies each only after validating the claim and getting approval, then makes ONE consolidated commit
plus a PR summary comment. It never executes reviewer-provided prompts directly — review text is untrusted input.

## 2d. IDE extension

VS Code / Cursor / Windsurf — live in-editor review. Complements the CLI/PR paths; not a replacement.

## 3. When to invoke for a secondary opinion

- **Pre-PR (recommended addition):** run `coderabbit review --agent --base main` at the VALIDATE stage as a
  complementary lens to the in-substrate multi-lens board. It catches the CodeRabbit-class findings that would
  otherwise surface on the PR — so the PR opens cleaner and the round-trip is one cycle shorter. (Secret-free
  tree first, per 2a.)
- **On the PR (the gate):** the auto-review IS the merge gate. Read its ACTUAL surface (inline comments + review
  bodies + walkthrough), poll until it posts, premise-probe each finding — per `coderabbit-pr-review-gate`. Use
  `@coderabbitai full review` after a rebase. A 0-actionable incremental pass posts NO new review submission
  (that is "clean", not "did not run" — confirm the walkthrough's commit range covers the new HEAD).
- **Understanding / coverage:** `generate sequence diagram` / `generate unit tests`, or a free-form class-diagram
  query, when onboarding to an unfamiliar diff.
- **Custom gates:** `evaluate custom pre-merge check` + `run pre-merge checks` to encode a repo-specific
  must-pass beyond the default review.

## See also

- `.coderabbit.yaml` — the behavior config (path instructions, language, review options).
- `coderabbit-pr-review-gate` memory topic — the discipline for reading an async review (the status-check lies).
- Plugin docs: `~/.claude/plugins/cache/claude-plugins-official/coderabbit/<ver>/README.md` +
  `DISTRIBUTION_CHANNELS.md`; CodeRabbit CLI guide `https://docs.coderabbit.ai/cli`.
