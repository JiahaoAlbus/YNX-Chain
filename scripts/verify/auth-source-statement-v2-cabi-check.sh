#!/usr/bin/env bash
set -euo pipefail
# Fixed public DATA/math tests, including an actual C caller through the hand
# header in the same Go test runtime. No archive rebuild or Source admission.
repo=$(cd "$(dirname "$0")/../.." && pwd)
if [[ $# -ne 1 || $1 != /* ]]; then
  echo 'usage: auth-source-statement-v2-cabi-check.sh /absolute/external/evidence-directory' >&2
  exit 2
fi
out=$1
if [[ -e $out ]]; then echo 'evidence directory must be new' >&2; exit 2; fi
mkdir -p "$out/tmp"
export GOMAXPROCS=2 GOMEMLIMIT=1536MiB CGO_ENABLED=1
export GOTMPDIR="$out/tmp" TMPDIR="$out/tmp"
cd "$repo"
status=0
go test -json -p 1 -count=1 -timeout=120s -run '^TestAuthSourceStatementV2' ./internal/ynxbatch ./cmd/ynx-artifact-release-cabi >"$out/test.jsonl" 2>"$out/stderr.log" || status=$?
python3.13 -B - "$out" "$status" <<'PY'
import json,pathlib,sys
out=pathlib.Path(sys.argv[1]);status=int(sys.argv[2])
expected={
 'TestAuthSourceStatementV2PUBLICOriginalE8':'github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch',
 'TestAuthSourceStatementV2PUBLICCanonicalAndBounds':'github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch',
 'TestAuthSourceStatementV2CABIPUBLICANDAndBinding':'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-artifact-release-cabi',
 'TestAuthSourceStatementV2CABIPUBLICOriginalBoundsRemain':'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-artifact-release-cabi',
}
terminal={};bad=[]
for line in (out/'test.jsonl').read_text().splitlines():
 row=json.loads(line);a=row.get('Action');t=row.get('Test');p=row.get('Package')
 if a in ('fail','skip'):bad.append({'action':a,'test':t,'package':p})
 if t in expected and a in ('pass','fail','skip'):
  if t in terminal or p!=expected[t]:bad.append({'test':t,'reason':'duplicate or wrong package terminal'})
  terminal[t]=a
ok=status==0 and not bad and terminal==dict.fromkeys(expected,'pass')
result={'version':1,'passed':ok,'goExit':status,'tests':terminal,'failures':bad,'actualCInSameTestRuntime':ok,'archiveBuilt':False,'externalArchiveInterop':False,'sourceAdmission':False,'accountAuthorized':False,'mobileQualified':False}
(out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
raise SystemExit(0 if ok else 1)
PY
