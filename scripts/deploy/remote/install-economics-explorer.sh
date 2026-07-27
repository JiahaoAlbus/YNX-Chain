#!/usr/bin/env bash
set -Eeuo pipefail

package_dir="${1:?package directory is required}"
release="${2:?release is required}"
source_commit="${3:?source commit is required}"
reserve_mode="${4:?reserve configuration mode is required}"
release_class="${5:?release class is required}"
public_reserve_url="${6:?public reserve URL is required}"
public_yusd_url="${7:?public YUSD URL is required}"

[[ "$release" =~ ^ynx-economics-explorer-[0-9a-f]{12}$ ]] || { echo "invalid Explorer release"; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source commit"; exit 1; }
[[ "$reserve_mode" == "configure" || "$reserve_mode" == "preserve" ]] || { echo "invalid reserve configuration mode"; exit 1; }
[[ "$release_class" == "central_testnet" || "$release_class" == "public_testnet" ]] || { echo "invalid release class"; exit 1; }
if [[ "$release_class" == "public_testnet" ]]; then
  [[ "$public_reserve_url" == https://*/api/stable/reserve ]] || { echo "invalid public reserve URL"; exit 1; }
  [[ "$public_yusd_url" == https://*/api/stable/yusd-sandbox ]] || { echo "invalid public YUSD URL"; exit 1; }
fi
[[ -d "$package_dir" && ! -L "$package_dir" ]] || { echo "invalid package directory"; exit 1; }

cd "$package_dir"
sha256sum -c SHA256SUMS
test -x bin/ynx-explorerd
test -f config/ynx-explorerd.env
test -f systemd/ynx-explorerd.service
if [[ "$reserve_mode" == "configure" ]]; then
  test -f config/stable-reserve-attestation.json
fi

backup="/var/backups/ynx-chain/$release"
sudo -n rm -rf "$backup"
sudo -n install -d -m 0700 -o root -g root "$backup"
for path in \
  /usr/local/bin/ynx-explorerd \
  /etc/systemd/system/ynx-explorerd.service \
  /etc/ynx/ynx-explorerd.env \
  /etc/ynx/stable-reserve-attestation.json
do
  name="$(basename "$path")"
  if sudo -n test -e "$path"; then
    sudo -n cp -p "$path" "$backup/$name"
  else
    sudo -n touch "$backup/$name.absent"
  fi
done

restore_path() {
  local destination="$1" name
  name="$(basename "$destination")"
  if sudo -n test -f "$backup/$name.absent"; then
    sudo -n rm -f "$destination"
  elif [[ "$destination" == "/usr/local/bin/ynx-explorerd" ]]; then
    sudo -n install -m 0755 -o root -g root "$backup/$name" "${destination}.${release}.restore"
    sudo -n mv -f "${destination}.${release}.restore" "$destination"
  else
    sudo -n cp -p "$backup/$name" "$destination"
  fi
}

deployment_complete=0
rollback() {
  local status="$?"
  trap - EXIT
  if [[ "$status" != "0" && "$deployment_complete" == "0" ]]; then
    set +e
    sudo -n systemctl stop ynx-explorerd.service
    restore_path /usr/local/bin/ynx-explorerd
    restore_path /etc/systemd/system/ynx-explorerd.service
    restore_path /etc/ynx/ynx-explorerd.env
    restore_path /etc/ynx/stable-reserve-attestation.json
    sudo -n systemctl daemon-reload
    sudo -n systemctl restart ynx-explorerd.service
    echo "scoped Explorer deployment failed; previous binary and configuration restored" >&2
  fi
  exit "$status"
}
trap rollback EXIT

sudo -n install -m 0755 -o root -g root bin/ynx-explorerd "/usr/local/bin/ynx-explorerd.${release}.new"
sudo -n mv -f "/usr/local/bin/ynx-explorerd.${release}.new" /usr/local/bin/ynx-explorerd
sudo -n install -m 0644 -o root -g root systemd/ynx-explorerd.service /etc/systemd/system/ynx-explorerd.service
if [[ "$reserve_mode" == "configure" ]] || ! sudo -n test -f /etc/ynx/ynx-explorerd.env; then
  sudo -n install -m 0600 -o root -g root config/ynx-explorerd.env /etc/ynx/ynx-explorerd.env
else
  merged_env="$(mktemp)"
  sudo -n cat /etc/ynx/ynx-explorerd.env |
    grep -v -E '^(YNX_STABLE_RESERVE_ADAPTER_RELEASE_CLASS|YNX_YUSD_SANDBOX_URL)=' >"$merged_env" || true
  grep -E '^(YNX_STABLE_RESERVE_ADAPTER_RELEASE_CLASS|YNX_YUSD_SANDBOX_URL)=' config/ynx-explorerd.env >>"$merged_env"
  sudo -n install -m 0600 -o root -g root "$merged_env" /etc/ynx/ynx-explorerd.env
  rm -f "$merged_env"
fi
if [[ "$reserve_mode" == "configure" ]]; then
  sudo -n install -m 0640 -o root -g ynx config/stable-reserve-attestation.json /etc/ynx/stable-reserve-attestation.json
fi

sudo -n systemctl is-active --quiet ynx-yusd-sandboxd.service ||
  { echo "YUSD Sandbox must be active before enabling its public Explorer projection"; exit 1; }
sudo -n bash -lc 'set -a; source /etc/ynx/ynx-chaind.env; source /etc/ynx/ynx-explorerd.env; set +a; /usr/local/bin/ynx-explorerd --check-config >/dev/null'
sudo -n systemctl daemon-reload
sudo -n systemctl restart ynx-explorerd.service
sudo -n systemctl is-active --quiet ynx-explorerd.service

probe="$(mktemp)"
yusd_probe=""
public_probe=""
public_yusd_probe=""
cleanup_probe() { rm -f "$probe" "${yusd_probe:-}" "${public_probe:-}" "${public_yusd_probe:-}"; }
ready=0
for attempt in $(seq 1 12); do
  if curl -sS --max-time 15 http://127.0.0.1:6427/health >"$probe" &&
    grep -Fq '"service":"ynx-explorerd"' "$probe" &&
    grep -Fq "\"commit\":\"$source_commit\"" "$probe"; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]] || { echo "Explorer did not become ready with the expected build identity"; exit 1; }
if [[ "$reserve_mode" == "configure" ]]; then
  curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 15 http://127.0.0.1:6427/api/stable/reserve >"$probe"
  grep -Fq '"externalReserveAttested":true' "$probe"
  grep -Fq "\"sourceCommit\":\"$source_commit\"" "$probe"
else
  status="$(curl -sS --max-time 10 -o "$probe" -w '%{http_code}' http://127.0.0.1:6427/api/stable/reserve)"
  if [[ "$status" == "200" ]]; then
    grep -Fq '"externalReserveAttested":true' "$probe"
  else
    [[ "$status" == "503" ]]
    grep -Fq '"YNX_STABLE_RESERVE_UNAVAILABLE"' "$probe"
  fi
fi
grep -Fq "\"sourceCommit\":\"$source_commit\"" "$probe"
grep -Fq "\"adapterReleaseClass\":\"$release_class\"" "$probe"
yusd_probe="$(mktemp)"
curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 15 \
  http://127.0.0.1:6427/api/stable/yusd-sandbox >"$yusd_probe"
grep -Fq '"product":"YUSD Sandbox"' "$yusd_probe"
grep -Fq '"realityValue":false' "$yusd_probe"
grep -Fq '"externalReserveAttested":false' "$yusd_probe"
grep -Fq '"solvent":true' "$yusd_probe"
grep -Fq '"reconciled":true' "$yusd_probe"
grep -Fq "\"sourceCommit\":\"$source_commit\"" "$yusd_probe"
grep -Fq "\"adapterReleaseClass\":\"$release_class\"" "$yusd_probe"
if [[ "$release_class" == "public_testnet" ]]; then
  grep -Fq '"deployedPublic":true' "$probe"
  public_probe="$(mktemp)"
  public_ready=0
  for attempt in $(seq 1 8); do
    if curl -sS --max-time 20 "$public_reserve_url" >"$public_probe" &&
      grep -Fq "\"sourceCommit\":\"$source_commit\"" "$public_probe" &&
      grep -Fq '"adapterReleaseClass":"public_testnet"' "$public_probe" &&
      grep -Fq '"deployedPublic":true' "$public_probe"; then
      public_ready=1
      break
    fi
    sleep 3
  done
  rm -f "$public_probe"
  public_probe=""
  [[ "$public_ready" == "1" ]] || { echo "public reserve endpoint did not prove the expected release"; exit 1; }
  public_yusd_probe="$(mktemp)"
  public_yusd_ready=0
  for attempt in $(seq 1 8); do
    if curl -fsS --max-time 20 "$public_yusd_url" >"$public_yusd_probe" &&
      grep -Fq "\"sourceCommit\":\"$source_commit\"" "$public_yusd_probe" &&
      grep -Fq '"adapterReleaseClass":"public_testnet"' "$public_yusd_probe" &&
      grep -Fq '"deployedPublic":true' "$public_yusd_probe" &&
      grep -Fq '"product":"YUSD Sandbox"' "$public_yusd_probe" &&
      grep -Fq '"realityValue":false' "$public_yusd_probe"; then
      public_yusd_ready=1
      break
    fi
    sleep 3
  done
  rm -f "$public_yusd_probe"
  public_yusd_probe=""
  [[ "$public_yusd_ready" == "1" ]] || { echo "public YUSD Sandbox endpoint did not prove the expected release"; exit 1; }
else
  grep -Fq '"deployedStaging":true' "$probe"
  grep -Fq '"deployedPublic":false' "$probe"
fi
cleanup_probe

deployment_complete=1
echo "scoped Explorer deployment verified: release=$release reserveMode=$reserve_mode releaseClass=$release_class sourceCommit=$source_commit"
