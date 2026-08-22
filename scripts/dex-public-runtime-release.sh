#!/usr/bin/env bash
set -euo pipefail

# A Central-signed binding is deliberately required at execution time.  This
# script cannot select a host, release, prior state, or public hash itself.
if [[ $# -ne 2 || ( "$1" != deploy && "$1" != rollback ) ]]; then
  echo "usage: $0 <deploy|rollback> <central-signed-binding.json>" >&2
  exit 64
fi

mode=$1
binding=$2
test -f "$binding" && test ! -L "$binding"
eval "$(python3 - "$binding" <<'PY'
import json, os, re, shlex, sys

data=json.load(open(sys.argv[1], encoding='utf-8'))
def get(*keys):
    value=data
    for key in keys: value=value[key]
    return value
def exact(value, pattern, label):
    if not re.fullmatch(pattern, str(value)): raise SystemExit(f'unsafe {label}')
    return str(value)
source=exact(get('source','commit'),r'[0-9a-f]{40}','source commit')
tree=exact(get('source','tree'),r'[0-9a-f]{40}','source tree')
if source!='7563dc6604540715f87d4e1e46b4ed41feaf6235' or tree!='a7edd2575d8f6f6d21abbd10baec26dcfbdbddbb': raise SystemExit('unexpected DEX source binding')
lease=exact(get('lease','id'),r'[A-Za-z0-9._-]{8,128}','lease id')
archive=exact(get('candidate','archivePath'),r'/opt/ynx/stage/dex/[A-Za-z0-9._/-]+\.tar\.gz','archive path')
archive_sha=exact(get('candidate','archiveSha256'),r'[0-9a-f]{64}','archive hash')
if archive_sha!='4d80b76890191ff93feb75e3bd4214078d1ad9e269d54829f4c3781e082fd092': raise SystemExit('unexpected candidate archive')
archive_bytes=int(get('candidate','archiveBytes'))
if archive_bytes!=3124626: raise SystemExit('unexpected candidate archive bytes')
release=exact(get('candidate','releaseDirectory'),r'/opt/ynx/releases/dex/ynx-dex-7563dc660454','release directory')
current=exact(get('runtime','currentSymlink'),r'/opt/ynx/dex-current','current symlink')
previous=exact(get('runtime','previousRelease'),r'/opt/ynx/releases/dex/ynx-dex-[A-Za-z0-9._-]+','previous release')
service=exact(get('runtime','service'),r'ynx-dex-indexerd','service')
for name in ('unit','env','caddy'):
    path=exact(get('runtime',name,'path'),r'/etc/[A-Za-z0-9._/-]+','%s path'%name)
    digest=exact(get('runtime',name,'sha256'),r'[0-9a-f]{64}','%s hash'%name)
    globals()[name.upper()+'_PATH']=path; globals()[name.upper()+'_SHA']=digest
state=exact(get('runtime','state','path'),r'/var/lib/ynx/dex/[A-Za-z0-9._-]+\.json','state path')
state_absent=get('runtime','state','absent')
state_sha=get('runtime','state','sha256')
if not isinstance(state_absent,bool) or (state_absent and state_sha is not None) or (not state_absent and not re.fullmatch(r'[0-9a-f]{64}',str(state_sha))): raise SystemExit('invalid state binding')
backup=exact(get('backup','directory'),r'/opt/ynx/backups/dex/'+re.escape(lease),'backup directory')
origin=exact(get('public','origin'),r'https://dex\.ynxweb4\.com','public origin')
for name in ('previousVersionSha256','previousHealthSha256','previousIndexSha256','candidateVersionSha256','candidateHealthSha256','candidateIndexSha256'):
    globals()[name]=exact(get('public',name),r'[0-9a-f]{64}',name)
values={'LEASE_ID':lease,'ARCHIVE':archive,'ARCHIVE_SHA':archive_sha,'ARCHIVE_BYTES':archive_bytes,'RELEASE':release,'CURRENT':current,'PREVIOUS':previous,'SERVICE':service,'UNIT_PATH':UNIT_PATH,'UNIT_SHA':UNIT_SHA,'ENV_PATH':ENV_PATH,'ENV_SHA':ENV_SHA,'CADDY_PATH':CADDY_PATH,'CADDY_SHA':CADDY_SHA,'STATE_PATH':state,'STATE_ABSENT':'true' if state_absent else 'false','STATE_SHA':state_sha or '','BACKUP':backup,'ORIGIN':origin}
values.update({key:globals()[key] for key in ('previousVersionSha256','previousHealthSha256','previousIndexSha256','candidateVersionSha256','candidateHealthSha256','candidateIndexSha256')})
for key,value in values.items(): print(f'{key}={shlex.quote(str(value))}')
PY
)"

receipt_dir="$BACKUP/receipts"
stage="$BACKUP/stage"
state_backup="$BACKUP/state-before.json"
state_receipt="$receipt_dir/state-created.json"
switched=false

hash_file(){ sha256sum "$1" | awk '{print $1}'; }
record(){ mkdir -p "$receipt_dir"; python3 - "$receipt_dir/$1" "$2" <<'PY'
import json, os, sys, time
path, payload=sys.argv[1:]
with open(path,'x',encoding='utf-8') as f: json.dump({'schemaVersion':1,'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'payload':json.loads(payload)},f,indent=2); f.write('\n')
os.chmod(path,0o600)
PY
}
http_hash(){ curl --fail --silent --show-error --max-time 10 "$1" | sha256sum | awk '{print $1}'; }
assert_live_binding(){
  test "$(readlink -f "$CURRENT")" = "$PREVIOUS"
  test "$(hash_file "$UNIT_PATH")" = "$UNIT_SHA"
  test "$(hash_file "$ENV_PATH")" = "$ENV_SHA"
  test "$(hash_file "$CADDY_PATH")" = "$CADDY_SHA"
  systemctl is-active --quiet "$SERVICE"
  if [[ "$STATE_ABSENT" == true ]]; then test ! -e "$STATE_PATH" && test ! -L "$STATE_PATH"; else test "$(hash_file "$STATE_PATH")" = "$STATE_SHA"; fi
  test "$(http_hash "$ORIGIN/version")" = "$previousVersionSha256"
  test "$(http_hash "$ORIGIN/health")" = "$previousHealthSha256"
  test "$(http_hash "$ORIGIN/")" = "$previousIndexSha256"
}
restore(){
  systemctl stop "$SERVICE"
  if [[ -f "$state_backup" ]]; then install -d -m 0700 "$(dirname "$STATE_PATH")"; restore_tmp="$(mktemp "$(dirname "$STATE_PATH")/.dex-state.restore.XXXXXX")"; cp --preserve=mode,ownership,timestamps "$state_backup" "$restore_tmp"; mv -Tf "$restore_tmp" "$STATE_PATH"; fi
  if [[ "$STATE_ABSENT" == true && -e "$STATE_PATH" ]]; then python3 - "$state_receipt" "$STATE_PATH" <<'PY'
import json, os, sys
receipt=json.load(open(sys.argv[1],encoding='utf-8'))['payload']
stat=os.lstat(sys.argv[2])
if str(stat.st_dev)!=receipt.get('createdDevice') or str(stat.st_ino)!=receipt.get('createdInode'): raise SystemExit('refuse to delete a different state file')
os.unlink(sys.argv[2])
PY
  fi
  next="$CURRENT.rollback"; test ! -e "$next" && test ! -L "$next"; ln -s "$PREVIOUS" "$next"; mv -Tf "$next" "$CURRENT"
  systemctl start "$SERVICE"
  test "$(http_hash "$ORIGIN/version")" = "$previousVersionSha256"
  test "$(http_hash "$ORIGIN/health")" = "$previousHealthSha256"
  test "$(http_hash "$ORIGIN/")" = "$previousIndexSha256"
  record rollback.json "{\"restoredRelease\":\"$PREVIOUS\"}"
}
capture_created_state(){
  if [[ "$STATE_ABSENT" == true && -e "$STATE_PATH" ]]; then
    state_stat="$(python3 - "$STATE_PATH" <<'PY'
import os,sys
s=os.lstat(sys.argv[1]); print(f'{s.st_dev}:{s.st_ino}')
PY
)"
    record state-created.json "{\"createdDevice\":\"${state_stat%%:*}\",\"createdInode\":\"${state_stat##*:}\"}"
  fi
}

if [[ "$mode" == rollback ]]; then restore; exit 0; fi

test -f "$ARCHIVE" && test ! -L "$ARCHIVE"
test "$(wc -c < "$ARCHIVE" | tr -d ' ')" = "$ARCHIVE_BYTES"
test "$(hash_file "$ARCHIVE")" = "$ARCHIVE_SHA"
test ! -e "$RELEASE" && test ! -L "$RELEASE"
test ! -e "$BACKUP" && test ! -L "$BACKUP"
assert_live_binding
mkdir -p -m 0700 "$BACKUP" "$receipt_dir" "$stage"
record preflight.json "{\"previousRelease\":\"$PREVIOUS\",\"candidateRelease\":\"$RELEASE\",\"archiveSha256\":\"$ARCHIVE_SHA\"}"
if [[ "$STATE_ABSENT" == false ]]; then cp --preserve=mode,ownership,timestamps "$STATE_PATH" "$state_backup"; test "$(hash_file "$state_backup")" = "$STATE_SHA"; else record state-before.json '{"absent":true}'; fi
tar -xzf "$ARCHIVE" -C "$stage"
candidate="$stage/$(basename "$RELEASE")"
test -d "$candidate" && test ! -L "$candidate" && test -x "$candidate/ynx-dex-indexerd"
(cd "$candidate" && sha256sum -c SHA256SUMS)
mv "$candidate" "$RELEASE"
next="$CURRENT.next"; test ! -e "$next" && test ! -L "$next"; ln -s "$RELEASE" "$next"; mv -Tf "$next" "$CURRENT"; switched=true
if ! systemctl restart "$SERVICE"; then capture_created_state; restore; exit 1; fi
capture_created_state
if ! test "$(http_hash "$ORIGIN/version")" = "$candidateVersionSha256" || ! test "$(http_hash "$ORIGIN/health")" = "$candidateHealthSha256" || ! test "$(http_hash "$ORIGIN/")" = "$candidateIndexSha256"; then restore; exit 1; fi
record deployed.json "{\"activeRelease\":\"$RELEASE\",\"sourceCommit\":\"7563dc6604540715f87d4e1e46b4ed41feaf6235\"}"
