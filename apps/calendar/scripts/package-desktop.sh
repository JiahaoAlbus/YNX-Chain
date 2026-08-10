#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
OUT=${1:-"$ROOT/dist"}
VERSION=0.2.0-testnet-preview
COMMIT=$(git -C "$ROOT" rev-parse HEAD)
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
GOOS_VALUE=${GOOS:-$(go env GOOS)}
GOARCH_VALUE=${GOARCH:-$(go env GOARCH)}
PACKAGE="ynx-calendar-${VERSION}-${GOOS_VALUE}-${GOARCH_VALUE}"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ynx-calendar-package.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM
STAGE="$TMP/$PACKAGE"

mkdir -p "$STAGE/bin" "$OUT"
(cd "$ROOT" && CGO_ENABLED=0 GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" go build \
  -trimpath -buildvcs=true \
  -ldflags "-s -w -X main.buildCommit=$COMMIT -X main.buildRelease=ynx-calendar-$VERSION -X main.buildTime=$BUILD_TIME" \
  -o "$STAGE/bin/ynx-calendard" ./apps/calendar)
go version -m "$STAGE/bin/ynx-calendard" > "$STAGE/SBOM-go-build.txt"
printf '%s\n' \
  'YNX Calendar Testnet Preview desktop companion' \
  '' \
  'Install: extract this archive into an owner-controlled directory.' \
  'Run: YNX_CALENDAR_DATA_DIR=/secure/path ./bin/ynx-calendard' \
  'Default local URL: http://127.0.0.1:8096' \
  'Wallet sign-in requires YNX_WALLET_VERIFY_URL.' \
  'This package is unsigned; reminders and invitations are local product state.' \
  "Commit: $COMMIT" \
  "Build time: $BUILD_TIME" > "$STAGE/INSTALL.txt"

ARCHIVE="$OUT/$PACKAGE.tar.gz"
tar -C "$TMP" -czf "$ARCHIVE" "$PACKAGE"
printf '%s\n' "$ARCHIVE"
