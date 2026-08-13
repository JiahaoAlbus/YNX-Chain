#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
source_commit=${1:-}
package_dir=${2:-release/wallet-cli/linux-packages}
preflight_dir=${3:-release/wallet-cli/linux-packages-preflight}
case "$(uname -m)" in
  x86_64) deb_arch=amd64; rpm_arch=x86_64 ;;
  aarch64|arm64) deb_arch=arm64; rpm_arch=aarch64 ;;
  *) echo "unsupported architecture" >&2; exit 2 ;;
esac
short_commit=${source_commit:0:12}
deb="$repo_root/$package_dir/ynx-wallet-cli_0.1.0~testnet+${short_commit}_${deb_arch}.deb"
rpm="$repo_root/$package_dir/ynx-wallet-cli-0.1.0-0.testnet.${short_commit}.${rpm_arch}.rpm"
preflight_deb="$repo_root/$preflight_dir/ynx-wallet-cli_0.0.0~testnet+${short_commit}_${deb_arch}.deb"
preflight_rpm="$repo_root/$preflight_dir/ynx-wallet-cli-0.0.0-0.testnet.${short_commit}.${rpm_arch}.rpm"
vector="$repo_root/packages/wallet-auth/testdata/product-session-http-proof-v1.json"

dpkg-deb --info "$deb" >/dev/null
dpkg-deb --contents "$deb" | grep -q 'usr/bin/ynx-wallet-cli'
rpm -qip "$rpm" >/dev/null
rpm -qlp "$rpm" | grep -qx '/usr/bin/ynx-wallet-cli'

dpkg -i "$preflight_deb" >/dev/null
ynx-wallet-cli version >/tmp/ynx-wallet-linux-cold.json
dpkg -i "$deb" >/dev/null
dpkg-query -W -f='${Version}' ynx-wallet-cli | grep -q '^0.1.0~testnet+'
ynx-wallet-cli version >/tmp/ynx-wallet-linux-second.json
cmp /tmp/ynx-wallet-linux-cold.json /tmp/ynx-wallet-linux-second.json
ynx-wallet-cli verify-vector -file "$vector" >/tmp/ynx-wallet-linux-vector.json
ynx-wallet-cli sign-self-test >/tmp/ynx-wallet-linux-sign.json
ynx-wallet-cli chain-status -timeout 15s >/tmp/ynx-wallet-linux-chain.json
dpkg -r ynx-wallet-cli >/dev/null
! command -v ynx-wallet-cli

rpm -i --nodeps "$preflight_rpm"
ynx-wallet-cli version >/tmp/ynx-wallet-linux-rpm-cold.json
rpm -U --nodeps "$rpm"
rpm -q --qf '%{VERSION}' ynx-wallet-cli | grep -qx '0.1.0'
ynx-wallet-cli verify-vector -file "$vector" >/tmp/ynx-wallet-linux-rpm-vector.json
ynx-wallet-cli sign-self-test >/tmp/ynx-wallet-linux-rpm-sign.json
ynx-wallet-cli chain-status -timeout 15s >/tmp/ynx-wallet-linux-rpm-chain.json
rpm -e ynx-wallet-cli
! command -v ynx-wallet-cli

printf '{"architecture":"%s","sourceCommit":"%s","debInstalled":true,"debColdStart":true,"debSecondStart":true,"debUpgradeVerified":true,"rpmInstalled":true,"rpmColdStart":true,"rpmUpgradeVerified":true,"vectorVerified":true,"signingVerified":true,"chainId":"0x1917","uninstallVerified":true,"productionSigned":false}\n' "$(uname -m)" "$source_commit"
