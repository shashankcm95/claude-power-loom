#!/usr/bin/env bash
# loom-edge-deploy-macos.sh — operator helper for the cross-uid loom-edge-signer deploy on macOS.
#
# Companion to docs/deployment/loom-edge.md (which is Linux-shaped). Symmetric twin of
# scripts/loom-broker-deploy-macos.sh, one custody domain over: it stands up the loom-edge-signer system uid (612)
# so the WORLD-ANCHOR EDGE signer (packages/kernel/egress/loom-edge-sign.js) runs under a genuinely separate uid and
# the host/actor cannot read its private edge-signing key or ptrace it. It handles the macOS realities a
# home-dir-locked dev box forces: the edge uid cannot read the repo or an nvm node, so the kernel code is STAGED to
# /opt/loom (root-owned, world-READABLE, never world-WRITABLE) and the wrapper execs a ROOT-OWNED node.
#
# SHADOW (PR-A2b W3): the world-anchor store passes signer:undefined in production (LIVE_SOURCES = Object.freeze([])),
# so NO live mint signs an edge yet — this provisions the VEHICLE. The cross-uid deployment is what makes a signed
# edge mean "the actor did not co-forge it" (the #273 integrity-vs-provenance NARROW->CLOSE for the edge weight);
# wiring the signer into a live mint + the recall consumer is PR-B (the Rubicon). The deploy is still useful now: you
# provision + verify custody + dogfood the C3 live-sign here, BEFORE PR-B flips the consumer.
#
# SECURITY (hacker-reviewed; ported verbatim from the broker helper): the edge signer's real attack surface is
# everything its sudo-invoked process EXECS — the node interpreter AND the staged code. If any of those, or any
# PARENT dir up to /, is writable by the host/actor uid, the actor unlink+recreates it and runs code AS the
# edge-signer (privesc that defeats key custody). So this helper REFUSES (under --apply) a node or stage path whose
# ancestor chain is not root-owned + non-group/world-writable. A Homebrew node (/opt/homebrew, owner-writable) is
# REFUSED — install a ROOT-OWNED node (the official nodejs.org .pkg installs /usr/local/bin/node root:wheel) and
# pass --node /usr/local/bin/node.
#
# SAFETY: dry-run BY DEFAULT (prints every step, touches nothing). --apply executes (requires sudo so SUDO_UID is
# the real operator). NEVER edits sudoers (a syntax error locks you out) — PRINTS the block for visudo. Idempotent
# (skips an existing user/key). Fails loud (set -euo pipefail). The keygen temp is trap-shredded on any exit.
#
# Usage:
#   bash scripts/loom-edge-deploy-macos.sh                                  # dry-run preview
#   sudo bash scripts/loom-edge-deploy-macos.sh --node /usr/local/bin/node --apply
# Options: --node <abs-path> (REQUIRED to be root-owned) · --stage-dir <abs-path> (default /opt/loom)
#          --edge-uid <n> (default 612) · --host-uid <n> (default $SUDO_UID) · --repo <abs-path>

set -euo pipefail

APPLY=false
NODE_BIN=/opt/homebrew/bin/node
STAGE_DIR=/opt/loom
EDGE_USER=loom-edge-signer
EDGE_UID=612
HOST_UID="${SUDO_UID:-$(id -u)}"
HOST_UID_EXPLICIT=false
KEY_DIR=/etc/loom
WRAPPER=/usr/local/bin/loom-edge-sign
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true ;;
    --node) NODE_BIN="$2"; shift ;;
    --stage-dir) STAGE_DIR="$2"; shift ;;
    --edge-uid) EDGE_UID="$2"; shift ;;
    --host-uid) HOST_UID="$2"; HOST_UID_EXPLICIT=true; shift ;;
    --repo) REPO="$2"; shift ;;
    -h|--help) grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '\n=== %s ===\n' "$1"; }
