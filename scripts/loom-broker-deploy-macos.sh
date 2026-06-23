#!/usr/bin/env bash
# loom-broker-deploy-macos.sh — operator helper for the cross-uid loom-broker deploy on macOS.
#
# Companion to docs/deployment/loom-broker.md (which is Linux-shaped). This handles the macOS realities a
# home-dir-locked dev box forces: the broker uid cannot read the repo or an nvm node, so the broker code is
# STAGED to /opt/loom (root-owned, world-READABLE, never world-WRITABLE) and the wrapper execs a ROOT-OWNED node.
# It ships KEY NON-EXFILTRATION only — NOT approval-provenance-vs-a-rogue-actor (that needs the actor to run as a
# SEPARATE non-allowlisted uid; tracked separately). See the runbook's Residuals.
#
# SECURITY (hacker-reviewed): the broker's real attack surface is everything its sudo-invoked process EXECS — the
# node interpreter AND the staged code. If any of those, or any PARENT dir up to /, is writable by the host/actor
# uid, the actor unlink+recreates it and runs code AS the broker (privesc that defeats key custody). So this helper
# REFUSES (under --apply) a node or stage path whose ancestor chain is not root-owned + non-group/world-writable.
# A Homebrew node (/opt/homebrew, owner-writable) is REFUSED — install a ROOT-OWNED node (the official nodejs.org
# .pkg installs /usr/local/bin/node root:wheel) and pass --node /usr/local/bin/node.
#
# SAFETY: dry-run BY DEFAULT (prints every step, touches nothing). --apply executes (requires sudo so SUDO_UID is
# the real operator). NEVER edits sudoers (a syntax error locks you out) — PRINTS the block for visudo. Idempotent
# (skips an existing user/key). Fails loud (set -euo pipefail). The keygen temp is trap-shredded on any exit.
#
# Usage:
#   bash scripts/loom-broker-deploy-macos.sh                                  # dry-run preview
#   sudo bash scripts/loom-broker-deploy-macos.sh --node /usr/local/bin/node --apply
# Options: --node <abs-path> (REQUIRED to be root-owned) · --stage-dir <abs-path> (default /opt/loom)
#          --broker-uid <n> (default 610) · --host-uid <n> (default $SUDO_UID) · --repo <abs-path>

set -euo pipefail

APPLY=false
NODE_BIN=/opt/homebrew/bin/node
STAGE_DIR=/opt/loom
BROKER_USER=loom-broker
BROKER_UID=610
HOST_UID="${SUDO_UID:-$(id -u)}"
HOST_UID_EXPLICIT=false
KEY_DIR=/etc/loom
WRAPPER=/usr/local/bin/loom-broker-sign
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true ;;
    --node) NODE_BIN="$2"; shift ;;
    --stage-dir) STAGE_DIR="$2"; shift ;;
    --broker-uid) BROKER_UID="$2"; shift ;;
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
resolve() { readlink -f "$1" 2>/dev/null || echo "$1"; }

# reject a path that is not absolute, contains '..', or carries shell-metachars/whitespace (M1 — these are
# interpolated into the generated /bin/sh wrapper + into argv). Mirrors loom-broker-launch.js's discipline.
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
# privesc gate. Under --apply this is a HARD refuse; in dry-run it WARNS + continues so the preview still renders.
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
    if "$APPLY"; then
      echo "REFUSE (--apply): $target is not root-locked; a non-root/writable ancestor lets the actor swap what the broker execs (privesc). Use a root-owned node (e.g. the nodejs.org .pkg -> /usr/local/bin/node) / a root-owned stage path." >&2
      exit 1
    fi
    note "WOULD-REFUSE under --apply (dry-run continues for preview): $target is not root-locked."
  fi
}

