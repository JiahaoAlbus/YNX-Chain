#!/usr/bin/env bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/../.." && pwd -P)
: "${YNX_PQ_LIGHT_SOURCE_EVIDENCE:?exclusive evidence path required}"
mkdir -m 700 "$YNX_PQ_LIGHT_SOURCE_EVIDENCE"
case_root=$(cd "$YNX_PQ_LIGHT_SOURCE_EVIDENCE" && pwd -P)
mkdir -m 700 "$case_root/tmp"
export TMPDIR="$case_root/tmp" GOTMPDIR="$case_root/tmp"
export GOMAXPROCS=2 GOMEMLIMIT=1536MiB
export YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$root/scripts/loadtest/fixtures/finalize-1b-public"
export YNX_PUBLIC_LIGHT_SOURCE_EXPORT="$case_root/public-delivery"
cd "$root"
# One new targeted invocation; the PUBLIC fixture and original verifier run in
# the listed package order at -p 1. No archive, keygen, signer, Node or RPC.
go test -mod=readonly -json -p 1 -count=1 -timeout=120s -tags=ynx_public_trace_testsupport \
  -run '^(TestPQLightSourcePUBLICZeroTransactionExport|TestPQLightSourcePUBLICNormalVerifier|TestExportLightSourceNormalCommandStrictArguments|TestExportLightSourceRejectsPlanBeforeOpeningStoresOrOutput)$' \
  ./internal/consensus ./cmd/ynx-consensus-proof-verify ./cmd/ynx-comet > "$case_root/GO.jsonl" 2> "$case_root/STDERR.log"
python3 -B scripts/ops/collect_pq_light_source_tests.py "$case_root/GO.jsonl"
