#!/usr/bin/env bash
set -eEuo pipefail

readonly RELEASE_REL='/opt/ynx-pay-web/releases/pay-web-5f4ce98e-release1'
readonly STAGE_REL='/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1'
readonly CONFIG_REL='/etc/caddy/ynx-chain.caddy'
readonly TAR_SHA='ae552951d8e569f04aced60db69e3c11422910cc1098a6e7061b0e84005ad09e'
readonly CANDIDATE_SHA='b606d1bdced436a984aed19981788f1a9471b4ccb7ad7f2c49b32015b729afa7'
readonly ROLLBACK_SHA='df5f7ad73dd2631c0e934514e05a30ac97c75dc9efe2ec568b049c71c4024396'
readonly SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly REPO_ROOT="$(cd "$SELF_DIR/../../.." && pwd)"
readonly PAY_HOST='43.153.202.237' PAY_USER='ubuntu' PAY_IDENTITY='/Users/huangjiahao/Downloads/Huang.pem'
readonly PAY_KNOWN_HOSTS_FILE='/Users/huangjiahao/.ssh/known_hosts'

if [[ "${1:-}" != '--remote' && "${PAY_DEPLOY_FIXTURE:-}" != '1' ]]; then
  [[ "$#" -eq 1 && ! -e "$1" ]] || { echo 'usage: deploy LOCAL_EVIDENCE_DIRECTORY' >&2; exit 64; }
  evidence="$1"; mkdir -m 0700 "$evidence"
  ssh_base=(ssh -i "$PAY_IDENTITY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$PAY_KNOWN_HOSTS_FILE" "${PAY_USER}@${PAY_HOST}")
  scp_base=(scp -i "$PAY_IDENTITY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$PAY_KNOWN_HOSTS_FILE")
  "${ssh_base[@]}" "sudo test ! -e '$RELEASE_REL' && sudo test ! -e '$STAGE_REL' && test \"\$(sudo sha256sum '$CONFIG_REL' | awk '{print \$1}')\" = '$ROLLBACK_SHA'"
  "${ssh_base[@]}" "sudo install -d -o '$PAY_USER' -g '$PAY_USER' -m 0700 '$STAGE_REL'"
  stage_identity="$("${ssh_base[@]}" "sudo stat -c '%d:%i' '$STAGE_REL'")"
  cleanup_stage(){ "${ssh_base[@]}" "test \"\$(sudo stat -c '%d:%i' '$STAGE_REL' 2>/dev/null)\" = '$stage_identity' && sudo rm -rf --one-file-system -- '$STAGE_REL'" || true; }
  trap cleanup_stage ERR INT TERM
  "${scp_base[@]}" "$REPO_ROOT/release/pay/ynx-pay-web-5f4ce98e-static.tar.gz" "${PAY_USER}@${PAY_HOST}:$STAGE_REL/candidate.tar.gz"
  "${scp_base[@]}" "$REPO_ROOT/release/pay/ynx-chain-pay-static-5f4ce98e.caddy" "${PAY_USER}@${PAY_HOST}:$STAGE_REL/candidate.caddy"
  "${scp_base[@]}" "$REPO_ROOT/release/pay/ynx-chain-pay-static-rollback-p0222.caddy" "${PAY_USER}@${PAY_HOST}:$STAGE_REL/rollback.caddy"
  "${scp_base[@]}" "$SELF_DIR/pay-public-deploy-p0224.sh" "$SELF_DIR/pay-public-rollback-p0224.sh" "${PAY_USER}@${PAY_HOST}:$STAGE_REL/"
  "${ssh_base[@]}" "sudo bash '$STAGE_REL/pay-public-deploy-p0224.sh' --remote" >"$evidence/deploy-receipt.txt"
  printf 'stageDev=%s\nstageIno=%s\n' "${stage_identity%%:*}" "${stage_identity##*:}" >>"$evidence/deploy-receipt.txt"
  trap - ERR INT TERM
  exit 0
fi
[[ "${1:-}" == '--remote' ]] && shift
readonly PREFIX="${PAY_DEPLOY_ROOT_PREFIX:-}"

if [[ -n "$PREFIX" && "${PAY_DEPLOY_FIXTURE:-}" != '1' ]]; then
  echo 'root prefix is fixture-only' >&2; exit 70
