#!/usr/bin/env bash
set -Eeuo pipefail

# Existing single-App profile transition. This is NOT the native fresh-import
# path. All artifacts and failed attempts remain; there is no rollback/retry.
operator_transition_fail() { echo "operator transition refused: $*" >&2; return 1; }
operator_transition_sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'; }
operator_transition_file() {
  python3 -B - "$1" <<'PYFILE'
import pathlib,stat,sys
p=pathlib.Path(sys.argv[1]);s=p.lstat()
assert p.is_absolute() and str(p.resolve(strict=True))==str(p) and stat.S_ISREG(s.st_mode) and s.st_nlink==1
PYFILE
}

# The package verifier authenticates all original plan bytes before this
# projection. Python integers preserve int64 heights; no JavaScript rounding.
operator_transition_binding() {
  python3 -B - "$@" <<'PY'
import base64, hashlib, json, pathlib, re, sys
def need(ok, why):
    if not ok: raise ValueError(why)
def unique(pairs):
    d={}
    for k,v in pairs:
        need(k not in d, 'duplicate JSON field'); d[k]=v
    return d
def read(p):
    p=pathlib.Path(p); info=p.lstat()
    need(p.is_file() and not p.is_symlink() and 0<info.st_size<=96<<20,'bounded original public input required')
    raw=p.read_bytes()
    return raw,json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('invalid number')))
def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(s): return type(s) is str and re.fullmatch('[0-9a-f]{64}',s) and s!='0'*64
def decimal(s): return type(s) is str and re.fullmatch('[1-9][0-9]*',s) and int(s)<=2**63-1
def runtime_profile(source):
    profiles={
        'YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2': {'internal/consensus/pq_light_proof.go','cmd/ynx-consensus-proof-verify/main.go','cmd/ynx-consensus-proof-verify/trust.go'},
        'YNX-PQ-LINUX-RUNTIME-CANDIDATE/v3': {'internal/consensus/pq_light_proof.go','cmd/ynx-consensus-proof-verify/main.go','cmd/ynx-consensus-proof-verify/trust.go','cmd/ynx-consensus-proof-verify/portable_import.go'},
    }
    need(source.get('version') in profiles and source.get('platform')=='linux/amd64','normal versioned runtime required')
    sources=source.get('proofVerifierSources')
    need(source.get('proofVerifierContract')=='YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1' and type(sources) is dict and set(sources)==profiles[source['version']],'version-specific proof verifier sources required')
    for value in sources.values():
        need(type(value) is dict and set(value)=={'bytes','sha256'} and type(value['bytes']) is int and 0<value['bytes']<=16<<20 and pin(value['sha256']),'original proof verifier source pin required')
try:
    phase,tx,role,approval,approvalpin,oldpkg,oldpin,oldsource,oldcommit,oldmanifest,newpkg,newpin,source,commit,manifest=sys.argv[1:]
    roles=('primary','singapore','silicon-valley','seoul')
    need(phase in ('quiesce','install','start') and role in roles and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}',tx),'invalid phase/identity')
    for s in (approvalpin,oldpin,oldmanifest,manifest): need(pin(s),'missing independent pin')
    raw,a=read(approval); need(sha(raw)==approvalpin,'approval differs from external pin')
    keys={'version','transitionId','phase','approved','oldOperatorPlanSHA256','oldRuntimeCommit','oldRuntimeManifestSHA256','nextOperatorPlanSHA256','runtimeCommit','runtimeManifestSHA256','cutoverTransactionId','freezeSHA256','nativePauseSHA256','checkpoint','backups'}
    need(set(a) in (keys,keys|{'futureTargetHeight'}) and a['version']=='YNX-OPERATOR-TRANSITION-APPROVAL/v1' and a['transitionId']==tx and a['phase']==phase and a['approved'] is True,'exact phase approval required')
    need((a['oldOperatorPlanSHA256'],a['oldRuntimeCommit'],a['oldRuntimeManifestSHA256'],a['runtimeCommit'],a['runtimeManifestSHA256'])==(oldpin,oldcommit,oldmanifest,commit,manifest),'approval/runtime/old plan mismatch')
    need(re.fullmatch('[0-9a-f]{40}',commit) and re.fullmatch('[0-9a-f]{40}',oldcommit),'full runtime commits required')
    need(type(a['freezeSHA256']) is dict and set(a['freezeSHA256'])==set(roles) and all(pin(v) for v in a['freezeSHA256'].values()) and pin(a['nativePauseSHA256']),'all original freeze/pause pins required')
    need(re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}',a['cutoverTransactionId']),'original cutover identity required')
    oldraw,old=read(pathlib.Path(oldpkg)/'common/operator-plan.json'); need(sha(oldraw)==oldpin,'old plan pin mismatch')
    oldraw,oldsrc=read(oldsource); need(sha(oldraw)==oldmanifest and oldsrc['commit']==oldcommit,'old runtime pin mismatch')
    raw,src=read(source); need(sha(raw)==manifest and src['commit']==commit,'runtime pin mismatch')
    for s in (oldsrc,src): runtime_profile(s)
    need(old['version']=='YNX-PRODUCTION-OPERATOR/v1' and not old['pqSchedule'] and not old['pqScheduleHash'],'only the original bootstrap/runtime to first-PQ transition is supported; no schedule rollback')
    oldroles={r['role']:r for r in old['roles']}; need(set(oldroles)==set(roles),'original four roles required')
    def halt_profile(plan):
        session=plan.get('heightHaltSessionId','')
        need(type(session) is str and (session=='' or pin(session)),'invalid halt session')
        for entry in plan['roles']:
            path=entry.get('heightHaltControlPath','')
            want=str(pathlib.PurePosixPath(entry['abciState']).parent/('operator-height-halt-'+session+'.json')) if session else ''
            need(type(path) is str and path==want,'partial or mismatched halt control path')
        return session
    halt_session=halt_profile(old)
    quiet=old.get('bootstrapRegistrationMode','')
    need(type(quiet) is str and quiet in ('','quiet-first-registration-v1') and not (quiet and halt_session),'invalid quiet bootstrap profile or unreachable future halt')
    future=a.get('futureTargetHeight')
    if phase=='quiesce' and halt_session:
        need(decimal(future) and int(future)<2**63-1,'enabled halt requires one independently approved futureTargetHeight string')
    else:
        need('futureTargetHeight' not in a,'future target is only valid for an enabled quiesce plan')
    target=old; schedule=None
    if phase=='quiesce':
        need(newpkg=='-' and newpin=='-' and a['nextOperatorPlanSHA256'] is None and a['checkpoint'] is None and a['backups'] is None,'quiesce cannot assert a future self-trusted checkpoint')
    else:
        need(pin(newpin) and a['nextOperatorPlanSHA256']==newpin,'new independent plan pin required')
        raw,target=read(pathlib.Path(newpkg)/'common/operator-plan.json'); need(sha(raw)==newpin,'new plan pin mismatch')
        next_session=halt_profile(target)
        need(target.get('bootstrapRegistrationMode','')=='','first PQ activation must restore normal automatic block production')
        need(not halt_session or next_session!=halt_session,'retained halt request requires a new independent session/path or disabled control')
        for k in ('version','chainId','validatorManifestSHA256','consensusGenesis','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','stateLayout','runtimePlan','runtimePlanHash'):
            need(old[k]==target[k],'original identity/layout/runtime changed: '+k)
        newroles={r['role']:r for r in target['roles']}; need(set(newroles)==set(roles),'new role set changed')
        for name in roles:
            for k in ('role','home','abciState','legacyKeyPath','legacyStatePath','nodeKeyPath'):
                need(oldroles[name][k]==newroles[name][k],'original state/custody path changed: '+name+'/'+k)
        schedule=json.loads(base64.b64decode(target['pqSchedule'],validate=True),object_pairs_hook=unique)
        cp=a['checkpoint']; need(type(cp) is dict and set(cp)=={'height','appHash','registryRoot','registryEventCount'} and decimal(cp['height']) and decimal(cp['registryEventCount']) and pin(cp['appHash']) and pin(cp['registryRoot']),'independent stopped checkpoint required')
        need(schedule['registryHeight']==int(cp['height']) and schedule['registryRoot']==cp['registryRoot'] and schedule['registryEventCount']==int(cp['registryEventCount']),'new schedule differs from approved exact committed registry')
        need(schedule['authorizedAt']==int(cp['height'])+1 and schedule['paramsUpdateHeight']==schedule['authorizedAt'] and schedule['validatorUpdateHeight']==schedule['activationHeight']-2 and schedule['activationHeight']>=schedule['authorizedAt']+3,'P/U/A order differs')
        need(type(a['backups']) is dict and set(a['backups'])==set(roles) and all(pin(v) for v in a['backups'].values()),'independent original stopped backup pins required')
    r=oldroles[role]
    for k in ('home','abciState','legacyKeyPath','legacyStatePath','nodeKeyPath'):
        need(re.fullmatch('/[A-Za-z0-9_./-]+',r[k]) and str(pathlib.PurePosixPath(r[k]))==r[k] and '..' not in pathlib.PurePosixPath(r[k]).parts,'unsafe original path')
    out=dict(version='YNX-OPERATOR-TRANSITION-BINDING/v1',phase=phase,transitionId=tx,role=role,approvalSHA256=approvalpin,oldOperatorPlanSHA256=oldpin,nextOperatorPlanSHA256=None if newpin=='-' else newpin,oldRuntimeCommit=oldcommit,oldRuntimeManifestSHA256=oldmanifest,runtimeCommit=commit,runtimeManifestSHA256=manifest,oldCometSHA256=oldsrc['binaries']['ynx-comet']['sha256'],cometSHA256=src['binaries']['ynx-comet']['sha256'],packageVerifierSHA256=src['binaries']['ynx-consensus-package']['sha256'],keycheckSHA256=src['binaries']['ynx-consensus-keycheck']['sha256'],originalRole=r,chainId=old['chainId'],consensusGenesisSHA256=old['consensusGenesisSHA256'],originalGenesisHash=old['originalGenesisHash'],migrationStateHash=old['migrationStateHash'],stateLayout=old['stateLayout'],runtimePlanHash=old['runtimePlanHash'],scheduleHash=target['pqScheduleHash'],schedule=schedule,checkpoint=a['checkpoint'],backupSHA256=None if a['backups'] is None else a['backups'][role],cutoverTransactionId=a['cutoverTransactionId'],freezeSHA256=a['freezeSHA256'][role],nativePauseSHA256=a['nativePauseSHA256'])
    out['oldKeycheckSHA256']=oldsrc['binaries']['ynx-consensus-keycheck']['sha256']
    need(all(pin(out[k]) for k in ('oldCometSHA256','oldKeycheckSHA256','cometSHA256','packageVerifierSHA256','keycheckSHA256')),'full binary pins required')
    out.update(quiesceMode='height-halt' if halt_session else 'parallel-stop',heightHaltSessionId=halt_session,futureTargetHeight=future)
    print(json.dumps(out,separators=(',',':'),sort_keys=True))
except (ValueError,KeyError,TypeError,OSError) as e:
    print('operator transition binding rejected: '+str(e),file=sys.stderr); sys.exit(1)
PY
}