note() { printf '  %s\n' "$1"; }
run()  { if "$APPLY"; then "$@"; else printf '  [dry-run] %s\n' "$*"; fi; }
resolve() {
  local r d b
  r="$(readlink -f "$1" 2>/dev/null)" && [ -n "$r" ] && { printf '%s\n' "$r"; return 0; }
  r="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null)" && [ -n "$r" ] && { printf '%s\n' "$r"; return 0; }
  d="$(dirname "$1")"; b="$(basename "$1")"
  if d="$(cd "$d" 2>/dev/null && pwd -P)"; then printf '%s/%s\n' "$d" "$b"; else printf '%s\n' "$1"; fi
}

# reject a path that is not absolute, contains '..', or carries shell-metachars/whitespace (M1 — these are
# interpolated into the generated /bin/sh wrapper + into argv). Mirrors loom-edge-launch.js's discipline.
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

# refuse if $1 (symlinks resolved) or ANY ancestor up to / is non-root-owned OR group/world-writable — the C1/C2
# privesc gate. HARD refuse whenever we run as ROOT (under --apply OR a `sudo` dry-run): the very next step may exec
# this path AS ROOT (e.g. the NODE_BIN --version probe), so a non-root-locked target is root code-exec. Only a
# NON-root dry-run WARNS + continues (it cannot exec anything as root; the preview is the point).
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
    # is about to exec this path; a non-root-locked target = root code-exec. Only a NON-root dry-run may continue.
    if "$APPLY" || [ "$RUNNING_UID" -eq 0 ]; then
      echo "REFUSE: $target is not root-locked; a non-root/writable ancestor lets the actor swap what the edge-signer execs (privesc) — and running as root would exec it AS ROOT. Use a root-owned node (e.g. the nodejs.org .pkg -> /usr/local/bin/node) / a root-owned stage path." >&2
      exit 1
    fi
    note "WOULD-REFUSE under --apply / as root (non-root dry-run continues for preview): $target is not root-locked."
  fi
}

# ---- preflight -------------------------------------------------------------
say "preflight"
[ "$(uname -s)" = "Darwin" ] || { echo "macOS-only (Linux: docs/deployment/loom-edge.md)" >&2; exit 1; }
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
# (sudo-invoked-while-root gives SUDO_UID=0; `--host-uid 0` is explicit — BOTH must be refused.)
if "$APPLY" && [ -z "${SUDO_UID:-}" ] && ! "$HOST_UID_EXPLICIT"; then
  echo "--apply must run via 'sudo' (so SUDO_UID is the real operator uid) or pass --host-uid <uid>" >&2; exit 1
fi
if "$APPLY" && [ "${HOST_UID}" = "0" ]; then
  echo "REFUSE: refusing to allowlist uid 0 on the edge signer (M2) — sudo as a NON-root operator, or pass --host-uid <non-zero>" >&2; exit 1
fi
assert_abs_safe "$NODE_BIN" "--node"
assert_abs_safe "$STAGE_DIR" "--stage-dir"
assert_abs_safe "$REPO" "--repo"
case "$EDGE_UID$HOST_UID" in *[!0-9]*) echo "REFUSE: uids must be numeric" >&2; exit 2 ;; esac
[ -x "$NODE_BIN" ] || { echo "node not executable at $NODE_BIN (install a ROOT-OWNED node and pass --node)" >&2; exit 1; }
[ -d "${REPO}/packages/kernel/egress" ] || { echo "repo packages/kernel not found at ${REPO}" >&2; exit 1; }
# C1 — the node root-lock gate MUST run BEFORE node is ever EXECUTED: the `--version` probe below executes node, and
# under --apply the preflight runs as ROOT — a non-root-locked node would be root code-exec BEFORE the gate fired.
# So the gate precedes the first execution.
say "preflight: node interpreter must be root-locked (C1)"
assert_root_locked "$NODE_BIN" "the edge signer execs this node as loom-edge-signer; a writable node = code-exec as the edge signer (root, here)"
note "node            : ${NODE_BIN} -> $(resolve "$NODE_BIN") ($("${NODE_BIN}" --version 2>/dev/null || echo '?'))"
note "repo            : ${REPO}"
note "stage dir       : ${STAGE_DIR}/packages/kernel  (root-owned, world-readable, never world-writable)"
note "edge user/uid   : ${EDGE_USER} / ${EDGE_UID}"
note "host (operator) : uid ${HOST_UID}  (the ONLY uid on the edge-signer allowlist)"
"$APPLY" || note "MODE            : DRY-RUN (nothing changed; re-run with sudo --apply)"

