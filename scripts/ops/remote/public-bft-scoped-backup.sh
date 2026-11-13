#!/usr/bin/env bash
set -Eeuo pipefail

transaction_id="${1:?transaction id is required}"
role="${2:?role is required}"
commit="${3:?commit is required}"
authoritative_release="${4:?authoritative release is required}"
bft_release="${5:?BFT release is required}"
root="${6:?backup root is required}"
include_indexer="${7:?indexer flag is required}"
source_root="${8:?source root is required}"
native_commit="${9:-}"

fail() {
  echo "$1" >&2
  exit 1
}

[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || fail "invalid transaction id"
[[ "$role" =~ ^(primary|singapore|silicon-valley|seoul)$ ]] || fail "invalid role"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]] || fail "invalid commit"
(( $# == 8 || $# == 9 )) || fail "unexpected backup inputs"
if [[ -n "$native_commit" ]]; then
  [[ "$native_commit" =~ ^[0-9a-f]{40}$ && "$native_commit" != "$(printf '0%.0s' {1..40})" ]] || fail "invalid approved native full commit"
  [[ "$authoritative_release" == "ynx-chain-${native_commit:0:12}" || "$authoritative_release" == "ynx-network-surgical-${native_commit:0:12}" ]] || fail "approved native release mismatch"
else
  [[ "$authoritative_release" == "ynx-chain-${commit}" ]] || fail "authoritative release mismatch"
fi
native_fields=""
[[ -z "$native_commit" ]] || native_fields=",\"authoritativeCommit\":\"$native_commit\""
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]] || fail "BFT release mismatch"
[[ "$include_indexer" == "true" || "$include_indexer" == "false" ]] || fail "invalid indexer flag"
[[ "$root" == /* && "$root" != *..* && "$root" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid backup root"
[[ "$source_root" == /* && "$source_root" != *..* && "$source_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid source root"

umask 077
archive="${root}/${role}.tar.gz"
partial="${root}/.${role}.tar.gz.partial"
evidence="${root}/${role}.json"
evidence_partial="${evidence}.partial"
if [[ -n "$native_commit" ]]; then
  for retained in "$archive" "$partial" "$evidence" "$evidence_partial" "${archive}.UNKNOWN" "${evidence}.UNKNOWN" "${root}/${role}-backup-capacity.json"; do
    [[ ! -e "$retained" && ! -L "$retained" ]] || fail "existing native backup/partial/UNKNOWN must be retained"
  done
fi
if [[ -z "$native_commit" ]]; then
  install -d -m 0700 "$root" || fail "cannot create backup root"
fi
test -d "$source_root/etc/ynx" || fail "missing YNX configuration directory"
test -d "$source_root/var/lib/ynx-chain/testnet" || fail "missing authoritative chain state"
test -f "$source_root/etc/systemd/system/ynx-chaind.service" || fail "missing authoritative service unit"
if [[ "$include_indexer" == "true" ]]; then
  test -d "$source_root/var/lib/ynx-chain/indexer" || fail "missing primary indexer state"
fi

paths=(etc/ynx etc/systemd/system/ynx-chaind.service var/lib/ynx-chain/testnet)
for path in \
  etc/systemd/system/ynx-indexerd.service \
  etc/systemd/system/ynx-explorerd.service \
  etc/systemd/system/ynx-faucetd.service \
  etc/systemd/system/ynx-ai-gatewayd.service \
  etc/systemd/system/ynx-payd.service \
  etc/systemd/system/ynx-trustd.service \
  etc/systemd/system/ynx-resourced.service \
  etc/nginx/conf.d/ynx-chain.conf \
  etc/caddy/Caddyfile \
  etc/caddy/ynx-chain.caddy; do
  [[ -e "$source_root/$path" ]] && paths+=("$path")
done
[[ "$include_indexer" == "true" ]] && paths+=(var/lib/ynx-chain/indexer)

# Native same-owner backups retain every prior failure and use only metadata
# before reserving storage. The old eight-argument reuse path is unchanged.
native_backup_archive() {
  python3 - "$1" "$root" "$source_root" "$role" "$partial" "${paths[@]}" <<'PY_NATIVE_BACKUP_CAPACITY'
import json,os,resource,stat,subprocess,sys,time
from pathlib import Path

RESERVE=2<<30  # Original preflight floor, now on the actual backup filesystem.
CORE=('etc/ynx','etc/systemd/system/ynx-chaind.service','var/lib/ynx-chain/testnet')
OPTIONAL=('etc/systemd/system/ynx-indexerd.service','etc/systemd/system/ynx-explorerd.service',
 'etc/systemd/system/ynx-faucetd.service','etc/systemd/system/ynx-ai-gatewayd.service',
 'etc/systemd/system/ynx-payd.service','etc/systemd/system/ynx-trustd.service',
 'etc/systemd/system/ynx-resourced.service','etc/nginx/conf.d/ynx-chain.conf',
 'etc/caddy/Caddyfile','etc/caddy/ynx-chain.caddy','var/lib/ynx-chain/indexer')

def need(ok,message):
    if not ok:raise ValueError(message)

def canonical(path):
    need(path.is_absolute() and path.resolve(strict=True)==path,'original backup path contains an alias')
    return path

def measured(source,paths):
    canonical(source)
    need(len(set(paths))==len(paths) and tuple(paths[:3])==CORE and set(paths)<=set(CORE+OPTIONAL),'original closed backup scope required')
    deadline=time.monotonic()+40
    result={'entries':0,'regularBytes':0,'paddedFileBytes':0}
    def one(info):
        need(time.monotonic()<deadline and result['entries']<1000000,'original metadata work bound reached')
        need(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode),'backup scope contains alias or special entry')
        result['entries']+=1
        if stat.S_ISREG(info.st_mode):
            result['regularBytes']+=info.st_size
            result['paddedFileBytes']+=((info.st_size+511)//512)*512
    def walk(fd,depth):
        need(depth<=64,'original metadata depth bound reached')
        with os.scandir(fd) as entries:
            for entry in entries:
                before=entry.stat(follow_symlinks=False);one(before)
                if stat.S_ISDIR(before.st_mode):
                    child=os.open(entry.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
                    try:
                        now=os.fstat(child)
                        need((now.st_dev,now.st_ino)==(before.st_dev,before.st_ino),'backup directory changed')
                        walk(child,depth+1)
                    finally:os.close(child)
    for name in paths:
        path=source/name;canonical(path.parent);before=path.lstat();one(before)
        if stat.S_ISDIR(before.st_mode):
            fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
            try:
                now=os.fstat(fd);need((now.st_dev,now.st_ino)==(before.st_dev,before.st_ino),'backup root changed')
                walk(fd,0)
            finally:os.close(fd)
    # No deduplication or compression savings. The generous per-entry tar
    # allowance covers normal headers/long names; twice that stream plus 1MiB
    # is an enforced allocation ceiling, not a claim about the actual B size.
    # Live growth or unexpected tar overhead must fail at that same ceiling.
    result['tarAllowanceBytes']=result['paddedFileBytes']+32768*result['entries']+10240
    result['archiveCeilingBytes']=2*result['tarAllowanceBytes']+(1<<20)
    return result

def space(root,measurement):
    parent=root
    while not parent.exists():
        need(not parent.is_symlink(),'backup parent alias');parent=parent.parent
    canonical(parent);need(parent.is_dir(),'backup filesystem parent must be directory')
    info=parent.stat();fs=os.statvfs(parent);available=fs.f_bavail*fs.f_frsize
    required=measurement['archiveCeilingBytes']+RESERVE
    need(available>required,'insufficient original backup filesystem capacity')
    return dict(availableBytes=available,requiredBytes=required,device=info.st_dev,reserveBytes=RESERVE)

def create(root,source,role,partial,paths,measurement):
    canonical(root);need(root.is_dir() and root.stat().st_mode&0o777==0o700,'original private backup root required')
    capacity=space(root,measurement)
    need(role in ('primary','singapore','silicon-valley','seoul') and partial==root/('.'+role+'.tar.gz.partial'),'fixed original backup output required')
    ceiling=measurement['archiveCeilingBytes'];limits=resource.getrlimit(resource.RLIMIT_FSIZE)
    need(all(value==resource.RLIM_INFINITY or value>=ceiling for value in limits),'existing file limit below required backup ceiling')
    record=dict(version='YNX-NATIVE-BACKUP-CAPACITY/v1',role=role,**measurement,**capacity,
        actualCompressedBytes=None,fullFirstImportReady=False,privateBodyReadForMeasurement=False,growthReserved=False)
    fd=os.open(root/(role+'-backup-capacity.json'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as output:
        json.dump(record,output,sort_keys=True);output.write('\n');output.flush();os.fsync(output.fileno())
    directory=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)
    fd=os.open(partial,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    def limit():resource.setrlimit(resource.RLIMIT_FSIZE,(ceiling,ceiling))
    # Same normal tar/gzip bytes and original complete paths. Only its output
    # is an exclusively held FD with a kernel file-size ceiling. No retry,
    # partial cleanup, source mutation, or caller-supplied capacity override.
    with os.fdopen(fd,'wb') as output:
        completed=subprocess.run(['tar','-C',str(source),'-czf','-',*paths],stdout=output,check=False,preexec_fn=limit)
        output.flush();os.fsync(output.fileno())
        need(completed.returncode==0,'original scoped tar failed; retain partial and capacity record')
        need(0<os.fstat(output.fileno()).st_size<=ceiling,'original archive exceeded capacity ceiling')

if __name__=='__main__':
    try:
        mode,root,source,role,partial,*paths=sys.argv[1:]
        need(mode in ('check','create'),'closed backup capacity operation required')
        need(not os.environ.get('TAR_OPTIONS') and not os.environ.get('GZIP'),'archive option override refused')
        root,source,partial=Path(root),Path(source),Path(partial)
        measurement=measured(source,paths);space(root,measurement)
        if mode=='create':create(root,source,role,partial,paths,measurement)
    except Exception as error:
        print('native backup capacity refused; preserve originals/partial/UNKNOWN: '+(str(error) if isinstance(error,ValueError) else type(error).__name__),file=sys.stderr)
        sys.exit(1)
PY_NATIVE_BACKUP_CAPACITY
}
if [[ -n "$native_commit" ]]; then
  native_backup_archive check || fail "native scoped backup capacity refused before reservation"
  install -d -m 0700 "$root" || fail "cannot create backup root"
fi

validate_archive() {
  test -s "$archive" || fail "scoped backup archive is empty"
  tar -tzf "$archive" >/dev/null || fail "scoped backup archive is unreadable"
  while IFS= read -r entry; do
    case "$entry" in
      etc/ynx|etc/ynx/*|\
      etc/systemd/system/ynx-chaind.service|\
      etc/systemd/system/ynx-indexerd.service|\
      etc/systemd/system/ynx-explorerd.service|\
      etc/systemd/system/ynx-faucetd.service|\
      etc/systemd/system/ynx-ai-gatewayd.service|\
      etc/systemd/system/ynx-payd.service|\
      etc/systemd/system/ynx-trustd.service|\
      etc/systemd/system/ynx-resourced.service|\
      etc/nginx/conf.d/ynx-chain.conf|\
      etc/caddy/Caddyfile|etc/caddy/ynx-chain.caddy|\
      var/lib/ynx-chain/testnet|var/lib/ynx-chain/testnet/*|\
      var/lib/ynx-chain/indexer|var/lib/ynx-chain/indexer/*) ;;
      *) echo "unsafe scoped backup entry: $entry" >&2; exit 1 ;;
    esac
  done < <(tar -tzf "$archive")
}

reused=false
if [[ -e "$archive" || -e "$evidence" ]]; then
  test -s "$archive" && test -s "$evidence" || fail "incomplete existing transaction backup"
  validate_archive
  grep -Fq "\"transactionId\":\"${transaction_id}\"" "$evidence" || fail "existing backup transaction mismatch"
  grep -Fq "\"role\":\"${role}\"" "$evidence" || fail "existing backup role mismatch"
  grep -Fq "\"commit\":\"${commit}\"" "$evidence" || fail "existing backup commit mismatch"
  grep -Fq "\"authoritativeRelease\":\"${authoritative_release}\"" "$evidence" || fail "existing backup native release mismatch"
  [[ -z "$native_commit" ]] || grep -Fq "\"authoritativeCommit\":\"${native_commit}\"" "$evidence" || fail "existing backup native commit mismatch"
  grep -Fq "\"bftRelease\":\"${bft_release}\"" "$evidence" || fail "existing backup BFT release mismatch"
  saved_sha="$(sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$evidence")"
  current_sha="$(sha256sum "$archive" | awk '{print $1}')"
  [[ -n "$saved_sha" && "$saved_sha" == "$current_sha" ]] || fail "existing backup checksum mismatch"
  reused=true
else
  if [[ -n "$native_commit" ]]; then
    native_backup_archive create || fail "cannot create bounded native scoped backup archive; retain partial"
  else
    rm -f "$partial" "$evidence_partial"
    tar -C "$source_root" -czf "$partial" "${paths[@]}" || fail "cannot create scoped backup archive"
  fi
  tar -tzf "$partial" >/dev/null || fail "new scoped backup archive is unreadable"
  chmod 0600 "$partial" || fail "cannot restrict scoped backup archive"
  mv "$partial" "$archive" || fail "cannot publish scoped backup archive"
  validate_archive
  current_sha="$(sha256sum "$archive" | awk '{print $1}')"
  printf '{"transactionId":"%s","role":"%s","commit":"%s","authoritativeRelease":"%s"%s,"bftRelease":"%s","archivePath":"%s","sha256":"%s","validated":true}\n' \
    "$transaction_id" "$role" "$commit" "$authoritative_release" "$native_fields" "$bft_release" "$archive" "$current_sha" >"$evidence_partial"
  chmod 0600 "$evidence_partial" || fail "cannot restrict scoped backup evidence"
  mv "$evidence_partial" "$evidence" || fail "cannot publish scoped backup evidence"
fi

printf 'transactionId=%s\nrole=%s\ncommit=%s\nauthoritativeRelease=%s\nbftRelease=%s\narchive=%s\nsha256=%s\nvalidated=true\nreused=%s\n' \
  "$transaction_id" "$role" "$commit" "$authoritative_release" "$bft_release" "$archive" "$current_sha" "$reused"
