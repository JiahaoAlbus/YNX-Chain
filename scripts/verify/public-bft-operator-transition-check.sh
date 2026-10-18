#!/usr/bin/env bash
set -Eeuo pipefail

# Isolated source/caller controls, not normal binary/DB/consensus execution.
# No SSH, service, host /proc, key creation, or network operation is permitted.
repo="$(cd "$(dirname "$0")/../.." && pwd -P)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
helper="$repo/scripts/ops/remote/public-bft-operator-transition.sh"
fail() { echo "operator transition control failed: $*" >&2; exit 1; }
sha() { sha256sum "$1" | awk '{print $1}'; }
mkdir -m 0700 "$tmp/meta"
python3 -B - "$tmp/meta" <<'PY'
import base64,hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); roles=['primary','singapore','silicon-valley','seoul']
def dump(path,v):
    raw=json.dumps(v,separators=(',',':')).encode(); path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(raw); return hashlib.sha256(raw).hexdigest()
old=dict(version='YNX-PRODUCTION-OPERATOR/v1',chainId='ynx_6423-1',validatorManifestSHA256='1'*64,consensusGenesis=base64.b64encode(b'original public genesis').decode(),consensusGenesisSHA256='2'*64,originalGenesisHash='3'*64,migrationStateHash='4'*64,stateLayout='block-journal',runtimePlan='',runtimePlanHash='',pqSchedule='',pqScheduleHash='',roles=[dict(role=r,home='/srv/'+r+'/comet',abciState='/srv/'+r+'/app/state',legacyKeyPath='/srv/'+r+'/keys/pv',legacyStatePath='/srv/'+r+'/keys/hrs',nodeKeyPath='/srv/'+r+'/keys/node',hostBinding=None,remoteSigner='',transportKeyPath='',signerPeerPublicKey='',remoteTimeout='') for r in roles])
schedule=dict(registryHeight=9007199254740993,registryRoot='5'*64,registryEventCount=4,authorizedAt=9007199254740994,paramsUpdateHeight=9007199254740994,validatorUpdateHeight=9007199254740995,activationHeight=9007199254740997)
new=json.loads(json.dumps(old)); new['pqSchedule']=base64.b64encode(json.dumps(schedule,separators=(',',':')).encode()).decode(); new['pqScheduleHash']='6'*64
for r in new['roles']: r.update(hostBinding={'fixturePublicOnly':True},remoteSigner='tcp://127.0.0.1:41000',transportKeyPath='/srv/'+r['role']+'/keys/transport',signerPeerPublicKey='7'*64,remoteTimeout='5s')
oldpin=dump(p/'old/common/operator-plan.json',old); newpin=dump(p/'next/common/operator-plan.json',new)
src=dict(version='YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2',platform='linux/amd64',commit='8'*40,binaries={n:dict(sha256='9'*64) for n in ['ynx-comet','ynx-consensus-package','ynx-consensus-keycheck']})
oldsrc=dict(src,commit='a'*40); oldmanifest=dump(p/'old-SOURCE.json',oldsrc); manifest=dump(p/'SOURCE.json',src)
a=dict(version='YNX-OPERATOR-TRANSITION-APPROVAL/v1',transitionId='source-control-transition',phase='quiesce',approved=True,oldOperatorPlanSHA256=oldpin,oldRuntimeCommit=oldsrc['commit'],oldRuntimeManifestSHA256=oldmanifest,nextOperatorPlanSHA256=None,runtimeCommit=src['commit'],runtimeManifestSHA256=manifest,cutoverTransactionId='source-original-cutover',freezeSHA256={r:'b'*64 for r in roles},nativePauseSHA256='c'*64,checkpoint=None,backups=None)
dump(p/'quiesce.json',a)
a.update(phase='install',nextOperatorPlanSHA256=newpin,checkpoint=dict(height=str(schedule['registryHeight']),appHash='d'*64,registryRoot=schedule['registryRoot'],registryEventCount='4'),backups={r:'e'*64 for r in roles})
dump(p/'install.json',a)
dump(p/'pins.json',dict(old=oldpin,next=newpin,oldManifest=oldmanifest,manifest=manifest))
PY
value() { python3 -B - "$tmp/meta/pins.json" "$1" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))[sys.argv[2]])
PY
}
oldpin="$(value old)"; newpin="$(value next)"; oldmanifest="$(value oldManifest)"; manifest="$(value manifest)"
binding_old_package="$tmp/meta/old"
bind() {
  bash -c 'set -Eeuo pipefail; source "$1"; shift; operator_transition_binding "$@"' -- "$helper" "$1" source-control-transition primary "$2" "$(sha "$2")" "$binding_old_package" "$oldpin" "$tmp/meta/old-SOURCE.json" "$(printf 'a%.0s' {1..40})" "$oldmanifest" "$3" "$4" "$tmp/meta/SOURCE.json" "$(printf '8%.0s' {1..40})" "$manifest"
}
bind quiesce "$tmp/meta/quiesce.json" - - >"$tmp/quiesce.binding"
bind install "$tmp/meta/install.json" "$tmp/meta/next" "$newpin" >"$tmp/install.binding"
grep -Fq '"height":"9007199254740993"' "$tmp/install.binding" || fail 'height rounded above 2^53'
cp "$tmp/meta/install.json" "$tmp/install-original.json"
for mutation in approved phase oldOperatorPlanSHA256 oldRuntimeCommit oldRuntimeManifestSHA256 nextOperatorPlanSHA256 runtimeCommit runtimeManifestSHA256 missingFreeze nativePause checkpoint backup; do
  python3 -B - "$tmp/install-original.json" "$tmp/negative.json" "$mutation" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); k=sys.argv[3]