# ---- 1. stage the kernel code (root-owned, world-readable, NEVER world-writable) ----
say "1. stage kernel code -> ${STAGE_DIR}/packages/kernel"
run mkdir -p "${STAGE_DIR}/packages"
run rm -rf "${STAGE_DIR}/packages/kernel"
run cp -R "${REPO}/packages/kernel" "${STAGE_DIR}/packages/kernel"
run chown -R root:wheel "${STAGE_DIR}"
run find "${STAGE_DIR}" -type d -exec chmod 755 {} +
run find "${STAGE_DIR}" -type f -exec chmod 644 {} +
# C2 — after locking, PROVE the staged entrypoint's ancestor chain is root-locked (catches a writable --stage-dir root).
say "1b. verify the staged entrypoint is root-locked (C2)"
if "$APPLY"; then
  assert_root_locked "${STAGE_DIR}/packages/kernel/egress/loom-edge-sign.js" "the edge signer execs this staged script; a writable ancestor = code-exec as the edge signer"
else
  note "[dry-run] would verify ${STAGE_DIR}/packages/kernel/egress/loom-edge-sign.js ancestors are root-locked"
fi

# ---- 2. create the edge-signer system user (no login, no shell) — idempotent ----
say "2. create the ${EDGE_USER} system user (uid ${EDGE_UID})"
if id "${EDGE_USER}" >/dev/null 2>&1; then
  # an existing user with a DIFFERENT uid is a silent trust-domain mismatch: we skip creation but the sudoers/custody
  # all assume ${EDGE_UID}. Verify the uid matches; refuse otherwise.
  existing_uid="$(id -u "${EDGE_USER}" 2>/dev/null || echo '?')"
  if [ "${existing_uid}" != "${EDGE_UID}" ]; then
    echo "REFUSE: user ${EDGE_USER} already exists with uid ${existing_uid}, not the requested ${EDGE_UID} — fix the uid or pass --edge-uid ${existing_uid}" >&2
    exit 1
  fi
  note "user ${EDGE_USER} already exists (uid ${existing_uid}) — skipping"
else
  run sysadminctl -addUser "${EDGE_USER}" -UID "${EDGE_UID}" -shell /usr/bin/false -home /var/empty
fi

# ---- 3. keypair: private 0600 owned by the edge signer; public pinned host-readable — idempotent + trap-shredded ----
say "3. keypair (private 0600 ${EDGE_USER}; public 0644 host-readable)"
run install -d -o root -g wheel -m 0755 "${KEY_DIR}"      # L1 — key DIR root-owned (edge signer can't swap edge-verify.pem); key file stays edge-owned 0600
if [ -L "${KEY_DIR}/edge.key" ]; then
  echo "REFUSE: ${KEY_DIR}/edge.key is a symlink — refusing (a symlinked key path is a redirect attack); delete it" >&2; exit 1
