#!/usr/bin/env bash
set -Eeuo pipefail

operation="${1:?switch or rollback is required}"
transaction_id="${2:?transaction id is required}"
commit="${3:?commit is required}"
bft_release="${4:?BFT release is required}"
remote_root="${5:?remote evidence root is required}"
ingress_mode="${6:-legacy}"

fail() { echo "$1" >&2; exit 1; }

[[ "$operation" == "switch" || "$operation" == "rollback" ]] || fail "invalid ingress operation"
[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || fail "invalid transaction id"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]] || fail "invalid commit"
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]] || fail "BFT release mismatch"
[[ "$remote_root" == /* && "$remote_root" != *..* && "$remote_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid remote evidence root"
[[ "$ingress_mode" == legacy || "$ingress_mode" == single-app-gateway || "$ingress_mode" == single-app-gateway-json ]] || fail "invalid explicit ingress mode"

single_app_gateway_ingress() {
  local operator_pin="$1" runtime_commit="$2" runtime_pin="$3" gateway_pin="$4" config_root="$5"
  local json_manifest="${6:-}" json_manifest_pin="${7:-}" json_helper
  json_helper="$(cd "$(dirname "$0")" && pwd)/public-bft-caddy-json.py"
  local root source_test=false public_changed=true pin tool resolved
  for pin in "$operator_pin" "$runtime_pin" "$gateway_pin"; do
    [[ "$pin" =~ ^[0-9a-f]{64}$ && "$pin" != "$(printf '0%.0s' {1..64})" ]] || fail "independent nonzero gateway/operator/runtime pins are required"
  done
  [[ "$runtime_commit" =~ ^[0-9a-f]{40}$ && "${runtime_commit:0:12}" == "$commit" ]] || fail "gateway runtime commit differs from transaction"
  [[ "$config_root" =~ ^/[A-Za-z0-9._/-]+$ && "$config_root" != *..* && -d "$config_root" && ! -L "$config_root" ]] || fail "invalid ingress configuration root"
  [[ "$(realpath -e "$config_root")" == "$config_root" ]] || fail "configuration root is not canonical"
  root="${config_root%/}"
  if [[ "$config_root" != / ]]; then
    # A non-production root is only a source test. It cannot run host service
    # commands, inspect host /proc, or report a real public ingress change.
    [[ "${PUBLIC_BFT_INGRESS_SOURCE_TEST_ONLY:-}" == yes && "$remote_root" == "$root/"* ]] || fail "alternate root is source-test-only"
    for tool in systemctl caddy curl timeout install chown sleep; do
      resolved="$(command -v "$tool")"
      [[ "$(realpath -e "$resolved")" == "$root/test-bin/$tool" ]] || fail "source test requires isolated command stubs"
    done
    source_test=true; public_changed=false
  else
    [[ "${PUBLIC_BFT_INGRESS_SOURCE_TEST_ONLY:-}" != yes && "$(id -u)" == 0 ]] || fail "production ingress requires the original privileged root"
  fi
  local env_root="$root/etc/ynx/public-bft-cutover/$transaction_id"
  local dependency_root="$root/var/lib/ynx-chain/public-bft-cutover/$transaction_id/dependencies"
  local source_attempt="$dependency_root/gateway-start-attempt"
  local gateway_unit=ynx-bft-gateway-candidate.service
  local unit="$root/etc/systemd/system/$gateway_unit" launcher="$dependency_root/start-gateway.sh"
  local gateway="$root/var/lib/ynx-chain/consensus-candidate/bin/ynx-bft-gatewayd"
  local candidate_env="$env_root/candidate.env" config="$root/etc/caddy/ynx-chain.caddy" master="$root/etc/caddy/Caddyfile"
  if [[ "$ingress_mode" == single-app-gateway-json ]]; then
    [[ "$json_manifest" == /* && "$json_manifest" != *..* && "$json_manifest" =~ ^/[A-Za-z0-9._/-]+$ && "$json_manifest_pin" =~ ^[0-9a-f]{64}$ && "$json_manifest_pin" != "$(printf '0%.0s' {1..64})" ]] || fail "independent JSON source manifest and pin are required"
    [[ -f "$json_helper" && ! -L "$json_helper" && "$(realpath -e "$json_helper")" == "$json_helper" ]] || fail "same-source JSON helper is unavailable"
    config="$root/etc/caddy/ynx-chain.json"
  fi
  local ingress="$remote_root/ingress" migration_height migration_hash original_pid original_inode coordinates observed_pid observed_inode
  coordinates="$(python3 - "$env_root/ownership.json" "$remote_root/primary-dependencies-start.json" "$source_attempt/intent.json" "$transaction_id" "$commit" "$bft_release" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$source_attempt" <<'PY'
import hashlib, json, os, re, stat, sys
owner, receipt, intent, tx, commit, release, operator, runtime, source, gateway, attempt = sys.argv[1:]
def unique(pairs):
    out = {}
    for k, v in pairs:
        if k in out: raise ValueError('duplicate gateway source field')
        out[k] = v
    return out
def load(p):
    s = os.lstat(p)
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_mode & 0o077 or os.path.realpath(p) != p or s.st_size > 65536:
        raise ValueError('gateway source must remain an original private regular file')
    with open(p, 'rb') as f: return json.load(f, object_pairs_hook=unique)
values = [load(p) for p in (owner, receipt, intent)]
with open(owner, 'rb') as a, open(receipt, 'rb') as b:
    if a.read() != b.read(): raise ValueError('gateway ownership must preserve the exact original completion receipt')
expected = dict(transactionId=tx, commit=commit, bftRelease=release, mode='single-app-gateway', operatorPlanSHA256=operator, runtimeCommit=runtime, runtimeSOURCEsha256=source, gatewaySHA256=gateway)
for value in values:
    if any(value.get(k) != v for k, v in expected.items()): raise ValueError('gateway source differs from independent transaction pins')
if values[0] != values[1]: raise ValueError('gateway ownership and original completion receipt differ')
v = values[1]
if v.get('version') != 'YNX-SINGLE-APP-GATEWAY-START/v1' or v.get('dependenciesActive') is not True or v.get('parallelCandidateOnly') is not True or v.get('publicIngressChanged') is not False or v.get('pqActivationVerified') is not False or v.get('reused') is not False or v.get('dryRun', False) is not False:
    raise ValueError('completed gateway-only activation evidence is required')
h, bh = v.get('migrationHeight'), v.get('migrationBlockHash')
if type(h) is not int or h < 1 or not isinstance(bh, str) or not re.fullmatch('[0-9a-f]{64}', bh): raise ValueError('invalid original migration coordinates')
for key, name in [('unitSHA256','gateway.service'), ('launcherSHA256','start-gateway.sh'), ('environmentSHA256','candidate.env')]:
    p=os.path.join(attempt,name); s=os.lstat(p)
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or os.path.realpath(p) != p or s.st_size > 65536: raise ValueError('gateway activation snapshot is not an original bounded file')
    with open(p,'rb') as f: digest=hashlib.sha256(f.read()).hexdigest()
    if v.get(key) != digest: raise ValueError('gateway activation snapshot differs from original receipt')
pid, inode = v.get('mainPid'), v.get('runningExecutableDeviceInode')
if not isinstance(pid,str) or not re.fullmatch('[1-9][0-9]*',pid) or int(pid)<2 or not isinstance(inode,str) or not re.fullmatch('[0-9]+:[0-9]+',inode) or v.get('runningExecutableSHA256') != gateway:
    raise ValueError('original gateway running identity is absent')
print(h, bh, pid, inode)
PY
)" || fail "original gateway source validation failed"
  read -r migration_height migration_hash original_pid original_inode <<<"$coordinates"
  local file
  local original_files=("$unit" "$launcher" "$candidate_env" "$source_attempt/gateway.service" "$source_attempt/start-gateway.sh" "$source_attempt/candidate.env" "$config")
  [[ "$ingress_mode" == single-app-gateway-json ]] || original_files+=("$master")
  for file in "${original_files[@]}"; do
    [[ -f "$file" && ! -L "$file" && "$(realpath -e "$file")" == "$file" && "$(stat -c %h "$file")" == 1 ]] || fail "gateway/ingress original file is missing or replaced"
  done
  cmp "$source_attempt/gateway.service" "$unit" >/dev/null || fail "gateway unit differs from its original activation"
  cmp "$source_attempt/start-gateway.sh" "$launcher" >/dev/null || fail "gateway launcher differs from its original activation"
  if [[ "$operation" == switch ]]; then
    [[ ! -e "$ingress" && ! -L "$ingress" ]] || fail "original ingress attempt exists; retain UNKNOWN/completion without resending switch"
  else
    [[ -d "$ingress" && ! -L "$ingress" && -s "$ingress/switch.json" ]] || fail "completed original RPC switch is required; partial UNKNOWN is not automatic rollback authority"
    if [[ "$ingress_mode" == single-app-gateway-json ]]; then
      [[ ! -e "$ingress/rollback-attempt" && ! -L "$ingress/rollback-attempt" ]] || fail "original rollback attempt exists; retain UNKNOWN without retry"
    fi
  fi
  systemctl is-active --quiet caddy || fail "single-App RPC ingress requires active original Caddy; no alternate ingress fallback"

  # A running admin config can differ from the on-disk Caddyfile. Reloading a
  # default/stale disk file would erase unrelated loaded routes. Never derive
  # the current whole-site config from a managed file that is not imported.
  # Compare every JSON value (including other apps/routes), without logging it.
  caddy_config_semantic_hash() {
    python3 -c '
import hashlib,json,sys
def unique(pairs):
    out={}
    for k,v in pairs:
        if k in out: raise ValueError("duplicate")
        out[k]=v
    return out
def constant(_): raise ValueError("nonfinite")
try:
    raw=sys.stdin.buffer.read((16<<20)+1)
    if not raw or len(raw)>16<<20 or b"\0" in raw: raise ValueError("bound")
    v=json.loads(raw.decode("utf-8"),object_pairs_hook=unique,parse_constant=constant)
    if type(v) is not dict: raise ValueError("shape")
    apps=v.get("apps",{})
    if type(apps) is not dict: raise ValueError("shape")
    http=apps.get("http",{})
    if type(http) is not dict: raise ValueError("shape")
    servers=http.get("servers",{})
    if type(servers) is not dict or any(type(s) is not dict or ("routes" in s and type(s["routes"]) is not list) for s in servers.values()): raise ValueError("shape")
    encoded=json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False).encode()
    print(hashlib.sha256(encoded).hexdigest())
except Exception:
    sys.exit(1)
'
  }
  local caddy_original_semantic caddy_original_master caddy_original_managed caddy_original_unit
  local caddy_current_semantic caddy_current_master caddy_current_managed caddy_current_unit
  caddy_live_disk_guard() {
    local expected="${1:-}" expected_managed="${2:-}" pid before after loaded disk start reload prefix master_sha managed_sha unit_sha caddy_program="$root/usr/bin/caddy" caddy_unit="$root/usr/lib/systemd/system/caddy.service"
    [[ -f "$caddy_unit" && ! -L "$caddy_unit" && "$(realpath -e "$caddy_unit")" == "$caddy_unit" && "$(stat -c %h "$caddy_unit")" == 1 ]] || fail "CADDY_ORIGINAL_UNIT_UNAVAILABLE"
    [[ "$(systemctl show -p FragmentPath --value caddy.service)" == "$caddy_unit" && -z "$(systemctl show -p DropInPaths --value caddy.service)" && "$(systemctl show -p User --value caddy.service)" == caddy && "$(systemctl show -p Group --value caddy.service)" == caddy ]] || fail "CADDY_ORIGINAL_UNIT_MISMATCH"
    start="$(systemctl show -p ExecStart --value caddy.service)"
    prefix="{ path=$caddy_program ; argv[]=$caddy_program run --environ --config $master ; ignore_errors=no ; "
    [[ "$start" == "$prefix"* && "${start#"$prefix"}" != *'argv[]='* ]] || fail "CADDY_ORIGINAL_START_MISMATCH"
    reload="$(systemctl show -p ExecReload --value caddy.service)"
    prefix="{ path=$caddy_program ; argv[]=$caddy_program reload --config $master --force ; ignore_errors=no ; "
    [[ "$reload" == "$prefix"* && "${reload#"$prefix"}" != *'argv[]='* ]] || fail "CADDY_ORIGINAL_RELOAD_MISMATCH"
    pid="$(systemctl show -p MainPID --value caddy.service)"
    [[ "$pid" =~ ^[1-9][0-9]*$ && "$pid" != 1 ]] || fail "CADDY_ORIGINAL_PID_UNAVAILABLE"
    before="$(stat -Lc '%d:%i' "$root/proc/$pid/exe" 2>/dev/null)" || fail "CADDY_ORIGINAL_EXECUTABLE_UNAVAILABLE"
    [[ "$before" == "$(stat -Lc '%d:%i' "$caddy_program" 2>/dev/null)" ]] || fail "CADDY_ORIGINAL_EXECUTABLE_MISMATCH"
    python3 - "$root/proc/$pid/cmdline" "$caddy_program" "$master" <<'PY' >/dev/null 2>&1 || fail "CADDY_ORIGINAL_ARGV_MISMATCH"
import sys
p,binary,master=sys.argv[1:]
with open(p,'rb') as f: raw=f.read(65537)
if raw!=b'\0'.join(x.encode() for x in [binary,'run','--environ','--config',master])+b'\0': raise ValueError('original argv')
PY
    master_sha="$(sha256sum "$master" | awk '{print $1}')"
    managed_sha="$(sha256sum "$config" | awk '{print $1}')"
    unit_sha="$(sha256sum "$caddy_unit" | awk '{print $1}')"
    python3 - "$caddy_unit" "$caddy_program" "$master" <<'PY' >/dev/null 2>&1 || fail "CADDY_ORIGINAL_UNIT_CONTENT_MISMATCH"
import sys
p,binary,master=sys.argv[1:]
with open(p,'rb') as f: raw=f.read(65537)
if len(raw)>65536 or b'\0' in raw: raise ValueError('unit bound')
expected={'User':'caddy','Group':'caddy','ExecStart':binary+' run --environ --config '+master,'ExecReload':binary+' reload --config '+master+' --force'}
actual={k:[] for k in expected}; section=''
for line in raw.decode('utf-8').splitlines():
    line=line.strip()
    if not line or line.startswith(('#',';')): continue
    if line.startswith('[') and line.endswith(']'): section=line; continue
    key,sep,value=line.partition('=')
    if section=='[Service]' and sep and key.strip() in expected: actual[key.strip()].append(value.strip())
if any(actual[k]!=[v] for k,v in expected.items()): raise ValueError('unit source')
PY
    disk="$(caddy adapt --config "$master" --adapter caddyfile 2>/dev/null | caddy_config_semantic_hash)" || fail "CADDY_DISK_CONFIG_INVALID"
    loaded="$(curl --disable --request GET --noproxy '*' --max-redirs 0 --connect-timeout 5 --max-time 10 --max-filesize 16777216 -fsS http://127.0.0.1:2019/config/ 2>/dev/null | caddy_config_semantic_hash)" || fail "CADDY_LOADED_CONFIG_UNAVAILABLE_OR_INVALID"
    [[ "$disk" == "$loaded" ]] || fail "CADDY_LOADED_DISK_CONFIG_MISMATCH"
    after="$(stat -Lc '%d:%i' "$root/proc/$pid/exe" 2>/dev/null)" || fail "CADDY_ORIGINAL_EXECUTABLE_UNAVAILABLE"
    [[ "$before" == "$after" && "$(systemctl show -p MainPID --value caddy.service)" == "$pid" ]] || fail "CADDY_ORIGINAL_RUNNING_IDENTITY_CHANGED"
    [[ "$(sha256sum "$master" | awk '{print $1}')" == "$master_sha" && "$(sha256sum "$config" | awk '{print $1}')" == "$managed_sha" && "$(sha256sum "$caddy_unit" | awk '{print $1}')" == "$unit_sha" ]] || fail "CADDY_ORIGINAL_CONFIG_CHANGED_DURING_READBACK"
    if [[ -n "$expected" ]]; then
      [[ "$loaded" == "$expected" ]] || fail "CADDY_ORIGINAL_CONFIG_CHANGED_BEFORE_MUTATION"
    fi
    if [[ -n "$expected" || -n "$expected_managed" ]]; then
      [[ "$master_sha" == "$caddy_original_master" && "$managed_sha" == "${expected_managed:-$caddy_original_managed}" && "$unit_sha" == "$caddy_original_unit" ]] || fail "CADDY_ORIGINAL_CONFIG_CHANGED_BEFORE_MUTATION"
    fi
    caddy_current_semantic="$loaded"
    caddy_current_master="$master_sha"; caddy_current_managed="$managed_sha"; caddy_current_unit="$unit_sha"
  }
  # This readonly guard intentionally precedes the old import check. A default
  # master plus a live multi-site config must fail for the real reload hazard.
  if [[ "$ingress_mode" != single-app-gateway-json ]]; then
    caddy_live_disk_guard
    caddy_original_semantic="$caddy_current_semantic"
    caddy_original_master="$caddy_current_master"
    caddy_original_managed="$caddy_current_managed"
    caddy_original_unit="$caddy_current_unit"
    awk -v p="$config" '$1 == "import" && $2 == p && NF == 2 { found++ } END { exit found != 1 }' "$master" || fail "original Caddyfile does not import the managed RPC config exactly once"
  fi

  gateway_running_source() {
    local authorization="$1" expected_env="$2" original="${3:-false}" pid before after loaded prefix
    cmp "$expected_env" "$candidate_env" >/dev/null || fail "gateway environment differs from the expected original projection"
    [[ "$(systemctl show -p FragmentPath --value "$gateway_unit")" == "$unit" && -z "$(systemctl show -p DropInPaths --value "$gateway_unit")" ]] || fail "gateway unit source/drop-ins differ"
    loaded="$(systemctl show -p ExecStart --value "$gateway_unit")"
    prefix="{ path=/usr/bin/env ; argv[]=/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash $launcher ; ignore_errors=no ; "
    [[ "$loaded" == "$prefix"* && "${loaded#"$prefix"}" != *'argv[]='* ]] || fail "gateway loaded ExecStart differs from original launcher"
    systemctl is-active --quiet "$gateway_unit" || fail "original gateway is not active"
    pid="$(systemctl show -p MainPID --value "$gateway_unit")"
    [[ "$pid" =~ ^[1-9][0-9]*$ && "$pid" != 1 ]] || fail "gateway MainPID is unavailable"
    before="$(stat -Lc '%d:%i' "$root/proc/$pid/exe")" || return $?
    [[ "$original" != true || ( "$pid" == "$original_pid" && "$before" == "$original_inode" ) ]] || fail "gateway process differs from the original startup observation"
    printf '%s  %s\n' "$gateway_pin" "$root/proc/$pid/exe" | sha256sum --strict -c - >/dev/null || fail "running gateway executable differs from independent original binary pin"
    python3 - "$root/proc/$pid/cmdline" "$root/proc/$pid/environ" "$gateway" "$migration_height" "$migration_hash" "$authorization" "$root/var/lib/ynx-chain/mutation-freeze.json" <<'PY'
import sys
cmd, env, binary, height, block, authorized, marker = sys.argv[1:]
expected = [binary, '--http', '127.0.0.1:27620', '--comet-rpc', 'http://127.0.0.1:27757', '--migration-height', height, '--migration-block-hash', block, '--public-cutover-authorized='+authorized]
with open(cmd, 'rb') as f:
    if f.read(65537) != b'\0'.join(x.encode() for x in expected)+b'\0': raise ValueError('running gateway argv differs')
with open(env, 'rb') as f:
    raw=f.read(65537)
    if not raw.endswith(b'\0') or sorted(raw[:-1].split(b'\0')) != sorted([b'PATH=/usr/bin:/bin', ('YNX_MUTATION_FREEZE_FILE='+marker).encode()]): raise ValueError('running gateway environment differs')
PY
    after="$(stat -Lc '%d:%i' "$root/proc/$pid/exe")" || return $?
    [[ "$before" == "$after" && "$(systemctl show -p MainPID --value "$gateway_unit")" == "$pid" ]] || fail "gateway running identity changed during source readback"
    observed_pid="$pid"; observed_inode="$after"
  }
  gateway_ready() {
    local expected="$1" payload ready=false
    for _attempt in $(seq 1 30); do
      payload="$(curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:27620/health)" || return $?
      if printf '%s' "$payload" | python3 -c 'import json,sys; v=json.load(sys.stdin); expected,commit,release,h,bh=sys.argv[1:]; sys.exit(0 if v.get("ok") is True and v.get("service")=="ynx-bft-gatewayd" and v.get("mode")=="cometbft-backed" and v.get("publicCutoverReady") is (expected=="true") and v.get("build",{}).get("commit")==commit and v.get("build",{}).get("release")==release and v.get("migrationHeight")==int(h) and v.get("migrationBlockHash")==bh else 1)' "$expected" "$commit" "$bft_release" "$migration_height" "$migration_hash"; then ready=true; break; fi
      sleep 1
    done
    [[ "$ready" == true ]] || fail "gateway authorization readback did not reach expected state"
  }
  gateway_ingress_unknown() {
    local status="$?"
    trap - EXIT
    echo "SINGLE_APP_GATEWAY_INGRESS_UNKNOWN: original status=$status; retain attempt/config/env/backups; no automatic restore or retry" >&2
    [[ "$status" != 0 ]] || status=1
    exit "$status"
  }

  if [[ "$ingress_mode" == single-app-gateway-json ]]; then
    # The original Caddy owner must already have installed the exact JSON
    # baseline and persistent drop-in. This consumer never repairs a stub or
    # changes a systemd source, and never interprets JSON as a Caddyfile.
    local json_args=(--manifest "$json_manifest" --manifest-sha256 "$json_manifest_pin" --transaction-id "$transaction_id" --commit "$commit" --operator-plan-sha256 "$operator_pin" --runtime-commit "$runtime_commit" --runtime-source-sha256 "$runtime_pin" --gateway-sha256 "$gateway_pin" --root "$root")
    local json_coordinates="" json_guard_result
    caddy_json_guard() {
      local phase="$1" pid after result
      pid="$(systemctl show -p MainPID --value caddy.service)"
      result="$(curl --disable --request GET --noproxy '*' --max-redirs 0 --connect-timeout 5 --max-time 10 --max-filesize 16777216 -fsS http://127.0.0.1:2019/config/ | python3 "$json_helper" guard "${json_args[@]}" --phase "$phase" --fragment "$(systemctl show -p FragmentPath --value caddy.service)" --dropins "$(systemctl show -p DropInPaths --value caddy.service)" --user "$(systemctl show -p User --value caddy.service)" --group "$(systemctl show -p Group --value caddy.service)" --start "$(systemctl show -p ExecStart --value caddy.service)" --reload "$(systemctl show -p ExecReload --value caddy.service)" --pid "$pid")" || fail "CADDY_JSON_PERSISTENT_SOURCE_OR_LOADED_CONFIG_MISMATCH"
      after="$(systemctl show -p MainPID --value caddy.service)"
      [[ "$pid" == "$after" ]] || fail "CADDY_JSON_RUNNING_IDENTITY_CHANGED"
      [[ -z "$json_coordinates" || "$result" == "$json_coordinates" ]] || fail "CADDY_JSON_SOURCE_CHANGED_DURING_ATTEMPT"
      json_guard_result="$result"
    }
    if [[ "$operation" == switch ]]; then
      caddy_json_guard original
      json_coordinates="$json_guard_result"
      gateway_running_source false "$source_attempt/candidate.env" true
      gateway_ready false
      umask 077
      mkdir -m 0700 "$ingress"
      trap gateway_ingress_unknown EXIT
      printf '{"version":"YNX-SINGLE-APP-GATEWAY-INGRESS/v1","transactionId":"%s","commit":"%s","mode":"single-app-gateway-json","caddySourceManifestSHA256":"%s","status":"unknown","automaticRetry":false}\n' "$transaction_id" "$commit" "$json_manifest_pin" >"$ingress/intent.json"
      mkdir -m 0700 "$ingress/backups" "$ingress/candidates"
      cp -p "$config" "$ingress/backups/ynx-chain.json"
      cp -p "$candidate_env" "$ingress/backups/candidate.env"
      python3 "$json_helper" project "${json_args[@]}" --output "$ingress/candidates/ynx-chain.json" >/dev/null
      [[ "$(grep -Fxc 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' "$candidate_env")" == 1 && "$(grep -c '^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=' "$candidate_env")" == 1 ]] || fail "original gateway authorization is not a unique false value"
      sed 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false$/YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true/' "$candidate_env" >"$ingress/candidates/candidate.env"
      sha256sum "$ingress/backups/candidate.env" "$ingress/backups/ynx-chain.json" >"$ingress/original-checksums.txt"
      sha256sum "$ingress/candidates/candidate.env" "$ingress/candidates/ynx-chain.json" >"$ingress/candidate-checksums.txt"
      caddy validate --config "$ingress/candidates/ynx-chain.json" >/dev/null
      gateway_running_source false "$ingress/backups/candidate.env" true
      caddy_json_guard original
      install -m 0640 -o root -g ynx "$ingress/candidates/candidate.env" "$candidate_env"
      timeout 30s systemctl restart "$gateway_unit"
      gateway_ready true
      gateway_running_source true "$ingress/candidates/candidate.env"
      caddy_json_guard original
      install -m 0600 -o caddy -g caddy "$ingress/candidates/ynx-chain.json" "$config"
      caddy validate --config "$config" >/dev/null
      timeout 30s systemctl reload caddy
      caddy_json_guard candidate
      gateway_running_source true "$ingress/candidates/candidate.env"
    else
      caddy_json_guard candidate
      json_coordinates="$json_guard_result"
      python3 "$json_helper" rollback-evidence "${json_args[@]}" --attempt "$ingress" >/dev/null
      sha256sum --strict -c "$ingress/original-checksums.txt" >/dev/null
      sha256sum --strict -c "$ingress/candidate-checksums.txt" >/dev/null
      gateway_running_source true "$ingress/candidates/candidate.env"
      mkdir -m 0700 "$ingress/rollback-attempt" || fail "original JSON rollback attempt exists; retain UNKNOWN without retry"
      trap gateway_ingress_unknown EXIT
      caddy_json_guard candidate
      install -m 0600 -o caddy -g caddy "$ingress/backups/ynx-chain.json" "$config"
      caddy validate --config "$config" >/dev/null
      timeout 30s systemctl reload caddy
      caddy_json_guard original
      install -m 0640 -o root -g ynx "$ingress/backups/candidate.env" "$candidate_env"
      timeout 30s systemctl restart "$gateway_unit"
      gateway_ready false
      gateway_running_source false "$ingress/backups/candidate.env"
    fi
    # Public DATA receipt only. Reload is not a real restart qualification.
    python3 - "$ingress" "$operation" "$transaction_id" "$commit" "$bft_release" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$json_manifest_pin" "$json_coordinates" "$source_test" "$observed_pid" "$observed_inode" <<'PY'
import hashlib,json,os,sys
base,action,tx,commit,release,operator,runtime,source,gateway,manifest,coordinates,test,pid,inode=sys.argv[1:]
def digest(name):
    with open(base+'/'+name,'rb') as f: return hashlib.sha256(f.read()).hexdigest()
rollback=action=='rollback'
v=dict(version='YNX-SINGLE-APP-GATEWAY-INGRESS/v1',transactionId=tx,commit=commit,bftRelease=release,mode='single-app-gateway-json',operatorPlanSHA256=operator,runtimeCommit=runtime,runtimeSOURCEsha256=source,gatewaySHA256=gateway,caddySourceManifestSHA256=manifest,ingress='authoritative' if rollback else 'bft',publicCutoverReady=not rollback,publicIngressChanged=not rollback and test!='true',automaticRollbackRequired=True,rolledBack=rollback,rpcOnly=True,ecosystemContinuityVerified=False,sourceTestOnly=test=='true',authoritativeChecksumsSha256=digest('original-checksums.txt'),candidateChecksumsSha256=digest('candidate-checksums.txt'),originalEnvironmentSHA256=digest('backups/candidate.env'),activatedEnvironmentSHA256=digest('candidates/candidate.env'),mainPid=pid,runningExecutableDeviceInode=inode,caddyRestartVerified=False)
v.update(json.loads(coordinates))
fd=os.open(base+'/'+action+'.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as f:
    f.write(json.dumps(v,separators=(',',':'))+'\n'); f.flush(); os.fsync(f.fileno())
PY
    trap - EXIT
    cat "$ingress/$operation.json"
    return
  fi

  if [[ "$operation" == switch ]]; then
    gateway_running_source false "$source_attempt/candidate.env" true
    gateway_ready false
    umask 077
    mkdir -m 0700 "$ingress"
    trap gateway_ingress_unknown EXIT
    printf '{"version":"YNX-SINGLE-APP-GATEWAY-INGRESS/v1","transactionId":"%s","commit":"%s","bftRelease":"%s","mode":"single-app-gateway","status":"unknown","automaticRetry":false}\n' "$transaction_id" "$commit" "$bft_release" >"$ingress/intent.json"
    mkdir -m 0700 "$ingress/backups" "$ingress/candidates"
    cp -p "$config" "$ingress/backups/ynx-chain.caddy"
    cp -p "$master" "$ingress/backups/Caddyfile"
    cp -p "$candidate_env" "$ingress/backups/candidate.env"
    python3 - "$ingress/backups/ynx-chain.caddy" "$ingress/candidates/ynx-chain.caddy" <<'PY'
import re, sys
with open(sys.argv[1], 'rb') as f: raw=f.read()
if b'\0' in raw: raise ValueError('Caddy source contains NUL')
prefix=rb'(?m)^([ \t]*reverse_proxy[ \t]+)'
end=rb'(?=[ \t\r]*(?:\{|#|$))'
if re.search(prefix+rb'[^#\r\n]*127\.0\.0\.1:27620(?=[^0-9]|$)', raw): raise ValueError('pre-existing candidate RPC mapping is not this attempt')
result, count=re.subn(prefix+rb'127\.0\.0\.1:6420'+end, lambda m:m[1]+b'127.0.0.1:27620', raw)
if count == 0: raise ValueError('no exact original native RPC directive')
if re.search(prefix+rb'[^#\r\n]*127\.0\.0\.1:6420(?=[^0-9]|$)', result): raise ValueError('unsupported native RPC directive; refuse partial switch')
with open(sys.argv[2], 'xb') as f: f.write(result)
PY
    [[ "$(grep -Fxc 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' "$candidate_env")" == 1 && "$(grep -c '^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=' "$candidate_env")" == 1 ]] || fail "original gateway authorization is not a unique false value"
    sed 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false$/YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true/' "$candidate_env" >"$ingress/candidates/candidate.env"
    sha256sum "$ingress/backups/Caddyfile" "$ingress/backups/candidate.env" "$ingress/backups/ynx-chain.caddy" >"$ingress/original-checksums.txt"
    sha256sum "$ingress/candidates/candidate.env" "$ingress/candidates/ynx-chain.caddy" >"$ingress/candidate-checksums.txt"
    cmp "$config" "$ingress/backups/ynx-chain.caddy" >/dev/null && cmp "$master" "$ingress/backups/Caddyfile" >/dev/null || fail "original ingress changed during preparation"
    caddy validate --config "$ingress/candidates/ynx-chain.caddy" --adapter caddyfile >/dev/null
    gateway_running_source false "$ingress/backups/candidate.env" true
    caddy_live_disk_guard "$caddy_original_semantic"
    install -m 0640 -o root -g ynx "$ingress/candidates/candidate.env" "$candidate_env"
    timeout 30s systemctl restart "$gateway_unit"
    gateway_ready true
    gateway_running_source true "$ingress/candidates/candidate.env"
    cmp "$master" "$ingress/backups/Caddyfile" >/dev/null && cmp "$config" "$ingress/backups/ynx-chain.caddy" >/dev/null || fail "original ingress changed before switch"
    caddy_live_disk_guard "$caddy_original_semantic"
    install -m 0644 -o root -g root "$ingress/candidates/ynx-chain.caddy" "$config"
    caddy validate --config "$master" --adapter caddyfile >/dev/null
    timeout 30s systemctl reload caddy
    caddy_live_disk_guard "" "$(sha256sum "$ingress/candidates/ynx-chain.caddy" | awk '{print $1}')"
    cmp "$config" "$ingress/candidates/ynx-chain.caddy" >/dev/null || fail "installed RPC config differs from exact projection"
    gateway_running_source true "$ingress/candidates/candidate.env"
  else
    python3 - "$ingress" "$transaction_id" "$commit" "$bft_release" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$source_test" <<'PY'
import hashlib, json, os, stat, sys
base, tx, commit, release, operator, runtime, source, gateway, test = sys.argv[1:]
def unique(pairs):
    out={}
    for k,v in pairs:
        if k in out: raise ValueError('duplicate original ingress field')
        out[k]=v
    return out
def read(name):
    p=os.path.join(base,name); s=os.lstat(p)
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or os.path.realpath(p)!=p or s.st_size>65536: raise ValueError('original ingress evidence replaced')
    with open(p,'rb') as f: return f.read()
v=json.loads(read('switch.json'),object_pairs_hook=unique)
expected=dict(version='YNX-SINGLE-APP-GATEWAY-INGRESS/v1',transactionId=tx,commit=commit,bftRelease=release,mode='single-app-gateway',operatorPlanSHA256=operator,runtimeCommit=runtime,runtimeSOURCEsha256=source,gatewaySHA256=gateway,ingress='bft',publicCutoverReady=True,publicIngressChanged=test!='true',sourceTestOnly=test=='true',rpcOnly=True,ecosystemContinuityVerified=False,rolledBack=False)
if any(type(v.get(k))!=type(value) or v[k]!=value for k,value in expected.items()): raise ValueError('RPC rollback differs from original completed switch')
for name,key,files in [('original-checksums.txt','authoritativeChecksumsSha256',['backups/Caddyfile','backups/candidate.env','backups/ynx-chain.caddy']),('candidate-checksums.txt','candidateChecksumsSha256',['candidates/candidate.env','candidates/ynx-chain.caddy'])]:
    manifest=read(name)
    if hashlib.sha256(manifest).hexdigest()!=v.get(key): raise ValueError('original checksum manifest changed')
    expected=b''.join((hashlib.sha256(read(f)).hexdigest()+'  '+os.path.join(base,f)+'\n').encode() for f in files)
    if manifest!=expected: raise ValueError('original checksum manifest has changed files/paths')
for name,key in [('backups/candidate.env','originalEnvironmentSHA256'),('candidates/candidate.env','activatedEnvironmentSHA256')]:
    if hashlib.sha256(read(name)).hexdigest()!=v.get(key): raise ValueError('original gateway environment versions changed')
PY
    sha256sum --strict -c "$ingress/original-checksums.txt" >/dev/null
    sha256sum --strict -c "$ingress/candidate-checksums.txt" >/dev/null
    cmp "$config" "$ingress/candidates/ynx-chain.caddy" >/dev/null && cmp "$master" "$ingress/backups/Caddyfile" >/dev/null || fail "foreign ingress config must not be overwritten by rollback"
    gateway_running_source true "$ingress/candidates/candidate.env"
    mkdir -m 0700 "$ingress/rollback-attempt" || fail "original rollback attempt exists; retain UNKNOWN without retry"
    trap gateway_ingress_unknown EXIT
    caddy_live_disk_guard "$caddy_original_semantic"
    install -m 0644 -o root -g root "$ingress/backups/ynx-chain.caddy" "$config"
    caddy validate --config "$master" --adapter caddyfile >/dev/null
    timeout 30s systemctl reload caddy
    caddy_live_disk_guard "" "$(sha256sum "$ingress/backups/ynx-chain.caddy" | awk '{print $1}')"
    install -m 0640 -o root -g ynx "$ingress/backups/candidate.env" "$candidate_env"
    timeout 30s systemctl restart "$gateway_unit"
    gateway_ready false
    gateway_running_source false "$ingress/backups/candidate.env"
    cmp "$config" "$ingress/backups/ynx-chain.caddy" >/dev/null || fail "original ingress bytes were not restored"
  fi
  local original_sha candidate_sha original_env_sha activated_env_sha target=bft ready=true rolled=false
  original_sha="$(sha256sum "$ingress/original-checksums.txt" | awk '{print $1}')"
  candidate_sha="$(sha256sum "$ingress/candidate-checksums.txt" | awk '{print $1}')"
  original_env_sha="$(sha256sum "$ingress/backups/candidate.env" | awk '{print $1}')"
  activated_env_sha="$(sha256sum "$ingress/candidates/candidate.env" | awk '{print $1}')"
  [[ "$operation" != rollback ]] || { target=authoritative; ready=false; rolled=true; }
  (set -o noclobber; printf '{"version":"YNX-SINGLE-APP-GATEWAY-INGRESS/v1","transactionId":"%s","commit":"%s","bftRelease":"%s","mode":"single-app-gateway","operatorPlanSHA256":"%s","runtimeCommit":"%s","runtimeSOURCEsha256":"%s","gatewaySHA256":"%s","ingress":"%s","publicCutoverReady":%s,"publicIngressChanged":%s,"automaticRollbackRequired":true,"rolledBack":%s,"rpcOnly":true,"ecosystemContinuityVerified":false,"sourceTestOnly":%s,"authoritativeChecksumsSha256":"%s","candidateChecksumsSha256":"%s","originalEnvironmentSHA256":"%s","activatedEnvironmentSHA256":"%s","mainPid":"%s","runningExecutableDeviceInode":"%s"}\n' "$transaction_id" "$commit" "$bft_release" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$target" "$ready" "$public_changed" "$rolled" "$source_test" "$original_sha" "$candidate_sha" "$original_env_sha" "$activated_env_sha" "$observed_pid" "$observed_inode" >"$ingress/$operation.json")
  trap - EXIT
  cat "$ingress/$operation.json"
}

if [[ "$ingress_mode" == single-app-gateway-json ]]; then
  [[ "$#" == 12 || "$#" == 13 ]] || fail "JSON ingress requires independent source manifest and pin"
  single_app_gateway_ingress "$7" "$8" "$9" "${10}" "${13:-/}" "${11}" "${12}"
  exit 0
fi
if [[ "$ingress_mode" == single-app-gateway ]]; then
  [[ "$#" == 10 || "$#" == 11 ]] || fail "single-App RPC ingress requires independent operator/runtime/gateway pins"
  single_app_gateway_ingress "$7" "$8" "$9" "${10}" "${11:-/}"
  exit 0
fi
[[ "$#" == 5 || "$#" == 6 ]] || fail "legacy ingress does not accept single-App inputs"

candidate_env="/etc/ynx/public-bft-cutover/${transaction_id}/candidate.env"
dependency_ownership="/etc/ynx/public-bft-cutover/${transaction_id}/ownership.json"
ingress_root="$remote_root/ingress"
ownership="$ingress_root/ownership.json"
switch_evidence="$ingress_root/switch.json"
rollback_evidence="$ingress_root/rollback.json"
[[ ! -e "$ingress_root/intent.json" && ! -L "$ingress_root/intent.json" ]] || fail "single-App ingress requires its original explicit profile and pins"
caddy_config=/etc/caddy/ynx-chain.caddy
nginx_config=/etc/nginx/conf.d/ynx-chain.conf
files=()
[[ -f "$caddy_config" ]] && files+=("$caddy_config")
[[ -f "$nginx_config" ]] && files+=("$nginx_config")

owned() {
  local file="$1"
  test -s "$file" && grep -Fq "\"transactionId\":\"${transaction_id}\"" "$file" && grep -Fq "\"commit\":\"${commit}\"" "$file" && grep -Fq "\"bftRelease\":\"${bft_release}\"" "$file"
}

backup_name() {
  printf '%s' "$1" | sed 's#^/##; s#/#__#g'
}

load_owned_files() {
  local file checksum manifest_sha
  files=()
  test -s "$ingress_root/checksums.txt" || fail "ingress checksum manifest is missing"
  while IFS='=' read -r file checksum; do
    case "$file" in
      "$caddy_config"|"$nginx_config") ;;
      *) fail "ingress checksum manifest contains an unmanaged file" ;;
    esac
    [[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || fail "ingress checksum manifest contains an invalid checksum"
    files+=("$file")
  done <"$ingress_root/checksums.txt"
  [[ ${#files[@]} -gt 0 ]] || fail "ingress checksum manifest contains no managed files"
  manifest_sha="$(sha256sum "$ingress_root/checksums.txt" | awk '{print $1}')"
  grep -Fq "\"authoritativeChecksumsSha256\":\"${manifest_sha}\"" "$ownership" || fail "ingress checksum manifest is not transaction-bound"
}

reload_active() {
  if systemctl is-active --quiet caddy; then
    caddy validate --config /etc/caddy/Caddyfile >/dev/null
    systemctl reload caddy
  fi
  if systemctl is-active --quiet nginx; then
    nginx -t >/dev/null
    systemctl reload nginx
  fi
}

wait_gateway_ready() {
  local expected="$1" ready=false payload
  for _attempt in $(seq 1 30); do
    payload="$(curl -fsS http://127.0.0.1:27620/health 2>/dev/null || true)"
    if printf '%s' "$payload" | grep -Fq "\"publicCutoverReady\":${expected}" && printf '%s' "$payload" | grep -Fq "\"commit\":\"${commit}\"" && printf '%s' "$payload" | grep -Fq "\"release\":\"${bft_release}\""; then
      ready=true
      break
    fi
    sleep 1
  done
  [[ "$ready" == true ]] || fail "BFT Gateway runtime authorization did not become ${expected}"
}

restore_files() {
  local file name backup expected actual
  for file in "${files[@]}"; do
    name="$(backup_name "$file")"
    backup="$ingress_root/backups/$name"
    test -s "$backup" || fail "ingress backup is missing: $file"
    expected="$(awk -F= -v key="$file" '$1 == key {print $2}' "$ingress_root/checksums.txt")"
    actual="$(sha256sum "$backup" | awk '{print $1}')"
    [[ -n "$expected" && "$actual" == "$expected" ]] || fail "ingress backup checksum mismatch: $file"
    install -m 0644 -o root -g root "$backup" "$file"
  done
  reload_active
}

verify_authoritative_files() {
  local file name backup expected current
  for file in "${files[@]}"; do
    name="$(backup_name "$file")"
    backup="$ingress_root/backups/$name"
    test -s "$backup" && test -s "$file" || fail "authoritative ingress file is missing: $file"
    expected="$(sha256sum "$backup" | awk '{print $1}')"
    current="$(sha256sum "$file" | awk '{print $1}')"
    [[ "$current" == "$expected" ]] || fail "authoritative ingress checksum is not restored: $file"
  done
  if [[ -s "$candidate_env" ]]; then
    grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' "$candidate_env" || fail "candidate Gateway authorization is not false after rollback"
  fi
}

rollback_ingress() {
  if [[ -s "$rollback_evidence" ]]; then
    owned "$rollback_evidence" || fail "rollback evidence belongs to another transaction"
    owned "$ownership" || fail "transaction-owned ingress backup is required"
    load_owned_files
    verify_authoritative_files
    printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nreused=true\ningress=authoritative\npublicCutoverReady=false\n' "$transaction_id" "$commit" "$bft_release"
    return
  fi
  if [[ ! -e "$ownership" ]]; then
    printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nnoOp=true\ningress=authoritative\npublicCutoverReady=false\n' "$transaction_id" "$commit" "$bft_release"
    return
  fi
  owned "$ownership" || fail "transaction-owned ingress backup is required"
  load_owned_files
  restore_files
  if [[ -s "$candidate_env" ]]; then
    if grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true' "$candidate_env"; then
      sed 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true$/YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false/' "$candidate_env" >"$candidate_env.next"
      chown root:ynx "$candidate_env.next"
      chmod 0640 "$candidate_env.next"
      mv "$candidate_env.next" "$candidate_env"
      systemctl restart ynx-bft-gateway-candidate.service
    else
      grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' "$candidate_env" || fail "candidate gateway authorization is not transaction-owned"
    fi
    wait_gateway_ready false
  fi
  printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","ingress":"authoritative","publicCutoverReady":false,"rolledBack":true,"recordedAt":"%s"}\n' \
    "$transaction_id" "$commit" "$bft_release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$rollback_evidence"
  chmod 0600 "$rollback_evidence"
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nreused=false\ningress=authoritative\npublicCutoverReady=false\nrolledBack=true\n' "$transaction_id" "$commit" "$bft_release"
}

if [[ "$operation" == "rollback" ]]; then
  rollback_ingress
  exit 0
fi

[[ ${#files[@]} -gt 0 ]] || fail "no managed YNX ingress configuration exists"
if [[ -s "$rollback_evidence" ]]; then fail "rolled-back ingress transaction cannot be switched again"; fi
  if [[ -s "$switch_evidence" ]]; then
    owned "$switch_evidence" || fail "switch evidence belongs to another transaction"
    for file in "${files[@]}"; do
      ! grep -Eq '127\.0\.0\.1:64(20|26|27|28|29|30|31|32)' "$file" || fail "reused BFT ingress contains an authoritative target"
      grep -Eq '127\.0\.0\.1:276(20|26|27|28|29|30|31|32)' "$file" || fail "reused BFT ingress has no candidate target"
    done
  wait_gateway_ready true
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nreused=true\ningress=bft\npublicCutoverReady=true\n' "$transaction_id" "$commit" "$bft_release"
  exit 0
fi

owned "$dependency_ownership" || fail "transaction-owned candidate dependencies are required"
for service in ynx-bft-gateway-candidate.service ynx-bft-indexer-candidate.service ynx-bft-explorer-candidate.service ynx-bft-faucet-candidate.service ynx-bft-ai-candidate.service ynx-bft-pay-candidate.service ynx-bft-trust-candidate.service ynx-bft-resource-candidate.service; do
  systemctl is-active "$service" >/dev/null || fail "candidate dependency is not active: $service"
done
test -s "$candidate_env" || fail "candidate env is missing"
grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' "$candidate_env" || fail "candidate gateway must start with public cutover authorization false"
systemctl is-active --quiet caddy || systemctl is-active --quiet nginx || fail "neither managed ingress service is active"

umask 077
install -d -m 0700 "$ingress_root/backups" "$ingress_root/candidates"
: >"$ingress_root/checksums.txt"
for file in "${files[@]}"; do
  name="$(backup_name "$file")"
  install -m 0600 "$file" "$ingress_root/backups/$name"
  printf '%s=%s\n' "$file" "$(sha256sum "$ingress_root/backups/$name" | awk '{print $1}')" >>"$ingress_root/checksums.txt"
  sed \
    -e 's#127\.0\.0\.1:6420#127.0.0.1:27620#g' \
    -e 's#127\.0\.0\.1:6426#127.0.0.1:27626#g' \
    -e 's#127\.0\.0\.1:6427#127.0.0.1:27627#g' \
    -e 's#127\.0\.0\.1:6428#127.0.0.1:27628#g' \
    -e 's#127\.0\.0\.1:6429#127.0.0.1:27629#g' \
    -e 's#127\.0\.0\.1:6430#127.0.0.1:27630#g' \
    -e 's#127\.0\.0\.1:6431#127.0.0.1:27631#g' \
    -e 's#127\.0\.0\.1:6432#127.0.0.1:27632#g' "$file" >"$ingress_root/candidates/$name"
  grep -Eq '127\.0\.0\.1:276(20|26|27|28|29|30|31|32)' "$ingress_root/candidates/$name" || fail "candidate ingress has no BFT targets: $file"
  ! grep -Eq '127\.0\.0\.1:64(20|26|27|28|29|30|31|32)' "$ingress_root/candidates/$name" || fail "candidate ingress retains authoritative YNX targets: $file"
done
chmod 0600 "$ingress_root/checksums.txt" "$ingress_root/candidates/"*
sha256sum "$ingress_root/candidates/"* >"$ingress_root/candidate-checksums.txt"
chmod 0600 "$ingress_root/candidate-checksums.txt"
authoritative_checksums_sha="$(sha256sum "$ingress_root/checksums.txt" | awk '{print $1}')"
candidate_checksums_sha="$(sha256sum "$ingress_root/candidate-checksums.txt" | awk '{print $1}')"
printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","files":%s,"authoritativeChecksumsSha256":"%s","candidateChecksumsSha256":"%s"}\n' "$transaction_id" "$commit" "$bft_release" "${#files[@]}" "$authoritative_checksums_sha" "$candidate_checksums_sha" >"$ownership"
chmod 0600 "$ownership"

switched=false
restore_on_error() {
  local status="$?"
  if [[ "$switched" != true ]]; then
    set +e
    restore_files
    if [[ -s "$candidate_env" ]]; then
      sed 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true$/YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false/' "$candidate_env" >"$candidate_env.next"
      chown root:ynx "$candidate_env.next" && chmod 0640 "$candidate_env.next" && mv "$candidate_env.next" "$candidate_env"
      systemctl restart ynx-bft-gateway-candidate.service
    fi
  fi
  exit "$status"
}
trap restore_on_error EXIT

sed 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false$/YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true/' "$candidate_env" >"$candidate_env.next"
chown root:ynx "$candidate_env.next"
chmod 0640 "$candidate_env.next"
mv "$candidate_env.next" "$candidate_env"
systemctl restart ynx-bft-gateway-candidate.service
wait_gateway_ready true

for file in "${files[@]}"; do
  name="$(backup_name "$file")"
  install -m 0644 -o root -g root "$ingress_root/candidates/$name" "$file"
done
reload_active

printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","ingress":"bft","publicCutoverReady":true,"publicIngressChanged":true,"automaticRollbackRequired":true,"authoritativeChecksumsSha256":"%s","candidateChecksumsSha256":"%s","recordedAt":"%s"}\n' \
  "$transaction_id" "$commit" "$bft_release" "$authoritative_checksums_sha" "$candidate_checksums_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$switch_evidence"
chmod 0600 "$switch_evidence"
switched=true
trap - EXIT
printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\ningress=bft\npublicCutoverReady=true\npublicIngressChanged=true\nautomaticRollbackRequired=true\n' "$transaction_id" "$commit" "$bft_release"
