#!/usr/bin/env bash
set -euo pipefail

# Pay production baseline collector. Every production-host command below is
# read-only and its stdout is redirected by this local shell into a local
# evidence directory. The remote host is never used as scratch storage.

readonly PAY_HOST="43.153.202.237"
readonly PAY_USER="ubuntu"
readonly PAY_HOST_KEY="SHA256:7wrOak1OZoD6oDAr0e3En+UD4fs8QnAM1n0Jvwi6Ha8"
readonly PAY_ORIGIN="https://pay.ynxweb4.com"

if [[ "${1:-}" == "--print-remote-commands" ]]; then
  audit_only=1
  shift
else
  audit_only=0
fi

output_dir="${1:-}"
if [[ "$audit_only" -eq 0 && -z "$output_dir" ]]; then
  echo "usage: $0 OUTPUT_DIRECTORY" >&2
  exit 64
fi

remote_commands=(
  "sudo cat /etc/caddy/Caddyfile"
  "sudo cat /etc/caddy/ynx-chain.caddy"
  "sudo cat /etc/caddy/conf.d/ynx-pay-app.caddy"
  "sudo cat /etc/caddy/conf.d/ynx-merchant-console.caddy"
  "sudo caddy adapt --config /etc/caddy/Caddyfile"
  "sudo sha256sum /etc/caddy/Caddyfile /etc/caddy/ynx-chain.caddy /etc/caddy/conf.d/ynx-pay-app.caddy /etc/caddy/conf.d/ynx-merchant-console.caddy"
  "sudo stat -c '%n|dev=%d|ino=%i|uid=%u|gid=%g|mode=%a|nlink=%h|bytes=%s|type=%F' /etc/caddy/Caddyfile /etc/caddy/ynx-chain.caddy /etc/caddy/conf.d/ynx-pay-app.caddy /etc/caddy/conf.d/ynx-merchant-console.caddy /opt /opt/ynx /opt/ynx/pay-app-current /usr/local/bin/ynx-payd"
  "sudo readlink /opt/ynx/pay-app-current"
  "sudo find -L /opt/ynx/pay-app-current -xdev -type f -printf '%P|%s\\n'"
  "sudo find -L /opt/ynx/pay-app-current -xdev -type f -exec sha256sum '{}' ';'"
  "sudo test ! -e /opt/ynx-pay-web && echo ABSENT:/opt/ynx-pay-web"
  "sudo sha256sum /usr/local/bin/ynx-payd"
  "sudo systemctl show ynx-payd.service --property=ActiveState,SubState,MainPID,NRestarts,ExecStart,FragmentPath --no-pager"
  "sudo ss -H -lntp"
  "sudo -n -l"
)

for command in "${remote_commands[@]}"; do
  if [[ "$command" =~ (^|[[:space:]])(mktemp|tee|touch|mkdir|rm|cp|mv|install|tar)([[:space:]]|$) ]] ||
     [[ "$command" =~ (^|[[:space:]])systemctl[[:space:]]+(restart|reload|start|stop|enable|disable) ]] ||
     [[ "$command" =~ (^|[[:space:]])caddy[[:space:]]+reload ]] ||
     [[ "$command" == *">"* ]]; then
    echo "refusing non-read-only remote command: $command" >&2
    exit 65
  fi
done

if [[ "$audit_only" -eq 1 ]]; then
  printf '%s\n' "${remote_commands[@]}"
  exit 0
fi

if [[ -e "$output_dir" ]]; then
  echo "output directory must not already exist: $output_dir" >&2
  exit 66
fi
mkdir -m 0700 "$output_dir"

if ! ssh-keygen -lf "${PAY_KNOWN_HOSTS:?set PAY_KNOWN_HOSTS to a local pinned known_hosts file}" | grep -Fq "$PAY_HOST_KEY"; then
  echo "pinned known_hosts does not contain the authorized Pay host key" >&2
  exit 67
fi

ssh_base=(
  ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="${PAY_KNOWN_HOSTS:?set PAY_KNOWN_HOSTS to a local pinned known_hosts file}"
  -o ConnectTimeout=10 "${PAY_USER}@${PAY_HOST}"
)

remote_capture() {
  local filename="$1"
  local command="$2"
  "${ssh_base[@]}" "$command" >"$output_dir/$filename"
}

remote_capture caddyfile.raw "${remote_commands[0]}"
remote_capture ynx-chain.caddy.raw "${remote_commands[1]}"
remote_capture ynx-pay-app.caddy.raw "${remote_commands[2]}"
remote_capture ynx-merchant-console.caddy.raw "${remote_commands[3]}"
remote_capture caddy-adapt.json "${remote_commands[4]}"
remote_capture caddy-sha256.txt "${remote_commands[5]}"
remote_capture host-stat.txt "${remote_commands[6]}"
remote_capture pay-app-current-link.txt "${remote_commands[7]}"
remote_capture pay-app-current-files.txt "${remote_commands[8]}"
remote_capture pay-app-current-sha256.txt "${remote_commands[9]}"
remote_capture pay-web-absence.txt "${remote_commands[10]}"
remote_capture payd-binary-sha256.txt "${remote_commands[11]}"
remote_capture payd-service.txt "${remote_commands[12]}"
remote_capture listeners.txt "${remote_commands[13]}"
remote_capture sudo-policy.txt "${remote_commands[14]}"

for route in root health version callback; do
  case "$route" in
    root) url="$PAY_ORIGIN/" ;;
    health) url="$PAY_ORIGIN/health" ;;
    version) url="$PAY_ORIGIN/version" ;;
    callback) url="$PAY_ORIGIN/merchant/wallet-auth/callback" ;;
  esac
  curl --fail-with-body --silent --show-error --location --max-time 20 \
    --dump-header "$output_dir/public-$route.headers" \
    --output "$output_dir/public-$route.body" "$url" || true
done

(cd "$output_dir" && shasum -a 256 ./* > evidence-sha256.txt)
printf '%s\n' "$PAY_HOST_KEY" >"$output_dir/expected-host-key-fingerprint.txt"
