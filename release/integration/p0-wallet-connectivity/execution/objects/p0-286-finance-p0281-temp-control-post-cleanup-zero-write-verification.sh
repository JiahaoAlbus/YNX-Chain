#!/bin/bash
set -euo pipefail

temp_executor='/tmp/ynx-finance-p0281-finance-p0279-control-cleanup-20260823T170900Z.executor.sh'
temp_lease='/tmp/ynx-finance-p0281-finance-p0279-control-cleanup-20260823T170900Z.json'
parent='/opt/ynx/leases/finance'

tuple_l() { stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha_file() { sha256sum -- "$1" | awk '{print $1}'; }
bytes_file() { wc -c < "$1" | tr -d ' '; }
require_file() {
  local label=$1 path=$2 expected_tuple=$3 expected_sha=$4 actual_tuple actual_sha
  test -f "$path"
  test ! -L "$path"
  actual_tuple=$(tuple_l "$path")
  actual_sha=$(sha_file "$path")
  test "$actual_tuple" = "$expected_tuple"
  test "$actual_sha" = "$expected_sha"
  printf '%s=file|%s|bytes=%s|sha256=%s\n' "$label" "$actual_tuple" "$(bytes_file "$path")" "$actual_sha"
}
http_exact() {
  local label=$1 url=$2 expected=$3 report
  report=$(
    { curl --silent --show-error --max-time 15 -o - -w $'\n__META__%{http_code}\t%{size_download}\t%{content_type}\n' "$url" || true; } |
      perl -MDigest::SHA=sha256_hex -e 'local $/;my$d=<STDIN>;my$m="\n__META__";my$a=rindex($d,$m);if($a<0){print "transport-no-meta";exit 0}my$b=substr($d,0,$a);my$x=substr($d,$a+length($m));if($x!~/\A([0-9]+)\t([0-9]+)\t([^\n]*)\n\z/){print "invalid-meta";exit 0}print "$1:".length($b).":".sha256_hex($b).":".$3'
  )
  test "$report" = "$expected"
  printf '%s=%s\n' "$label" "$report"
}

test ! -e "$temp_executor"
test ! -L "$temp_executor"
test ! -e "$temp_lease"
test ! -L "$temp_lease"
printf 'p0281TemporaryExecutor=absent\np0281TemporaryLease=absent\n'

parent_tuple=$(tuple_l "$parent")
parent_children=$(find -P "$parent" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' ')
test "$parent_tuple" = '64770:4594822:0:0:750:2:4096:directory'
test "$parent_children" = 0
printf 'retainedParent=%s\nretainedParentDirectChildren=%s\n' "$parent_tuple" "$parent_children"

test -L /opt/ynx/finance-current
current_tuple=$(tuple_l /opt/ynx/finance-current)
current_target=$(readlink -- /opt/ynx/finance-current)
current_resolved=$(readlink -f /opt/ynx/finance-current)
test "$current_tuple" = '64770:1312291:0:0:777:1:50:symbolic link'
test "$current_target" = '/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a'
test "$current_resolved" = '/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a'
test "$(tuple_l "$current_resolved")" = '64770:1860506:0:0:755:3:4096:directory'
printf 'current=%s|target=%s|resolved=%s|resolvedTuple=%s\n' "$current_tuple" "$current_target" "$current_resolved" "$(tuple_l "$current_resolved")"

require_file productionEnv /etc/ynx/finance.env '64770:1324724:0:986:640:1:1545:regular file' '854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252'
test ! -e /var/lib/ynx/finance/state.json
test ! -L /var/lib/ynx/finance/state.json
printf 'state=absent\n'
require_file unit /etc/systemd/system/ynx-finance.service '64770:161304:0:0:644:1:515:regular file' '2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b'
require_file caddy /etc/caddy/conf.d/ynx-finance.caddy '64770:1051759:0:0:644:1:255:regular file' 'dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282'

for pair in 'LoadState:loaded' 'ActiveState:active' 'SubState:running' 'MainPID:2241003' 'NRestarts:0' 'FragmentPath:/etc/systemd/system/ynx-finance.service' 'WorkingDirectory:/opt/ynx/finance-current' 'User:ynx' 'Group:ynx'; do
  key=${pair%%:*}; expected=${pair#*:}; actual=$(systemctl show ynx-finance.service -p "$key" --value)
  test "$actual" = "$expected"
  printf 'service%s=%s\n' "$key" "$actual"
done

for origin in 'loopback:http://127.0.0.1:6483' 'public:https://finance.ynxweb4.com'; do
  label=${origin%%:*}; base=${origin#*:}
  http_exact "${label}Root" "$base/" '200:11427:c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53:text/html; charset=utf-8'
  http_exact "${label}Health" "$base/health" '200:485:d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1:application/json; charset=utf-8'
  http_exact "${label}Version" "$base/version" '200:130:39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226:application/json; charset=utf-8'
done

printf 'verificationComplete=true\ncleanupComplete=true\nmutationCount=0\n'
