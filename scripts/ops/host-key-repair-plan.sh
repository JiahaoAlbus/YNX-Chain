#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh
ynx_load_env

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-${SERVER_HOST:-43.153.202.237}}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-${SERVER_USER:-ubuntu}}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-/Users/huangjiahao/Downloads/Huang.pem}}"
SG_NODE_HOST="${SG_NODE_HOST:-43.134.23.58}"
SG_NODE_USER="${SG_NODE_USER:-root}"
SG_NODE_SSH_KEY="${SG_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}}"
SILICON_VALLEY_NODE_HOST="${SILICON_VALLEY_NODE_HOST:-43.162.100.54}"
SILICON_VALLEY_NODE_USER="${SILICON_VALLEY_NODE_USER:-ubuntu}"
SILICON_VALLEY_NODE_SSH_KEY="${SILICON_VALLEY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang2.pem}"
SEOUL_NODE_HOST="${SEOUL_NODE_HOST:-43.164.132.81}"
SEOUL_NODE_USER="${SEOUL_NODE_USER:-root}"
SEOUL_NODE_SSH_KEY="${SEOUL_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang3.pem}"

out="${YNX_HOST_KEY_AUDIT_OUT:-tmp/host-key-audit}"
known_hosts="${KNOWN_HOSTS_FILE:-$HOME/.ssh/known_hosts}"
plan="$out/HOST_KEY_REPAIR_PLAN.md"
mkdir -p "$out"

shell_quote() {
  printf "%q" "$1"
}

write_node_plan() {
  local role="$1" user="$2" host="$3" key="$4"
  local scan_file="$out/${role}-${host}.known_hosts"
  local status="needs-review"
  local strict_output

  ssh-keyscan -T 8 -t ed25519,ecdsa,rsa "$host" > "$scan_file" 2>/dev/null || true
  if [[ ! -s "$scan_file" ]]; then
    status="keyscan-failed"
  elif ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$user@$host" "hostname >/dev/null" >"$out/${role}-${host}.strict.out" 2>&1; then
    status="strict-ok"
  else
    status="strict-failed"
  fi
  strict_output="$(sed -n '1,20p' "$out/${role}-${host}.strict.out" 2>/dev/null || true)"

  {
    echo "## $role"
    echo
    echo "- Login: \`$user@$host\`"
    echo "- SSH key path: \`$key\`"
    echo "- Status from strict check: \`$status\`"
    echo
    echo "Current local known_hosts entries:"
    echo
    echo '```text'
    ssh-keygen -F "$host" -f "$known_hosts" 2>/dev/null || echo "none"
    echo '```'
    echo
    echo "Presented fingerprints from \`ssh-keyscan\`:"
    echo
    echo '```text'
    if [[ -s "$scan_file" ]]; then
      ssh-keygen -lf "$scan_file"
    else
      echo "ssh-keyscan returned no keys"
    fi
    echo '```'
    echo
    if [[ -n "$strict_output" ]]; then
      echo "Strict SSH output:"
      echo
      echo '```text'
      printf '%s\n' "$strict_output"
      echo '```'
      echo
    fi
    if [[ "$status" == "strict-ok" ]]; then
      echo "No local host-key repair is required for this node."
    elif [[ "$status" == "keyscan-failed" ]]; then
      echo "Do not update known_hosts for this node yet. Confirm the instance is reachable and retry host-key audit."
    else
      echo "Do not run these commands until the presented fingerprints above are confirmed from a trusted cloud-console or provider channel."
      echo
      echo '```bash'
      printf 'cp %s %s\n' "$(shell_quote "$known_hosts")" "$(shell_quote "$known_hosts.bak.$(date +%Y%m%d%H%M%S)")"
      printf 'ssh-keygen -R %s -f %s\n' "$(shell_quote "$host")" "$(shell_quote "$known_hosts")"
      printf 'cat %s >> %s\n' "$(shell_quote "$scan_file")" "$(shell_quote "$known_hosts")"
      printf 'ssh -i %s -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes %s hostname\n' "$(shell_quote "$key")" "$(shell_quote "$user@$host")"
      echo '```'
    fi
    echo
  } >> "$plan"
}

{
  echo "# Host Key Repair Plan"
  echo
  echo "Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "This file is an operator plan only. It does not modify \`$known_hosts\`."
  echo
  echo "Rules:"
  echo
  echo "- Do not update any host key until the presented fingerprint is confirmed from a trusted out-of-band source."
  echo "- Write confirmed fingerprints to ignored \`.host-key-approvals.json\`, then require \`make host-key-approval-check\` to pass before running any repair command."
  echo "- Do not use this plan to bypass SSH host-key protection."
  echo "- After any approved host-key update, rerun \`make host-key-audit\`, \`make remote-blocker-report\`, and \`make deploy-readiness-gate\`."
  echo
} > "$plan"

write_node_plan "primary" "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY"
write_node_plan "singapore" "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY"
write_node_plan "silicon-valley" "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY"
write_node_plan "seoul" "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY"

echo "host-key repair plan written: $plan"
