#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# != 1 || -e "$1" ]]; then
 echo 'a new external public evidence directory is required' >&2
 exit 2
fi
mkdir -p "$1"
YNX_ACCOUNT_WIRE_EVIDENCE="$(cd "$1" && pwd)"
YNX_ACCOUNT_WIRE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$YNX_ACCOUNT_WIRE_ROOT"
export GOMAXPROCS=2 GOMEMLIMIT=1536MiB
export YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$YNX_ACCOUNT_WIRE_ROOT/scripts/loadtest/fixtures/finalize-1b-public"
export YNX_PQ_NETWORK_E2E=''
# Verify the exact owner-supplied DATA headers before compiling the consumer.
python3 -B scripts/ops/test_collect_pq_committed_account_wire_tests.py
# Compile only the test-only sole SDK DATA consumer, never a node/archive/App.
"${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror \
 internal/consensus/testdata/account_proof_wire_sdk/data_check.cpp \
 -o "$YNX_ACCOUNT_WIRE_EVIDENCE/sdk-data-check"
export YNX_ACCOUNT_PROOF_SDK_DATA_DRIVER="$YNX_ACCOUNT_WIRE_EVIDENCE/sdk-data-check"
if ! go test -tags=ynx_public_trace_testsupport -json -p 1 -count=1 -timeout=120s \
 -run '^(TestPQCommittedAccountWirePUBLICStrictDATA|TestPQCommittedAccountWirePUBLICContinuousProof|TestPQCommittedAccountWirePUBLICCloseDebt)$' \
 ./internal/consensus > "$YNX_ACCOUNT_WIRE_EVIDENCE/GO.jsonl" 2> "$YNX_ACCOUNT_WIRE_EVIDENCE/STDERR"; then
 cat "$YNX_ACCOUNT_WIRE_EVIDENCE/GO.jsonl"
 cat "$YNX_ACCOUNT_WIRE_EVIDENCE/STDERR" >&2
 exit 1
fi
cat "$YNX_ACCOUNT_WIRE_EVIDENCE/GO.jsonl"
python3 -B scripts/ops/collect_pq_committed_account_wire_tests.py "$YNX_ACCOUNT_WIRE_EVIDENCE/GO.jsonl" "$YNX_ACCOUNT_WIRE_EVIDENCE/RESULT.json"
