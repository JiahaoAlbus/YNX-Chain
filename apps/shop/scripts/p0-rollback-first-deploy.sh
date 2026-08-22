#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 EXPECTED_OLD_RELEASE BACKUP_STATE_PATH BACKUP_STATE_SHA256" >&2
  exit 64
fi

readonly EXPECTED_OLD_RELEASE="$1"
readonly BACKUP_STATE_PATH="$2"
readonly BACKUP_STATE_SHA256="$3"
readonly SOURCE_COMMIT="4ecbdba1fee7b919f5d0c65d0907ca4727e37496"
readonly ARCHIVE_SHA256="821922165d8a4210ae2267bdd9e97abe63dbbd23f44016078819bba83ffb26a8"
readonly BINARY_SHA256="ca19460320baa9b12b8b326fefe9c06be6a7c8caa5ab146bd1b955ec09a343f0"
readonly ARCHIVE_PATH="/var/tmp/ynx-shop-${SOURCE_COMMIT}.tar.gz"
readonly RELEASE_DIR="/opt/ynx-shop/releases/${SOURCE_COMMIT}"
readonly CURRENT_LINK="/opt/ynx-shop/current"
readonly NEXT_LINK="/opt/ynx-shop/.current-schema7-next"
readonly SERVICE="ynx-shopd.service"
readonly COLD_PORT="28095"
readonly COLD_STATE="/var/tmp/ynx-shop-${SOURCE_COMMIT}-cold-state.json"
readonly COLD_LOG="/var/tmp/ynx-shop-${SOURCE_COMMIT}-cold.log"
readonly ENV_FILE="/etc/ynx/ynx-shopd.env"

[[ "$(id -u)" == "0" ]] || { echo "root required" >&2; exit 77; }
[[ "$EXPECTED_OLD_RELEASE" == /opt/ynx-shop/releases/* ]] || { echo "invalid old release" >&2; exit 65; }
[[ "$BACKUP_STATE_PATH" == /var/backups/ynx-shop/predeploy-${SOURCE_COMMIT}/* ]] || { echo "invalid backup path" >&2; exit 65; }
[[ "$BACKUP_STATE_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid backup hash" >&2; exit 65; }
[[ -L "$CURRENT_LINK" ]] || { echo "current is not a symlink" >&2; exit 66; }
[[ "$(readlink -f "$CURRENT_LINK")" == "$EXPECTED_OLD_RELEASE" ]] || { echo "current release changed" >&2; exit 67; }
[[ -f "$ARCHIVE_PATH" ]] || { echo "archive missing" >&2; exit 66; }
[[ -f "$ENV_FILE" ]] || { echo "Shop environment file missing" >&2; exit 66; }
echo "$ARCHIVE_SHA256  $ARCHIVE_PATH" | sha256sum -c -
[[ -f "$BACKUP_STATE_PATH" ]] || { echo "state backup missing" >&2; exit 66; }
echo "$BACKUP_STATE_SHA256  $BACKUP_STATE_PATH" | sha256sum -c -
[[ ! -e "$RELEASE_DIR" ]] || { echo "candidate release already exists" >&2; exit 73; }
[[ ! -e "$NEXT_LINK" ]] || { echo "next link already exists" >&2; exit 73; }

install -d -m 0755 "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" --strip-components=1 -C "$RELEASE_DIR"
(cd "$RELEASE_DIR" && sha256sum -c SHA256SUMS)
echo "$BINARY_SHA256  $RELEASE_DIR/bin/ynx-shopd" | sha256sum -c -

rm -f "$COLD_STATE" "$COLD_LOG" "$COLD_STATE.bak"
install -m 0600 "$BACKUP_STATE_PATH" "$COLD_STATE"
echo "$BACKUP_STATE_SHA256  $COLD_STATE" | sha256sum -c -
set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a
"$RELEASE_DIR/bin/ynx-shopd" \
  -http "127.0.0.1:${COLD_PORT}" \
  -state "$COLD_STATE" \
  -buyer-assets "$RELEASE_DIR/web/shop" \
  -seller-assets "$RELEASE_DIR/web/shop" >"$COLD_LOG" 2>&1 &
cold_pid=$!
cleanup_cold() {
  kill "$cold_pid" 2>/dev/null || true
  wait "$cold_pid" 2>/dev/null || true
  rm -f "$COLD_STATE" "$COLD_STATE.bak"
}
trap cleanup_cold EXIT
for _ in {1..30}; do
  curl -fsS --max-time 2 "http://127.0.0.1:${COLD_PORT}/health" >/dev/null && break
  kill -0 "$cold_pid" 2>/dev/null || { echo "cold process exited" >&2; exit 70; }
  sleep 1
done
curl -fsS --max-time 2 "http://127.0.0.1:${COLD_PORT}/health" >/dev/null
curl -fsS --max-time 2 "http://127.0.0.1:${COLD_PORT}/version" | grep -F "$SOURCE_COMMIT" >/dev/null
echo "$BACKUP_STATE_SHA256  $COLD_STATE" | sha256sum -c -
[[ ! -e "$COLD_STATE.bak" ]] || { echo "current schema 7 preflight unexpectedly migrated state" >&2; exit 75; }
cleanup_cold
trap - EXIT

ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"
[[ "$(readlink -f "$CURRENT_LINK")" == "$RELEASE_DIR" ]] || { echo "candidate switch mismatch" >&2; exit 74; }
echo "SHOP_SCHEMA7_DEPLOYED source=$SOURCE_COMMIT release=$RELEASE_DIR"
