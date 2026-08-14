#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

control=infra/systemd/ynx-monitor.example.service
publisher=infra/systemd/ynx-monitor-publisher.example.service
timer=infra/systemd/ynx-monitor-publisher.example.timer
caddy=infra/caddy/ynx-monitor.caddy.example
environment=infra/monitor/ynx-monitor.env.example

for required in "$control" "$publisher" "$timer" "$caddy" "$environment"; do
  [[ -s "$required" ]] || { echo "missing Monitor deployment asset: $required" >&2; exit 1; }
done

for unit in "$control" "$publisher"; do
  grep -Fq 'User=ynx' "$unit"
  grep -Fq 'EnvironmentFile=/etc/ynx/ynx-monitor.env' "$unit"
  grep -Fq 'WorkingDirectory=/opt/ynx-monitor/current/apps/monitor' "$unit"
  grep -Fq 'NoNewPrivileges=true' "$unit"
  grep -Fq 'ProtectSystem=strict' "$unit"
  grep -Fq 'ProtectHome=true' "$unit"
  grep -Fq 'ReadWritePaths=/var/lib/ynx-monitor' "$unit"
done

grep -Fq 'ExecStart=/usr/bin/node node_modules/tsx/dist/cli.mjs server/index.ts' "$control"
grep -Fq 'MemoryMax=512M' "$control"
grep -Fq 'TasksMax=256' "$control"
grep -Fq 'ExecStart=/usr/bin/node scripts/publish-public-status.mjs' "$publisher"
grep -Fq 'OnUnitActiveSec=30s' "$timer"
grep -Fq 'Persistent=true' "$timer"
grep -Fq 'Unit=ynx-monitor-publisher.service' "$timer"

for route in '/health' '/version' '/status' '/ops/*'; do
  grep -Fq "$route" "$caddy" || { echo "Monitor ingress is missing $route" >&2; exit 1; }
done
grep -Fq 'reverse_proxy 127.0.0.1:18112' "$caddy"
grep -Fq 'root * /opt/ynx-monitor/current/apps/monitor/dist' "$caddy"

for key in YNX_MONITOR_PORT YNX_MONITOR_STATE_PATH YNX_MONITOR_PUBLIC_STATUS_PATH YNX_MONITOR_PUBLIC_STATUS_INTEGRITY_KEY YNX_MONITOR_PUBLIC_STATUS_EXPECTED_SOURCE YNX_MONITOR_PUBLIC_STATUS_APPROVAL_ID YNX_MONITOR_PUBLIC_STATUS_PROBES; do
  grep -Eq "^${key}=" "$environment" || { echo "Monitor environment template is missing $key" >&2; exit 1; }
done
if grep -Eq '^YNX_MONITOR_(SOURCE_COMMIT|RELEASE)=' "$environment"; then
  echo "Monitor environment template must not pin a historical release identity" >&2
  exit 1
fi

echo "Monitor deployment assets passed"
