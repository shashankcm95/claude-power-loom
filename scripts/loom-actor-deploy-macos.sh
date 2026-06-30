#!/usr/bin/env bash
# loom-actor-deploy-macos.sh — operator helper for the cross-uid loom-actor deploy on macOS (#412 PR 2).
#
# Companion to docs/deployment/loom-actor.md. Stands up the loom-actor system uid (611) so the autonomous
# `claude -p` actor runs as a SEPARATE non-allowlisted uid — structurally excluded from the loom-broker (the
# broker's sudoers authorizes only the operator uid, so 611 cannot `sudo -u loom-broker` at all). Symmetric twin of
# scripts/loom-broker-deploy-macos.sh (the broker put the SIGNER on a separate uid; this puts the ACTOR on one).
#
# SECURITY (hacker-reviewed) — two surfaces the broker helper did NOT have:
#   1. The actor's API key is an OPERATOR SECRET, not a generated keypair. It is read on STDIN (hidden), under
#      umask 077, written via a builtin `printf | tee` (the value never touches argv / `ps` / a log), into a
#      ROOT-LOCKED key dir (so no symlink-follow TOCTOU), then chowned to the actor uid 0600. The dry-run path
#      NEVER reads or prints it.
#   2. The wrapper execs `claude` (and its node) AS the actor uid. The helper does NOT copy a $HOME claude — that
#      would be a deploy-time trojan surface (the source is operator-uid-writable; only the destination would be
#      root-locked). It REQUIRES root-owned --claude-bin + --node (provide them out-of-band, exactly as the broker
#      required a root-owned node) and REFUSES a non-root-locked one. No copy -> no TOCTOU.
#
# SAFETY: dry-run BY DEFAULT (prints every step, touches nothing). --apply executes (requires sudo so SUDO_UID is
# the real operator). NEVER edits sudoers (a syntax error locks you out) — PRINTS the block for visudo. Idempotent
# (skips an existing user/key). Fails loud (set -euo pipefail).
#
# Usage:
#   bash scripts/loom-actor-deploy-macos.sh --claude-bin /opt/loom-actor/claude --node /usr/local/bin/node   # dry-run
#   sudo bash scripts/loom-actor-deploy-macos.sh --claude-bin <abs> --node /usr/local/bin/node --apply
# Options: --claude-bin <abs> + --node <abs> (REQUIRED, must be root-owned) · --actor-user <name> (default
#          loom-actor) · --actor-uid <n> (default 611) · --host-uid <n> (default $SUDO_UID) · --broker-uid <n>
#          (default 610; for the distinct-uid refusal)

set -euo pipefail

APPLY=false
CLAUDE_BIN=
NODE_BIN=
ACTOR_USER=loom-actor
ACTOR_UID=611
BROKER_UID=610
HOST_UID="${SUDO_UID:-$(id -u)}"
HOST_UID_EXPLICIT=false
KEY_DIR=/etc/loom
KEY_FILE=/etc/loom/actor-anthropic.key
WRAPPER=/usr/local/bin/loom-actor-run

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true ;;
    --claude-bin) CLAUDE_BIN="${2:?--claude-bin needs a value}"; shift ;;
    --node) NODE_BIN="${2:?--node needs a value}"; shift ;;
    --actor-user) ACTOR_USER="${2:?--actor-user needs a value}"; shift ;;
    --actor-uid) ACTOR_UID="${2:?--actor-uid needs a value}"; shift ;;
    --host-uid) HOST_UID="${2:?--host-uid needs a value}"; HOST_UID_EXPLICIT=true; shift ;;
    --broker-uid) BROKER_UID="${2:?--broker-uid needs a value}"; shift ;;
    -h|--help) grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '\n=== %s ===\n' "$1"; }
note() { printf '  %s\n' "$1"; }
run()  { if "$APPLY"; then "$@"; else printf '  [dry-run] %s\n' "$*"; fi; }
# portable canonicalize: BSD/stock macOS `readlink` lacks -f (CodeRabbit), which would silently make this a no-op and
# weaken assert_root_locked's symlink resolution. Try `readlink -f` (GNU / newer macOS), then python3 realpath
# (always present on macOS), then a pure-shell `cd -P` dir-resolve, finally the raw path.
resolve() {
  local r d b
  r="$(readlink -f "$1" 2>/dev/null)" && [ -n "$r" ] && { printf '%s\n' "$r"; return 0; }
  r="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null)" && [ -n "$r" ] && { printf '%s\n' "$r"; return 0; }
  d="$(dirname "$1")"; b="$(basename "$1")"
  if d="$(cd "$d" 2>/dev/null && pwd -P)"; then printf '%s/%s\n' "$d" "$b"; else printf '%s\n' "$1"; fi
}

