#!/usr/bin/env bash
set -Eeuo pipefail

# Existing single-App profile transition. This is NOT the native fresh-import
# path. All artifacts and failed attempts remain; there is no rollback/retry.
operator_transition_fail() { echo "operator transition refused: $*" >&2; return 1; }
operator_transition_sha() { sha256sum "$1" | awk '{print $1}'; }
operator_transition_file() {
  test -f "$1" && test ! -L "$1" && test "$(realpath -e "$1")" = "$1" && test "$(stat -c %h "$1")" = 1
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
    for s in (oldsrc,src): need(s['version']=='YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2' and s['platform']=='linux/amd64','normal v2 runtime required')
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
  diff <(find "$expected/config" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort) <(find "$candidate/config" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort) >/dev/null
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
    [[ "$state" == inactive && "$(systemctl show --property MainPID --value "$unit")" == 0 ]]
    group="$(systemctl show --property ControlGroup --value "$unit")"
    [[ -z "$group" || ( "$group" == /* && "$group" != *..* ) ]]
    if [[ -n "$group" && -e "/sys/fs/cgroup$group/cgroup.procs" ]]; then [[ -z "$(cat "/sys/fs/cgroup$group/cgroup.procs")" ]]; fi
  done
}

operator_transition_halt_request() {
  python3 -B - "$binding" <<'PY'
import json,sys
b=json.load(open(sys.argv[1])); assert b['phase']=='quiesce' and b['quiesceMode']=='height-halt'
print(json.dumps(dict(version='YNX-OPERATOR-HEIGHT-HALT/v1',targetHeight=b['futureTargetHeight'],chainId=b['chainId'],genesisSHA256=b['consensusGenesisSHA256'],operatorPlanSHA256=b['oldOperatorPlanSHA256'],sessionId=b['heightHaltSessionId']),separators=(',',':')))
PY
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
  local expected_pid expected_ticks observation active pid ticks status
  expected_pid="$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["mainPid"])' "$attempt/original-process.json")"
  expected_ticks="$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["startTicks"])' "$attempt/original-process.json")"
  # At most 60 observations. Timeout only returns UNKNOWN: never stop/kill a
  # live operator, remove the request, or dispatch it a second time.
  for observation in {1..60}; do
    active="$(systemctl show --property ActiveState --value "$unit")"
    pid="$(systemctl show --property MainPID --value "$unit")"
    if [[ "$active" == inactive && "$pid" == 0 ]]; then
      operator_transition_stopped
      [[ "$(systemctl show --property Result --value "$unit")" == success && "$(systemctl show --property ExecMainCode --value "$unit")" == 1 && "$(systemctl show --property ExecMainStatus --value "$unit")" == 0 ]] || operator_transition_fail 'operator did not exit normally after the request; retained UNKNOWN'
      return
    fi
    [[ "$active" == active || "$active" == deactivating ]] || operator_transition_fail 'operator failed while waiting for height halt; retained UNKNOWN'
    if [[ "$pid" != 0 ]]; then
      [[ "$pid" == "$expected_pid" ]] || operator_transition_fail 'operator PID changed after publication; retained UNKNOWN'
      if ticks="$(cat "/proc/$pid/stat")"; then
        [[ "$(printf '%s\n' "$ticks" | sed 's/^.*) //' | awk '{print $20}')" == "$expected_ticks" ]] || operator_transition_fail 'operator process identity changed after publication; retained UNKNOWN'
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

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then operator_transition_remote "$@"; fi
