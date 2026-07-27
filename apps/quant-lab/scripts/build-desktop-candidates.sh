#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$repo_root"
commit_ref=${YNX_QUANT_SOURCE_COMMIT:-HEAD}
if ! commit=$(git rev-parse --verify "${commit_ref}^{commit}"); then
  echo "Invalid Quant desktop source commit: $commit_ref" >&2
  exit 1
fi
output=${YNX_QUANT_DESKTOP_OUTPUT:-dist/quant-desktop}
mac_app="$output/macos/YNX Quant Lab.app"
windows_dir="$output/windows/YNX Quant Lab"
mac_archive="$output/YNX-Quant-Lab-0.2.0-testnet-macos-arm64.zip"
windows_archive="$output/YNX-Quant-Lab-0.2.0-testnet-windows-x64.zip"

rm -rf "$mac_app" "$windows_dir"
rm -f "$mac_archive" "$windows_archive"
mkdir -p "$mac_app/Contents/MacOS" "$mac_app/Contents/Resources/web" "$windows_dir/web"
cp apps/quant-lab/desktop/Info.plist "$mac_app/Contents/Info.plist"
cp -R apps/quant-lab/web/. "$mac_app/Contents/Resources/web/"
cp -R apps/quant-lab/web/. "$windows_dir/web/"

CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -buildvcs=false -trimpath -ldflags="-s -w" -o "$mac_app/Contents/MacOS/ynx-quant-desktop" ./cmd/ynx-quant-desktop
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -buildvcs=false -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=$commit" -o "$mac_app/Contents/MacOS/ynx-quantd" ./cmd/ynx-quantd
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -buildvcs=false -trimpath -ldflags="-s -w" -o "$mac_app/Contents/MacOS/ynx-quant-web" ./cmd/ynx-quant-web

CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags="-s -w" -o "$windows_dir/ynx-quant-desktop.exe" ./cmd/ynx-quant-desktop
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=$commit" -o "$windows_dir/ynx-quantd.exe" ./cmd/ynx-quantd
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags="-s -w" -o "$windows_dir/ynx-quant-web.exe" ./cmd/ynx-quant-web

signing_class=unsigned
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$mac_app"
  codesign --verify --deep --strict "$mac_app"
  signing_class=adhoc-test-only
fi

find "$mac_app" "$windows_dir" -exec touch -t 200001010000 {} +
(
  cd "$output/macos"
  find "YNX Quant Lab.app" -print | LC_ALL=C sort | zip -X -q "../$(basename "$mac_archive")" -@
)
(
  cd "$output/windows"
  find "YNX Quant Lab" -print | LC_ALL=C sort | zip -X -q "../$(basename "$windows_archive")" -@
)

find "$output" -type f -print0 | sort -z | xargs -0 shasum -a 256
wc -c "$mac_archive" "$windows_archive"
echo "Desktop candidates built with macOS signing class: $signing_class. Production signing, notarization, Windows launch, hosting, and store release are not implied."
