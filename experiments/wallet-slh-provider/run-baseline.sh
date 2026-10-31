#!/usr/bin/env bash
set -euo pipefail
# Run only the opt-in original production-backend diagnostic. No network fetch,
# root module mutation, shared cache writes, production build or install.
: "${BASELINE_ROOT:?Set an absolute external private artifact/cache root}"
: "${GO_BINARY:?Set the existing Go 1.26.10 binary absolute path}"
: "${READONLY_MODULE_PROXY:?Set file:///path/to/existing/module/cache/download}"
[[ "$BASELINE_ROOT" = /* && "$GO_BINARY" = /* && "$READONLY_MODULE_PROXY" = file:///* ]]
export GOTOOLCHAIN=local GOMAXPROCS="${GOMAXPROCS:-2}"
export GOCACHE="$BASELINE_ROOT/gocache" GOMODCACHE="$BASELINE_ROOT/gomodcache"
export GOTMPDIR="$BASELINE_ROOT/tmp" GOPROXY="$READONLY_MODULE_PROXY" GOSUMDB=off
export YNX_SLH_BASELINE_SAMPLES="${YNX_SLH_BASELINE_SAMPLES:-1000}"
export YNX_SLH_BASELINE_OUTPUT="$BASELINE_ROOT/results/${RUN_LABEL:-formal}"
if [[ -e "$YNX_SLH_BASELINE_OUTPUT/test.log" ]]; then
 printf 'Existing result evidence retained; choose a fresh RUN_LABEL: %s\n' "$YNX_SLH_BASELINE_OUTPUT" >&2
 exit 1
fi
mkdir -p "$GOCACHE" "$GOMODCACHE" "$GOTMPDIR" "$YNX_SLH_BASELINE_OUTPUT"
# This script must be launched from the worktree root. Caller chooses and owns
# BASELINE_ROOT. Only public timing / CPU stack metadata is emitted.
{
 date -u
 "$GO_BINARY" version
 uname -a
 sysctl hw.model hw.ncpu hw.physicalcpu hw.memsize machdep.cpu.brand_string hw.optional.arm.FEAT_SHA256 hw.optional.arm.FEAT_SHA512
 git branch --show-current
 git rev-parse HEAD
 git status --short
 shasum -a 256 go.mod go.sum internal/ynxbatch/provider.go internal/ynxbatch/parallel_provider.go internal/ynxbatch/key_material.go internal/ynxbatch/sign.go internal/ynxbatch/provider_slh_experiment_baseline_test.go
 "$GO_BINARY" env GOOS GOARCH GOARM64 GOFLAGS GOTOOLCHAIN GOMAXPROCS GOCACHE GOMODCACHE GOTMPDIR GOPROXY
 ps -Ao pid,ppid,pcpu,comm -r | head -20 || true
} > "$YNX_SLH_BASELINE_OUTPUT/environment.txt"
/usr/bin/time -l "$GO_BINARY" test -mod=readonly -p=1 ./internal/ynxbatch \
 -run '^TestSLHOriginalProviderBaseline$' -count=1 -v -timeout=15m \
 2>&1 | tee "$YNX_SLH_BASELINE_OUTPUT/test.log"
{
 date -u
 git status --short
 shasum -a 256 go.mod go.sum internal/ynxbatch/provider.go internal/ynxbatch/parallel_provider.go internal/ynxbatch/key_material.go internal/ynxbatch/sign.go
 ps -Ao pid,ppid,pcpu,comm -r | head -20 || true
} > "$YNX_SLH_BASELINE_OUTPUT/cleanup.txt"