if k=='approved': a[k]=False
elif k=='phase': a[k]='start'
elif k=='missingFreeze': del a['freezeSHA256']['seoul']
elif k=='nativePause': a['nativePauseSHA256']='0'*64
elif k=='checkpoint': a['checkpoint']['height']=str(int(a['checkpoint']['height'])+1)
elif k=='backup': a['backups']['seoul']=''
elif k.endswith('Commit'): a[k]='f'*40
else: a[k]='f'*64
json.dump(a,open(sys.argv[2],'w'),separators=(',',':'))
PY
  if bind install "$tmp/negative.json" "$tmp/meta/next" "$newpin" >"$tmp/$mutation.stdout" 2>"$tmp/$mutation.error"; then fail "accepted $mutation"; fi
done
# Wrong external pin, duplicate fields and omitted new profile must fail even
# when all other self-reported material appears internally consistent.
if bash -c 'source "$1"; shift; operator_transition_binding "$@"' -- "$helper" install source-control-transition primary "$tmp/meta/install.json" "$(printf 'f%.0s' {1..64})" "$tmp/meta/old" "$oldpin" "$tmp/meta/old-SOURCE.json" "$(printf 'a%.0s' {1..40})" "$oldmanifest" "$tmp/meta/next" "$newpin" "$tmp/meta/SOURCE.json" "$(printf '8%.0s' {1..40})" "$manifest" >"$tmp/wrong-pin.log" 2>&1; then fail 'external approval pin was ignored'; fi
sed 's/"approved":true/"approved":false,"approved":true/' "$tmp/meta/install.json" >"$tmp/duplicate.json"
if bind install "$tmp/duplicate.json" "$tmp/meta/next" "$newpin" >"$tmp/duplicate.log" 2>&1; then fail 'duplicate approval accepted'; fi
if bind install "$tmp/meta/install.json" - - >"$tmp/legacy.log" 2>&1; then fail 'legacy profile substituted'; fi

# The old optional control is exact for all four roles and the target comes
# only from the independently pinned phase approval, never a live RPC.
python3 -B - "$tmp/meta" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); old=json.loads((p/'old/common/operator-plan.json').read_bytes()); old['heightHaltSessionId']='f'*64
for r in old['roles']: r['heightHaltControlPath']=str(pathlib.PurePosixPath(r['abciState']).parent/('operator-height-halt-'+'f'*64+'.json'))
path=p/'halt/common/operator-plan.json'; path.parent.mkdir(parents=True); raw=json.dumps(old,separators=(',',':')).encode(); path.write_bytes(raw)
a=json.loads((p/'quiesce.json').read_bytes()); a['oldOperatorPlanSHA256']=hashlib.sha256(raw).hexdigest(); a['futureTargetHeight']='9007199254740993'; (p/'halt-quiesce.json').write_text(json.dumps(a,separators=(',',':')))
PY
saved_oldpin="$oldpin"; oldpin="$(sha "$tmp/meta/halt/common/operator-plan.json")"; binding_old_package="$tmp/meta/halt"
bind quiesce "$tmp/meta/halt-quiesce.json" - - >"$tmp/halt.binding"
grep -Fq '"quiesceMode":"height-halt"' "$tmp/halt.binding"
grep -Fq '"futureTargetHeight":"9007199254740993"' "$tmp/halt.binding"
for mutation in missing numeric zero leading-zero max negative unknown duplicate; do
  python3 -B - "$tmp/meta/halt-quiesce.json" "$tmp/halt-negative.json" "$mutation" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); kind=sys.argv[3]
if kind=='missing': del a['futureTargetHeight']
elif kind=='numeric': a['futureTargetHeight']=9007199254740993
elif kind=='zero': a['futureTargetHeight']='0'
elif kind=='leading-zero': a['futureTargetHeight']='09007199254740993'
elif kind=='max': a['futureTargetHeight']=str(2**63-1)
elif kind=='negative': a['futureTargetHeight']='-1'
elif kind=='unknown': a['unexpected']='not authority'
raw=json.dumps(a,separators=(',',':'))
if kind=='duplicate': raw=raw.replace('"futureTargetHeight":','"futureTargetHeight":"1","futureTargetHeight":')
open(sys.argv[2],'w').write(raw)
PY
  if bind quiesce "$tmp/halt-negative.json" - - >"$tmp/halt-$mutation.out" 2>"$tmp/halt-$mutation.err"; then fail "accepted halt $mutation"; fi
