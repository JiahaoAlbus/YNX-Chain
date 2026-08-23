#!/usr/bin/env bash
set -euo pipefail

tuple(){ stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
inventory(){
  local root=$1 item kind
  (
    cd "$root"
    while IFS= read -r -d '' item; do
      kind=$(stat -c '%F' -- "$item")
      printf '%s\0%s\0%s\0' "$item" "$kind" "$(stat -c '%u:%g:%a:%h:%s' -- "$item")"
      case "$kind" in
        'regular file') sha "$item" | tr '\n' '\0' ;;
        'symbolic link') readlink -- "$item" | tr '\n' '\0' ;;
        *) printf '\0' ;;
      esac
    done < <(find . -mindepth 1 -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}
children(){ find -P "$1" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' '; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
http_exact(){
  local label=$1 url=$2 expected=$3 actual
  actual=$({ curl --silent --show-error --max-time 15 -o - -w $'\n__META__%{http_code}\t%{size_download}\t%{content_type}\n' "$url" || true; } | perl -MDigest::SHA=sha256_hex -e 'local $/;my$d=<STDIN>;my$m="\n__META__";my$a=rindex($d,$m);die if $a<0;my$b=substr($d,0,$a);my$x=substr($d,$a+length($m));die if $x!~/\A([0-9]+)\t([0-9]+)\t([^\n]*)\n\z/;print "$1:".length($b).":".sha256_hex($b).":".$3')
  case "$actual" in "$expected"*) ;; *) exit 71;; esac
  printf '%s=%s|%s\n' "$label" "$url" "$actual"
}

for path in \
  /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.executor.sh.pending \
  /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.executor.sh \
  /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.json.pending \
  /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.json \
  /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.manual-rollback.json.pending \
  /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.manual-rollback.json \
  /opt/ynx/stage/finance/p0294-finance-phase3-20260824t020000z \
  /opt/ynx/stage/finance/p0294-finance-phase3-20260824t020000z/stage \
  /var/backups/ynx-finance/p0294-finance-phase3-20260824t020000z \
  /var/backups/ynx-finance/p0294-finance-phase3-20260824t020000z/backup \
  /opt/ynx/releases/finance/p0294-finance-phase3-20260824t020000z \
  /opt/ynx/releases/finance/p0294-finance-phase3-20260824t020000z/ynx-finance-7824af677dd0 \
  /opt/ynx/finance-current.next \
  /opt/ynx/finance-current.rollback
do absent "$path"; done

test "$(tuple /opt/ynx/leases/finance)" = '64770:4594822:0:0:750:2:4096:directory'
test "$(children /opt/ynx/leases/finance)" = 0
test "$(inventory /opt/ynx/leases/finance)" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
test "$(tuple /opt/ynx/stage/finance)" = '64770:3450041:0:0:750:5:4096:directory'
test "$(children /opt/ynx/stage/finance)" = 3
test "$(inventory /opt/ynx/stage/finance)" = 0d11124b36a42c6201f7e0d491fd20279ea47950554f92c6b1cc960aaa0fee91
test "$(tuple /var/backups/ynx-finance)" = '64770:1481354:0:0:755:11:4096:directory'
test "$(children /var/backups/ynx-finance)" = 9
test "$(inventory /var/backups/ynx-finance)" = a59008acfeccfb0a2f88de5b029871b713b42d0bf43ad1ba87786c962e6659be
test "$(tuple /opt/ynx/releases/finance)" = '64770:1607576:0:0:755:7:4096:directory'
test "$(children /opt/ynx/releases/finance)" = 5
test "$(inventory /opt/ynx/releases/finance)" = 3b8985ca358662dc1e43b027b859b043a3ea974482f5b4b347adbe8bd7a01c4c

test -L /opt/ynx/finance-current
test "$(tuple /opt/ynx/finance-current)" = '64770:1312291:0:0:777:1:50:symbolic link'
test "$(readlink /opt/ynx/finance-current)" = /opt/ynx/releases/finance/ynx-finance-3b2383f5c18a
test "$(tuple /opt/ynx/finance-current/ynx-finance)" = '64770:1860512:0:0:755:1:8573112:regular file'
test "$(sha /opt/ynx/finance-current/ynx-finance)" = 0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f
test "$(sha /etc/ynx/finance.env)" = 854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252
test "$(sha /etc/systemd/system/ynx-finance.service)" = 2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b
test "$(sha /etc/caddy/conf.d/ynx-finance.caddy)" = dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282
absent /var/lib/ynx/finance/state.json
systemctl is-active --quiet ynx-finance.service
test "$(systemctl show -p MainPID --value ynx-finance.service)" = 2241003
test "$(systemctl show -p NRestarts --value ynx-finance.service)" = 0

printf 'verification=FINANCE_P0294_FOUR_RESIDUE_CLEANUP_ZERO_WRITE\nallP0294Paths=absent\nparentsRestored=true\ncurrentTarget=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a\nservicePid=2241003\nserviceNRestarts=0\n'
http_exact loopbackRoot http://127.0.0.1:6483/ '200:11427:c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53:text/html'
http_exact loopbackHealth http://127.0.0.1:6483/health '200:485:d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1:application/json'
http_exact loopbackVersion http://127.0.0.1:6483/version '200:130:39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226:application/json'
http_exact publicRoot https://finance.ynxweb4.com/ '200:11427:c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53:text/html'
http_exact publicHealth https://finance.ynxweb4.com/health '200:485:d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1:application/json'
http_exact publicVersion https://finance.ynxweb4.com/version '200:130:39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226:application/json'
printf 'remoteExitStatus=0\nverificationComplete=true\ncleanupComplete=true\nmutationCount=0\n'
