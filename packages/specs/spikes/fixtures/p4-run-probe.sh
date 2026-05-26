#!/bin/bash
# P4 delta-storage-budget probe.
#
# Measures the byte size of `git diff --cached HEAD --binary` for 10 representative
# spawn-scope scenarios, in a throwaway repo. Output: scenario|delta_bytes|delta_kb.
#
# Run from any clean directory; creates and uses /tmp/p4-delta-probe/.
# Re-run is idempotent (probe dir is recreated).
#
# Method note (see phase-1-probes.md §P4):
# Synthetic edits are used because delta size depends on WHAT changed in the working
# tree, not WHO changed it. A real Agent spawn making the same edit produces the same
# delta. Spawn cost is orthogonal to delta-budget.

set -e

PROBE_DIR=/tmp/p4-delta-probe
rm -rf "$PROBE_DIR"
mkdir "$PROBE_DIR"
cd "$PROBE_DIR"

git init -q
git config user.email "probe@local"
git config user.name "probe"
echo "# scaffold" > README.md
git add .
git commit -q -m "init"

declare -a SCENARIOS=(
  "S1-tweak-1line"
  "S2-add-10lines"
  "S3-new-small-file-50lines"
  "S4-rename-2files"
  "S5-new-medium-file-300lines"
  "S6-multifile-refactor-5files"
  "S7-large-new-file-1000lines"
  "S8-schema-style-lockfile"
  "S9-doc-bundle-3files"
  "S10-binary-asset-512KB"
)

run_scenario() {
  case "$1" in
    S1-tweak-1line)
      sed -i.bak 's/scaffold/scaffold-tweaked/' README.md && rm -f README.md.bak
      ;;
    S2-add-10lines)
      for i in $(seq 1 10); do echo "Line $i additional content here." >> README.md; done
      ;;
    S3-new-small-file-50lines)
      for i in $(seq 1 50); do echo "small-file line $i / lorem ipsum dolor sit amet" >> small.md; done
      ;;
    S4-rename-2files)
      mv README.md README-renamed.md
      echo "secondary doc" > SECONDARY.md
      ;;
    S5-new-medium-file-300lines)
      for i in $(seq 1 300); do echo "medium line $i with some realistic prose content for measurement purposes." >> medium.md; done
      ;;
    S6-multifile-refactor-5files)
      for f in src1.js src2.js src3.js src4.js src5.js; do
        for i in $(seq 1 30); do echo "// $f line $i" >> "$f"; done
      done
      ;;
    S7-large-new-file-1000lines)
      for i in $(seq 1 1000); do echo "large file line $i with substantial content for storage budget testing." >> large.md; done
      ;;
    S8-schema-style-lockfile)
      echo '{' > package-lock.json
      for i in $(seq 1 2000); do
        echo "  \"dep_$i\": { \"version\": \"1.2.3\", \"resolved\": \"https://registry.npmjs.org/dep$i/-/dep$i-1.2.3.tgz\", \"integrity\": \"sha512-$(printf 'x%.0s' {1..86})\" }," >> package-lock.json
      done
      echo '  "_end": true' >> package-lock.json
      echo '}' >> package-lock.json
      ;;
    S9-doc-bundle-3files)
      for f in doc1.md doc2.md doc3.md; do
        for i in $(seq 1 80); do echo "# $f section $i — content paragraph." >> "$f"; done
      done
      ;;
    S10-binary-asset-512KB)
      dd if=/dev/urandom of=asset.bin bs=1024 count=512 2>/dev/null
      ;;
  esac
}

reset_repo() {
  git reset --hard -q HEAD
  git clean -fdq
}

echo "scenario|delta_bytes|delta_kb"
for s in "${SCENARIOS[@]}"; do
  reset_repo
  run_scenario "$s"
  git add -A
  bytes=$(git diff --cached HEAD --binary | wc -c | tr -d ' ')
  kb=$(echo "scale=2; $bytes / 1024" | bc)
  echo "${s}|${bytes}|${kb}"
done

reset_repo
