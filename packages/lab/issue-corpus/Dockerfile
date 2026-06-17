# loom-sandbox — the containment image for the behavioral-grading / dry-run leg.
#
# Loom-AUTHORED, NOT attacker-influenced: the stranger supplies the repo + patch,
# never this Dockerfile. The build runs on the HOST with full network (a build-time
# supply-chain surface, DISTINCT from the `--network none` RUN-time boundary) — so the
# base is DIGEST-PINNED and pytest is version-PINNED (VERIFY H6).
#
# Contents: python3 + pytest ONLY. NO git (the clone is hardened on the host,
# pre-container, by _clone-lifecycle.js), NO node (the pytest-runner is `python3 -c`).
#
# Build (stdin context — sends ONLY this file, never the repo tree; there is no COPY):
#   docker build -t loom-sandbox:latest - < packages/lab/issue-corpus/Dockerfile
#
# The Docker backend fails-CLOSED with this build hint if the image is absent
# (NO silent build-on-demand mid-"contained"-run).

FROM python:3.12-slim@sha256:d764629ce0ddd8c71fd371e9901efb324a95789d2315a47db7e4d27e78f1b0e9

# pytest version-pinned; --no-cache-dir keeps the layer lean.
RUN pip install --no-cache-dir pytest==8.3.4

# A writable HOME on the ephemeral tmpfs: the root fs is mounted --read-only at run
# time, so any tool reaching for $HOME lands on /tmp (the run-time --tmpfs), never the host.
ENV HOME=/tmp

# No ENTRYPOINT/CMD that interferes: the backend runs `<image> sh -c '<wrapper>' sh <cmd> <argv>`,
# overriding the base CMD. The container runs as --user $(id -u):$(id -g) at RUN time
# (the host clone owner — keeps non-root AND able to write the bind-mounted /work), so
# no image-baked user is required.
