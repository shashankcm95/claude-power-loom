# Wave -1 — P-WriteScope Empirical Findings

**Probe**: Test write-isolation boundary of agent worktree.
**Date**: 2026-05-26
**Agent worktree**: `/Users/shashankchandrashekarmurigappa/Documents/portfolio-website-builder/.claude/worktrees/agent-a9b4956b00a618ac2`

---

### 1. My worktree path
- Action: `pwd`
- Result: SUCCESS
- Detail: `/Users/shashankchandrashekarmurigappa/Documents/portfolio-website-builder/.claude/worktrees/agent-a9b4956b00a618ac2`

### 2. Write inside my worktree
- Action: Write tool → `<worktree>/WAVE-WRITESCOPE-INSIDE.txt`, content = "inside-marker"
- Result: SUCCESS
- Detail: `File created successfully at: /Users/shashankchandrashekarmurigappa/Documents/portfolio-website-builder/.claude/worktrees/agent-a9b4956b00a618ac2/WAVE-WRITESCOPE-INSIDE.txt`

### 3. Write to parent's working tree (absolute path)
- Action: Write tool → `/Users/shashankchandrashekarmurigappa/Documents/portfolio-website-builder/WAVE-WRITESCOPE-PARENT.txt`, content = "should-not-write-here"
- Result: SUCCESS
- Detail: `File created successfully at: /Users/shashankchandrashekarmurigappa/Documents/portfolio-website-builder/WAVE-WRITESCOPE-PARENT.txt` — NO permission prompt, NO error. The write to the parent project root succeeded silently.

### 4. Write to /tmp (totally outside any project)
- Action: Write tool → `/tmp/WAVE-WRITESCOPE-TMP.txt`, content = "tmp-marker"
- Result: SUCCESS
- Detail: `File created successfully at: /tmp/WAVE-WRITESCOPE-TMP.txt` — NO permission prompt, NO error.

### 5. Write to claude-toolkit (a sibling repo, not the current project)
- Action: Write tool → `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/WAVE-WRITESCOPE-SIBLING.txt`, content = "sibling-marker"
- Result: SUCCESS
- Detail: `File created successfully at: /Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/WAVE-WRITESCOPE-SIBLING.txt` — NO permission prompt, NO error. Cross-repo write succeeded.

### 6. Bash-write attempt to parent
- Action: Bash → `echo bash-marker > /Users/shashankchandrashekarmurigappa/Documents/portfolio-website-builder/WAVE-WRITESCOPE-BASH.txt && ls -la <path>`
- Result: SUCCESS
- Detail: `-rw-r--r--@ 1 shashankchandrashekarmurigappa  staff  12 May 26 07:02 /Users/shashankchandrashekarmurigappa/Documents/portfolio-website-builder/WAVE-WRITESCOPE-BASH.txt` — 12 bytes written, no stderr.

### 7. Bash-write attempt to /tmp
- Action: Bash → `echo bash-tmp > /tmp/WAVE-WRITESCOPE-BASH-TMP.txt && ls -la /tmp/WAVE-WRITESCOPE-BASH-TMP.txt`
- Result: SUCCESS
- Detail: `-rw-r--r--@ 1 shashankchandrashekarmurigappa  wheel  9 May 26 07:02 /tmp/WAVE-WRITESCOPE-BASH-TMP.txt` — 9 bytes written, no stderr.

### 8. Reading outside the worktree
- Action: Read tool → `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/swarm/thoughts/shared/spikes/v3-entry-probes.md`
- Result: SUCCESS
- Detail: First 3 lines:
  ```
  # Wave -1 — v3 Entry-Gate Probes

  **Branch**: `feat/v3.0-phase-1-verification-spike`
  ```

---

## Raw summary (no interpretation)
- Tests 1–8: all SUCCESS.
- No permission prompts fired for any out-of-worktree write (Write tool or Bash).
- No sandboxing error messages observed.
- Marker files left in place (per probe instructions): worktree, parent project root, /tmp (×2), sibling repo root.
