# Evolve — Update an Agent, Skill, or Command with New Learnings

Update an existing agent / skill / command from a concrete observed run, then ship it through the normal gate. To create something new, use `/forge` instead.

## Arguments

$ARGUMENTS — the agent / skill / command to evolve (e.g., "code-reviewer", "prune") + the learnings.

## Risk tier (decide FIRST — it picks the path)

- **Low** — a command's or skill's PROSE (steps, conventions, examples). Proceed here.
- **High** — an **agent rewrite** (it changes every future spawn of that persona) or any **persona-contract** change. Per the self-improvement rule these need human-reasoned review: **route through `/self-improve` first**, then return here for the mechanical edit. Do not silently rewrite a persona.

## Step 1 — Locate the SOURCE (not the installed copy)

The target is one of three shapes — find it in the repo source:

- agent   -> `agents/{name}.md`
- skill   -> `packages/skills/library/{name}/SKILL.md`
- command -> `packages/skills/commands/{name}.md`

Read the installed copy (`~/.claude/agents|commands/...` or the plugin cache) ONLY to confirm the live state — but **edit the source**. The installed copy is a `cp` / plugin-cache that the next `install.sh` / `claude plugin update` clobbers (edit-source rule, #219). Not found -> suggest `/forge`.

## Step 2 — Gather learnings (anchor to a concrete run)

The strongest signal is a **specific observed failure**: what did this agent/skill do wrong on a real task, and what should it have done? Add:

- the user's stated feedback / directives;
- `library ls toolkit/session-snapshots` + MEMORY entries that name it (grep);
- prior evolution records (`library ls toolkit/decisions`).

No concrete run behind it -> say so; a speculative evolution is weak.

## Step 3 — Apply the edit (scope by target type)

- **All**: refine the steps from what worked/failed; add a "failure patterns to avoid" note; keep examples runnable; ASCII + markdownlint-clean (these `.md` are in the repo lint gate).
- **Agents only**: `tools:` permissions, `model:` tier, and the persona-contract `interface.instincts[]` (parity-enforced) — change these deliberately; widening `tools:` is a capability change.

## Step 4 — Verify (the step the old version lacked)

- **Command / skill (docs)**: `npx markdownlint-cli2 <file>` -> 0 errors.
- **Agent**: `node packages/runtime/orchestration/contracts-validate.js` (persona-instinct parity MUST be 0) + the relevant unit suite — an agent edit can break the BUILD, not just read oddly.
- Any `.js` touched: `node scripts/generate-signpost.js --check`.

## Step 5 — Record the evolution (library; content from stdin)

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/library.js write toolkit/decisions/evolve-<name>-<YYYY-MM-DD> \
  --form narrative --topic evolve,<name> --entities <related> <<'EOF'
<the triggering run, the gaps found, the changes applied, the disposition>
EOF
```

## Step 6 — Ship through the gate (NOT a local hotfix)

The source edit is a normal repo change: **branch -> PR -> USER merge -> live on `claude plugin update` / `install.sh`**. Never edit the installed/cached `~/.claude/` copy — it is clobbered AND bypasses the merge gate. (MEMORY + library volumes are the exception: local, edited in place.) Report the diff + the verify result + the PR link.
