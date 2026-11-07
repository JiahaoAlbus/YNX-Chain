#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# != 1 || -e "$1" ]]; then
  echo 'a new external public evidence directory is required' >&2
  exit 2
fi
mkdir -p "$1"
YNX_ACCOUNT_EVIDENCE="$(cd "$1" && pwd)"
YNX_ACCOUNT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$YNX_ACCOUNT_ROOT"
export GOMAXPROCS=2 GOMEMLIMIT=1536MiB
export YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$YNX_ACCOUNT_ROOT/scripts/loadtest/fixtures/finalize-1b-public"
export YNX_PQ_NETWORK_E2E=''
# Exact new group, mandatory original nine PUBLIC pieces; no missing-fixture skip.
if ! go test -tags=ynx_public_trace_testsupport -json -p 1 -count=1 -timeout=120s \
  -run '^(TestPQCommittedAccountPUBLICContinuousEngineLayouts|TestPQCommittedAccountPUBLICLifecycleAndDebt|TestPQCommittedAccountPUBLICAppBeforeStoreRefused|TestPQCommittedAccountPUBLICSignedEvidenceRefusals)$' \
  ./internal/consensus > "$YNX_ACCOUNT_EVIDENCE/GO.jsonl" 2> "$YNX_ACCOUNT_EVIDENCE/STDERR"; then
  cat "$YNX_ACCOUNT_EVIDENCE/GO.jsonl"
  cat "$YNX_ACCOUNT_EVIDENCE/STDERR" >&2
  exit 1
fi
cat "$YNX_ACCOUNT_EVIDENCE/GO.jsonl"
python3 -B scripts/ops/collect_pq_committed_account_tests.py "$YNX_ACCOUNT_EVIDENCE/GO.jsonl" "$YNX_ACCOUNT_EVIDENCE/RESULT.json"
