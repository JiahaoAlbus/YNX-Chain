#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
OUT=${1:-"$ROOT/dist"}
VERSION=0.2.0-testnet-preview
COMMIT=$(git -C "$ROOT" rev-parse HEAD)
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
GOOS_VALUE=${GOOS:-$(go env GOOS)}
GOARCH_VALUE=${GOARCH:-$(go env GOARCH)}
PACKAGE="ynx-mail-${VERSION}-${GOOS_VALUE}-${GOARCH_VALUE}"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ynx-mail-package.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM
STAGE="$TMP/$PACKAGE"

mkdir -p "$STAGE/bin" "$STAGE/licenses" "$OUT"
(cd "$ROOT" && CGO_ENABLED=0 GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" go build \
  -trimpath -buildvcs=true \
  -ldflags "-s -w -X main.buildCommit=$COMMIT -X main.buildRelease=ynx-mail-$VERSION -X main.buildTime=$BUILD_TIME" \
  -o "$STAGE/bin/ynx-maild" ./apps/mail)
go version -m "$STAGE/bin/ynx-maild" > "$STAGE/SBOM-go-build.txt"
XCRYPTO_DIR=$(cd "$ROOT" && go list -m -f '{{.Dir}}' golang.org/x/crypto)
cp "$XCRYPTO_DIR/LICENSE" "$STAGE/licenses/golang.org-x-crypto.LICENSE"
printf '%s\n' \
  'YNX Mail Testnet Preview desktop companion' \
  '' \
  'Install: extract this archive into an owner-controlled directory.' \
  'Run: YNX_MAIL_DATA_DIR=/secure/path ./bin/ynx-maild' \
  'Default local URL: http://127.0.0.1:8095' \
  'Wallet sign-in requires YNX_WALLET_VERIFY_URL.' \
  'This package is unsigned and supports known YNX handles only; it is not internet email.' \
  "Commit: $COMMIT" \
  "Build time: $BUILD_TIME" > "$STAGE/INSTALL.txt"

ARCHIVE="$OUT/$PACKAGE.tar.gz"
tar -C "$TMP" -czf "$ARCHIVE" "$PACKAGE"
printf '%s\n' "$ARCHIVE"
