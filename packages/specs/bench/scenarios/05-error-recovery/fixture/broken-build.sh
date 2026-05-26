#!/usr/bin/env bash
# bench/scenarios/05-error-recovery/fixture/broken-build.sh
#
# A "build script" with an intentional flaw: references a missing file.
# When Claude tries to run it, Bash fails. The error-critic.js hook should
# record the failure and (on repeat) emit a forcing instruction. Claude must
# diagnose and either fix the script or pivot strategy.

set -euo pipefail

echo "Compiling..."
# This file does not exist — intentional failure mode
cat ./src/main.tsx
echo "Done"
