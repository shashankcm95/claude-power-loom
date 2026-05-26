#!/usr/bin/env bash
# packages/runtime/orchestration/build-team-helpers.sh — substrate-primitive wrappers for /build-team.
#
# Per HT.1.5 (ADR-0002 cross-language application — markdown narrative + helper-script
# invocations post-split shape). Sub-plan: swarm/thoughts/shared/plans/2026-05-10-HT.1.5-
# build-team-md-split.md (status: approved; 9 FLAGs absorbed).
#
# Subcommands (5 + --help):
#   route-decide-gate                  — H.7.3 + H.7.5 route-decision wrapper (Step 0)
#   build-spawn-context                — H.8.5 spawn-context auto-extension (Step 1.5)
#   verify-with-contract-selection     — H.5.7 task-type heuristic + tier-aware verifier
#   assign-challenger-pair             — polymorphic assign-challenger / assign-pair dispatch
#   record-verdict                     — pattern-recorder wrapper with task-signature derivation
#
# Path resolution: $HOME/Documents/claude-toolkit/packages/runtime/orchestration/* + packages/kernel/algorithms/route-decide.js + packages/kernel/validators/contract-verifier.js (matches the existing
# ROUTE_DECIDE_SCRIPT pattern at commands/build-team.md). DO NOT use $SCRIPT_DIR — the
# variable is not set in slash-command context (verified across all 14 commands at HT.1.5-
# verify; using it would have caused runtime failure).
#
# Output contract: stdout carries machine-readable payloads (JSON or text); stderr carries
# user-facing log messages and errors. Helper invocations may be safely captured via $(...)
# without log-pollution.

set -e

# ---------- constants ----------

TOOLKIT_ROOT="$HOME/Documents/claude-toolkit"
# Phase 0 (v3.0-alpha) workspace restructure: scripts moved kernel→runtime; persona contracts moved.
ROUTE_DECIDE_SCRIPT="$TOOLKIT_ROOT/packages/kernel/algorithms/route-decide.js"
BUILD_SPAWN_CONTEXT_SCRIPT="$TOOLKIT_ROOT/packages/runtime/orchestration/build-spawn-context.js"
CONTRACT_VERIFIER_SCRIPT="$TOOLKIT_ROOT/packages/kernel/validators/contract-verifier.js"
AGENT_IDENTITY_SCRIPT="$TOOLKIT_ROOT/packages/runtime/orchestration/agent-identity.js"
PATTERN_RECORDER_SCRIPT="$TOOLKIT_ROOT/packages/runtime/orchestration/pattern-recorder.js"
PERSONAS_CONTRACTS_DIR="$TOOLKIT_ROOT/packages/runtime/contracts"
ENGINEERING_CONTRACT="$PERSONAS_CONTRACTS_DIR/engineering-task.contract.json"

# ---------- usage ----------

usage() {
  cat <<USAGE
build-team-helpers.sh — substrate-primitive wrappers for /build-team

Usage: bash build-team-helpers.sh <subcommand> [args...]

Subcommands:
  route-decide-gate <task> [prior-turn-excerpt]
      H.7.3 + H.7.5 route-decision wrapper. Emits route-decision JSON with
      recommendation + score + reasoning + uncertain. Empty prior-turn-excerpt
      skips --context. Defaults to {recommendation:"route"} if route-decide.js
      missing (fail-open per ADR-0001).

  build-spawn-context <task> [target-files]
      H.8.5 spawn-context auto-extension. Emits SPAWN_CONTEXT block to stdout.
      Empty on fail per ADR-0001 fail-open discipline.

  verify-with-contract-selection <impl-output> <identity> <verification-tier> <skip-checks> <task-description> <task-type-override> <persona>
      H.5.7 task-type heuristic (audit-precedence) + tier-aware contract-
      verifier dispatch. Emits verifier JSON output. PERSONA derived from
      IDENTITY (\${IDENTITY%%.*}) when empty.

  assign-challenger-pair <exclude-persona> <exclude-identity> <count> <task>
      Polymorphic dispatch: count=1 → agent-identity.js assign-challenger;
      count>=2 → agent-identity.js assign-pair. Emits assignment JSON.

  record-verdict <identity> <verdict> <paired-with> <convergence> [task-type]
      pattern-recorder.js wrapper with task-signature derivation
      (\${persona}:actor-\${persona} pattern; PERSONA derived from IDENTITY).

  --help, -h
      Show this message and exit 0.

Path resolution: $TOOLKIT_ROOT/...
USAGE
}