operator_transition_value() {
  python3 -B - "$binding" "$1" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
for key in sys.argv[2].split('.'): v=v[key]
if isinstance(v,(dict,list)) or v is None: raise SystemExit('expected bound scalar')
print(v)
PY
}

operator_transition_installed() {
  local package="$1" wanted="$2" wanted_keycheck="$3" expected file
  expected="$package/roles/$role"
  operator_transition_file "$unit_path"
  cmp "$unit_path" "$expected/systemd/$unit" >/dev/null
  [[ "$(systemctl show --property FragmentPath --value "$unit")" == "$unit_path" && -z "$(systemctl show --property DropInPaths --value "$unit")" ]]
  [[ "$(systemctl show --property ExecStart --value "$unit")" == *"path=$candidate/scripts/start-operator.sh ;"* ]]
  for file in role-manifest.json scripts/start-operator.sh; do operator_transition_file "$candidate/$file"; cmp "$candidate/$file" "$expected/$file" >/dev/null; done
  for file in "$expected"/config/*; do operator_transition_file "$candidate/config/$(basename "$file")"; cmp "$file" "$candidate/config/$(basename "$file")" >/dev/null; done
  # Check the complete names directly: subprocess-listing errors must not
  # compare as two empty lists, including on a non-GNU control-test host.
  python3 -B - "$expected/config" "$candidate/config" <<'PYCONFIG' || return $?
import pathlib,sys
assert {p.name for p in pathlib.Path(sys.argv[1]).iterdir()} == {p.name for p in pathlib.Path(sys.argv[2]).iterdir()}, 'installed config entries differ'
PYCONFIG
  operator_transition_file "$candidate/bin/ynx-comet"
  operator_transition_file "$candidate/bin/ynx-consensus-keycheck"
  [[ "$(operator_transition_sha "$candidate/bin/ynx-comet")" == "$wanted" && "$(operator_transition_sha "$candidate/bin/ynx-consensus-keycheck")" == "$wanted_keycheck" ]]
}

operator_transition_publish() {
  local archived="$candidate.retained-$tx" archived_unit="$unit_path.retained-$tx" relative source old_target new_file mode owner
  test ! -e "$archived" && test ! -L "$archived" && test ! -e "$archived_unit" && test ! -L "$archived_unit" || operator_transition_fail 'original retained profile/unit already exists'
  mkdir -m 0700 "$archived" "$archived/bin" "$archived/scripts" "$archived/config" "$attempt/new-files"
  # Remove the stopped unit from its load path FIRST, retaining the exact old
  # file. Publish the new unit only after the complete pinned profile exists.
  mv -T -n -- "$unit_path" "$archived_unit"; test ! -e "$unit_path"
  systemctl daemon-reload
  for relative in bin/ynx-comet bin/ynx-consensus-keycheck scripts/start-operator.sh role-manifest.json; do
    operator_transition_file "$candidate/$relative"
    mv -T -n -- "$candidate/$relative" "$archived/$relative"; test ! -e "$candidate/$relative"
  done
  for source in "$old_package/roles/$role"/config/*; do
    relative="config/$(basename "$source")"
    mv -T -n -- "$candidate/$relative" "$archived/$relative"; test ! -e "$candidate/$relative"
  done
  # Never rename candidateRoot or touch its gateway binary: a live gateway's
  # original /proc/exe inode/path and source-qualified unit must stay intact.
  local entries=(bin/ynx-comet bin/ynx-consensus-keycheck scripts/start-operator.sh role-manifest.json)
  for source in "$new_package/roles/$role"/config/*; do entries+=("config/$(basename "$source")"); done
  for relative in "${entries[@]}"; do
    case "$relative" in
      bin/*) source="$stage/$relative"; mode=0755; owner=root:root ;;
      scripts/*) source="$new_package/roles/$role/$relative"; mode=0755; owner=root:root ;;
      *) source="$new_package/roles/$role/$relative"; mode=0600; owner=ynx:ynx ;;
    esac
    new_file="$attempt/new-files/$(printf '%s' "$relative" | tr / _)"
    dd if="$source" of="$new_file" conv=excl,fsync status=none
    cmp "$source" "$new_file" >/dev/null; chmod "$mode" "$new_file"; chown "$owner" "$new_file"
    test ! -e "$candidate/$relative" && test ! -L "$candidate/$relative"
    mv -T -n -- "$new_file" "$candidate/$relative"; test ! -e "$new_file"
  done
  new_file="$attempt/new-files/operator.service"
  dd if="$new_package/roles/$role/systemd/$unit" of="$new_file" conv=excl,fsync status=none
  chmod 0644 "$new_file"; chown root:root "$new_file"
  test ! -e "$unit_path" && test ! -L "$unit_path"
  mv -T -n -- "$new_file" "$unit_path"; test ! -e "$new_file"
  sync -f "$candidate"; sync -f "$(dirname "$unit_path")"
  systemctl daemon-reload
}

operator_transition_running() {
  local wanted="$1" pid before after group
  systemctl is-active --quiet "$unit"
  pid="$(systemctl show --property MainPID --value "$unit")"; [[ "$pid" =~ ^[1-9][0-9]*$ ]]
  before="$(cat "/proc/$pid/stat")"
  [[ "$(operator_transition_sha "/proc/$pid/exe")" == "$wanted" ]]
  [[ "$(readlink "/proc/$pid/exe")" == "$candidate/bin/ynx-comet" ]]
  python3 -B - "$candidate/scripts/start-operator.sh" "/proc/$pid/cmdline" "/proc/$pid/environ" <<'PY'
import pathlib,shlex,sys
lines=[v for v in pathlib.Path(sys.argv[1]).read_text().splitlines() if v.startswith('exec ')]
assert len(lines)==1
tokens=shlex.split(lines[0]); assert tokens[:4]==['exec','env','-i','PATH=/usr/bin:/bin']
argv=pathlib.Path(sys.argv[2]).read_bytes().split(b'\0'); assert argv[-1]==b''
assert argv[:-1]==[s.encode() for s in tokens[4:]]
assert pathlib.Path(sys.argv[3]).read_bytes()==b'PATH=/usr/bin:/bin\0'
PY
  after="$(cat "/proc/$pid/stat")"
  # startTicks, unlike the full stat line, is immutable while CPU counters run.
  [[ "$(printf '%s\n' "$before" | sed 's/^.*) //' | awk '{print $20}')" == "$(printf '%s\n' "$after" | sed 's/^.*) //' | awk '{print $20}')" ]]
  [[ "$(systemctl show --property MainPID --value "$unit")" == "$pid" ]]
  group="$(systemctl show --property ControlGroup --value "$unit")"
  [[ "$group" == /* && "$group" != *..* && -f "/sys/fs/cgroup$group/cgroup.procs" ]]
  grep -Fxq "$pid" "/sys/fs/cgroup$group/cgroup.procs"
  printf '{"mainPid":"%s","startTicks":"%s","runningExecutableSHA256":"%s"}\n' "$pid" "$(printf '%s\n' "$before" | sed 's/^.*) //' | awk '{print $20}')" "$wanted"
}

operator_transition_stopped() {
  local pass group state
  for pass in 1 2; do
    state="$(systemctl show --property ActiveState --value "$unit")"
    [[ "$state" == inactive && "$(systemctl show --property MainPID --value "$unit")" == 0 ]] || return 1
    group="$(systemctl show --property ControlGroup --value "$unit")"
    [[ -z "$group" || ( "$group" == /* && "$group" != *..* ) ]] || return 1
    if [[ -n "$group" && -e "/sys/fs/cgroup$group/cgroup.procs" ]]; then [[ -z "$(cat "/sys/fs/cgroup$group/cgroup.procs")" ]] || return 1; fi
  done
}

operator_transition_halt_request() {
  python3 -B - "$binding" <<'PY'
import json,sys
b=json.load(open(sys.argv[1])); assert b['phase']=='quiesce' and b['quiesceMode']=='height-halt'
print(json.dumps(dict(version='YNX-OPERATOR-HEIGHT-HALT/v1',targetHeight=b['futureTargetHeight'],chainId=b['chainId'],genesisSHA256=b['consensusGenesisSHA256'],operatorPlanSHA256=b['oldOperatorPlanSHA256'],sessionId=b['heightHaltSessionId']),separators=(',',':')))
PY
}

operator_transition_record_halt_identity() {
  # Bind the future terminal observation to the already qualified process
  # before publishing its one-shot request. A replacement unit is UNKNOWN.
  local expected_pid expected_ticks invocation started ticks
  expected_pid="$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["mainPid"])' "$attempt/original-process.json")" || return $?
  expected_ticks="$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["startTicks"])' "$attempt/original-process.json")" || return $?
  [[ "$expected_pid" =~ ^[1-9][0-9]*$ && "$expected_ticks" =~ ^[1-9][0-9]*$ ]] || { operator_transition_fail 'original live halt incarnation changed; retained UNKNOWN'; return 1; }
  [[ "$(systemctl show --property ActiveState --value "$unit")" == active && "$(systemctl show --property MainPID --value "$unit")" == "$expected_pid" && "$(systemctl show --property ExecMainPID --value "$unit")" == "$expected_pid" ]] || { operator_transition_fail 'original live halt incarnation changed; retained UNKNOWN'; return 1; }
  ticks="$(cat "/proc/$expected_pid/stat")" || return $?
  [[ "$(printf '%s\n' "$ticks" | sed 's/^.*) //' | awk '{print $20}')" == "$expected_ticks" ]] || { operator_transition_fail 'original live halt incarnation changed; retained UNKNOWN'; return 1; }
  invocation="$(systemctl show --property InvocationID --value "$unit")" || return $?
  started="$(systemctl show --property ExecMainStartTimestampMonotonic --value "$unit")" || return $?
  [[ "$invocation" =~ ^[0-9a-f]{32}$ && "$invocation" != 00000000000000000000000000000000 && "$started" =~ ^[1-9][0-9]*$ ]] || { operator_transition_fail 'original live halt incarnation changed; retained UNKNOWN'; return 1; }
  [[ "$(systemctl show --property InvocationID --value "$unit")" == "$invocation" && "$(systemctl show --property ExecMainStartTimestampMonotonic --value "$unit")" == "$started" && "$(systemctl show --property ExecMainPID --value "$unit")" == "$expected_pid" && "$(systemctl show --property MainPID --value "$unit")" == "$expected_pid" && "$(systemctl show --property ActiveState --value "$unit")" == active ]] || { operator_transition_fail 'original live halt incarnation changed; retained UNKNOWN'; return 1; }
  ticks="$(cat "/proc/$expected_pid/stat")" || return $?
  [[ "$(printf '%s\n' "$ticks" | sed 's/^.*) //' | awk '{print $20}')" == "$expected_ticks" ]] || { operator_transition_fail 'original live halt incarnation changed; retained UNKNOWN'; return 1; }
  python3 -B - "$attempt/original-process.json" "$attempt/halt-incarnation.json" "$expected_pid" "$expected_ticks" "$invocation" "$started" <<'PYHALT'
import hashlib,json,os,pathlib,sys
p=pathlib.Path(sys.argv[1]);raw=p.read_bytes();v=json.loads(raw)
assert set(v)=={'mainPid','startTicks','runningExecutableSHA256'} and v['mainPid']==sys.argv[3] and v['startTicks']==sys.argv[4]
r=dict(version='YNX-OPERATOR-HALT-INCARNATION/v1',mainPid=sys.argv[3],startTicks=sys.argv[4],invocationId=sys.argv[5],execMainStartTimestampMonotonic=sys.argv[6],originalProcessSHA256=hashlib.sha256(raw).hexdigest())
fd=os.open(sys.argv[2],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
try:
 with os.fdopen(fd,'wb',closefd=False) as f:f.write(json.dumps(r,separators=(',',':')).encode()+b'\n');f.flush()
 os.fsync(fd)
finally:os.close(fd)
fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
try:os.fsync(fd)
finally:os.close(fd)
PYHALT
}

operator_transition_request_height_halt() {
  local parent input request request_pin control session
  parent="$(dirname "$state")"; session="$(operator_transition_value heightHaltSessionId)"
  control="$(operator_transition_value originalRole.heightHaltControlPath)"
  input="$parent/operator-height-halt-$session-publication-input"
  # Preserve the private App owner's custody; root never publishes a request
  # that the same-uid consumer would reject. These are public derived inputs,
  # not a new approval or a source checkpoint. Keep them on every failure.
  [[ "$(realpath -e "$parent")" == "$parent" && "$(stat -c %a "$parent")" == 700 && "$(stat -c %u "$parent")" == "$(id -u ynx)" ]]
  operator_transition_file "$state"; [[ "$(stat -c %u "$state")" == "$(id -u ynx)" && "$(stat -c %a "$state")" == 600 ]]
  operator_transition_record_halt_identity || return $?
  mkdir -m 0700 "$input"
  request="$input/request.json"
  (set -o noclobber; operator_transition_halt_request >"$attempt/halt-request.json")
  dd if="$attempt/halt-request.json" of="$request" conv=excl,fsync status=none
  dd if="$stage/bin/ynx-comet" of="$input/ynx-comet" conv=excl,fsync status=none
  chmod 0500 "$input/ynx-comet"; chmod 0600 "$request"
  chown ynx:ynx "$input" "$request" "$input/ynx-comet"
  [[ "$(operator_transition_sha "$input/ynx-comet")" == "$comet_pin" ]]
  request_pin="$(operator_transition_sha "$attempt/halt-request.json")"
  [[ "$(operator_transition_sha "$request")" == "$request_pin" ]]
  sync -f "$attempt/halt-request.json"; sync -f "$input"; sync -f "$parent"
  # The Go publisher alone owns atomic NOREPLACE + fsync publication. Never
  # cat/copy/link a partially written request into the watched control path.
  (set -o noclobber; runuser -u ynx -- env -i PATH=/usr/bin:/bin "$input/ynx-comet" request-height-halt \
    --request "$request" --request-sha256 "$request_pin" --abci-state "$state" --height-halt-control "$control" \
    --chain-id "$(operator_transition_value chainId)" --consensus-genesis-sha256 "$(operator_transition_value consensusGenesisSHA256)" \
    --operator-plan-sha256 "$(operator_transition_value oldOperatorPlanSHA256)" --height-halt-session-id "$session" \
    >"$attempt/halt-publication.json" 2>"$attempt/halt-publication.error")
  python3 -B - "$binding" "$attempt/halt-publication.json" "$request_pin" <<'PY'
import json,sys
def unique(pairs):
    d={}
    for k,v in pairs:
        assert k not in d; d[k]=v
    return d
b=json.load(open(sys.argv[1])); r=json.load(open(sys.argv[2]),object_pairs_hook=unique)
assert r==dict(version='YNX-OPERATOR-HEIGHT-HALT-PUBLISHED/v1',controlPath=b['originalRole']['heightHaltControlPath'],requestSHA256=sys.argv[3],targetHeight=b['futureTargetHeight'],chainId=b['chainId'],genesisSHA256=b['consensusGenesisSHA256'],operatorPlanSHA256=b['oldOperatorPlanSHA256'],sessionId=b['heightHaltSessionId'],published=True,nodeStopped=False,activation=False)
assert r['published'] is True and r['nodeStopped'] is False and r['activation'] is False
PY
  operator_transition_file "$control"
  [[ "$(stat -c %u "$control")" == "$(id -u ynx)" && "$(stat -c %a "$control")" == 600 && "$(operator_transition_sha "$control")" == "$request_pin" ]]
}

operator_transition_wait_height_halt() {
  local expected_pid expected_ticks expected_invocation expected_started original_identity observation active pid ticks status terminal_pass
  original_identity="$(python3 -B - "$attempt/original-process.json" "$attempt/halt-incarnation.json" <<'PYHALT'
import hashlib,json,pathlib,re,sys
raw=pathlib.Path(sys.argv[1]).read_bytes();p=json.loads(raw)
def unique(pairs):
 d={}
 for k,v in pairs:
  assert k not in d;d[k]=v
 return d
r=json.loads(pathlib.Path(sys.argv[2]).read_bytes(),object_pairs_hook=unique)
assert set(r)=={'version','mainPid','startTicks','invocationId','execMainStartTimestampMonotonic','originalProcessSHA256'} and r['version']=='YNX-OPERATOR-HALT-INCARNATION/v1'
assert r['originalProcessSHA256']==hashlib.sha256(raw).hexdigest() and r['mainPid']==p['mainPid'] and r['startTicks']==p['startTicks']
assert all(type(r[k]) is str and re.fullmatch('[1-9][0-9]*',r[k]) for k in ('mainPid','startTicks','execMainStartTimestampMonotonic'))
assert type(r['invocationId']) is str and re.fullmatch('[0-9a-f]{32}',r['invocationId']) and r['invocationId']!='0'*32
print(r['mainPid'],r['startTicks'],r['invocationId'],r['execMainStartTimestampMonotonic'])
PYHALT
)" || return $?
  read -r expected_pid expected_ticks expected_invocation expected_started <<<"$original_identity"
  # At most 60 observations. Timeout only returns UNKNOWN: never stop/kill a
  # live operator, remove the request, or dispatch it a second time.
  for observation in {1..60}; do
    active="$(systemctl show --property ActiveState --value "$unit")"
    pid="$(systemctl show --property MainPID --value "$unit")"
    if [[ "$active" == inactive && "$pid" == 0 ]]; then
      operator_transition_stopped || return $?
      for terminal_pass in 1 2; do
        [[ "$(systemctl show --property ExecMainPID --value "$unit")" == "$expected_pid" && "$(systemctl show --property InvocationID --value "$unit")" == "$expected_invocation" && "$(systemctl show --property ExecMainStartTimestampMonotonic --value "$unit")" == "$expected_started" ]] || { operator_transition_fail 'operator terminal incarnation differs from the original requested process; retained UNKNOWN'; return 1; }
        [[ "$(systemctl show --property Result --value "$unit")" == success && "$(systemctl show --property ExecMainCode --value "$unit")" == 1 && "$(systemctl show --property ExecMainStatus --value "$unit")" == 0 ]] || { operator_transition_fail 'operator did not exit normally after the request; retained UNKNOWN'; return 1; }
        operator_transition_stopped || return $?
      done
      return
    fi
    [[ "$active" == active || "$active" == deactivating ]] || { operator_transition_fail 'operator failed while waiting for height halt; retained UNKNOWN'; return 1; }
    if [[ "$pid" != 0 ]]; then
      [[ "$pid" == "$expected_pid" ]] || { operator_transition_fail 'operator PID changed after publication; retained UNKNOWN'; return 1; }
      if ticks="$(cat "/proc/$pid/stat")"; then
        [[ "$(printf '%s\n' "$ticks" | sed 's/^.*) //' | awk '{print $20}')" == "$expected_ticks" ]] || { operator_transition_fail 'operator process identity changed after publication; retained UNKNOWN'; return 1; }
      else
        status="$?"
        # A normal exit may race this read. Only observed terminal systemd
        # state is allowed to continue to the full terminal checks above.
        [[ "$(systemctl show --property MainPID --value "$unit")" == 0 && "$(systemctl show --property ActiveState --value "$unit")" == inactive ]] || return "$status"
      fi
    fi
    if [[ "$observation" != 60 ]]; then sleep 1; fi
  done
  operator_transition_fail 'HEIGHT_HALT_OUTCOME_UNKNOWN: bounded normal-exit wait expired; retain request, freeze, pause and all attempts'
  return 1
}

operator_transition_markers() {
  local freeze=/var/lib/ynx-chain/mutation-freeze.json pause=/var/lib/ynx-chain/block-production-pause.json
  operator_transition_file "$freeze"
  [[ "$(operator_transition_sha "$freeze")" == "$(operator_transition_value freezeSHA256)" ]]
  python3 -B - "$binding" "$freeze" <<'PY'
import json,sys
b,f=(json.load(open(p)) for p in sys.argv[1:]); assert f['transactionId']==b['transitionId'] and f['role']==b['role'] and f['frozenAt']
PY
  if [[ "$role" == primary ]]; then
    operator_transition_file "$pause"
    [[ "$(operator_transition_sha "$pause")" == "$(operator_transition_value nativePauseSHA256)" ]]
    python3 -B - "$binding" "$pause" <<'PY'
import json,sys
b,p=(json.load(open(p)) for p in sys.argv[1:]); assert p['transactionId']==b['cutoverTransactionId'] and p['pausedAt']
PY
  fi
}

operator_transition_freeze() {
  local marker=/var/lib/ynx-chain/mutation-freeze.json original="$stage/freeze-markers/$role.json" code
  operator_transition_file "$original"
  [[ "$(operator_transition_sha "$original")" == "$(operator_transition_value freezeSHA256)" ]]
  if [[ ! -e "$marker" && ! -L "$marker" ]]; then
    # Publish only the exact independently approved existing bytes. Partial
    # publication remains UNKNOWN; neither timestamps nor authority are made.
    dd if="$original" of="$marker" conv=excl,fsync status=none
    sync -f "$(dirname "$marker")"
  fi
  cmp "$original" "$marker" >/dev/null
  operator_transition_markers
  code="$(curl --noproxy '*' --connect-timeout 5 --max-time 10 --max-redirs 0 --silent --show-error --output "$attempt/native-freeze-probe.json" --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' --data '{}' http://127.0.0.1:6420/__ynx_mutation_freeze_probe__)"
  [[ "$code" == 503 ]] && grep -Fq 'mutation_frozen' "$attempt/native-freeze-probe.json" || operator_transition_fail 'native mutation gate did not confirm this freeze'
  if [[ "$role" == primary ]]; then
    code="$(curl --noproxy '*' --connect-timeout 5 --max-time 10 --max-redirs 0 --silent --show-error --output "$attempt/gateway-freeze-probe.json" --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' --data '{}' http://127.0.0.1:27620/__ynx_mutation_freeze_probe__)"
    [[ "$code" == 503 ]] && grep -Fq 'mutation_frozen' "$attempt/gateway-freeze-probe.json" || operator_transition_fail 'gateway mutation gate did not confirm this freeze'
  fi
}

operator_transition_inspect() {
  local output="$1" next="${2:-}" backup="${3:-}" args
  args=(inspect-operator-checkpoint --consensus-genesis "$home/config/genesis.json" --migration-state "$old_package/roles/$role/config/bound-migration.json" --abci-state "$state" --abci-state-layout "$(operator_transition_value stateLayout)" --comet-data-dir "$home/data" --signing-state "$signing_state" --consensus-genesis-sha256 "$(operator_transition_value consensusGenesisSHA256)" --original-genesis-hash "$(operator_transition_value originalGenesisHash)" --bound-migration-state-hash "$(operator_transition_value migrationStateHash)")
  local runtime_hash; runtime_hash="$(operator_transition_value runtimePlanHash)"
  if [[ -n "$runtime_hash" ]]; then args+=(--runtime-upgrade-plan "$old_package/roles/$role/config/runtime-plan.json" --runtime-upgrade-plan-hash "$runtime_hash"); fi
  if [[ -n "$next" ]]; then args+=(--next-pq-engine-schedule "$new_package/roles/$role/config/pq-engine-schedule.json" --next-pq-engine-schedule-hash "$next"); fi
  if [[ -n "$backup" ]]; then args+=(--backup-output "$backup" --backup-legacy-key "$(operator_transition_value originalRole.legacyKeyPath)" --backup-node-key "$(operator_transition_value originalRole.nodeKeyPath)"); fi
  (set -o noclobber; "$stage/bin/ynx-comet" "${args[@]}" >"$output")
  python3 -B - "$binding" "$output" "$next" <<'PY'
import json,sys
b,c=(json.load(open(p)) for p in sys.argv[1:3])
assert c['version']=='YNX-OPERATOR-CHECKPOINT/v1' and c['readOnly'] is True and c['sourceReadOnly'] is True and c['writerExcluded'] is True and c['signingWriterExcluded'] is True and c['engineCheckpointVerified'] is True and c['pqActivationVerified'] is False
for k in ('chainId','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','stateLayout'): assert c[k]==b[k]
assert c['committedScheduleHash'] is None and c['nextScheduleHash']==(sys.argv[3] or None)
if b['checkpoint'] is not None:
    for k,v in b['checkpoint'].items(): assert c[k]==v
if b['phase']=='quiesce' and b['quiesceMode']=='height-halt':
    assert c['height']==b['futureTargetHeight'], 'actual stopped height differs from independently approved target'
PY
}

operator_transition_backup_check() {
  python3 -B - "$1" "$2" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); raw=p.read_bytes()
assert hashlib.sha256(raw).hexdigest()==sys.argv[2]
m=json.loads(raw); assert m['version']=='YNX-OPERATOR-TRANSITION-BACKUP/v1' and m['committedSourceConsistent'] is True
for name,digest in m['files'].items():
    assert name in ('committed-source.tar.gz','original-launch.tar.gz')
    f=p.parent/name; assert f.is_file() and not f.is_symlink()
    h=hashlib.sha256()
    with f.open('rb') as r:
        for chunk in iter(lambda:r.read(1<<20),b''): h.update(chunk)
    assert h.hexdigest()==digest
assert len(m['files'])==2
PY
}

operator_transition_receipt() {
  local status="$1" checkpoint="$2" backup="$3" process="${4:-}"
  python3 -B - "$binding" "$status" "$checkpoint" "$backup" "$process" <<'PY'
import json,sys
b=json.load(open(sys.argv[1])); b.update(version='YNX-OPERATOR-TRANSITION-RESULT/v1',status=sys.argv[2],checkpoint=json.load(open(sys.argv[3])) if sys.argv[3] else None,backupSHA256=sys.argv[4] or None,originalMaterialRetained=True,pqActivationVerified=False,independentFinalityVerified=False)
if sys.argv[5]: b['process']=json.load(open(sys.argv[5]))
print(json.dumps(b,separators=(',',':'),sort_keys=True))
PY
}

operator_transition_begin_completion() {
  [[ -d "$attempt" && ! -L "$attempt" && "$(stat -c %u "$attempt")" == "$(id -u)" && "$(stat -c %a "$attempt")" == 700 ]]
  operator_transition_file "$attempt/prepared.json"
  # Existence (including an empty or partial directory) consumes this dispatch.
  mkdir -m 0700 "$attempt/complete-attempt" || operator_transition_fail 'completion already attempted/UNKNOWN; never resend'
  sync -f "$attempt/complete-attempt"; sync -f "$attempt"
}

# A read-only numeric observation for an ALREADY INSTALLED bootstrap operator.
# It is neither a first-native-import budget nor a reservation/growth guarantee.
operator_transition_capacity_measure() {
  python3 -B - "$@" <<'PYCAPACITY'
import contextlib,hashlib,json,os,pathlib,pwd,re,stat,sys,time
P=pathlib.Path
MiB=1<<20; GiB=1<<30; LIMIT=(1<<63)-1
CANDIDATE=P('/var/lib/ynx-chain/consensus-candidate')
UNIT=P('/etc/systemd/system/ynx-consensus-operator-candidate.service')
CAPBASE=P('/opt/ynx-chain/operator-transitions')
BACKUPBASE=P('/var/lib/ynx-chain')
BRIDGEBASE=P('/var/tmp')
ROLES=('primary','singapore','silicon-valley','seoul')
IDENTITY=('transitionId','role','approvalSHA256','oldOperatorPlanSHA256','oldRuntimeCommit','oldRuntimeManifestSHA256','runtimeCommit','runtimeManifestSHA256')
NUMBERS=('quiesceStageBytesBound','futureStageBytesBound','oldPackageBytes','currentMigrationBytes')
def need(ok,message):
    if not ok: raise ValueError(message)
def unique(pairs):
    out={}
    for k,v in pairs:need(k not in out,'duplicate public field');out[k]=v
    return out
def decode(raw):return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:need(False,'invalid number'))
def sha(raw):return hashlib.sha256(raw).hexdigest()
def integer(v):
    need(type(v) is str and re.fullmatch('[1-9][0-9]*',v) and int(v)<=LIMIT,'invalid positive byte bound')
    return int(v)
def pin(v):return type(v) is str and re.fullmatch('[0-9a-f]{64}',v) and v!='0'*64
def identity(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
# Ordinary ancestors are held for path identity, not an inventory of their
# unrelated children. Creating a sibling changes nlink/size/mtime/ctime.
# Targets and enumerated source directories retain the full identity above.
def ancestor_identity(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid)
def canonical(path):
    p=P(path);need(p.is_absolute() and str(p)==str(path) and '..' not in p.parts and len(os.fsencode(p))<=4096,'noncanonical source')
    return p
@contextlib.contextmanager
def held(path,directory=False):
    # Open each ancestor relative to its held parent. No resolve/open race and
    # no private regular file is opened by the metadata walker below.
    p=canonical(path);fds=[];links=[]
    try:
        fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);fds.append(fd)
        for name in p.parts[1:-1]:
            before=os.stat(name,dir_fd=fd,follow_symlinks=False)
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            fds.append(child)
            need(ancestor_identity(before)==ancestor_identity(os.fstat(child)),'ancestor changed')
            links.append((fd,name,child,before));fd=child
        name=p.name;before=os.stat(name,dir_fd=fd,follow_symlinks=False)
        need(stat.S_ISDIR(before.st_mode) if directory else stat.S_ISREG(before.st_mode),'wrong source kind')
        child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|(os.O_DIRECTORY if directory else 0),dir_fd=fd)
        fds.append(child)
        need(identity(before)==identity(os.fstat(child)),'original changed at open')
        yield child,before
        need(identity(before)==identity(os.fstat(child))==identity(os.stat(name,dir_fd=fd,follow_symlinks=False)),'original changed while held')
        for parent,n,child,s in reversed(links):
            # Ancestor directory *contents* may change elsewhere; its actual
            # inode/type/owner must remain the directory through which we read.
            now=os.fstat(child);named=os.stat(n,dir_fd=parent,follow_symlinks=False)
            need(ancestor_identity(now)==ancestor_identity(s)==ancestor_identity(named),'ancestor replaced')
    finally:
        for fd in reversed(fds):os.close(fd)
def installed_uid():return pwd.getpwnam('ynx').pw_uid
def public(path,limit=MiB,owner=None):
    with held(path) as (fd,s):
        need(s.st_nlink==1 and 0<s.st_size<=limit and s.st_uid==(os.geteuid() if owner is None else owner) and not s.st_mode&0o022,'invalid public input')
        chunks=[];size=0
        while True:
            b=os.read(fd,65536)
            if not b:break
            size+=len(b);need(size<=limit,'public input grew');chunks.append(b)
        need(size==s.st_size,'public input length changed')
    return b''.join(chunks)
def bounded_stat(path):
    p=canonical(path)
    with held(p.parent,True) as (fd,_):
        s=os.stat(p.name,dir_fd=fd,follow_symlinks=False)
        need(stat.S_ISREG(s.st_mode) and s.st_size<=LIMIT,'regular source metadata required')
        return s
class Inventory:
    def __init__(self):self.start=time.monotonic();self.entries={};self.raw=0;self.files=0;self.dirs=0
    def check(self):need(time.monotonic()-self.start<=30 and len(self.entries)<=200000,'metadata enumeration bound exceeded; UNKNOWN')
    def add(self,path,s):
        self.check();need(not stat.S_ISLNK(s.st_mode) and (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)),'special or aliased source; UNKNOWN')
        need(not any('unknown' in n.lower() or n.endswith(('.partial','.tmp')) for n in P(path).parts),'retained uncertain source; UNKNOWN')
        value=identity(s)
        if path in self.entries:need(self.entries[path]==value,'overlapping source changed');return False
        self.entries[path]=value
        if stat.S_ISREG(s.st_mode):self.raw+=s.st_size;self.files+=1
        else:self.dirs+=1
        need(self.raw<=LIMIT and len(self.entries)<=200000,'metadata count overflow');return True
    def walk(self,path):
        p=canonical(path)
        with held(p.parent,True) as (fd,_):self.child(fd,p.name,str(p),0)
    def names(self,fd):
        names=[]
        with os.scandir(fd) as entries:
            for entry in entries:
                self.check();names.append(entry.name)
                need(len(names)<=200000,'directory entry bound exceeded; UNKNOWN')
        return sorted(names)
    def child(self,parent,name,path,depth):
        need(depth<=64,'metadata depth bound exceeded')
        s=os.stat(name,dir_fd=parent,follow_symlinks=False)
        if not self.add(path,s):return
        if stat.S_ISDIR(s.st_mode):
            fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            try:
                need(identity(s)==identity(os.fstat(fd)),'directory changed at open')
                names=self.names(fd)
                for n in names:self.child(fd,n,path+'/'+n,depth+1)
                need(names==self.names(fd) and identity(s)==identity(os.fstat(fd))==identity(os.stat(name,dir_fd=parent,follow_symlinks=False)),'source grew/replaced during enumeration; UNKNOWN')
            finally:os.close(fd)
        else:need(identity(s)==identity(os.stat(name,dir_fd=parent,follow_symlinks=False)),'file changed during metadata read')
    def result(self):
        # 64KiB per entry covers 4096-byte path/link PAX records and headers;
        # 512 padding per file, 10KiB tar end/record padding; gzip worst-case
        # expansion is bounded above by 2*tar + 1MiB (no compression saving).
        tar=self.raw+512*self.files+65536*len(self.entries)+(10<<10)
        archive=2*tar+MiB;need(archive<=LIMIT,'archive bound overflow')
        return {k:str(v) for k,v in dict(rawBytes=self.raw,files=self.files,directories=self.dirs,tarBytesBound=tar,archiveBytesBound=archive).items()}
def inventory(paths):
    first=Inventory()
    for p in paths:first.walk(p)
    second=Inventory()
    for p in paths:second.walk(p)
    need(first.entries==second.entries,'source changed between metadata passes; UNKNOWN')
    return first.result()
def source(raw,commit):
    s=decode(raw)
    names=('ynx-abci','ynx-comet','ynx-bft-gatewayd','ynx-consensus-pq-remote-signer','ynx-consensus-pq-key-init','ynx-consensus-proof-verify','ynx-consensus-package','ynx-consensus-keycheck')
    need(s['commit']==commit and s['platform']=='linux/amd64' and s['version'] in ('YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2','YNX-PQ-LINUX-RUNTIME-CANDIDATE/v3'),'runtime metadata mismatch')
    need(set(s['binaries'])==set(names),'runtime inventory differs')
    total=0
    for v in s['binaries'].values():
        need(type(v) is dict and set(v)=={'bytes','sha256'} and type(v['bytes']) is int and 0<v['bytes']<=128*MiB and pin(v['sha256']),'invalid runtime bound')
        total+=v['bytes']
    need(total<=512*MiB,'runtime total exceeds original bound')
    return s

def budget(request,src,groups):
    q,f,old,m=(integer(request[k]) for k in NUMBERS)
    need(m<=GiB and old>=5*m,'original five migration copies absent')
    future=5*m+6*(96*MiB)+64*MiB
    binary_sum=sum(src['binaries'][n]['bytes'] for n in ('ynx-comet','ynx-consensus-package','ynx-consensus-keycheck'))
    need(q>=old+binary_sum and f>=old+future+384*MiB,'public stage bound omits original packages/runtime')
    public_phases=2*q+GiB+2*(2*f+GiB)
    # Installation retains the old profile by rename, but the new full role and
    # staging new-files can occupy different filesystems. Charge both copies.
    install=2*(future+384*MiB+8*MiB)+2*int(groups['launch']['tarBytesBound'])
    backups=sum(2*int(g['archiveBytesBound']) for g in groups.values())
    # Height-halt publisher keeps a normal comet copy and request metadata.
    halt=src['binaries']['ynx-comet']['bytes']+8*MiB
    bridge=0
    if request['bridgeMode']:
        # Each host receives three stage-public requests. They have no body
        # inputs; their three ELF copies already count in the phase payloads.
        bridge=3*(2*3*MiB+144*MiB+256*MiB)
        if request.get('bridgeToolRole',request['role'])==request['role']:
            # The controller pins these bulk requests to its original tool
            # role: future generate, four verifies, and two inventories.
            # Keep the original full copy/overhead/reserve for each call.
            overhead=8192*65536
            def operation(inputs,outputs):return 3*(inputs+overhead)+2*(outputs+overhead)+144*MiB+256*MiB
            bridge+=operation(m+2*96*MiB,future)+2*operation(old,3*MiB)+2*operation(future,3*MiB)+2*operation(2*MiB,2*MiB)
            if 'bridgeToolRole' not in request:
                # A retained v1 receipt counted full stage overhead too.
                bridge+=3*operation(2*MiB,3*MiB)-3*(2*3*MiB+144*MiB+256*MiB)
    totals=dict(publicStagesBytesBound=public_phases,backupBytesBound=backups,installationBytesBound=install,heightHaltBytesBound=halt,bridgeBytesBound=bridge,metadataReserveBytes=16*MiB)
    need(sum(totals.values())<=LIMIT,'cumulative bound overflow')
    return {k:str(v) for k,v in totals.items()}
def nearest(path):
    p=canonical(path)
    while not os.path.lexists(p):p=p.parent
    with held(p,True):pass
    return p
def devices(totals,state,stage,tx,role):
    # Charge the complete cumulative bound on each actual target filesystem.
    # This is deliberately conservative across distinct mounts, never an
    # inference that free space on one mount can pay for another mount.
    paths=(stage.parent,nearest(BACKUPBASE/'operator-transitions'/tx/role),CANDIDATE,CANDIDATE/'bin',CANDIDATE/'config',CANDIDATE/'scripts',UNIT.parent,BRIDGEBASE,P(state).parent)
    total=sum(int(v) for v in totals.values());out={}
    for p in paths:
        with held(p,True) as (fd,s):
            fs=os.fstatvfs(fd)
            need(0<fs.f_frsize<=65536 and fs.f_bavail>=0,'unsupported filesystem accounting')
            row=dict(device=str(s.st_dev),availableBytes=str(fs.f_bavail*fs.f_frsize),requiredBytes=str(total))
            if s.st_dev in out:row['availableBytes']=str(min(int(out[s.st_dev]['availableBytes']),int(row['availableBytes'])))
            out[s.st_dev]=row
    return sorted(out.values(),key=lambda v:int(v['device']))
def receipt_numbers(v):
    def number(x):need(type(x) is str and re.fullmatch('0|[1-9][0-9]*',x) and int(x)<=LIMIT,'invalid retained numeric receipt')
    need(type(v['capacityAvailable']) is bool and v['sampleOnly'] is True and v['growthReserved'] is False and v['requiresRemeasure'] is True and v['sourceGrant'] is False and v['firstNativeImport'] is False,'retained capacity flags differ')
    need(set(v['groups'])=={'committed','launch'},'retained source groups differ')
    for g in v['groups'].values():
        need(type(g) is dict and set(g)=={'rawBytes','files','directories','tarBytesBound','archiveBytesBound'},'retained group fields differ')
        for value in g.values():number(value)
        need(int(g['archiveBytesBound'])>=int(g['tarBytesBound'])>=int(g['rawBytes']),'retained archive bound differs')
    need(set(v['bounds'])=={'publicStagesBytesBound','backupBytesBound','installationBytesBound','heightHaltBytesBound','bridgeBytesBound','metadataReserveBytes'},'retained bounds differ')
    for value in v['bounds'].values():number(value)
    need(type(v['filesystems']) is list and 0<len(v['filesystems'])<=9,'retained filesystem set differs')
    seen=set()
    for row in v['filesystems']:
        need(type(row) is dict and set(row)=={'device','availableBytes','requiredBytes'},'retained filesystem fields differ')
        for value in row.values():number(value)
        need(row['device'] not in seen,'duplicate filesystem');seen.add(row['device'])
    need(v['capacityAvailable']==all(int(row['availableBytes'])>int(row['requiredBytes']) for row in v['filesystems']),'capacity result differs from original numeric predicate')

def measure(stage,binding,request_pin,process,mode,receipt_path='-'):
    stage=canonical(stage);need(stage==CAPBASE/binding['transitionId']/binding['role']/'capacity','wrong capacity stage')
    with held(stage,True) as (_,s):need(s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o700,'capacity stage ownership')
    raw=public(stage/'request.json');need(sha(raw)==request_pin,'request pin mismatch');r=decode(raw)
    fields={'version',*IDENTITY,*NUMBERS,'currentMigrationSHA256','bridgeMode'}
    if r.get('version')=='YNX-OPERATOR-TRANSITION-CAPACITY-REQUEST/v2':
        need(set(r)==fields|{'bridgeToolRole'},'capacity request schema')
        need(r['bridgeToolRole'] in (ROLES if r['bridgeMode'] else ('-',)),'invalid original bridge tool role')
    else:need(set(r)==fields and r['version']=='YNX-OPERATOR-TRANSITION-CAPACITY-REQUEST/v1','capacity request schema')
    need(all(r[k]==binding[k] for k in IDENTITY) and binding['role'] in ROLES and binding['phase']=='quiesce','capacity source/phase binding')
    need(type(r['bridgeMode']) is bool and pin(r['currentMigrationSHA256']),'invalid capacity source bounds')
    for k in NUMBERS:integer(r[k])
    old=public(stage/'old-package/common/operator-plan.json',96*MiB);need(sha(old)==binding['oldOperatorPlanSHA256'],'old plan bytes changed')
    plan=decode(old);need(not plan['pqSchedule'] and not plan['pqScheduleHash'],'capacity only supports installed bootstrap operator')
    manifest=decode(public(stage/'old-package/package-manifest.json',16*MiB))
    need(manifest['operatorPlanHash']==binding['oldOperatorPlanSHA256'] and manifest['files']['common/operator-plan.json']==binding['oldOperatorPlanSHA256'],'verified original package plan differs')
    need(manifest['files']['roles/'+binding['role']+'/config/bound-migration.json']==r['currentMigrationSHA256'],'migration source pin mismatch')
    srcraw=public(stage/'SOURCE.json');oldsrc=public(stage/'old-SOURCE.json')
    need(sha(srcraw)==binding['runtimeManifestSHA256'] and sha(oldsrc)==binding['oldRuntimeManifestSHA256'],'runtime source bytes mismatch')
    src=source(srcraw,binding['runtimeCommit']);source(oldsrc,binding['oldRuntimeCommit'])
    for relative,target in (('role-manifest.json',CANDIDATE/'role-manifest.json'),('scripts/start-operator.sh',CANDIDATE/'scripts/start-operator.sh'),('systemd/'+UNIT.name,UNIT)):
        need(public(stage/'old-role'/relative)==public(target,owner=installed_uid() if relative=='role-manifest.json' else os.geteuid()),'original installed public identity differs')
    rm=decode(public(CANDIDATE/'role-manifest.json',owner=installed_uid()))
    role=binding['originalRole'];need(rm['node']['role']==binding['role'] and rm['chainId']==binding['chainId'] and rm['migrationStateHash']==binding['migrationStateHash'] and rm['privateValidatorKeyPath']==role['legacyKeyPath'] and rm['nodeKeyPath']==role['nodeKeyPath'],'installed role differs')
    need(bounded_stat(CANDIDATE/'config/bound-migration.json').st_size==integer(r['currentMigrationBytes']),'installed migration size differs')
    need(set(process)=={'mainPid','startTicks','runningExecutableSHA256'} and process['runningExecutableSHA256']==binding['oldCometSHA256'],'original process receipt differs')
    for k in ('mainPid','startTicks'):integer(process[k])
    paths=[role['home'],role['abciState'],role['abciState']+'.writer.lock',role['legacyStatePath'],role['legacyStatePath']+'.writer.lock',role['legacyKeyPath'],role['nodeKeyPath']]
    need(role['home']!='/' and P(role['home']).name!='data' and len(set(paths[-2:]))==2,'unsupported backup source')
    if binding['stateLayout']!='atomic-json':
        need(binding['stateLayout'] in ('snapshot-journal','block-journal'),'unknown original state layout')
        paths += [role['abciState']+'.lock',role['abciState']+'.read.lock']
    for p in (role['legacyKeyPath'],role['nodeKeyPath']):
        s=bounded_stat(p);need(s.st_size>0 and stat.S_IMODE(s.st_mode)==0o600,'original custody metadata differs')
    groups=dict(committed=inventory(paths),launch=inventory([str(CANDIDATE),str(UNIT)]))
    totals=budget(r,src,groups)
    if mode=='remeasure':
        # The quiesce archive/extracted stage is now already reflected in free
        # bytes. Keep its original 1GiB floor, every future stage and backup;
        # do not reserve its 2*q upload a second time.
        totals['publicStagesBytesBound']=str(int(totals['publicStagesBytesBound'])-2*integer(r['quiesceStageBytesBound']))
    fs=devices(totals,role['abciState'],stage,binding['transitionId'],binding['role'])
    result=dict(version='YNX-OPERATOR-TRANSITION-CAPACITY/v1',**{k:r[k] for k in IDENTITY},requestSHA256=request_pin,process=process,groups=groups,bounds=totals,filesystems=fs,capacityAvailable=all(int(v['availableBytes'])>int(v['requiredBytes']) for v in fs),sampleOnly=True,growthReserved=False,requiresRemeasure=True,sourceGrant=False,firstNativeImport=False)
    receipt_numbers(result)
    if mode=='remeasure':
        original=decode(public(P(receipt_path)))
        need(set(original)==set(result) and original['capacityAvailable'] is True,'original successful capacity receipt required')
        receipt_numbers(original)
        for k in ('version',*IDENTITY,'requestSHA256','process','sampleOnly','growthReserved','requiresRemeasure','sourceGrant','firstNativeImport'):need(original[k]==result[k],'capacity receipt binding changed')
        for group in groups:
            need(set(original['groups'][group])==set(groups[group]),'original capacity group differs')
            for k,v in groups[group].items():need(int(v)<=int(original['groups'][group][k]),'backup source grew beyond retained ceiling; UNKNOWN')
    else:need(mode=='observe','invalid capacity action')
    return result
if __name__=='__main__':
    try:
        mode,stage,binding,request_pin,process,receipt=sys.argv[1:]
        value=measure(stage,decode(binding),request_pin,decode(process),mode,receipt)
        print(json.dumps(value,sort_keys=True,separators=(',',':')))
        sys.exit(0 if value['capacityAvailable'] else 1)
    except (ValueError,KeyError,TypeError,OSError,OverflowError) as error:
        # No private path/name, content, or arbitrary OS exception is printed.
        print('operator transition capacity unavailable; retain original attempt/UNKNOWN ('+type(error).__name__+')',file=sys.stderr);sys.exit(1)
PYCAPACITY
}

operator_transition_capacity() {
  [[ "$#" == 11 && "$(id -u)" == 0 && "$(uname -s)" == Linux ]] || return 64
  local tx="$1" role="$2" stage="$3" approval_pin="$4" old_pin="$5" old_commit="$6" old_manifest="$7" commit="$8" manifest="$9" helper_pin="${10}" request_pin="${11}"
  [[ "$role" =~ ^(primary|singapore|silicon-valley|seoul)$ && "$tx" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ && "$stage" == "/opt/ynx-chain/operator-transitions/$tx/$role/capacity" ]] || return 64
  [[ "$(operator_transition_sha "${BASH_SOURCE[0]}")" == "$helper_pin" && "$(operator_transition_sha "$stage/helper.sh")" == "$helper_pin" ]] || return 1
  local b process after wanted unit=ynx-consensus-operator-candidate.service candidate=/var/lib/ynx-chain/consensus-candidate unit_path=/etc/systemd/system/ynx-consensus-operator-candidate.service result
  b="$(operator_transition_binding quiesce "$tx" "$role" "$stage/approval.json" "$approval_pin" "$stage/old-package" "$old_pin" "$stage/old-SOURCE.json" "$old_commit" "$old_manifest" - - "$stage/SOURCE.json" "$commit" "$manifest")" || return $?
  [[ "$(systemctl show --property FragmentPath --value "$unit")" == "$unit_path" && -z "$(systemctl show --property DropInPaths --value "$unit")" && "$(systemctl show --property ExecStart --value "$unit")" == *"path=$candidate/scripts/start-operator.sh ;"* ]] || return 1
  wanted="$(python3 -B -c 'import json,sys;print(json.loads(sys.argv[1])["oldCometSHA256"])' "$b")" || return $?
  # Child shell preserves errexit for the ORIGINAL running getter even if a
  # caller invokes this capacity function in a shell condition.
  process="$(bash -Eeuo pipefail -c 'source "$1"; unit=ynx-consensus-operator-candidate.service; candidate=/var/lib/ynx-chain/consensus-candidate; operator_transition_running "$2"' _ "${BASH_SOURCE[0]}" "$wanted")" || return $?
  result="$(operator_transition_capacity_measure observe "$stage" "$b" "$request_pin" "$process" -)" || { local rc=$?; [[ -z "$result" ]] || printf '%s\n' "$result"; return "$rc"; }
  after="$(bash -Eeuo pipefail -c 'source "$1"; unit=ynx-consensus-operator-candidate.service; candidate=/var/lib/ynx-chain/consensus-candidate; operator_transition_running "$2"' _ "${BASH_SOURCE[0]}" "$wanted")" || return $?
  [[ "$process" == "$after" ]] || { operator_transition_fail 'original capacity process changed; UNKNOWN'; return 1; }
  printf '%s\n' "$result"
}

operator_transition_capacity_remeasure() {
  local original_stage="/opt/ynx-chain/operator-transitions/$tx/$role/capacity" pins request_pin receipt_pin b process
  pins="$(python3 -B - "$stage/capacity-receipts" "$tx" "$role" "$commit" "$manifest" <<'PYSET'
import hashlib,json,pathlib,re,sys
p=pathlib.Path(sys.argv[1]);tx,role,commit,source=sys.argv[2:]
assert str(p.resolve(strict=True))==str(p)
m=json.loads((p/'manifest.json').read_bytes());assert set(m)=={'version','transitionId','runtimeCommit','runtimeManifestSHA256','roles'}
assert (m['version'],m['transitionId'],m['runtimeCommit'],m['runtimeManifestSHA256'])==('YNX-OPERATOR-TRANSITION-CAPACITY-SET/v1',tx,commit,source)
assert set(m['roles'])=={'primary','singapore','silicon-valley','seoul'}
for r,v in m['roles'].items():
 assert set(v)=={'requestSHA256','receiptSHA256'} and all(re.fullmatch('[0-9a-f]{64}',x) for x in v.values())
 f=p/(r+'.json');assert f.is_file() and not f.is_symlink() and f.stat().st_nlink==1 and f.stat().st_size<=1048576
 raw=f.read_bytes();assert hashlib.sha256(raw).hexdigest()==v['receiptSHA256'];a=json.loads(raw)
 assert a['capacityAvailable'] is True and a['role']==r and a['transitionId']==tx and a['runtimeCommit']==commit and a['runtimeManifestSHA256']==source and a['requestSHA256']==v['requestSHA256']
print(m['roles'][role]['requestSHA256'])
PYSET
)" || return $?
  request_pin="$pins"
  [[ "$(operator_transition_sha "$original_stage/helper.sh")" == "$(operator_transition_sha "${BASH_SOURCE[0]}")" ]] || return 1
  b="$(cat "$binding")" || return $?
  process="$(cat "$attempt/original-process.json")" || return $?
  operator_transition_capacity_measure remeasure "$original_stage" "$b" "$request_pin" "$process" "$stage/capacity-receipts/$role.json" >/dev/null || return $?
}

operator_transition_remote() {
  [[ "$#" == 18 && "$(id -u)" == 0 && "$(uname -s)" == Linux ]] || return 64
  local phase="$1" tx="$2" role="$3" stage="$4" approval_pin="$5" old_pin="$6" old_commit="$7" old_manifest="$8" next_pin="$9" commit="${10}" manifest="${11}" helper_pin="${12}" archive_pin="${13}" old_comet_pin="${14}" comet_pin="${15}" verifier_pin="${16}" keycheck_pin="${17}"
  local action="${18}"
  [[ ( "$phase" == quiesce && ( "$action" == prepare || "$action" == complete ) ) || ( "$phase" != quiesce && "$action" == run ) ]] || return 64
  [[ "$stage" =~ ^/opt/ynx-chain/operator-transitions/[A-Za-z0-9._/-]+$ && "$stage" != *..* && "$(realpath -e "$stage")" == "$stage" ]]
  [[ "$(stat -c %u "$stage")" == 0 && "$(stat -c %a "$stage")" == 700 ]]
  [[ "$phase" == quiesce || "$phase" == install || "$phase" == start ]]
  [[ "$role" =~ ^(primary|singapore|silicon-valley|seoul)$ && "$tx" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]]
  local pin; for pin in "$approval_pin" "$old_pin" "$old_manifest" "$manifest" "$helper_pin" "$archive_pin" "$old_comet_pin" "$comet_pin" "$verifier_pin" "$keycheck_pin"; do [[ "$pin" =~ ^[0-9a-f]{64}$ && "$pin" != "$(printf '0%.0s' {1..64})" ]]; done
  printf '%s  %s\n' "$helper_pin" "$stage/helper.sh" "$approval_pin" "$stage/approval.json" "$old_manifest" "$stage/old-SOURCE.json" "$manifest" "$stage/SOURCE.json" "$comet_pin" "$stage/bin/ynx-comet" "$verifier_pin" "$stage/bin/ynx-consensus-package" "$keycheck_pin" "$stage/bin/ynx-consensus-keycheck" | sha256sum --strict -c - >/dev/null
  local old_package="$stage/old-package" new_package=-
  [[ "$phase" == quiesce ]] || new_package="$stage/new-package"
  "$stage/bin/ynx-consensus-package" -verify-package "$old_package" -operator-plan-hash "$old_pin" >/dev/null
  if [[ "$phase" != quiesce ]]; then "$stage/bin/ynx-consensus-package" -verify-package "$new_package" -operator-plan-hash "$next_pin" >/dev/null; fi
  local root="/var/lib/ynx-chain/operator-transitions/$tx/$role" attempt binding unit=ynx-consensus-operator-candidate.service
  local candidate=/var/lib/ynx-chain/consensus-candidate unit_path="/etc/systemd/system/$unit"
  umask 077
  mkdir -p /var/lib/ynx-chain/operator-transitions
  [[ "$(realpath -e /var/lib/ynx-chain/operator-transitions)" == /var/lib/ynx-chain/operator-transitions && "$(stat -c %u /var/lib/ynx-chain/operator-transitions)" == 0 && "$(stat -c %a /var/lib/ynx-chain/operator-transitions)" == 700 ]]
  local lock=/var/lib/ynx-chain/operator-transitions/.operator-switch.lock
  if [[ ! -e "$lock" && ! -L "$lock" ]]; then (set -o noclobber; : >"$lock"); fi
  operator_transition_file "$lock"; [[ "$(stat -c %a "$lock")" == 600 ]]
  exec 9<>"$lock"
  [[ "$(stat -Lc %d:%i /proc/$$/fd/9)" == "$(stat -c %d:%i "$lock")" ]]
  flock -n 9 || operator_transition_fail 'another operator transition holds the exclusive host lease'
  if [[ "$phase" == quiesce && "$action" == prepare ]]; then mkdir -p "/var/lib/ynx-chain/operator-transitions/$tx"; mkdir -m 0700 "$root"; else test -d "$root" && test ! -L "$root"; fi
  [[ "$(realpath -e "$root")" == "$root" && "$(stat -c %u "$root")" == 0 && "$(stat -c %a "$root")" == 700 ]]
  attempt="$root/$phase-attempt"
  if [[ "$action" == complete ]]; then
    # Even a failed completion consumes this one-shot dispatch. A subsequent
    # invocation must reconcile the original, never republish or force stop.
    operator_transition_begin_completion
  else
    mkdir -m 0700 "$attempt" || operator_transition_fail 'existing phase/UNKNOWN must be reconciled, never resent'
  fi
  binding="$attempt/binding.json"
  local fresh_binding="$binding"
  if [[ "$action" == complete ]]; then fresh_binding="$attempt/complete-attempt/binding.json"; fi
  (set -o noclobber; operator_transition_binding "$phase" "$tx" "$role" "$stage/approval.json" "$approval_pin" "$old_package" "$old_pin" "$stage/old-SOURCE.json" "$old_commit" "$old_manifest" "$new_package" "$next_pin" "$stage/SOURCE.json" "$commit" "$manifest" >"$fresh_binding")
  if [[ "$action" == complete ]]; then
    operator_transition_file "$binding"; cmp "$binding" "$fresh_binding" >/dev/null
    python3 -B - "$binding" "$attempt/prepared.json" <<'PY'
import json,sys
b,r=(json.load(open(p)) for p in sys.argv[1:]); assert r['status']=='prepared_not_stopped'
for k,v in b.items():
    if k!='version': assert r[k]==v
assert r['checkpoint'] is None and r['backupSHA256'] is None and r['originalMaterialRetained'] is True
PY
    sync -f "$fresh_binding"; sync -f "$attempt/complete-attempt"
  fi
  sync -f "$binding"; sync -f "$attempt"; sync -f "$root"
  [[ "$(operator_transition_value oldCometSHA256)" == "$old_comet_pin" && "$(operator_transition_value cometSHA256)" == "$comet_pin" && "$(operator_transition_value packageVerifierSHA256)" == "$verifier_pin" && "$(operator_transition_value keycheckSHA256)" == "$keycheck_pin" ]]
  local home state signing_state; home="$(operator_transition_value originalRole.home)"; state="$(operator_transition_value originalRole.abciState)"; signing_state="$(operator_transition_value originalRole.legacyStatePath)"
  ! systemctl is-active --quiet ynx-consensus-abci-candidate.service
  ! systemctl is-active --quiet ynx-consensus-comet-candidate.service
  if [[ "$phase" == quiesce ]]; then
    operator_transition_installed "$old_package" "$old_comet_pin" "$(operator_transition_value oldKeycheckSHA256)"
    if [[ "$action" == prepare ]]; then
      (set -o noclobber; operator_transition_running "$old_comet_pin" >"$attempt/original-process.json")
      operator_transition_capacity_remeasure || return $?
      operator_transition_freeze
      (set -o noclobber; operator_transition_running "$old_comet_pin" >"$attempt/prepared-process.json")
      cmp "$attempt/original-process.json" "$attempt/prepared-process.json" >/dev/null
      (set -o noclobber; operator_transition_receipt prepared_not_stopped '' '' "$attempt/original-process.json" >"$attempt/prepared.json")
      sync -f "$attempt/prepared.json"; sync -f "$attempt"
      cat "$attempt/prepared.json"
      return
    fi
    operator_transition_markers
    (set -o noclobber; operator_transition_running "$old_comet_pin" >"$attempt/complete-attempt/process.json")
    cmp "$attempt/original-process.json" "$attempt/complete-attempt/process.json" >/dev/null
    if [[ "$(operator_transition_value quiesceMode)" == height-halt ]]; then
      operator_transition_request_height_halt
      operator_transition_wait_height_halt
    else
      # Legacy fallback has no same-height guarantee. The four independently
      # inspected stopped checkpoints must still agree, or installation fails.
      timeout --signal=TERM --kill-after=5 30 systemctl stop "$unit"
    fi
    operator_transition_stopped
    # Establish the actual target under normal App/HRS/DB locks BEFORE any
    # backup; a planned height or publisher receipt is never a checkpoint.
    operator_transition_capacity_remeasure || return $?
    operator_transition_inspect "$attempt/checkpoint-stopped.json"
    # The normal Go command holds original App/signing/Comet DB locks while
    # archiving. Two later equal heights alone are NOT a consistent backup.
    operator_transition_inspect "$attempt/checkpoint-before.json" '' "$attempt/committed-source.tar.gz"
    (set -o noclobber; tar -czf - -- "$candidate" "$unit_path" >"$attempt/original-launch.tar.gz")
    tar -tzf "$attempt/original-launch.tar.gz" >/dev/null
    sync -f "$attempt/original-launch.tar.gz"
    operator_transition_stopped
    operator_transition_inspect "$attempt/checkpoint-after.json"
    python3 -B - "$attempt" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); a=json.loads((p/'checkpoint-before.json').read_bytes()); b=json.loads((p/'checkpoint-after.json').read_bytes()); stopped=json.loads((p/'checkpoint-stopped.json').read_bytes())
backup=a.pop('backup'); b.pop('backup',None); stopped.pop('backup',None); a.pop('backupCreated',None); b.pop('backupCreated',None); stopped.pop('backupCreated',None); assert a==b==stopped and backup['sourceConsistent'] is True
files={}
for name in ('committed-source.tar.gz','original-launch.tar.gz'):
    h=hashlib.sha256()
    with (p/name).open('rb') as r:
        for chunk in iter(lambda:r.read(1<<20),b''): h.update(chunk)
    files[name]=h.hexdigest()
assert files['committed-source.tar.gz']==backup['sha256']
with (p/'backup-manifest.json').open('x') as f: json.dump(dict(version='YNX-OPERATOR-TRANSITION-BACKUP/v1',committedSourceConsistent=True,files=files),f,separators=(',',':'),sort_keys=True)
PY
    sync -f "$attempt/backup-manifest.json"
    operator_transition_receipt stopped "$attempt/checkpoint-after.json" "$(operator_transition_sha "$attempt/backup-manifest.json")" "$attempt/original-process.json" >"$attempt/result.json"
  else
    operator_transition_markers
    operator_transition_stopped
    operator_transition_file "$root/quiesce-attempt/result.json"
    operator_transition_backup_check "$root/quiesce-attempt/backup-manifest.json" "$(operator_transition_value backupSHA256)"
    operator_transition_inspect "$attempt/checkpoint.json" "$(operator_transition_value scheduleHash)"
    python3 -B - "$binding" "$root/quiesce-attempt/result.json" <<'PY'
import json,sys
b,r=(json.load(open(p)) for p in sys.argv[1:]); assert r['status']=='stopped' and r['role']==b['role'] and r['transitionId']==b['transitionId'] and r['oldOperatorPlanSHA256']==b['oldOperatorPlanSHA256'] and r['oldRuntimeManifestSHA256']==b['oldRuntimeManifestSHA256'] and r['backupSHA256']==b['backupSHA256']
for k,v in b['checkpoint'].items(): assert r['checkpoint'][k]==v
PY
    if [[ "$phase" == install ]]; then
      operator_transition_installed "$old_package" "$old_comet_pin" "$(operator_transition_value oldKeycheckSHA256)"
      # Keep the gateway's existing SOURCE untouched; this provenance belongs
      # only to the newly installed operator, under its retained attempt.
      dd if="$stage/SOURCE.json" of="$attempt/operator-runtime-SOURCE.json" conv=excl,fsync status=none
      operator_transition_publish
      operator_transition_installed "$new_package" "$comet_pin" "$keycheck_pin"
      operator_transition_stopped
      operator_transition_receipt installed_not_started "$attempt/checkpoint.json" "$(operator_transition_value backupSHA256)" >"$attempt/result.json"
    else
      operator_transition_file "$root/install-attempt/result.json"
      python3 -B - "$binding" "$root/install-attempt/result.json" <<'PY'
import json,sys
b,r=(json.load(open(p)) for p in sys.argv[1:]); assert r['status']=='installed_not_started'
for k in ('transitionId','role','oldOperatorPlanSHA256','nextOperatorPlanSHA256','runtimeCommit','runtimeManifestSHA256','backupSHA256'): assert b[k]==r[k]
for k,v in b['checkpoint'].items(): assert r['checkpoint'][k]==v
PY
      operator_transition_installed "$new_package" "$comet_pin" "$keycheck_pin"
      # The normal factory, remote SecretConnection and durable signer acquire
      # their ORIGINAL leases. Failure never falls back to the old Ed profile.
      timeout --signal=TERM --kill-after=5 30 systemctl start "$unit"
      operator_transition_running "$comet_pin" >"$attempt/process.json"
      operator_transition_receipt started_activation_unproven "$attempt/checkpoint.json" "$(operator_transition_value backupSHA256)" "$attempt/process.json" >"$attempt/result.json"
    fi
  fi
  sync -f "$attempt/result.json"; sync -f "$attempt"
  cat "$attempt/result.json"
}


# Post-activation, single-role proof capture. The original three-phase
# bootstrap transition above is unchanged; this cannot initialize or install.
operator_light_inspect() {
  local output="$1" args
  args=(inspect-operator-checkpoint --consensus-genesis "$(operator_transition_value sourcePlan.genesisFile)"
    --migration-state "$(operator_transition_value sourcePlan.migrationFile)" --abci-state "$state"
    --abci-state-layout "$(operator_transition_value sourcePlan.stateLayout)" --comet-data-dir "$home/data"
    --signing-state "$signing_state" --signing-lock-kind pq-signer
    --consensus-genesis-sha256 "$(operator_transition_value sourcePlan.consensusGenesisSHA256)"
    --original-genesis-hash "$(operator_transition_value sourcePlan.originalGenesisHash)"
    --bound-migration-state-hash "$(operator_transition_value sourcePlan.migrationStateHash)"
    --pq-engine-schedule "$(operator_transition_value sourcePlan.scheduleFile)"
    --pq-engine-schedule-hash "$(operator_transition_value sourcePlan.scheduleHash)")
  if [[ -n "$(operator_transition_value sourcePlan.runtimePlanHash)" ]]; then
    args+=(--runtime-upgrade-plan "$(operator_transition_value sourcePlan.runtimePlanFile)" --runtime-upgrade-plan-hash "$(operator_transition_value sourcePlan.runtimePlanHash)")
  fi
  (set -o noclobber; "$stage/bin/ynx-comet" "${args[@]}" >"$output" 2>"$output.error")
  python3 -B - "$stage/quiet.py" "$binding" "$output" <<'PY'
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
q.check_capture_checkpoint(json.load(open(sys.argv[2])),sys.argv[3])
PY
}

operator_light_signer_identity() {
  python3 -B - "$stage/quiet.py" "$binding" "$1" <<'PY'
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
print(json.dumps(q.capture_signer_identity(json.load(open(sys.argv[2])),sys.argv[3]=='running'),separators=(',',':'),sort_keys=True))
PY
}

operator_light_recheck_phase() {
  python3 -B - "$stage/quiet.py" "$binding" "$stage" "$root/start-attempt/result.json" <<'PYRECHECK'
import importlib.util,pathlib,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q);p=pathlib.Path(sys.argv[3])
q.remote_capture_inputs(sys.argv[2],p/'approval.json',p/'SOURCE.json',p/'current-package',p/'source-plan.json',sys.argv[4],p/'cutover-approval.json')
PYRECHECK
}

operator_light_capture_remote() {
  [[ "$#" == 9 && "$(id -u)" == 0 && "$(uname -s)" == Linux ]] || return 64
  local phase="$1" tx="$2" role="$3" stage="$4" binding_pin="$5" helper_pin="$6" quiet_pin="$7" manifest="$8" archive_pin="$9"
  [[ "$phase" == capture || "$phase" == resume ]] && [[ "$role" =~ ^(primary|singapore|silicon-valley|seoul)$ && "$tx" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]]
  [[ "$stage" == "/opt/ynx-chain/operator-transitions/$tx/$role/$phase/source" && "$(realpath -e "$stage")" == "$stage" && "$(stat -c %u:%a "$stage")" == 0:700 ]]
  local p; for p in "$binding_pin" "$helper_pin" "$quiet_pin" "$manifest" "$archive_pin"; do [[ "$p" =~ ^[0-9a-f]{64}$ && "$p" != "$(printf '0%.0s' {1..64})" ]]; done
  printf '%s  %s\n' "$binding_pin" "$stage/binding.json" "$helper_pin" "$stage/helper.sh" "$quiet_pin" "$stage/quiet.py" "$manifest" "$stage/SOURCE.json" | sha256sum --strict -c - >/dev/null
  local root="/var/lib/ynx-chain/operator-transitions/$tx/$role" attempt binding="$stage/binding.json"
  attempt="$root/$phase-attempt"
  local candidate=/var/lib/ynx-chain/consensus-candidate unit=ynx-consensus-operator-candidate.service
  local unit_path="/etc/systemd/system/$unit" old_package="$stage/current-package" new_package="$stage/current-package"
  local home state signing_state comet_pin signer_unit=ynx-consensus-pq-remote-signer.service
  home="$(operator_transition_value originalRole.home)"; state="$(operator_transition_value originalRole.abciState)"
  signing_state="$(operator_transition_value sourcePlan.signingStatePath)"; comet_pin="$(operator_transition_value binarySHA256.ynx-comet)"
  [[ "$(operator_transition_value phase)" == "$phase" && "$(operator_transition_value transitionId)" == "$tx" && "$(operator_transition_value role)" == "$role" ]]
  printf '%s  %s\n' "$comet_pin" "$stage/bin/ynx-comet" "$(operator_transition_value binarySHA256.ynx-consensus-package)" "$stage/bin/ynx-consensus-package" "$(operator_transition_value binarySHA256.ynx-consensus-keycheck)" "$stage/bin/ynx-consensus-keycheck" | sha256sum --strict -c - >/dev/null
  "$stage/bin/ynx-consensus-package" -verify-package "$old_package" -operator-plan-hash "$(operator_transition_value operatorPlanSHA256)" >/dev/null
  python3 -B - "$stage/quiet.py" "$binding" "$stage" "$root/start-attempt/result.json" <<'PY'
import importlib.util,pathlib,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q);p=pathlib.Path(sys.argv[3])
q.remote_capture_inputs(sys.argv[2],p/'approval.json',p/'SOURCE.json',p/'current-package',p/'source-plan.json',sys.argv[4],p/'cutover-approval.json')
PY
  [[ "$(realpath -e "$root")" == "$root" && "$(stat -c %u:%a "$root")" == 0:700 ]]
  local lock=/var/lib/ynx-chain/operator-transitions/.operator-switch.lock
  operator_transition_file "$lock"; [[ "$(stat -c %u:%a "$lock")" == 0:600 ]]
  exec 9<>"$lock"; [[ "$(stat -Lc %d:%i /proc/$$/fd/9)" == "$(stat -c %d:%i "$lock")" ]]; flock -n 9
  umask 077; mkdir -m 0700 "$attempt" || operator_transition_fail 'capture/resume already attempted/UNKNOWN; reconcile original, never resend'
  dd if="$binding" of="$attempt/binding.json" conv=excl,fsync status=none
  dd if="$stage/source-plan.json" of="$attempt/source-plan.json" conv=excl,fsync status=none
  binding="$attempt/binding.json"; sync -f "$attempt"; sync -f "$root"
  operator_transition_installed "$old_package" "$comet_pin" "$(operator_transition_value binarySHA256.ynx-consensus-keycheck)"
  operator_transition_markers
  ! systemctl is-active --quiet ynx-consensus-abci-candidate.service
  ! systemctl is-active --quiet ynx-consensus-comet-candidate.service
  if [[ "$phase" == capture ]]; then
    operator_transition_running "$comet_pin" >"$attempt/original-process.json"
    operator_light_signer_identity running >"$attempt/signer-before.json"
    # Reuse original same-uid publisher and bounded natural-exit wait. Only
    # this selected role is requested; no systemctl stop of the operator.
    python3 -B - "$binding" "$attempt/halt-binding.json" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]));b.update(phase='quiesce',quiesceMode='height-halt',futureTargetHeight=b['sourcePlan']['engineHeight'],oldOperatorPlanSHA256=b['operatorPlanSHA256'],chainId=b['sourcePlan']['chainId'],consensusGenesisSHA256=b['sourcePlan']['consensusGenesisSHA256'])
with open(sys.argv[2],'x') as f:json.dump(b,f,separators=(',',':'),sort_keys=True)
PY
    operator_light_recheck_phase
    local capture_binding="$binding"; binding="$attempt/halt-binding.json"
    operator_transition_request_height_halt
    operator_transition_wait_height_halt
    binding="$capture_binding"
    operator_transition_stopped
    # Clean EOF can naturally retire the original one-session signer before
    # this check. Only that same invocation's real exit zero qualifies; a
    # failed/partial/timeout path is never reset or treated as successful.
    [[ "$(systemctl show --property ExecMainPID --value "$signer_unit")" == "$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["mainPid"])' "$attempt/signer-before.json")" && "$(systemctl show --property ExecMainStartTimestampMonotonic --value "$signer_unit")" == "$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["execMainStartTimestampMonotonic"])' "$attempt/signer-before.json")" ]]
    if [[ "$(systemctl show --property ActiveState --value "$signer_unit")" == active ]]; then
      operator_light_signer_identity running >"$attempt/signer-before-stop.json"
      cmp "$attempt/signer-before.json" "$attempt/signer-before-stop.json" >/dev/null
      operator_light_recheck_phase
      timeout --signal=TERM --kill-after=5 30 systemctl stop "$signer_unit"
    fi
    local saved_unit="$unit"; unit="$signer_unit"; operator_transition_stopped; unit="$saved_unit"
    [[ "$(systemctl show --property Result --value "$signer_unit")" == success && "$(systemctl show --property ExecMainCode --value "$signer_unit")" == 1 && "$(systemctl show --property ExecMainStatus --value "$signer_unit")" == 0 ]]
    operator_light_signer_identity stopped >"$attempt/signer-stopped.json"
    python3 -B - "$stage/quiet.py" "$signing_state" "$attempt/signing-metadata.json" <<'PY'
import importlib.util,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q);q.publish(sys.argv[3],q.signing_metadata(sys.argv[2]))
PY
    operator_light_inspect "$attempt/checkpoint.json"
    local output parent; output="$(operator_transition_value output)"; parent="$(dirname "$output")"
    mkdir -m 0700 "$parent"; [[ "$(realpath -e "$parent")" == "$parent" && "$(stat -c %u:%a "$parent")" == 0:700 ]]; sync -f "$(dirname "$parent")"
    # One real normal producer. Exit failure/lost acknowledgement preserves
    # all attempts/output; no transport-side reconstruction or second export.
    operator_light_recheck_phase
    local export_status=0
    (set -o noclobber; "$stage/bin/ynx-comet" export-light-source --source-plan "$attempt/source-plan.json" --source-plan-sha256 "$(operator_transition_value sourcePlanSHA256)" --output "$output" >"$attempt/export-receipt.json" 2>"$attempt/export-error.txt") || export_status="$?"
    printf '%s\n' "$export_status" >"$attempt/export-exit.txt"; sync -f "$attempt/export-exit.txt"; sync -f "$attempt"
    [[ "$export_status" == 0 ]] || return "$export_status"
    operator_light_inspect "$attempt/checkpoint-after.json"
    operator_transition_stopped
    operator_light_signer_identity stopped >"$attempt/signer-after.json"; cmp "$attempt/signer-stopped.json" "$attempt/signer-after.json" >/dev/null
    python3 -B - "$stage/quiet.py" "$binding" "$attempt" <<'PY'
import importlib.util,json,pathlib,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
q.publish(pathlib.Path(sys.argv[3])/'result.json',q.finish_capture(json.load(open(sys.argv[2])),sys.argv[3]))
PY
  else
    operator_transition_stopped
    local saved_unit="$unit"; unit="$signer_unit"; operator_transition_stopped; unit="$saved_unit"
    operator_light_signer_identity stopped >"$attempt/signer-before.json"
    cmp "$root/capture-attempt/signer-stopped.json" "$attempt/signer-before.json" >/dev/null
    operator_light_inspect "$attempt/checkpoint.json"
    operator_light_recheck_phase
    python3 -B - "$stage/quiet.py" "$binding" "$root/capture-attempt" "$attempt" <<'PY'
import importlib.util,json,pathlib,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
b=json.load(open(sys.argv[2]));cap=pathlib.Path(sys.argv[3]);attempt=pathlib.Path(sys.argv[4]);r,raw=q.load(cap/'result.json',b['captureSHA256'],1<<20)
q.need(r==q.finish_capture(json.load(open(cap/'binding.json')),cap),'completed original capture changed')
retained=q.retain_consumed_halt(b,r,attempt/'checkpoint.json');q.publish(attempt/'retained-request.json',dict(path=retained,sha256=r['haltRequestSHA256']))
PY
    # New explicit resume action, not replay of the old transition start.
    operator_light_recheck_phase
    timeout --signal=TERM --kill-after=5 30 systemctl start "$signer_unit"
    operator_light_signer_identity running >"$attempt/signer-process.json"
    operator_light_recheck_phase
    timeout --signal=TERM --kill-after=5 30 systemctl start "$unit"
    operator_transition_running "$comet_pin" >"$attempt/process.json"
    python3 -B - "$stage/quiet.py" "$binding" "$attempt" <<'PY'
import importlib.util,json,pathlib,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
b=json.load(open(sys.argv[2]));p=pathlib.Path(sys.argv[3]);c,_=q.load(pathlib.Path(b['captureRoot'])/'result.json',b['captureSHA256'],1<<20)
r=dict(c,phase='resume',status='resumed_activation_unproven',resumeApprovalSHA256=b['approvalSHA256'],captureSHA256=b['captureSHA256'],currentProcess=q.load(p/'process.json')[0],signerProcess=q.load(p/'signer-process.json')[0]);q.publish(p/'result.json',r)
PY
  fi
  sync -f "$attempt/result.json"; sync -f "$attempt"; cat "$attempt/result.json"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "${1:-}" == capacity ]]; then shift; operator_transition_capacity "$@"; elif [[ "${1:-}" == light-capture ]]; then shift; operator_light_capture_remote "$@"; else operator_transition_remote "$@"; fi
fi