# ---- preflight -------------------------------------------------------------
say "preflight"
[ "$(uname -s)" = "Darwin" ] || { echo "macOS-only (Linux: docs/deployment/loom-broker.md)" >&2; exit 1; }
if "$APPLY" && [ "$(id -u)" -ne 0 ]; then echo "--apply requires root: 'sudo bash $0 ... --apply'" >&2; exit 1; fi
# M2 — never allowlist uid 0: demand sudo (SUDO_UID = the real operator) OR explicit --host-uid, AND reject a resolved 0.
# (sudo-invoked-while-root gives SUDO_UID=0; `--host-uid 0` is explicit — BOTH must be refused; CodeRabbit Major.)
if "$APPLY" && [ -z "${SUDO_UID:-}" ] && ! "$HOST_UID_EXPLICIT"; then
  echo "--apply must run via 'sudo' (so SUDO_UID is the real operator uid) or pass --host-uid <uid>" >&2; exit 1
fi
if "$APPLY" && [ "${HOST_UID}" = "0" ]; then
  echo "REFUSE: refusing to allowlist uid 0 on the broker (M2) — sudo as a NON-root operator, or pass --host-uid <non-zero>" >&2; exit 1
fi
assert_abs_safe "$NODE_BIN" "--node"
assert_abs_safe "$STAGE_DIR" "--stage-dir"
assert_abs_safe "$REPO" "--repo"
case "$BROKER_UID$HOST_UID" in *[!0-9]*) echo "REFUSE: uids must be numeric" >&2; exit 2 ;; esac
[ -x "$NODE_BIN" ] || { echo "node not executable at $NODE_BIN (install a ROOT-OWNED node and pass --node)" >&2; exit 1; }
[ -d "${REPO}/packages/kernel/egress" ] || { echo "repo packages/kernel not found at ${REPO}" >&2; exit 1; }
# C1 — the node root-lock gate MUST run BEFORE node is ever EXECUTED (CodeRabbit CRITICAL: the `--version` probe
# below executes node, and under --apply the preflight runs as ROOT — a non-root-locked node would be root
# code-exec BEFORE the gate fired). So the gate precedes the first execution.
say "preflight: node interpreter must be root-locked (C1)"
assert_root_locked "$NODE_BIN" "the broker execs this node as loom-broker; a writable node = code-exec as the broker (root, here)"
note "node            : ${NODE_BIN} -> $(resolve "$NODE_BIN") ($("${NODE_BIN}" --version 2>/dev/null || echo '?'))"
note "repo            : ${REPO}"
note "stage dir       : ${STAGE_DIR}/packages/kernel  (root-owned, world-readable, never world-writable)"
note "broker user/uid : ${BROKER_USER} / ${BROKER_UID}"
note "host (operator) : uid ${HOST_UID}  (the ONLY uid on the broker allowlist)"
"$APPLY" || note "MODE            : DRY-RUN (nothing changed; re-run with sudo --apply)"

# ---- 1. stage the broker code (root-owned, world-readable, NEVER world-writable) ----
say "1. stage broker code -> ${STAGE_DIR}/packages/kernel"
run mkdir -p "${STAGE_DIR}/packages"
run rm -rf "${STAGE_DIR}/packages/kernel"
run cp -R "${REPO}/packages/kernel" "${STAGE_DIR}/packages/kernel"
run chown -R root:wheel "${STAGE_DIR}"
run find "${STAGE_DIR}" -type d -exec chmod 755 {} +
run find "${STAGE_DIR}" -type f -exec chmod 644 {} +
# C2 — after locking, PROVE the staged entrypoint's ancestor chain is root-locked (catches a writable --stage-dir root).
say "1b. verify the staged entrypoint is root-locked (C2)"
if "$APPLY"; then
  assert_root_locked "${STAGE_DIR}/packages/kernel/egress/loom-broker-sign.js" "the broker execs this staged script; a writable ancestor = code-exec as the broker"
else
  note "[dry-run] would verify ${STAGE_DIR}/packages/kernel/egress/loom-broker-sign.js ancestors are root-locked"
fi

# ---- 2. create the broker system user (no login, no shell) — idempotent ----
say "2. create the ${BROKER_USER} system user (uid ${BROKER_UID})"
if id "${BROKER_USER}" >/dev/null 2>&1; then
  note "user ${BROKER_USER} already exists — skipping"
else
  run sysadminctl -addUser "${BROKER_USER}" -UID "${BROKER_UID}" -shell /usr/bin/false -home /var/empty
fi