# ---------- subcommand: route-decide-gate ----------

cmd_route_decide_gate() {
  local task_description="${1:-}"
  local prior_turn_excerpt="${2:-}"

  if [ -z "$task_description" ]; then
    echo "ERROR: route-decide-gate requires <task-description>" >&2
    exit 1
  fi

  # Fail-open per ADR-0001: emit a synthetic route-decision so chat agent proceeds
  # to Step 1 with route as the default. Matches pre-H.7.3 behavior.
  if [ ! -f "$ROUTE_DECIDE_SCRIPT" ]; then
    echo '{"recommendation":"route","score_total":0,"reasoning":"route-decide.js missing; defaulting to route (fail-open)","uncertain":false}'
    return 0
  fi

  if [ -n "$prior_turn_excerpt" ]; then
    node "$ROUTE_DECIDE_SCRIPT" --task "$task_description" --context "$prior_turn_excerpt"
  else
    node "$ROUTE_DECIDE_SCRIPT" --task "$task_description"
  fi
}

# ---------- subcommand: build-spawn-context ----------

cmd_build_spawn_context() {
  local task_description="${1:-}"
  local target_files="${2:-}"

  if [ -z "$task_description" ]; then
    echo "ERROR: build-spawn-context requires <task-description>" >&2
    exit 1
  fi

  # Fail-open per ADR-0001: empty SPAWN_CONTEXT lets Step 2 proceed without prefix
  if [ ! -f "$BUILD_SPAWN_CONTEXT_SCRIPT" ]; then
    echo ""
    return 0
  fi

  if [ -n "$target_files" ]; then
    node "$BUILD_SPAWN_CONTEXT_SCRIPT" --task "$task_description" --files "$target_files" --format text 2>/dev/null || echo ""
  else
    node "$BUILD_SPAWN_CONTEXT_SCRIPT" --task "$task_description" --format text 2>/dev/null || echo ""
  fi
}

# ---------- subcommand: verify-with-contract-selection ----------

cmd_verify_with_contract_selection() {
  local impl_output="${1:-}"
  local identity="${2:-}"
  local verification_tier="${3:-}"
  local skip_checks="${4:-}"
  local task_description="${5:-}"
  local task_type_override="${6:-}"
  local persona="${7:-}"

  if [ -z "$impl_output" ] || [ -z "$identity" ] || [ -z "$verification_tier" ]; then
    echo "ERROR: verify-with-contract-selection requires <impl-output> <identity> <verification-tier> [skip-checks task-desc task-type-override persona]" >&2
    exit 1
  fi

  # Derive PERSONA from IDENTITY if not supplied (\${IDENTITY%%.*} pattern)
  if [ -z "$persona" ]; then
    persona="${identity%%.*}"
  fi

  # H.5.7 task-type heuristic — explicit override wins; else verb regex; else
  # engineering fallback. Audit-precedence by design: mixed-mode tasks default
  # to audit unless override forces engineering.
  local task_type
  if [ -n "$task_type_override" ]; then
    task_type="$task_type_override"
  elif echo "$task_description" | grep -iE "audit|review|assess|analyze|investigate|check|verify|inspect|examine|find vulnerabilities" > /dev/null; then
    task_type="audit"
  else
    task_type="engineering"
  fi

  # Contract selection per task-type
  local impl_contract
  if [ "$task_type" = "audit" ]; then
    impl_contract="$PERSONAS_CONTRACTS_DIR/${persona}.contract.json"
  else
    impl_contract="$ENGINEERING_CONTRACT"
  fi

  echo "H.5.7 selected: TASK_TYPE=$task_type, CONTRACT=$impl_contract" >&2

  # Tier-aware verifier dispatch — only spot-check-only consumes skip-checks
  # (H.7.1 H-2: medium/low must run full verification).
  case "$verification_tier" in
    spot-check-only)
      node "$CONTRACT_VERIFIER_SCRIPT" \
        --contract "$impl_contract" \
        --output "$impl_output" \
        --identity "$identity" \
        --skip-checks "$skip_checks"
      ;;
    asymmetric-challenger|symmetric-pair)
      node "$CONTRACT_VERIFIER_SCRIPT" \
        --contract "$impl_contract" \
        --output "$impl_output" \
        --identity "$identity"
      ;;
    *)
      echo "ERROR: unknown verification tier: $verification_tier (expected spot-check-only|asymmetric-challenger|symmetric-pair)" >&2
      exit 1
      ;;
  esac
}

