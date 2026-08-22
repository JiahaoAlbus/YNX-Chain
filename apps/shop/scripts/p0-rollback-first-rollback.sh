#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 EXPECTED_OLD_RELEASE BACKUP_STATE_PATH BACKUP_STATE_SHA256 EXPECTED_STATE_OWNER_GROUP" >&2
  exit 64
fi

readonly EXPECTED_OLD_RELEASE="$1"
readonly BACKUP_STATE_PATH="$2"
readonly BACKUP_STATE_SHA256="$3"
readonly EXPECTED_STATE_OWNER_GROUP="$4"
readonly SOURCE_COMMIT="221a6bde7bef8aab83ca45f9b1dd4ecf9ac60aba"
readonly EXECUTION_SUFFIX="p0215"
readonly CANDIDATE_RELEASE="/opt/ynx-shop/releases/${SOURCE_COMMIT}-${EXECUTION_SUFFIX}"
readonly CURRENT_LINK="/opt/ynx-shop/current"
readonly NEXT_LINK="/opt/ynx-shop/.current-schema7-${EXECUTION_SUFFIX}-rollback"
readonly STATE_PATH="/var/lib/ynx-shop/state.json"
readonly STATE_NEXT="/var/lib/ynx-shop/.state.json.schema7-${EXECUTION_SUFFIX}-rollback"
readonly SERVICE="ynx-shopd.service"

[[ "$(id -u)" == "0" ]] || { echo "root required" >&2; exit 77; }
[[ "$EXPECTED_OLD_RELEASE" == /opt/ynx-shop/releases/* ]] || { echo "invalid old release" >&2; exit 65; }
[[ "$BACKUP_STATE_PATH" == /var/backups/ynx-shop/predeploy-${SOURCE_COMMIT}-${EXECUTION_SUFFIX}/* ]] || { echo "invalid backup path" >&2; exit 65; }
[[ "$BACKUP_STATE_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid backup hash" >&2; exit 65; }
[[ "$EXPECTED_STATE_OWNER_GROUP" =~ ^[a-z_][a-z0-9_-]*:[a-z_][a-z0-9_-]*$ ]] || { echo "invalid state owner/group" >&2; exit 65; }
[[ -d "$EXPECTED_OLD_RELEASE" ]] || { echo "old release missing" >&2; exit 66; }
[[ -L "$CURRENT_LINK" ]] || { echo "current is not a symlink" >&2; exit 66; }
[[ "$(readlink -f "$CURRENT_LINK")" == "$CANDIDATE_RELEASE" ]] || { echo "candidate is not current" >&2; exit 67; }
[[ ! -e "$NEXT_LINK" && ! -e "$STATE_NEXT" ]] || { echo "rollback temp path exists" >&2; exit 73; }
echo "$BACKUP_STATE_SHA256  $BACKUP_STATE_PATH" | sha256sum -c -

systemctl stop "$SERVICE"
install -m 0600 -o "${EXPECTED_STATE_OWNER_GROUP%%:*}" -g "${EXPECTED_STATE_OWNER_GROUP##*:}" "$BACKUP_STATE_PATH" "$STATE_NEXT"
echo "$BACKUP_STATE_SHA256  $STATE_NEXT" | sha256sum -c -
mv -Tf "$STATE_NEXT" "$STATE_PATH"
ln -s "$EXPECTED_OLD_RELEASE" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
systemctl start "$SERVICE"
systemctl is-active --quiet "$SERVICE"
[[ "$(readlink -f "$CURRENT_LINK")" == "$EXPECTED_OLD_RELEASE" ]] || { echo "old release restore mismatch" >&2; exit 74; }
echo "$BACKUP_STATE_SHA256  $STATE_PATH" | sha256sum -c -
echo "SHOP_SCHEMA7_ROLLED_BACK release=$EXPECTED_OLD_RELEASE"