done
bash -c 'set -Eeuo pipefail; source "$1"; binding="$2"; operator_transition_halt_request' -- "$helper" "$tmp/halt.binding" >"$tmp/halt-request.json"
python3 -B - "$tmp/halt-request.json" "$oldpin" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); assert r==dict(version='YNX-OPERATOR-HEIGHT-HALT/v1',targetHeight='9007199254740993',chainId='ynx_6423-1',genesisSHA256='2'*64,operatorPlanSHA256=sys.argv[2],sessionId='f'*64)
PY
# A new plan may disable or independently replace the old session, but never
# restart against the retained request under the same session/path.
python3 -B - "$tmp/meta" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); old=json.loads((p/'halt/common/operator-plan.json').read_bytes()); new=json.loads((p/'next/common/operator-plan.json').read_bytes()); new['heightHaltSessionId']=old['heightHaltSessionId']
for r in new['roles']: r['heightHaltControlPath']=next(v['heightHaltControlPath'] for v in old['roles'] if v['role']==r['role'])
raw=json.dumps(new,separators=(',',':')).encode(); dest=p/'reused/common/operator-plan.json'; dest.parent.mkdir(parents=True); dest.write_bytes(raw)
a=json.loads((p/'install.json').read_bytes()); a['oldOperatorPlanSHA256']=hashlib.sha256((p/'halt/common/operator-plan.json').read_bytes()).hexdigest(); a['nextOperatorPlanSHA256']=hashlib.sha256(raw).hexdigest(); (p/'reused-install.json').write_text(json.dumps(a))
a['nextOperatorPlanSHA256']=hashlib.sha256((p/'next/common/operator-plan.json').read_bytes()).hexdigest(); (p/'disabled-install.json').write_text(json.dumps(a))
PY
if bind install "$tmp/meta/reused-install.json" "$tmp/meta/reused" "$(sha "$tmp/meta/reused/common/operator-plan.json")" >"$tmp/reused.out" 2>"$tmp/reused.err"; then fail 'retained halt session reused'; fi
bind install "$tmp/meta/disabled-install.json" "$tmp/meta/next" "$newpin" >"$tmp/disabled.binding"
# Independently repinned malformed plans still fail the local exact control
# projection; a role cannot quietly omit or redirect its original session.
for mutation in missing-role wrong-path empty-session; do
  python3 -B - "$tmp/meta" "$mutation" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); old=json.loads((p/'halt/common/operator-plan.json').read_bytes()); kind=sys.argv[2]
if kind=='missing-role': del old['roles'][3]['heightHaltControlPath']
elif kind=='wrong-path': old['roles'][3]['heightHaltControlPath']='/srv/seoul/app/another.json'
else: old['heightHaltSessionId']=''
raw=json.dumps(old,separators=(',',':')).encode(); path=p/'bad-halt/common/operator-plan.json'; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(raw)
a=json.loads((p/'halt-quiesce.json').read_bytes()); a['oldOperatorPlanSHA256']=hashlib.sha256(raw).hexdigest(); (p/'bad-halt-quiesce.json').write_text(json.dumps(a))
PY
  oldpin="$(sha "$tmp/meta/bad-halt/common/operator-plan.json")"; binding_old_package="$tmp/meta/bad-halt"
  if bind quiesce "$tmp/meta/bad-halt-quiesce.json" - - >"$tmp/plan-$mutation.out" 2>"$tmp/plan-$mutation.err"; then fail "accepted halt profile $mutation"; fi
done
oldpin="$saved_oldpin"; binding_old_package="$tmp/meta/old"
python3 -B - "$tmp/meta/quiesce.json" "$tmp/legacy-target.json" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); a['futureTargetHeight']='42'; json.dump(a,open(sys.argv[2],'w'))
PY
if bind quiesce "$tmp/legacy-target.json" - - >"$tmp/legacy-target.out" 2>"$tmp/legacy-target.err"; then fail 'legacy plan claimed height-halt guarantee'; fi

# Execute the actual production publication function on isolated original
# files. Only chown/systemctl are observed stubs; mv/cp/dd/cmp/fsync are real.
# This is not an eight-ELF package verification or real service test.
new_publish_fixture() {
  p="$tmp/publish-$1"; mkdir -p "$p/bin" "$p/candidate/"{bin,scripts,config} "$p/stage/bin" "$p/new/roles/primary/"{scripts,config,systemd} "$p/old/roles/primary/config" "$p/systemd" "$p/attempt" "$p/original"
  for rel in bin/ynx-comet bin/ynx-consensus-keycheck scripts/start-operator.sh role-manifest.json config/genesis.json config/bound-migration.json; do printf 'original-%s\n' "$rel" >"$p/candidate/$rel"; done
  cp "$p/candidate/config/"* "$p/old/roles/primary/config/"
  printf 'old normal operator unit\n' >"$p/systemd/ynx-consensus-operator-candidate.service"
  printf 'existing gateway ORIGINAL SAME INODE\n' >"$p/candidate/bin/ynx-bft-gatewayd"
  for f in App Home HRS PQHRS vault UNKNOWN; do printf 'retained original %s\n' "$f" >"$p/original/$f"; done
  printf 'new normal comet\n' >"$p/stage/bin/ynx-comet"; printf 'new normal keycheck\n' >"$p/stage/bin/ynx-consensus-keycheck"
  for rel in scripts/start-operator.sh role-manifest.json config/genesis.json config/bound-migration.json config/pq-engine-schedule.json systemd/ynx-consensus-operator-candidate.service; do printf 'new independently verified %s\n' "$rel" >"$p/new/roles/primary/$rel"; done
  cat >"$p/bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$#" == 1 && "$1" == daemon-reload ]]; then printf 'daemon-reload\n' >>"$FIX_LOG"; exit 0; fi