fi
if [[ -z "$PREFIX" && "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo 'production deployment must run as root' >&2; exit 71
fi
p(){ printf '%s%s' "$PREFIX" "$1"; }
readonly RELEASE="$(p "$RELEASE_REL")"
readonly STAGE="$(p "$STAGE_REL")"
readonly CONFIG="$(p "$CONFIG_REL")"
readonly ARCHIVE="$STAGE/candidate.tar.gz"
readonly CANDIDATE="$STAGE/candidate.caddy"
readonly ROLLBACK="$STAGE/rollback.caddy"
release_dev='' release_ino='' switched=0

stat_identity(){ if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then stat -f '%d:%i' "$1"; else stat -c '%d:%i' "$1"; fi; }
file_size(){ if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then stat -f '%z' "$1"; else stat -c '%s' "$1"; fi; }
install_dir(){ if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then install -d -m 0755 "$1"; else install -d -o root -g root -m 0755 "$1"; fi; }
install_config(){ if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then install -m 0644 "$1" "$2"; else install -o root -g root -m 0644 "$1" "$2"; fi; }
same_inode(){ [[ -e "$1" ]] && [[ "$(stat_identity "$1")" == "$2:$3" ]]; }
cleanup_exact(){ local path="$1" dev="$2" ino="$3"; same_inode "$path" "$dev" "$ino" || return 73; if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then rm -rf -- "$path"; else rm -rf --one-file-system -- "$path"; fi; }
reload_caddy(){ if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then printf 'reload\n' >>"$(p /var/log/pay-caddy-fixture.log)"; else caddy reload --config "$(p /etc/caddy/Caddyfile)"; fi; }
validate_caddy(){ if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then return 0; else caddy adapt --config "$1" --validate >/dev/null; fi; }
rollback_on_error(){
  local rc="${1:-$?}"
  trap - ERR
  if [[ "$switched" -eq 1 && -f "$ROLLBACK" && "$(sha256sum "$ROLLBACK" | awk '{print $1}')" == "$ROLLBACK_SHA" ]]; then
    install_config "$ROLLBACK" "$CONFIG.pay-rollback"
    mv -f "$CONFIG.pay-rollback" "$CONFIG"
    reload_caddy || true
  fi
  if [[ -n "$release_dev" && -n "$release_ino" ]]; then cleanup_exact "$RELEASE" "$release_dev" "$release_ino" || true; fi
  exit "$rc"
}
trap rollback_on_error ERR

[[ "$(sha256sum "$CONFIG" | awk '{print $1}')" == "$ROLLBACK_SHA" ]]
[[ ! -e "$RELEASE" ]]
[[ -f "$ARCHIVE" && "$(sha256sum "$ARCHIVE" | awk '{print $1}')" == "$TAR_SHA" ]]
[[ -f "$CANDIDATE" && "$(sha256sum "$CANDIDATE" | awk '{print $1}')" == "$CANDIDATE_SHA" ]]
[[ -f "$ROLLBACK" && "$(sha256sum "$ROLLBACK" | awk '{print $1}')" == "$ROLLBACK_SHA" ]]

install_dir "$(dirname "$RELEASE")"
install_dir "$RELEASE"
IFS=: read -r release_dev release_ino <<<"$(stat_identity "$RELEASE")"
if [[ "${PAY_DEPLOY_FIXTURE:-}" == '1' ]]; then gtar -xzf "$ARCHIVE" -C "$RELEASE" --no-same-owner --no-same-permissions; else tar -xzf "$ARCHIVE" -C "$RELEASE" --no-same-owner --no-same-permissions; fi

while IFS='|' read -r rel bytes sha; do
  file="$RELEASE/dist/$rel"
  [[ -f "$file" && "$(file_size "$file")" == "$bytes" && "$(sha256sum "$file" | awk '{print $1}')" == "$sha" ]]
done <<'MANIFEST'
_expo/static/js/web/ed25519-c59a4172dfc4d671adde680f5993c63a.js|18359|c97d8089090855fe74e3351e81ae0bbe12f70949393dbc832ce3e418c174cf74
_expo/static/js/web/index-3ecf2c56af407d1a54804200684d414f.js|45437|767c40994a2ce2055116bf1aa4e5f769fe17526fdba3622aa026aa31be02dbfa
_expo/static/js/web/index-7b0e541eda1df37fa2c19e3d7df84d2f.js|2668358|94c7d8da1d22464092658af66e8024d543db64ed60e304ab8d9c48588bfd0840
assets/assets/ynx-logo.a0b95fd9058a835ba2786aeb2287e0b7.png|172128|38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde
build-identity.json|322|7b57cc88fc9287c546ba41d0e61a00c13665cdfd8aa8cc34c2f7347f8abb0b81
index.html|1174|22f743c62a976928abd8a6bc3d123d366b5e1cac774b6ad3d20c21cfa07d917e
metadata.json|49|aa5f19cc84d41c0f8c70ececb2bc82e863227ea1e121632aca879eb616056991
MANIFEST

validate_caddy "$CANDIDATE"
install_config "$CANDIDATE" "$CONFIG.pay-new"
[[ "$(sha256sum "$CONFIG.pay-new" | awk '{print $1}')" == "$CANDIDATE_SHA" ]]
mv -f "$CONFIG.pay-new" "$CONFIG"
switched=1
reload_caddy
if [[ "${PAY_FIXTURE_FAIL_AFTER_SWITCH:-0}" == '1' ]]; then rollback_on_error 74; fi
trap - ERR
printf 'release=%s\ndev=%s\nino=%s\nconfigSha256=%s\n' "$RELEASE_REL" "$release_dev" "$release_ino" "$CANDIDATE_SHA"
