#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
source_commit=${1:-}
package_version=${2:-0.1.0}
output_dir=${3:-release/wallet-cli/linux-packages}
if [[ ! $source_commit =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: build-wallet-linux-packages.sh <source-commit> [version] [output-dir]" >&2
  exit 2
fi
git_commit_available=false
if git -C "$repo_root" cat-file -e "$source_commit^{commit}" 2>/dev/null; then
  git_commit_available=true
fi
if ! grep -q "\"sourceCommit\": \"$source_commit\"" "$repo_root/release/wallet-cli/artifacts/manifest.json"; then
  echo "artifact manifest is not bound to source commit" >&2
  exit 2
fi

case "$(uname -m)" in
  x86_64) go_arch=amd64; deb_arch=amd64; rpm_arch=x86_64 ;;
  aarch64|arm64) go_arch=arm64; deb_arch=arm64; rpm_arch=aarch64 ;;
  *) echo "unsupported native package architecture: $(uname -m)" >&2; exit 2 ;;
esac

source_archive="$repo_root/release/wallet-cli/artifacts/ynx-wallet-cli-linux-${go_arch}.gz"
[[ -f $source_archive ]] || { echo "missing verified CLI archive: $source_archive" >&2; exit 2; }
if [[ $git_commit_available == true ]]; then
  source_date_epoch=$(git -C "$repo_root" show -s --format=%ct "$source_commit")
else
  source_date_epoch=${SOURCE_DATE_EPOCH:-}
  [[ $source_date_epoch =~ ^[0-9]{10}$ ]] || { echo "SOURCE_DATE_EPOCH is required when Git metadata is unavailable" >&2; exit 2; }
fi
short_commit=${source_commit:0:12}
absolute_output=$(cd "$repo_root" && mkdir -p "$output_dir" && cd "$output_dir" && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

binary="$work_dir/ynx-wallet-cli"
gzip -dc "$source_archive" > "$binary"
chmod 0755 "$binary"

deb_root="$work_dir/deb"
install -Dm0755 "$binary" "$deb_root/usr/bin/ynx-wallet-cli"
install -d -m0755 "$deb_root/DEBIAN"
printf '%s\n' \
  'Package: ynx-wallet-cli' \
  "Version: ${package_version}~testnet+${short_commit}" \
  "Architecture: ${deb_arch}" \
  'Maintainer: YNX Chain Release Engineering' \
  'Depends: ca-certificates' \
  'Section: utils' \
  'Priority: optional' \
  'Description: Fail-closed YNX Wallet Testnet CLI' \
  ' Consumes the frozen product-session proof and verifies exact YNX Testnet identity.' \
  > "$deb_root/DEBIAN/control"
find "$deb_root" -exec touch -h -d "@${source_date_epoch}" {} +
deb_path="$absolute_output/ynx-wallet-cli_${package_version}~testnet+${short_commit}_${deb_arch}.deb"
SOURCE_DATE_EPOCH=$source_date_epoch dpkg-deb --build --root-owner-group --uniform-compression -Zxz -z9 "$deb_root" "$deb_path" >/dev/null

rpm_top="$work_dir/rpmbuild"
mkdir -p "$rpm_top"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}
install -m0755 "$binary" "$rpm_top/SOURCES/ynx-wallet-cli"
spec="$rpm_top/SPECS/ynx-wallet-cli.spec"
printf '%s\n' \
  'Name: ynx-wallet-cli' \
  "Version: ${package_version}" \
  "Release: 0.testnet.${short_commit}" \
  'Summary: Fail-closed YNX Wallet Testnet CLI' \
  'License: LicenseRef-YNX-Proprietary' \
  'Requires: ca-certificates' \
  "BuildArch: ${rpm_arch}" \
  'Source0: ynx-wallet-cli' \
  '%description' \
  'Consumes the frozen product-session proof and verifies exact YNX Testnet identity.' \
  '%prep' \
  '%build' \
  '%install' \
  'install -Dm0755 %{SOURCE0} %{buildroot}/usr/bin/ynx-wallet-cli' \
  '%files' \
  '/usr/bin/ynx-wallet-cli' \
  > "$spec"
touch -d "@${source_date_epoch}" "$rpm_top/SOURCES/ynx-wallet-cli" "$spec"
SOURCE_DATE_EPOCH=$source_date_epoch rpmbuild -bb --target "$rpm_arch" \
  --define "_topdir $rpm_top" \
  --define '_buildhost reproducible.ynx.local' \
  --define '_binary_payload w9.xzdio' \
  --define 'use_source_date_epoch_as_buildtime 1' \
  --define 'clamp_mtime_to_source_date_epoch 1' \
  "$spec" >/dev/null
rpm_source=$(find "$rpm_top/RPMS" -type f -name '*.rpm' -print -quit)
rpm_path="$absolute_output/ynx-wallet-cli-${package_version}-0.testnet.${short_commit}.${rpm_arch}.rpm"
install -m0644 "$rpm_source" "$rpm_path"

sha256sum "$deb_path" "$rpm_path"
stat -c '%n %s bytes' "$deb_path" "$rpm_path"
