#!/usr/bin/env bash
# Source-only verification in the original Perf source CI. Never run a Node.
set -euo pipefail
source_root=${1:?exact composed source directory required}
evidence=${2:?fresh canonical private evidence directory required}
[[ "$source_root" = /* && "$evidence" = /* && ! -e "$evidence" ]]
mkdir -m 0700 "$evidence"
cd "$source_root"
export GOMAXPROCS=2 GOMEMLIMIT=1024MiB
# The original CI owns exact source Go directive, CGO, cache selection and job deadline.
export YNX_PQLAB_LIVE_SESSION_FIXTURE_ROOT="$evidence/private-fixture"
timeout --signal=TERM --kill-after=5s 240s go test -mod=readonly -json -p 1 -count=1 -timeout=160s -run '^TestPQLab(LiveSession(OriginalProofAndHeldScope|LifecycleAndOriginalRefusal)|LiveMaterials(CaptureObservationRetainsOriginalFailure|CancelledAppReadDrainsOriginal|CaptureKnownCoordinatesNeverRebase)|SenderPrepareOriginalWitnessAndCurrent|PublicOwnerPrepareBeforeCommands)$' ./internal/consensus > "$evidence/core.jsonl" 2> "$evidence/core.stderr.private"
export YNX_PQ_LAB_LIVE_FIXTURE_ROOT="$evidence/private-fixture"
timeout --signal=TERM --kill-after=5s 240s go test -mod=readonly -json -p 1 -count=1 -timeout=90s -run '^TestPQLab(LiveSession(CommandStrictInputs|FailureProjection|CommandOriginalSourceAndLostAck)|SenderPUBLICOwnersPreparedReady(Refusals)?)$' ./cmd/ynx-consensus-pq-lab > "$evidence/cli.jsonl" 2> "$evidence/cli.stderr.private"
python3 -B - "$evidence" <<'PYCOLLECT'
import json,sys
from pathlib import Path
p=Path(sys.argv[1])
for filename,package,names in [
 ('core.jsonl','internal/consensus',['TestPQLabLiveSessionOriginalProofAndHeldScope','TestPQLabLiveSessionLifecycleAndOriginalRefusal','TestPQLabLiveMaterialsCaptureObservationRetainsOriginalFailure','TestPQLabLiveMaterialsCancelledAppReadDrainsOriginal','TestPQLabLiveMaterialsCaptureKnownCoordinatesNeverRebase','TestPQLabSenderPrepareOriginalWitnessAndCurrent','TestPQLabPublicOwnerPrepareBeforeCommands']),
 ('cli.jsonl','cmd/ynx-consensus-pq-lab',['TestPQLabLiveSessionCommandStrictInputs','TestPQLabLiveSessionFailureProjection','TestPQLabLiveSessionCommandOriginalSourceAndLostAck','TestPQLabSenderPUBLICOwnersPreparedReady','TestPQLabSenderPUBLICOwnersPreparedReadyRefusals'])]:
 package='github.com/JiahaoAlbus/YNX-Chain/'+package
 rows=[json.loads(x) for x in (p/filename).read_text().splitlines()]
 if not rows or any(r.get('Action') in ('fail','skip','build-fail') for r in rows): raise ValueError('empty, failed or skipped original stream')
 if any(r.get('Package') and r['Package']!=package for r in rows): raise ValueError('foreign package')
 for name in {r['Test'] for r in rows if r.get('Test')}:
  if [r['Action'] for r in rows if r.get('Test')==name and r['Action'] in ('run','pass','fail','skip')]!=['run','pass']: raise ValueError('incomplete or duplicate child')
 if [r['Action'] for r in rows if r.get('Package')==package and not r.get('Test') and r['Action'] in ('start','pass','fail','skip')]!=['start','pass']: raise ValueError('original package must start and pass once')
 tests={r['Test'] for r in rows if r.get('Test') and r.get('Action')=='run' and '/' not in r['Test']}
 if tests!=set(names): raise ValueError('exact test denominator differs')
 for name in names:
  if [(r.get('Package'),r['Action']) for r in rows if r.get('Test')==name and r['Action'] in ('run','pass','fail','skip')]!=[(package,'run'),(package,'pass')]: raise ValueError('required original not uniquely executed')
print('LIVE_MATERIALS_SESSION_DATA_ONLY sourceQualified=false nodeStarted=false fourLaneRSSQualified=false')
PYCOLLECT
# Never archive private-fixture, stderr.private, custody, or all temporary files.