# ---- 3. keypair: private 0600 owned by the broker; public pinned host-readable — idempotent + trap-shredded ----
say "3. keypair (private 0600 ${BROKER_USER}; public 0644 host-readable)"
run install -d -o root -g wheel -m 0755 "${KEY_DIR}"      # L1 — key DIR root-owned (broker can't swap verify.pem); key file stays broker-owned 0600
if [ -f "${KEY_DIR}/broker.key" ]; then
  note "${KEY_DIR}/broker.key already exists — NOT regenerating (delete it first to rotate)"
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
  install -o "${BROKER_USER}" -g wheel -m 0600 "${TMPK}/k.priv" "${KEY_DIR}/broker.key"
  install -o root -g wheel -m 0644 "${TMPK}/k.pub" "${KEY_DIR}/verify.pem"
  rm -rf "${TMPK}"; trap - EXIT
  note "wrote ${KEY_DIR}/broker.key (0600 ${BROKER_USER}) + ${KEY_DIR}/verify.pem (0644 root)"
else
  note "[dry-run] generate ed25519 keypair (temp 0700, trap-shredded); install priv 0600 ${BROKER_USER} -> ${KEY_DIR}/broker.key; pub 0644 root -> ${KEY_DIR}/verify.pem"
fi

# ---- 4. the wrapper: root-owned, NOT host-writable (a host-writable wrapper is a privesc hole) ----
say "4. install the broker wrapper ${WRAPPER} (root-owned 0755)"
# the wrapper FILE is locked below, but a writable PARENT dir lets the actor unlink+recreate it (CodeRabbit Major,
# same class as C1/C2). Verify the wrapper's dir + ancestors are root-locked BEFORE writing into it.
assert_root_locked "$(dirname "${WRAPPER}")" "the broker execs this wrapper; a writable wrapper dir lets the actor swap it -> code-exec as the broker"
WRAPPER_BODY="#!/bin/sh
export LOOM_BROKER_KEY_FILE=${KEY_DIR}/broker.key
export LOOM_BROKER_ALLOWED_UIDS=${HOST_UID}
exec ${NODE_BIN} ${STAGE_DIR}/packages/kernel/egress/loom-broker-sign.js \"\$@\"
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
  Run:  sudo visudo -f /etc/sudoers.d/loom-broker
  Add EXACTLY these lines:

      ${HOSTUSER} ALL=(${BROKER_USER}) NOPASSWD: ${WRAPPER}
      Defaults:${HOSTUSER} env_reset, !setenv
      Defaults!${WRAPPER} env_reset, !setenv

  Then AUDIT (SUDO_* in env_keep VOIDS caller-auth — this must print nothing):
      sudo -l -U ${HOSTUSER} | grep -iE 'env_keep.*SUDO_' && echo 'FAIL: SUDO_* in env_keep'
SUDOERS

# ---- 6. verify + the out-of-band attestation (the step only you can do) ----
say "6. verify (as your host uid), then attest out-of-band"
cat <<VERIFY
  node ${STAGE_DIR}/packages/kernel/egress/loom-custody-verify.js \\
    --key ${KEY_DIR}/broker.key --verify-key ${KEY_DIR}/verify.pem \\
    --broker-user ${BROKER_USER} --wrapper ${WRAPPER}

  Expect hostObservableChecksPassed:true + requiresOutOfBandUidConfirmation:true (EXITS NON-ZERO until you attest).
  Then close the last step the tool cannot observe:
      id                                 # YOUR uid (${HOST_UID})
      ls -l ${KEY_DIR}/broker.key        # OWNER must be ${BROKER_USER}, NOT you
      cat ${KEY_DIR}/broker.key          # MUST print: Permission denied
  Only if the owner differs AND the read is denied:
      node ${STAGE_DIR}/packages/kernel/egress/loom-custody-verify.js ... --attested-cross-uid
VERIFY

say "done"
note "$("$APPLY" && echo 'APPLIED steps 1-4. Now apply sudoers (5) + verify/attest (6).' || echo 'DRY-RUN complete — nothing changed.')"
note "RESIDUAL: KEY non-exfiltration only. A rogue actor at uid ${HOST_UID} is on the allowlist and can still REQUEST"
note "a signature — approval-provenance-vs-a-rogue-actor needs the actor on a SEPARATE non-allowlisted uid (tracked)."
