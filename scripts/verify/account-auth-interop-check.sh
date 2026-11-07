#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# != 3 || -e "$1" ]]; then
 echo 'new external evidence directory, existing same-platform Source18 archive, exact SHA256 required' >&2
 exit 2
fi
YNX_ACCOUNT_AUTH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$1"
YNX_ACCOUNT_AUTH_EVIDENCE="$(cd "$1" && pwd)"
cd "$YNX_ACCOUNT_AUTH_ROOT"
# Original Auth PUBLIC platform body is Darwin; no Linux/mobile positive claimed.
python3 -B scripts/verify/build-account-auth-interop.py "$YNX_ACCOUNT_AUTH_EVIDENCE/cpp" "$2" "$3"
export YNX_ACCOUNT_AUTH_INTEROP_BINARY="$YNX_ACCOUNT_AUTH_EVIDENCE/cpp/account-auth-joint"
export YNX_ACCOUNT_AUTH_ROOT0_BINARY="$YNX_ACCOUNT_AUTH_EVIDENCE/cpp/account-auth-root0"
export YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$YNX_ACCOUNT_AUTH_ROOT/scripts/loadtest/fixtures/finalize-1b-public"
export GOMAXPROCS=2 GOMEMLIMIT=1536MiB YNX_PQ_NETWORK_E2E=''
if ! go test -tags=ynx_public_trace_testsupport,ynx_account_auth_interop -json -p 1 -count=1 -timeout=120s \
 -run '^TestPQCommittedAccountPUBLICAuthFinalR1Joint$' ./internal/consensus \
 > "$YNX_ACCOUNT_AUTH_EVIDENCE/GO.jsonl" 2> "$YNX_ACCOUNT_AUTH_EVIDENCE/STDERR"; then
 cat "$YNX_ACCOUNT_AUTH_EVIDENCE/GO.jsonl"
 cat "$YNX_ACCOUNT_AUTH_EVIDENCE/STDERR" >&2
 exit 1
fi
cat "$YNX_ACCOUNT_AUTH_EVIDENCE/GO.jsonl"
python3 -B scripts/ops/collect_pq_account_auth_interop_tests.py "$YNX_ACCOUNT_AUTH_EVIDENCE/GO.jsonl" "$YNX_ACCOUNT_AUTH_EVIDENCE/RESULT.json"