[[ "$#" == 5 && "$1" == show && "$2" == --property && "$4" == --value && "$5" == ynx-consensus-operator-candidate.service ]]
case "$3" in
FragmentPath) printf '%s/systemd/%s\n' "$FIX_ROOT" "$5" ;;
DropInPaths) printf '\n' ;;
ExecStart) printf '{ path=%s/candidate/scripts/start-operator.sh ; argv[]=fixture ; }\n' "$FIX_ROOT" ;;
*) exit 90 ;;
esac
SH
  cat >"$p/bin/chown" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == root:root || "$1" == ynx:ynx ]]
test -f "$2"
SH
  cat >"$p/bin/dd" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${FIX_FAIL_NEW_COMET:-0}" == 1 && "$*" == *'/stage/bin/ynx-comet'* ]]; then echo 'source control retained copy failure' >&2; exit 74; fi
exec /usr/bin/dd "$@"
SH
  chmod 0755 "$p/bin/"*
  (cd "$p/original" && sha256sum *) >"$p/original.sha256"
  (cd "$p/candidate" && find . -type f ! -name ynx-bft-gatewayd -print0 | sort -z | xargs -0 sha256sum) >"$p/old.sha256"
  gateway_inode="$(stat -c %d:%i "$p/candidate/bin/ynx-bft-gatewayd")"; gateway_hash="$(sha "$p/candidate/bin/ynx-bft-gatewayd")"
}
publish() {
  PATH="$p/bin:$PATH" FIX_LOG="$p/log" bash -c 'set -Eeuo pipefail; source "$1"; root="$2"; candidate="$root/candidate"; unit=ynx-consensus-operator-candidate.service; unit_path="$root/systemd/$unit"; tx=source-control-transition; role=primary; stage="$root/stage"; old_package="$root/old"; new_package="$root/new"; attempt="$root/attempt"; operator_transition_publish' -- "$helper" "$p"
}
assert_originals() {
  (cd "$p/original" && sha256sum -c "$p/original.sha256" >/dev/null)
  [[ "$(stat -c %d:%i "$p/candidate/bin/ynx-bft-gatewayd")" == "$gateway_inode" && "$(sha "$p/candidate/bin/ynx-bft-gatewayd")" == "$gateway_hash" ]] || fail 'gateway source inode changed'
  (cd "$p/candidate.retained-source-control-transition" && sha256sum -c "$p/old.sha256" >/dev/null) || fail 'old operator bytes were lost'
  grep -Fxq 'old normal operator unit' "$p/systemd/ynx-consensus-operator-candidate.service.retained-source-control-transition"
}
new_publish_fixture success
publish >"$p/stdout" 2>"$p/stderr"
assert_originals
cmp "$p/stage/bin/ynx-comet" "$p/candidate/bin/ynx-comet"
cmp "$p/new/roles/primary/systemd/ynx-consensus-operator-candidate.service" "$p/systemd/ynx-consensus-operator-candidate.service"
[[ "$(grep -c daemon-reload "$p/log")" == 2 ]]
installed_control() {
  PATH="$p/bin:$PATH" FIX_ROOT="$p" bash -c 'set -Eeuo pipefail; source "$1"; candidate="$2/candidate"; unit=ynx-consensus-operator-candidate.service; unit_path="$2/systemd/$unit"; role=primary; operator_transition_installed "$2/new" "$3" "$4"' -- "$helper" "$p" "$(sha "$p/stage/bin/ynx-comet")" "$(sha "$p/stage/bin/ynx-consensus-keycheck")"
}
installed_control >"$p/installed.stdout" 2>"$p/installed.error"
printf 'substituted keycheck must fail before start\n' >"$p/candidate/bin/ynx-consensus-keycheck"
if installed_control >"$p/keycheck.stdout" 2>"$p/keycheck.error"; then fail 'installed keycheck differed from independent runtime pin'; fi
cp "$p/stage/bin/ynx-consensus-keycheck" "$p/candidate/bin/ynx-consensus-keycheck"
installed_control >"$p/restored.stdout" 2>"$p/restored.error"
if publish >"$p/retry.stdout" 2>"$p/retry.error"; then fail 'existing retained/UNKNOWN profile was overwritten'; fi
assert_originals
new_publish_fixture partial
export FIX_FAIL_NEW_COMET=1
if publish >"$p/stdout" 2>"$p/stderr"; then fail 'partial copy reported success'; fi
unset FIX_FAIL_NEW_COMET
assert_originals
test ! -e "$p/systemd/ynx-consensus-operator-candidate.service" || fail 'partial profile published a runnable new unit'
if publish >"$p/retry.stdout" 2>"$p/retry.error"; then fail 'partial transition auto-resumed'; fi

