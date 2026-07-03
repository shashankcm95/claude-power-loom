#!/bin/sh
# Loom pre-push lint gate — a thin shim that delegates to the Node decision core.
#
# Named `pre-push.sh` (not `pre-push`) so the existing shellcheck smoke gate
# (tests/smoke-ht.sh Test 81, which enumerates `*.sh`) lints it automatically.
# `install.sh --git-hooks` COPIES it to `.git/hooks/pre-push` (the git hook name,
# no extension). The COPY model is deliberate: setting core.hooksPath would
# clobber this repo's already-set hooksPath pin, resolve inconsistently under
# worktreeConfig=true, and silently disable every existing .git/hooks/* (e.g. a
# secret-scanner pre-commit). A copy touches no config and survives orphan-branch
# / `git rm` checkouts.
#
# Git invokes the installed hook with: argv = <remote-name> <remote-url>; stdin =
# one line per pushed ref, "<localref> <localsha> <remoteref> <remotesha>".
#
# Fail-OPEN (exit 0) at the shim level on any unavailability — not a git repo, the
# hook module missing, or node absent. A lint gate must never brick a push on its
# own setup. The escape for a real lint failure is the native `git push --no-verify`.
#
# shellcheck shell=sh

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
hook="$root/packages/kernel/validators/lint-gate-prepush.js"
[ -f "$hook" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

# exec preserves fd 0 (the ref-lines on stdin) for node to read.
exec node "$hook" "$@"