elif [ -f "${KEY_DIR}/edge.key" ]; then
  # exists — validate BOTH ownership AND mode 0600 before trusting it. edge.key is the PRIVATE signing key: a stale
  # group/world-readable (e.g. 0644) key lets any uid — incl. the actor — read it and mint edges directly (full
  # custody bypass); a mis-owned one is unusable by the edge signer. Fail closed on either.
  kowner="$(stat -f '%Su' "${KEY_DIR}/edge.key" 2>/dev/null || echo '?')"
  kmode="$(stat -f '%Sp' "${KEY_DIR}/edge.key" 2>/dev/null || echo '?')"
  if [ "${kowner}" != "${EDGE_USER}" ]; then
    echo "REFUSE: ${KEY_DIR}/edge.key exists but is owned by '${kowner}' (expected ${EDGE_USER}) — delete it and re-run to rotate" >&2; exit 1
  elif [ "${kmode}" != "-rw-------" ]; then
    echo "REFUSE: ${KEY_DIR}/edge.key exists with unsafe mode '${kmode}' (expected -rw------- / 0600) — a group/world-readable signing key defeats cross-uid custody; fix (chmod 0600) or delete and re-run" >&2; exit 1
  elif [ ! -f "${KEY_DIR}/edge-verify.pem" ]; then
    # the keypair must stay CONSISTENT: step 6's verify (--verify-key) reads the PUBLIC half. A present private key
    # with a missing public half is a half-present keypair — fail closed here rather than skip-regenerate and let
    # step 6 fail confusingly. (A present-but-STALE edge-verify.pem from a different pair is caught downstream: the
    # step 6 C3 sig-verify FAILs against the wrong public key.)
    echo "REFUSE: ${KEY_DIR}/edge.key exists but its public ${KEY_DIR}/edge-verify.pem is MISSING — step 6's --verify-key needs it. Restore edge-verify.pem, or delete edge.key and re-run to regenerate the PAIR." >&2; exit 1
  else
    note "${KEY_DIR}/edge.key already exists (owner ${kowner}, 0600) + edge-verify.pem present — NOT regenerating (delete BOTH to rotate)"
  fi