# Failure at the normal checkpoint command must return its original code and
# retain its partial archive, without manufacturing JSON or restarting a node.
mkdir -p "$tmp/inspect/stage/bin" "$tmp/inspect/old/roles/primary/config"
cat >"$tmp/inspect/stage/bin/ynx-comet" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == inspect-operator-checkpoint ]]
printf '%s\n' "$*" >"$FIX_INSPECT_LOG"
while (($#)); do if [[ "$1" == --backup-output ]]; then printf 'retained partial UNKNOWN\n' >"$2.partial"; fi; shift; done
exit 73
SH
chmod 0755 "$tmp/inspect/stage/bin/ynx-comet"
if FIX_INSPECT_LOG="$tmp/inspect/argv" bash -c 'set -Eeuo pipefail; source "$1"; binding="$2"; stage="$3/stage"; old_package="$3/old"; role=primary; home=/srv/primary/comet; state=/srv/primary/app/state; signing_state=/srv/primary/keys/hrs; operator_transition_inspect "$3/result.json" "" "$3/original.tar.gz"' -- "$helper" "$tmp/quiesce.binding" "$tmp/inspect" >"$tmp/inspect/out" 2>"$tmp/inspect/err"; then fail 'checkpoint failure accepted'; else code="$?"; fi
[[ "$code" == 73 ]] || fail 'checkpoint first cause changed'
grep -Fq 'retained partial UNKNOWN' "$tmp/inspect/original.tar.gz.partial"
test ! -s "$tmp/inspect/result.json"
grep -Fq -- '--signing-state /srv/primary/keys/hrs' "$tmp/inspect/argv"
grep -Fq -- '--comet-data-dir /srv/primary/comet/data' "$tmp/inspect/argv"
grep -Fq -- '--backup-legacy-key /srv/primary/keys/pv' "$tmp/inspect/argv"
grep -Fq -- '--backup-node-key /srv/primary/keys/node' "$tmp/inspect/argv"

# The actual inspect-output validator must check observed DB height, including
# integers above 2^53, before the remote flow reaches its backup call.
cp "$tmp/inspect/stage/bin/ynx-comet" "$tmp/inspect/failure-callee"
cat >"$tmp/inspect/stage/bin/ynx-comet" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == inspect-operator-checkpoint && "$*" != *--backup-output* ]]
python3 -B - "$FIX_CHECKPOINT_BINDING" "$FIX_CHECKPOINT_HEIGHT" <<'PY'
import json,sys
b=json.load(open(sys.argv[1])); r={k:b[k] for k in ('chainId','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','stateLayout')}
r.update(version='YNX-OPERATOR-CHECKPOINT/v1',readOnly=True,sourceReadOnly=True,writerExcluded=True,signingWriterExcluded=True,engineCheckpointVerified=True,pqActivationVerified=False,committedScheduleHash=None,nextScheduleHash=None,height=sys.argv[2])
print(json.dumps(r))
PY
SH
chmod 0755 "$tmp/inspect/stage/bin/ynx-comet"
for height in 9007199254740993 9007199254740992 9007199254740994; do
  if FIX_CHECKPOINT_BINDING="$tmp/halt.binding" FIX_CHECKPOINT_HEIGHT="$height" bash -c 'set -Eeuo pipefail; source "$1"; binding="$2"; stage="$3/stage"; old_package="$3/old"; role=primary; home=/srv/primary/comet; state=/srv/primary/app/state; signing_state=/srv/primary/keys/hrs; operator_transition_inspect "$3/checkpoint-$4.json"' -- "$helper" "$tmp/halt.binding" "$tmp/inspect" "$height" >"$tmp/inspect/$height.out" 2>"$tmp/inspect/$height.err"; then code=0; else code="$?"; fi
  if [[ "$height" == 9007199254740993 ]]; then [[ "$code" == 0 ]]; else [[ "$code" != 0 ]]; fi
done