# reject a path that is not absolute, contains '..', or carries shell-metachars/whitespace (interpolated into the
# generated /bin/sh wrapper + into argv). Mirrors loom-broker-deploy-macos.sh.
assert_abs_safe() {
  case "$1" in
    /*) ;;
    *) echo "REFUSE: ${2:-path} must be absolute: $1" >&2; exit 2 ;;
  esac
  case "$1" in
    *..*|*' '*|*$'\t'*|*';'*|*'&'*|*'|'*|*'$'*|*'`'*|*'*'*|*'('*|*'<'*|*'>'*|*'"'*|*"'"*|*\\*|*$'\n'*)
      echo "REFUSE: ${2:-path} contains an unsafe token (.. / whitespace / quote / backslash / shell metachar): $1" >&2; exit 2 ;;
  esac
}

# the actor user lands in the sudoers runas spec + the printed sudoers text — validate it like the launcher's
# USERNAME_RE (^[a-z_][a-z0-9_-]{0,31}$) so it can carry no shell metachar.
assert_username() {
  case "$1" in
    [a-z_]*) ;;
    *) echo "REFUSE: ${2:-user} must start with a lowercase letter or underscore: $1" >&2; exit 2 ;;
  esac
  case "$1" in
    *[!a-z0-9_-]*) echo "REFUSE: ${2:-user} must match ^[a-z_][a-z0-9_-]*\$ (no metachars; it lands in sudoers): $1" >&2; exit 2 ;;
  esac
  [ "${#1}" -le 32 ] || { echo "REFUSE: ${2:-user} too long (>32): $1" >&2; exit 2; }
}

# refuse if $1 (symlinks resolved) or ANY ancestor up to / is non-root-owned OR group/world-writable — the privesc
# gate. HARD refuse whenever we run as ROOT (under --apply OR a `sudo` dry-run), not just --apply: a root process must
# never slip past this gate (parity with the broker/edge helpers, where the next step execs the probed path AS ROOT;
# this helper has no such in-flow exec today, so it is defense-in-depth). Only a NON-root dry-run WARNS + continues so
# the preview still renders (it cannot exec anything as root).
assert_root_locked() {
  local target="$1" why="$2" p owner sp gw ow bad=false
  p="$(resolve "$target")"
  while : ; do
    owner="$(stat -f '%u' "$p" 2>/dev/null)" || break
    sp="$(stat -f '%Sp' "$p" 2>/dev/null)"
    gw="${sp:5:1}"; ow="${sp:8:1}"
    if [ "$owner" != "0" ]; then echo "  UNSAFE: $p is owned by uid $owner (not root) — ${why}" >&2; bad=true; fi
    if [ "$gw" = "w" ] || [ "$ow" = "w" ]; then echo "  UNSAFE: $p is group/world-writable ($sp) — ${why}" >&2; bad=true; fi
    [ "$p" = "/" ] && break
    p="$(dirname "$p")"
  done
  if "$bad"; then
    # fatal whenever we run as root: --apply (root-required) OR a `sudo` dry-run (root, no --apply). A root process
    # must not continue past the privesc gate. Only a NON-root dry-run may continue (the preview is the point).
    if "$APPLY" || [ "$RUNNING_UID" -eq 0 ]; then
      echo "REFUSE: $target is not root-locked; a non-root/writable ancestor lets the operator uid swap what the actor execs (privesc) — and running as root must not slip past this gate. Provide a root-owned target out-of-band." >&2
      exit 1
    fi
    note "WOULD-REFUSE under --apply / as root (non-root dry-run continues for preview): $target is not root-locked."
  fi
}

# ---- preflight -------------------------------------------------------------
say "preflight"
[ "$(uname -s)" = "Darwin" ] || { echo "macOS-only (the Linux path is docs/deployment/loom-actor.md)" >&2; exit 1; }
# Resolve the running uid ONCE, fail-closed. `command id -u` dodges a shell-function/alias shadow of `id`; the
# numeric-validation closes a fail-OPEN — a non-numeric / empty uid would make a later `[ "<uid>" -eq 0 ]` ERROR
# (rc 2, treated as false) and SILENTLY skip the root gate. An UNVERIFIABLE uid is fatal: we can neither confirm we
# are root (so the privesc refuse must fire) nor that we are not (so --apply must demand it). Both gates read this
# validated value, never a fresh `$(id -u)`.
RUNNING_UID="$(command id -u 2>/dev/null || true)"
case "$RUNNING_UID" in
  ''|*[!0-9]*) echo "REFUSE: cannot determine the running uid via 'id -u' (got '${RUNNING_UID}') — refusing, fail closed (an unverifiable uid could be root)." >&2; exit 1 ;;
esac
# a real uid is a uint32 (<= 10 digits); a longer all-digit string is NOT a uid and would overflow the gate
# arithmetic below (`[ -eq ]` is 64-bit) — re-opening the very fail-open the validation closes. Reject by LENGTH
# (string-measured, never arithmetic on the oversized value).
[ "${#RUNNING_UID}" -le 10 ] || { echo "REFUSE: running uid '${RUNNING_UID}' is implausibly long for a uid — refusing, fail closed." >&2; exit 1; }
if "$APPLY" && [ "$RUNNING_UID" -ne 0 ]; then echo "--apply requires root: 'sudo bash $0 ... --apply'" >&2; exit 1; fi
# M2 — never allowlist uid 0: demand sudo (SUDO_UID = the real operator) OR explicit --host-uid, AND reject a resolved 0.
if "$APPLY" && [ -z "${SUDO_UID:-}" ] && ! "$HOST_UID_EXPLICIT"; then
  echo "--apply must run via 'sudo' (so SUDO_UID is the real operator uid) or pass --host-uid <uid>" >&2; exit 1
fi
if "$APPLY" && [ "${HOST_UID}" = "0" ]; then
  echo "REFUSE: refusing to allowlist uid 0 (M2) — sudo as a NON-root operator, or pass --host-uid <non-zero>" >&2; exit 1
fi
# --claude-bin + --node are REQUIRED and must be root-locked (the helper NEVER copies a $HOME claude — hacker C1).
[ -n "${CLAUDE_BIN}" ] || { echo "REFUSE: --claude-bin <abs path to a ROOT-OWNED claude> is required (the helper does NOT copy a \$HOME claude — that is a deploy-time trojan surface; provide a root-owned claude out-of-band, e.g. a root-level install)" >&2; exit 2; }
[ -n "${NODE_BIN}" ] || { echo "REFUSE: --node <abs path to a ROOT-OWNED node> is required (e.g. the nodejs.org .pkg /usr/local/bin/node)" >&2; exit 2; }
assert_abs_safe "${CLAUDE_BIN}" "--claude-bin"
assert_abs_safe "${NODE_BIN}" "--node"
assert_abs_safe "${KEY_DIR}" "KEY_DIR"
assert_abs_safe "${WRAPPER}" "WRAPPER"
assert_username "${ACTOR_USER}" "--actor-user"
case "${ACTOR_UID}${HOST_UID}${BROKER_UID}" in *[!0-9]*) echo "REFUSE: uids must be numeric" >&2; exit 2 ;; esac
# distinct trust domain: the actor uid must not collide with root / the operator / the broker (a collision silently
# re-merges the domains the whole arc exists to separate).
if [ "${ACTOR_UID}" = "0" ]; then echo "REFUSE: --actor-uid must not be 0 (root)" >&2; exit 1; fi
if [ "${ACTOR_UID}" = "${HOST_UID}" ]; then echo "REFUSE: --actor-uid (${ACTOR_UID}) collides with the operator uid (${HOST_UID}) — the actor must be a DISTINCT uid" >&2; exit 1; fi
if [ "${ACTOR_UID}" = "${BROKER_UID}" ]; then echo "REFUSE: --actor-uid (${ACTOR_UID}) collides with the broker uid (${BROKER_UID}) — separate trust domains" >&2; exit 1; fi
[ -x "${CLAUDE_BIN}" ] || { echo "claude not executable at ${CLAUDE_BIN}" >&2; exit 1; }
[ -x "${NODE_BIN}" ] || { echo "node not executable at ${NODE_BIN} (install a ROOT-OWNED node and pass --node)" >&2; exit 1; }
# C1 — the wrapper execs these AS the actor uid; a 501-writable target/ancestor = code-exec as 611. Gate BOTH before use.
say "preflight: --claude-bin + --node must be root-locked (C1 — the exec chain runs as the actor uid)"
assert_root_locked "${CLAUDE_BIN}" "the wrapper execs this claude as ${ACTOR_USER}; a writable claude/ancestor = code-exec as the actor uid (privesc)"
assert_root_locked "${NODE_BIN}" "claude's node, on the wrapper PATH, runs as ${ACTOR_USER}; a writable node/ancestor = code-exec as the actor uid"
NODE_DIR="$(dirname "$(resolve "${NODE_BIN}")")"
assert_abs_safe "${NODE_DIR}" "node dir"
note "claude          : ${CLAUDE_BIN} -> $(resolve "${CLAUDE_BIN}")"
note "node            : ${NODE_BIN} -> $(resolve "${NODE_BIN}") (PATH dir ${NODE_DIR})"
note "actor user/uid  : ${ACTOR_USER} / ${ACTOR_UID}   (NOT on the broker allowlist — that is the point)"
note "host (operator) : uid ${HOST_UID}"
"$APPLY" || note "MODE            : DRY-RUN (nothing changed; re-run with sudo --apply)"

# ---- 1. create the actor system user (no login, no shell) — idempotent ----
say "1. create the ${ACTOR_USER} system user (uid ${ACTOR_UID})"
if id "${ACTOR_USER}" >/dev/null 2>&1; then
  # an existing user with a DIFFERENT uid is a silent trust-domain mismatch: we skip creation but the sudoers/custody
  # all assume ${ACTOR_UID} (CodeRabbit). Verify the uid matches; refuse otherwise.
  existing_uid="$(id -u "${ACTOR_USER}" 2>/dev/null || echo '?')"
  if [ "${existing_uid}" != "${ACTOR_UID}" ]; then
    echo "REFUSE: user ${ACTOR_USER} already exists with uid ${existing_uid}, not the requested ${ACTOR_UID} — fix the uid or pass --actor-uid ${existing_uid} (and re-check the distinct-uid refusal)" >&2
    exit 1
  fi
  note "user ${ACTOR_USER} already exists (uid ${existing_uid}) — skipping"
else
  run sysadminctl -addUser "${ACTOR_USER}" -UID "${ACTOR_UID}" -shell /usr/bin/false -home /var/empty
fi

# ---- 2. the API-key custody: operator SECRET via STDIN, 0600 owned by the actor ----
say "2. API-key custody ${KEY_FILE} (0600 ${ACTOR_USER}; value via STDIN, never argv/log)"
# refuse a pre-planted symlink at the key dir (install -d would LEAVE it; do not rely on /etc being root-owned — VALIDATE-hacker M-1).
if [ -L "${KEY_DIR}" ]; then echo "REFUSE: ${KEY_DIR} is a symlink — refusing to write the API key through it" >&2; exit 1; fi
run install -d -o root -g wheel -m 0755 "${KEY_DIR}"      # root-owned, traversable key DIR (custody-verify can lstat the owner)
# the dest PARENT must be root-locked BEFORE the tee — else the operator uid plants a symlink for a tee-follow TOCTOU.
assert_root_locked "${KEY_DIR}" "the actor key dir; a writable ancestor lets the operator uid swap the API key"
if [ -L "${KEY_FILE}" ]; then
  echo "REFUSE: ${KEY_FILE} is a symlink — refusing (a symlinked key path is a redirect attack); delete it" >&2; exit 1
elif [ -f "${KEY_FILE}" ]; then
  # exists — validate BOTH ownership AND mode 0600 (a stale 0644 key is world-readable; a root-owned one is
  # unreadable by the actor — VALIDATE-hacker M-2 + CodeRabbit). Fail closed on either.
  kowner="$(stat -f '%Su' "${KEY_FILE}" 2>/dev/null || echo '?')"
  kmode="$(stat -f '%Sp' "${KEY_FILE}" 2>/dev/null || echo '?')"
  if [ "${kowner}" != "${ACTOR_USER}" ]; then
    echo "REFUSE: ${KEY_FILE} exists but is owned by '${kowner}' (expected ${ACTOR_USER}) — the actor cannot read a mis-owned key; delete it and re-run to rotate" >&2; exit 1
  elif [ "${kmode}" != "-rw-------" ]; then
    echo "REFUSE: ${KEY_FILE} exists with unsafe mode '${kmode}' (expected -rw------- / 0600) — fix it (chmod 0600) or delete and re-run" >&2; exit 1
  else
    note "${KEY_FILE} already exists (owner ${kowner}, 0600) — NOT overwriting (delete it first to rotate)"
  fi
elif "$APPLY"; then
  # umask 077 so the tee CREATES 0600 (default umask 022 would leave a world-readable window); the value rides the
  # builtin printf's STDIN to tee (never an external argv); the subshell scopes the umask + the secret var.
  ( umask 077
    printf 'Paste the ANTHROPIC_API_KEY for %s (input hidden, then Enter): ' "${ACTOR_USER}" >&2
    IFS= read -rs ACTOR_KEY; printf '\n' >&2
    [ -n "${ACTOR_KEY}" ] || { echo "REFUSE: empty API key" >&2; exit 1; }
    printf '%s' "${ACTOR_KEY}" | tee "${KEY_FILE}" >/dev/null
    chown "${ACTOR_USER}:wheel" "${KEY_FILE}"
    chmod 0600 "${KEY_FILE}" )
  note "wrote ${KEY_FILE} (0600 ${ACTOR_USER})"
else
  note "[dry-run] would prompt for the ANTHROPIC_API_KEY on STDIN (hidden), umask 077, builtin printf | tee -> ${KEY_FILE}, chown ${ACTOR_USER}, chmod 0600 — NOT reading it now"
fi

# ---- 3. the wrapper: root-owned, NOT host-writable; a FAIL-CLOSED case dispatch over $1 (actor model + judge modes) ----
say "3. install the actor wrapper ${WRAPPER} (root-owned 0755)"
# a writable wrapper PARENT lets the operator unlink+recreate it -> code-exec as the actor uid. Lock it first.
assert_root_locked "$(dirname "${WRAPPER}")" "the actor execs this wrapper; a writable wrapper dir lets the operator swap it -> code-exec as the actor uid"
# #430 PR-2 — the dispatch is an EXPLICIT-ALLOWLIST case (NOT a -*)-denylist-then-*)-actor): an empty / whitespace /
# leading-dash / unknown \$1 fails CLOSED (exit 2), never the tool-bearing actor recipe (VERIFY hacker CRITICAL C1,
# reproduced firsthand). The model arm allowlist MUST stay in sync with ALLOWED_ACTOR_MODELS
# (packages/kernel/egress/loom-actor-launch.js) — a drift fails CLOSED (an unknown model hits *)), and the launcher
# validates the model before it reaches here (defense-in-depth). The --loom-judge model + budget cap are LITERALS
# (pulled DOWN into the wrapper) so no attacker-influenced positional rides the cross-uid argv.
WRAPPER_BODY="#!/bin/sh
# loom-actor-run — runs claude -p as ${ACTOR_USER}. \$1 selects the mode (the prompt rides STDIN):
#   --loom-actor-version-probe  -> claude --version           (custody-verify C3; free, no API call)
#   --loom-judge-version-probe  -> tool-less judge + stream-json (custody-verify C5; reads init tools[])
#   --loom-judge                -> the TOOL-LESS, PLAIN-output judge recipe (#430 PR-2)
#   an allowlisted MODEL        -> the actor recipe (no-Bash toolset)
#   anything else (empty / leading-dash / unknown) -> FAIL CLOSED (exit 2)
# Installed root-owned by loom-actor-deploy-macos.sh. The judge model (claude-sonnet-4-6) duplicates JUDGE_MODEL in the
# JS chokepoints — the cross-ref is the SOLE model-drift guard (custody-verify C5 checks tools[], NOT the model).
PATH=${NODE_DIR}:/usr/bin:/bin
case \"\$1\" in
  --loom-actor-version-probe) exec ${CLAUDE_BIN} --version ;;
  --loom-judge-version-probe) export ANTHROPIC_API_KEY=\"\$(cat ${KEY_FILE})\"; exec ${CLAUDE_BIN} -p --tools \"\" --strict-mcp-config --disallowedTools LSP --model claude-sonnet-4-6 --output-format stream-json --verbose ;;
  --loom-judge) export ANTHROPIC_API_KEY=\"\$(cat ${KEY_FILE})\"; exec ${CLAUDE_BIN} -p --tools \"\" --strict-mcp-config --disallowedTools LSP --model claude-sonnet-4-6 --max-budget-usd 0.50 ;;
  claude-sonnet-4-6|claude-opus-4-8|claude-haiku-4-5) export ANTHROPIC_API_KEY=\"\$(cat ${KEY_FILE})\"; exec ${CLAUDE_BIN} -p --output-format stream-json --verbose --model \"\$1\" --allowedTools Read,Grep,Glob,Edit,Write ;;
  *) echo \"loom-actor-run: unrecognized mode '\$1' -- refusing (fail-closed)\" >&2; exit 2 ;;
esac
"
if "$APPLY"; then
  printf '%s' "${WRAPPER_BODY}" > "${WRAPPER}"
  chown root:wheel "${WRAPPER}"; chmod 0755 "${WRAPPER}"
  note "installed ${WRAPPER} (root:wheel 0755)"
else
  note "[dry-run] write ${WRAPPER} (root:wheel 0755) with this body:"
  printf '%s\n' "${WRAPPER_BODY}" | sed 's/^/      | /'
fi

# ---- 4. sudoers — PRINT ONLY (never auto-edit) ----
say "4. sudoers — APPLY THIS BY HAND (the helper never edits sudoers)"
HOSTUSER="$(id -un "${HOST_UID}" 2>/dev/null || echo "<your-username>")"
cat <<SUDOERS
  Run:  sudo visudo -f /etc/sudoers.d/loom-actor
  Add EXACTLY these lines:

      ${HOSTUSER} ALL=(${ACTOR_USER}) NOPASSWD: ${WRAPPER}
      Defaults:${HOSTUSER} env_reset, !setenv
      Defaults!${WRAPPER} env_reset, !setenv

  env_reset is LOAD-BEARING here: it STRIPS your ANTHROPIC_API_KEY so the actor uses its OWN from custody.
  Then AUDIT (a SUDO_* var in env_keep would let the actor forge SUDO_UID). Match the token PRECISELY
  (case-sensitive SUDO_<NAME>) — a loose 'env_keep.*SUDO_' false-fails on stock macOS via /etc/sudo_lecture:
      sudo -l -U ${HOSTUSER} | grep -oE 'SUDO_[A-Za-z0-9_]+' && echo 'FAIL: SUDO_* in env_keep' || echo 'OK: no SUDO_* preserved'
SUDOERS

# ---- 5. verify + the out-of-band attestation (the step only you can do) ----
say "5. verify (as your host uid), then attest out-of-band"
cat <<VERIFY
  node <repo>/packages/kernel/egress/loom-actor-custody-verify.js \\
    --key ${KEY_FILE} --actor-user ${ACTOR_USER} --wrapper ${WRAPPER} \\
    --claude-bin ${CLAUDE_BIN} --node-bin ${NODE_BIN}

  Expect C0-C4 + hostObservableChecksPassed:true + requiresOutOfBandUidConfirmation:true (EXITS NON-ZERO until you
  attest). Then close the last step the tool cannot observe:
      id                                 # YOUR uid (${HOST_UID})
      ls -l ${KEY_FILE}                  # OWNER must be ${ACTOR_USER}, NOT you
      cat ${KEY_FILE}                    # MUST print: Permission denied
  Only if the owner differs AND the read is denied:
      node .../loom-actor-custody-verify.js ... --attested-cross-uid
VERIFY

say "done"
note "$("$APPLY" && echo 'APPLIED steps 1-3. Now apply sudoers (4) + verify/attest (5).' || echo 'DRY-RUN complete — nothing changed.')"
note "RESIDUAL: the actor does not RUN as ${ACTOR_USER} until the routing seam (PR 3) wires runActorTrajectory through"
note "the cross-uid launcher. This deploy is the VEHICLE's operator half; the seam + your dogfood close #412."
