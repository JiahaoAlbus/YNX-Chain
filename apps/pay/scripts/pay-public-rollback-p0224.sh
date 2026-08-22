#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_REL='/opt/ynx-pay-web/releases/pay-web-5f4ce98e-release1'
readonly STAGE_REL='/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1'
readonly CONFIG_REL='/etc/caddy/ynx-chain.caddy'
readonly CANDIDATE_SHA='b606d1bdced436a984aed19981788f1a9471b4ccb7ad7f2c49b32015b729afa7'
readonly ROLLBACK_SHA='df5f7ad73dd2631c0e934514e05a30ac97c75dc9efe2ec568b049c71c4024396'
readonly PAY_HOST='43.153.202.237' PAY_USER='ubuntu' PAY_IDENTITY='/Users/huangjiahao/Downloads/Huang.pem'
readonly PAY_KNOWN_HOSTS_FILE='/Users/huangjiahao/.ssh/known_hosts'

if [[ "${1:-}" != '--remote' && "${PAY_DEPLOY_FIXTURE:-}" != '1' ]]; then
  [[ "$#" -eq 1 && -f "$1/deploy-receipt.txt" ]] || { echo 'usage: rollback LOCAL_EVIDENCE_DIRECTORY' >&2; exit 64; }
  receipt="$1/deploy-receipt.txt"
  dev="$(sed -n 's/^dev=//p' "$receipt")"; ino="$(sed -n 's/^ino=//p' "$receipt")"
  stage_dev="$(sed -n 's/^stageDev=//p' "$receipt")"; stage_ino="$(sed -n 's/^stageIno=//p' "$receipt")"
  [[ "$dev" =~ ^[0-9]+$ && "$ino" =~ ^[0-9]+$ && "$stage_dev" =~ ^[0-9]+$ && "$stage_ino" =~ ^[0-9]+$ ]] || { echo 'invalid deployment receipt' >&2; exit 65; }
  exec ssh -i "$PAY_IDENTITY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$PAY_KNOWN_HOSTS_FILE" "${PAY_USER}@${PAY_HOST}" "sudo bash '$STAGE_REL/pay-public-rollback-p0224.sh' --remote '$dev' '$ino' '$stage_dev' '$stage_ino'"
fi
[[ "${1:-}" == '--remote' ]] && shift
readonly PREFIX="${PAY_DEPLOY_ROOT_PREFIX:-}"
[[ "$#" -eq 4 && "$1" =~ ^[0-9]+$ && "$2" =~ ^[0-9]+$ && "$3" =~ ^[0-9]+$ && "$4" =~ ^[0-9]+$ ]] || { echo 'usage: rollback RELEASE_DEVICE RELEASE_INODE STAGE_DEVICE STAGE_INODE' >&2; exit 64; }
if [[ -n "$PREFIX" && "${PAY_DEPLOY_FIXTURE:-}" != '1' ]]; then echo 'root prefix is fixture-only' >&2; exit 70; fi
if [[ -z "$PREFIX" && "${EUID:-$(id -u)}" -ne 0 ]]; then echo 'production rollback must run as root' >&2; exit 71; fi
p(){ printf '%s%s' "$PREFIX" "$1"; }
readonly RELEASE="$(p "$RELEASE_REL")"
readonly STAGE="$(p "$STAGE_REL")"
readonly CONFIG="$(p "$CONFIG_REL")"
readonly ROLLBACK="$STAGE/rollback.caddy"
stat_identity(){ if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then stat -f '%d:%i' "$1"; else stat -c '%d:%i' "$1"; fi; }
install_config(){ if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then install -m 0644 "$1" "$2"; else install -o root -g root -m 0644 "$1" "$2"; fi; }
current="$(sha256sum "$CONFIG" | awk '{print $1}')"
if [[ "$current" == "$CANDIDATE_SHA" ]]; then
  [[ -f "$ROLLBACK" && "$(sha256sum "$ROLLBACK" | awk '{print $1}')" == "$ROLLBACK_SHA" ]]
  install_config "$ROLLBACK" "$CONFIG.pay-rollback"
  mv -f "$CONFIG.pay-rollback" "$CONFIG"
  if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then printf 'reload\n' >>"$(p /var/log/pay-caddy-fixture.log)"; else caddy reload --config "$(p /etc/caddy/Caddyfile)"; fi
elif [[ "$current" != "$ROLLBACK_SHA" ]]; then
  echo 'refusing rollback from an unknown active Caddy object' >&2; exit 72
fi
[[ -d "$RELEASE" && "$(stat_identity "$RELEASE")" == "$1:$2" ]] || { echo 'release path identity changed; refusing deletion' >&2; exit 73; }
if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then rm -rf -- "$RELEASE"; else rm -rf --one-file-system -- "$RELEASE"; fi
[[ -d "$STAGE" && "$(stat_identity "$STAGE")" == "$3:$4" ]] || { echo 'stage path identity changed; refusing deletion' >&2; exit 74; }
if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then rm -rf -- "$STAGE"; else rm -rf --one-file-system -- "$STAGE"; fi
printf 'rollbackConfigSha256=%s\nreleaseRemoved=%s\nstageRemoved=%s\n' "$ROLLBACK_SHA" "$RELEASE_REL" "$STAGE_REL"