# Source-qualified process and terminal-state controls use ONLY synthetic
# proc/cgroup files. In particular cgroup.procs must be READ, not stat(size).
q="$tmp/process"; mkdir -p "$q/bin" "$q/proc/4321" "$q/cgroup/source-test" "$q/candidate/"{bin,scripts}
sed -e "s#/proc/#$q/proc/#g" -e "s#/sys/fs/cgroup#$q/cgroup#g" "$helper" >"$q/helper.sh"
printf 'normal fixture ELF bytes, never executed\n' >"$q/candidate/bin/ynx-comet"
printf "exec env -i PATH=/usr/bin:/bin '%s' 'start' '--home' '/original/home'\n" "$q/candidate/bin/ynx-comet" >"$q/candidate/scripts/start-operator.sh"
ln -s "$q/candidate/bin/ynx-comet" "$q/proc/4321/exe"
printf '%s\0start\0--home\0/original/home\0' "$q/candidate/bin/ynx-comet" >"$q/proc/4321/cmdline"
printf 'PATH=/usr/bin:/bin\0' >"$q/proc/4321/environ"
{ printf '4321 (ynx-comet) S'; for _n in {1..18}; do printf ' 0'; done; printf ' 987\n'; } >"$q/proc/4321/stat"
printf '4321\n' >"$q/cgroup/source-test/cgroup.procs"
cat >"$q/bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
test "${*: -1}" = ynx-consensus-operator-candidate.service
if [[ "$1" == is-active ]]; then [[ "${FIX_PROCESS_STOPPED:-0}" != 1 ]]; exit; fi
[[ "$1" == show && "$2" == --property && "$4" == --value ]]
case "$3" in
MainPID) if [[ "${FIX_PROCESS_STOPPED:-0}" == 1 ]]; then echo 0; else echo 4321; fi ;;
ActiveState) if [[ "${FIX_PROCESS_STOPPED:-0}" == 1 ]]; then echo inactive; else echo active; fi ;;
ControlGroup) echo /source-test ;;
Result) echo "${FIX_EXIT_RESULT:-success}" ;;
ExecMainCode) echo 1 ;;
ExecMainStatus) echo "${FIX_EXIT_STATUS:-0}" ;;
*) exit 90 ;;
esac
SH
chmod 0755 "$q/bin/systemctl"
process_control() {
  PATH="$q/bin:$PATH" bash -c 'set -Eeuo pipefail; source "$1"; candidate="$2/candidate"; unit=ynx-consensus-operator-candidate.service; if [[ "$3" == stopped ]]; then operator_transition_stopped; else operator_transition_running "$4"; fi' -- "$q/helper.sh" "$q" "$1" "$(sha "$q/candidate/bin/ynx-comet")"
}
process_control running >"$q/positive.json"
grep -Fq '"mainPid":"4321"' "$q/positive.json"
grep -Fq '"startTicks":"987"' "$q/positive.json"
cp "$q/proc/4321/cmdline" "$q/cmdline-original"
printf '%s\0start\0--home\0/substituted/home\0' "$q/candidate/bin/ynx-comet" >"$q/proc/4321/cmdline"
if process_control running >"$q/args.log" 2>&1; then fail 'same binary with wrong actual startup arguments accepted'; fi
cp "$q/cmdline-original" "$q/proc/4321/cmdline"
printf 'PATH=/usr/bin:/bin\0UNAPPROVED=fixture\0' >"$q/proc/4321/environ"
if process_control running >"$q/env.log" 2>&1; then fail 'unapproved inherited environment accepted'; fi
printf 'PATH=/usr/bin:/bin\0' >"$q/proc/4321/environ"
export FIX_PROCESS_STOPPED=1
if process_control stopped >"$q/children.log" 2>&1; then fail 'inactive MainPID0 concealed a remaining owned cgroup process'; fi
: >"$q/cgroup/source-test/cgroup.procs"
process_control stopped >"$q/stopped.log"
unset FIX_PROCESS_STOPPED
if process_control stopped >"$q/active.log" 2>&1; then fail 'active original writer reported stopped'; fi

# Actual wait function, synthetic proc/systemd only. Sleep is a no-op control;
# its 60 bounded observations are retained. No stop/kill command is accepted
# by the stub, so success cannot come from forcing the operator down.
mkdir -m 0700 "$q/attempt"
cp "$q/positive.json" "$q/attempt/original-process.json"
cat >"$q/bin/sleep" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$#" == 1 && "$1" == 1 ]]
printf 'wait\n' >>"$FIX_WAIT_LOG"
SH
chmod 0755 "$q/bin/sleep"
halt_wait() {
  PATH="$q/bin:$PATH" FIX_WAIT_LOG="$q/waits" bash -c 'set -Eeuo pipefail; source "$1"; unit=ynx-consensus-operator-candidate.service; attempt="$2/attempt"; operator_transition_wait_height_halt' -- "$q/helper.sh" "$q"
}
export FIX_PROCESS_STOPPED=1
halt_wait >"$q/halt-stopped.out" 2>"$q/halt-stopped.err"
export FIX_EXIT_STATUS=1
if halt_wait >"$q/halt-failed.out" 2>"$q/halt-failed.err"; then fail 'nonzero normal caller exit was accepted as halt'; fi
unset FIX_EXIT_STATUS
printf '4321\n' >"$q/cgroup/source-test/cgroup.procs"
if halt_wait >"$q/halt-child.out" 2>"$q/halt-child.err"; then fail 'halt accepted with remaining cgroup child'; fi
: >"$q/cgroup/source-test/cgroup.procs"
unset FIX_PROCESS_STOPPED
if halt_wait >"$q/halt-timeout.out" 2>"$q/halt-timeout.err"; then fail 'live operator timeout reported stopped'; fi
grep -Fq HEIGHT_HALT_OUTCOME_UNKNOWN "$q/halt-timeout.err"
[[ "$(wc -l <"$q/waits" | tr -d ' ')" == 59 ]]
cp "$q/proc/4321/stat" "$q/stat-original"
sed 's/ 987$/ 988/' "$q/stat-original" >"$q/proc/4321/stat"
if halt_wait >"$q/halt-replaced.out" 2>"$q/halt-replaced.err"; then fail 'reused PID with different startTicks accepted'; fi
grep -Fq 'process identity changed' "$q/halt-replaced.err"
cp "$q/stat-original" "$q/proc/4321/stat"