elif "$APPLY"; then
  TMPK="$(mktemp -d /tmp/loom-keygen.XXXXXX)"
  trap 'rm -rf "${TMPK}" 2>/dev/null || true' EXIT        # H1 — shred the priv-key temp on ANY exit (incl. set -e abort)
  "${NODE_BIN}" -e '
    const fs = require("fs");
    const { generateEdgeKeypair } = require(process.argv[1] + "/packages/kernel/_lib/edge-attestation");
    const kp = generateEdgeKeypair();
    fs.writeFileSync(process.argv[2] + "/k.priv", kp.privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(process.argv[2] + "/k.pub",  kp.publicKeyPem,  { mode: 0o600 });
  ' "${STAGE_DIR}" "${TMPK}"
  install -o "${EDGE_USER}" -g wheel -m 0600 "${TMPK}/k.priv" "${KEY_DIR}/edge.key"
  install -o root -g wheel -m 0644 "${TMPK}/k.pub" "${KEY_DIR}/edge-verify.pem"
  rm -rf "${TMPK}"; trap - EXIT
  note "wrote ${KEY_DIR}/edge.key (0600 ${EDGE_USER}) + ${KEY_DIR}/edge-verify.pem (0644 root)"
else
  note "[dry-run] generate ed25519 keypair (temp 0700, trap-shredded); install priv 0600 ${EDGE_USER} -> ${KEY_DIR}/edge.key; pub 0644 root -> ${KEY_DIR}/edge-verify.pem"
fi

# ---- 4. the wrapper: root-owned, NOT host-writable (a host-writable wrapper is a privesc hole) ----
say "4. install the edge wrapper ${WRAPPER} (root-owned 0755)"
# the wrapper FILE is locked below, but a writable PARENT dir lets the actor unlink+recreate it (same class as
# C1/C2). Verify the wrapper's dir + ancestors are root-locked BEFORE writing into it.
assert_root_locked "$(dirname "${WRAPPER}")" "the edge signer execs this wrapper; a writable wrapper dir lets the actor swap it -> code-exec as the edge signer"
WRAPPER_BODY="#!/bin/sh
export LOOM_EDGE_KEY_FILE=${KEY_DIR}/edge.key
export LOOM_EDGE_ALLOWED_UIDS=${HOST_UID}
exec ${NODE_BIN} ${STAGE_DIR}/packages/kernel/egress/loom-edge-sign.js \"\$@\"
"
if "$APPLY"; then
  printf '%s' "${WRAPPER_BODY}" > "${WRAPPER}"
  chown root:wheel "${WRAPPER}"; chmod 0755 "${WRAPPER}"
  note "installed ${WRAPPER} (root:wheel 0755)"
else
  note "[dry-run] write ${WRAPPER} (root:wheel 0755) with this body:"
  printf '%s\n' "${WRAPPER_BODY}" | sed 's/^/      | /'
fi

# ---- 5. sudoers — PRINT ONLY (never auto-edit: a syntax error locks you out of sudo) ----
say "5. sudoers — APPLY THIS BY HAND (the helper never edits sudoers)"
HOSTUSER="$(id -un "${HOST_UID}" 2>/dev/null || echo "<your-username>")"
cat <<SUDOERS
  Run:  sudo visudo -f /etc/sudoers.d/loom-edge
  Add EXACTLY these lines:

      ${HOSTUSER} ALL=(${EDGE_USER}) NOPASSWD: ${WRAPPER}
      Defaults:${HOSTUSER} env_reset, !setenv
      Defaults!${WRAPPER} env_reset, !setenv

  Then AUDIT (a SUDO_* var in env_keep VOIDS caller-auth). Match the env-var token PRECISELY (case-sensitive
  SUDO_<NAME>) — a loose 'env_keep.*SUDO_' false-fails on stock macOS via the /etc/sudo_lecture config path:
      sudo -l -U ${HOSTUSER} | grep -oE 'SUDO_[A-Za-z0-9_]+' && echo 'FAIL: SUDO_* in env_keep' || echo 'OK: no SUDO_* preserved'
SUDOERS

# ---- 6. verify + the out-of-band attestation (the step only you can do) ----
say "6. verify (as your host uid), then attest out-of-band"
cat <<VERIFY
  node ${STAGE_DIR}/packages/kernel/egress/loom-edge-custody-verify.js \\
    --key ${KEY_DIR}/edge.key --verify-key ${KEY_DIR}/edge-verify.pem \\
    --edge-user ${EDGE_USER} --wrapper ${WRAPPER}

  Expect hostObservableChecksPassed:true + requiresOutOfBandUidConfirmation:true (EXITS NON-ZERO until you attest).
  C3 (edge sign-liveness) goes through sudo + the recompute-bind — a C3 "no signature" under otherwise-correct
  wiring most likely means the operator uid is not on LOOM_EDGE_ALLOWED_UIDS (step 4), NOT a key failure.
  Then close the last step the tool cannot observe:
      id                                 # YOUR uid (${HOST_UID})
      ls -l ${KEY_DIR}/edge.key          # OWNER must be ${EDGE_USER}, NOT you
      cat ${KEY_DIR}/edge.key            # MUST print: Permission denied
  Only if the owner differs AND the read is denied:
      node ${STAGE_DIR}/packages/kernel/egress/loom-edge-custody-verify.js ... --attested-cross-uid
VERIFY

say "done"
note "$("$APPLY" && echo 'APPLIED steps 1-4. Now apply sudoers (5) + verify/attest (6).' || echo 'DRY-RUN complete — nothing changed.')"
note "RESIDUAL: KEY non-exfiltration of the edge-signing key only — the cross-uid IS the #273 integrity-vs-provenance"
note "close for the edge weight (un-deployed/same-uid, a host process co-forges a byte-valid signed edge). SHADOW:"
note "no live mint signs an edge until PR-B (LIVE_SOURCES is empty). A rogue actor at uid ${HOST_UID} is on the"
note "allowlist + can still REQUEST a signature — actor-vs-provenance needs the actor on a SEPARATE uid (loom-actor/611)."