# ---------- subcommand: assign-challenger-pair ----------

cmd_assign_challenger_pair() {
  local exclude_persona="${1:-}"
  local exclude_identity="${2:-}"
  local count="${3:-1}"
  local task="${4:-}"

  if [ -z "$exclude_persona" ] || [ -z "$exclude_identity" ] || [ -z "$task" ]; then
    echo "ERROR: assign-challenger-pair requires <exclude-persona> <exclude-identity> <count> <task>" >&2
    exit 1
  fi

  # Polymorphic dispatch: 1 challenger → assign-challenger; >=2 → assign-pair.
  # Per HT.1.5-verify architect Q1c PASS: real abstraction value; chat agent
  # shouldn't need to know which subcommand to invoke based on count.
  if [ "$count" -ge 2 ]; then
    node "$AGENT_IDENTITY_SCRIPT" assign-pair \
      --persona "$exclude_persona" \
      --count "$count" \
      --task "$task"
  else
    node "$AGENT_IDENTITY_SCRIPT" assign-challenger \
      --exclude-persona "$exclude_persona" \
      --exclude-identity "$exclude_identity" \
      --task "$task"
  fi
}

# ---------- subcommand: record-verdict ----------

cmd_record_verdict() {
  local identity="${1:-}"
  local verdict="${2:-}"
  local paired_with="${3:-}"
  local convergence="${4:-}"
  local task_type="${5:-engineering}"

  if [ -z "$identity" ] || [ -z "$verdict" ]; then
    echo "ERROR: record-verdict requires <identity> <verdict> [paired-with] [convergence] [task-type]" >&2
    exit 1
  fi

  # Task-signature derivation consolidates the duplicated pattern at the original
  # build-team.md lines 237-238 and 264-265 ("${persona}:actor-${persona}").
  local persona="${identity%%.*}"
  local task_signature="${persona}:actor-${persona}"

  node "$PATTERN_RECORDER_SCRIPT" record \
    --task-signature "$task_signature" \
    --persona "$persona" \
    --identity "$identity" \
    --verdict "$verdict" \
    --paired-with "$paired_with" \
    --convergence "$convergence"
}

# ---------- dispatch ----------

if [ $# -eq 0 ]; then
  usage >&2
  exit 1
fi

case "$1" in
  --help|-h)
    usage
    exit 0
    ;;
  route-decide-gate)
    shift
    cmd_route_decide_gate "$@"
    ;;
  build-spawn-context)
    shift
    cmd_build_spawn_context "$@"
    ;;
  verify-with-contract-selection)
    shift
    cmd_verify_with_contract_selection "$@"
    ;;
  assign-challenger-pair)
    shift
    cmd_assign_challenger_pair "$@"
    ;;
  record-verdict)
    shift
    cmd_record_verdict "$@"
    ;;
  *)
    echo "Unknown subcommand: $1" >&2
    usage >&2
    exit 1
    ;;
esac