# Execute the normal two-round orchestrator with a transport-only fixture.
# Every completed preparation represents a source/freeze receipt, not a fake
# consensus checkpoint. A failed prepare must prevent ALL second dispatches.
for result in pass failure; do
  mkdir -m 0700 "$tmp/barrier-$result"
  if bash -c '
set -Eeuo pipefail
source "$1"
root="$2"; fixture="$3"; transition_action=run
ynx_ops_each_node() { local r; for r in primary singapore silicon-valley seoul; do "$1" "$r" fixture fixture fixture fixture; done; }
dispatch_operator_transition() {
  local r="$1" other
  if [[ "$transition_action" == prepare ]]; then
    if [[ "$fixture" == failure && "$r" == seoul ]]; then printf "retained prepare UNKNOWN\n" >"$root/$r.partial"; return 74; fi
    printf "source and freeze prepared\n" >"$root/$r.prepared"
  else
    for other in primary singapore silicon-valley seoul; do test -f "$root/$other.prepared"; done
    printf "single completion dispatched\n" >"$root/$r.complete"
  fi
}
operator_transition_quiesce_all
' -- "$repo/scripts/ops/public-bft-operator-transition.sh" "$tmp/barrier-$result" "$result" >"$tmp/barrier-$result/out" 2>"$tmp/barrier-$result/err"; then code=0; else code="$?"; fi
  if [[ "$result" == pass ]]; then
    [[ "$code" == 0 ]]; for role in primary singapore silicon-valley seoul; do test -f "$tmp/barrier-$result/$role.complete"; done
  else
    [[ "$code" == 74 && -f "$tmp/barrier-$result/seoul.partial" ]]
    [[ -z "$(find "$tmp/barrier-$result" -name '*.complete' -print)" ]] || fail 'failed preparation dispatched a halt/stop'
  fi
done
mkdir -m 0700 "$tmp/completion"
printf '{"status":"prepared_not_stopped"}' >"$tmp/completion/prepared.json"
completion() { bash -c 'set -Eeuo pipefail; source "$1"; attempt="$2"; operator_transition_begin_completion' -- "$helper" "$tmp/completion"; }
completion
printf 'original uncertain effect\n' >"$tmp/completion/complete-attempt/UNKNOWN"
if completion >"$tmp/completion/retry.out" 2>"$tmp/completion/retry.err"; then fail 'completion could be repeated'; fi
grep -Fxq 'original uncertain effect' "$tmp/completion/complete-attempt/UNKNOWN"

# The real caller invokes the normal publisher once as the original App uid.
# Here only the executable/runuser/chown/id are explicit source fixtures; the
# actual atomic rename/no-replace implementation has its own normal Go tests.
for outcome in success failure wrong-height; do
  h="$tmp/halt-publish-$outcome"; mkdir -m 0700 "$h" "$h/app" "$h/attempt" "$h/bin" "$h/stage" "$h/stage/bin"
  printf 'original App retained' >"$h/app/state"; chmod 0600 "$h/app/state"
  python3 -B - "$tmp/halt.binding" "$h" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[2]); b=json.load(open(sys.argv[1])); b['originalRole']['abciState']=str(p/'app/state'); b['originalRole']['heightHaltControlPath']=str(p/'app'/('operator-height-halt-'+b['heightHaltSessionId']+'.json')); (p/'binding.json').write_text(json.dumps(b))
PY
  cat >"$h/stage/bin/ynx-comet" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == request-height-halt ]]; shift
printf 'publisher once\n' >>"$FIX_PUBLISH_LOG"
python3 -B - "$FIX_PUBLISH_OUTCOME" "$@" <<'PY'
import hashlib,json,pathlib,sys
kind=sys.argv[1]; args=sys.argv[2:]; assert len(args)==16
a=dict(zip(args[::2],args[1::2])); assert len(a)==8
assert set(a)=={'--request','--request-sha256','--abci-state','--height-halt-control','--chain-id','--consensus-genesis-sha256','--operator-plan-sha256','--height-halt-session-id'}
raw=pathlib.Path(a['--request']).read_bytes(); assert hashlib.sha256(raw).hexdigest()==a['--request-sha256']; r=json.loads(raw); target=pathlib.Path(a['--height-halt-control'])
if kind=='failure':
    target.with_suffix('.json.partial').write_bytes(b'fixture retained UNKNOWN'); raise SystemExit(73)
with target.open('xb') as f: f.write(raw)
target.chmod(0o600)
print(json.dumps(dict(version='YNX-OPERATOR-HEIGHT-HALT-PUBLISHED/v1',controlPath=str(target),requestSHA256=a['--request-sha256'],targetHeight='1' if kind=='wrong-height' else r['targetHeight'],chainId=r['chainId'],genesisSHA256=r['genesisSHA256'],operatorPlanSHA256=r['operatorPlanSHA256'],sessionId=r['sessionId'],published=True,nodeStopped=False,activation=False)))
PY
SH
  cat >"$h/bin/runuser" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == -u && "$2" == ynx && "$3" == -- && "$4" == env && "$5" == -i && "$6" == PATH=/usr/bin:/bin ]]
