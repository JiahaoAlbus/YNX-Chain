#!/usr/bin/env bash
set -euo pipefail
cfg=/etc/caddy/conf.d/ynx-video-products-20260906.caddy
staged=/var/tmp/ynx-video-products-20260906.caddy
expected=9f38811c6b027f8713613d94607e8225da034578d35d897c2533215c7472f3fa
[ "$(sha256sum "$staged" | cut -d' ' -f1)" = "$expected" ]
test ! -e "$cfg"
record() {
 date -u
 sha256sum /etc/caddy/Caddyfile /etc/caddy/ynx-chain.caddy
 systemctl show ynx-videod.service ynx-video-viewer.service ynx-creator-studio-wallet.service -p Id -p MainPID -p ActiveState -p ExecMainStartTimestamp
}
record
rollback() {
 sudo -n rm -f "$cfg"
 sudo -n caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
 sudo -n systemctl reload caddy
}
trap 'rollback' ERR
sudo -n install -o root -g root -m 0644 "$staged" "$cfg"
sudo -n caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo -n systemctl reload caddy
sudo -n systemctl is-active caddy
trap - ERR
record
sha256sum "$cfg"
stat -c '%a %U %G %n' "$cfg"
echo PRODUCT_DOMAIN_ROUTES_INSTALLED=true