shift 6
exec "$@"
SH
  cat >"$h/bin/id" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$*" == '-u ynx' ]]; then exec /usr/bin/id -u; fi
exec /usr/bin/id "$@"
SH
  cat >"$h/bin/chown" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == ynx:ynx && "$#" == 4 ]]
SH
  chmod 0755 "$h/bin/"* "$h/stage/bin/ynx-comet"
  publish_halt() {
    PATH="$h/bin:$PATH" FIX_PUBLISH_LOG="$h/once" FIX_PUBLISH_OUTCOME="$outcome" bash -c 'set -Eeuo pipefail; umask 077; source "$1"; binding="$2/binding.json"; state="$2/app/state"; attempt="$2/attempt"; stage="$2/stage"; comet_pin="$(operator_transition_sha "$stage/bin/ynx-comet")"; operator_transition_request_height_halt' -- "$helper" "$h"
  }
  state_sha="$(sha "$h/app/state")"
  if publish_halt >"$h/out" 2>"$h/err"; then code=0; else code="$?"; fi
  if [[ "$outcome" == success ]]; then [[ "$code" == 0 ]]; else [[ "$code" != 0 ]]; fi
  if [[ "$outcome" == failure ]]; then [[ "$code" == 73 ]]; grep -Fq 'fixture retained UNKNOWN' "$h/app/"*.partial; fi
  [[ "$(sha "$h/app/state")" == "$state_sha" && "$(wc -l <"$h/once" | tr -d ' ')" == 1 ]]
  original_request="$(sha "$h/attempt/halt-request.json")"
  if publish_halt >"$h/retry.out" 2>"$h/retry.err"; then fail 'halt publisher was resent'; fi
  [[ "$(wc -l <"$h/once" | tr -d ' ')" == 1 && "$(sha "$h/attempt/halt-request.json")" == "$original_request" && "$(sha "$h/app/state")" == "$state_sha" ]]
done

# The real freeze publisher must retain exact approved bytes and a different
# original native pause transaction. A rejected/redirected probe cannot become
# a success merely because the second gateway probe returns 503.
f="$tmp/freeze"; mkdir -p "$f/native" "$f/stage/freeze-markers" "$f/attempt" "$f/bin"
sed "s#/var/lib/ynx-chain#$f/native#g" "$helper" >"$f/helper.sh"
printf '{"transactionId":"source-control-transition","role":"primary","frozenAt":"explicit-owner-value"}' >"$f/stage/freeze-markers/primary.json"
printf '{"transactionId":"source-original-cutover","pausedAt":"retained-original"}' >"$f/native/block-production-pause.json"
python3 -B - "$tmp/quiesce.binding" "$f" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[2]); b=json.load(open(sys.argv[1])); b['freezeSHA256']=hashlib.sha256((p/'stage/freeze-markers/primary.json').read_bytes()).hexdigest(); b['nativePauseSHA256']=hashlib.sha256((p/'native/block-production-pause.json').read_bytes()).hexdigest(); (p/'binding.json').write_text(json.dumps(b))
PY
cat >"$f/bin/curl" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'probe %s\n' "${*: -1}" >>"$FIX_PROBE_LOG"
output=; while (($#)); do if [[ "$1" == --output ]]; then output="$2"; shift; fi; shift; done
test -n "$output"
printf '{"status":"mutation_frozen"}' >"$output"
printf '%s' "${FIX_HTTP_STATUS:-503}"
SH
chmod 0755 "$f/bin/curl"
freeze_control() {
  PATH="$f/bin:$PATH" FIX_PROBE_LOG="$f/probes" bash -c 'set -Eeuo pipefail; source "$1/helper.sh"; binding="$1/binding.json"; stage="$1/stage"; attempt="$1/attempt"; role=primary; operator_transition_freeze' -- "$f"
}
pause_sha="$(sha "$f/native/block-production-pause.json")"
freeze_control >"$f/good.out" 2>"$f/good.err"
cmp "$f/stage/freeze-markers/primary.json" "$f/native/mutation-freeze.json"
[[ "$(sha "$f/native/block-production-pause.json")" == "$pause_sha" ]]
export FIX_HTTP_STATUS=302
if freeze_control >"$f/redirect.out" 2>"$f/redirect.err"; then fail 'redirected freeze probe accepted'; fi
unset FIX_HTTP_STATUS
cmp "$f/stage/freeze-markers/primary.json" "$f/native/mutation-freeze.json"
printf 'retain foreign UNKNOWN freeze' >"$f/native/mutation-freeze.json"
foreign_sha="$(sha "$f/native/mutation-freeze.json")"
if freeze_control >"$f/foreign.out" 2>"$f/foreign.err"; then fail 'existing foreign marker replaced'; fi
[[ "$(sha "$f/native/mutation-freeze.json")" == "$foreign_sha" && "$(sha "$f/native/block-production-pause.json")" == "$pause_sha" ]]

echo 'operator transition source controls passed: independent pins, common approved halt target, four-role prepare barrier, one-shot publication, normal-exit boundary, exact int64 checkpoint/P/U/A, original inode/HRS preservation, partial/UNKNOWN refusal; no real package/service/activation claim'
