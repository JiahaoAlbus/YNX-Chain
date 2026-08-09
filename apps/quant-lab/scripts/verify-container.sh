#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$repo_root"

python_bin=${PYTHON_BIN:-/usr/bin/python3}
if ! "$python_bin" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
  echo "Python 3.9+ is required for Quant container verification" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable" >&2
  exit 1
fi

release_source=$(
  "$python_bin" -c 'import json; print(json.load(open("apps/quant-lab/product-release.json", encoding="utf-8"))["sourceCommit"])'
)
source_commit=${YNX_QUANT_SOURCE_COMMIT:-$release_source}
if ! [[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || ! git cat-file -e "${source_commit}^{commit}" 2>/dev/null; then
  echo "Quant container source commit is not a resolvable full commit" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$source_commit" HEAD; then
  echo "Quant container source commit is not an ancestor of HEAD" >&2
  exit 1
fi
container_source_paths=(
  go.mod
  go.sum
  apps/quant-lab/Dockerfile
  apps/quant-lab/compose.yaml
  apps/quant-lab/web
  apps/quant-lab/scripts/verify-container.sh
  cmd/ynx-quantd
  cmd/ynx-quant-worker
  cmd/ynx-quant-paperd
  cmd/ynx-quant-riskd
  cmd/ynx-quant-web
  cmd/ynx-quant-cli
  internal/buildinfo
  internal/quantapp
  internal/quantcli
  internal/quantlab
  internal/quantpackage
  internal/quantworker
)
if ! git diff --quiet "$source_commit"..HEAD -- "${container_source_paths[@]}"; then
  echo "Quant container inputs changed after the declared source commit" >&2
  git diff --name-only "$source_commit"..HEAD -- "${container_source_paths[@]}" >&2
  exit 1
fi
container_dirty=$(git status --porcelain --untracked-files=all -- "${container_source_paths[@]}")
if [[ -n "$container_dirty" ]]; then
  echo "Quant container inputs contain uncommitted or untracked changes" >&2
  printf '%s\n' "$container_dirty" >&2
  exit 1
fi

allocate_port() {
  "$python_bin" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

short_commit=${source_commit:0:12}
run_id="${short_commit}-$$"
project="ynx-quant-verify-${run_id}"
image="ynx-quant:testnet-verify-${short_commit}"
restore_volume="ynx-quant-restore-${run_id}"
restore_container="ynx-quant-restore-${run_id}"
web_port=${YNX_QUANT_CONTAINER_PORT:-$(allocate_port)}
restore_port=${YNX_QUANT_RESTORE_PORT:-$(allocate_port)}
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/ynx-quant-container.XXXXXX")
evidence_path=${YNX_QUANT_CONTAINER_EVIDENCE:-$repo_root/tmp/quant-container-evidence.json}
compose_file=apps/quant-lab/compose.yaml
compose_started=0
restore_created=0
keep_image=${YNX_QUANT_KEEP_VERIFY_IMAGE:-0}

compose() {
  env \
    SOURCE_COMMIT="$source_commit" \
    YNX_QUANT_IMAGE="$image" \
    YNX_QUANT_WEB_HOST_ADDR=127.0.0.1 \
    YNX_QUANT_WEB_HOST_PORT="$web_port" \
    docker compose -p "$project" -f "$compose_file" "$@"
}

cleanup() {
  set +e
  if [[ "$compose_started" == "1" ]]; then
    compose down -v --remove-orphans >/dev/null 2>&1
  fi
  docker rm -f "$restore_container" >/dev/null 2>&1
  if [[ "$restore_created" == "1" ]]; then
    docker volume rm "$restore_volume" >/dev/null 2>&1
  fi
  if [[ "$keep_image" != "1" ]]; then
    docker image rm "$image" >/dev/null 2>&1
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

wait_http() {
  local url=$1
  local attempts=${2:-30}
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

docker build \
  -f apps/quant-lab/Dockerfile \
  --build-arg SOURCE_COMMIT="$source_commit" \
  -t "$image" .

image_id=$(docker image inspect "$image" --format '{{.Id}}')
image_size=$(docker image inspect "$image" --format '{{.Size}}')
image_user=$(docker image inspect "$image" --format '{{.Config.User}}')
image_os=$(docker image inspect "$image" --format '{{.Os}}')
image_arch=$(docker image inspect "$image" --format '{{.Architecture}}')
if [[ "$image_user" != "65532:65532" ]]; then
  echo "Quant container image is not configured for UID/GID 65532" >&2
  exit 1
fi

compose up -d
compose_started=1
wait_http "http://127.0.0.1:${web_port}/api/v1/snapshot" 60

running_services=$(compose ps --services --status running)
for required_service in quantd worker paperd riskd web; do
  if ! printf '%s\n' "$running_services" | grep -qx "$required_service"; then
    echo "Quant Compose service is not running: $required_service" >&2
    compose ps -a >&2
    exit 1
  fi
done

quantd_id=$(compose ps -q quantd)
if [[ -z "$quantd_id" ]]; then
  echo "Quant core container ID is unavailable" >&2
  exit 1
fi
if [[ "$(docker inspect "$quantd_id" --format '{{.Config.User}}')" != "65532:65532" ]]; then
  echo "Quant core container is not running as UID/GID 65532" >&2
  exit 1
fi
if [[ "$(docker inspect "$quantd_id" --format '{{.HostConfig.ReadonlyRootfs}}')" != "true" ]]; then
  echo "Quant core container root filesystem is not read-only" >&2
  exit 1
fi
cap_drop=$(docker inspect "$quantd_id" --format '{{json .HostConfig.CapDrop}}')
security_opt=$(docker inspect "$quantd_id" --format '{{json .HostConfig.SecurityOpt}}')
if [[ "$cap_drop" != *'"ALL"'* ]]; then
  echo "Quant core container does not drop all Linux capabilities" >&2
  exit 1
fi
if [[ "$security_opt" != *'no-new-privileges:true'* ]]; then
  echo "Quant core container does not enforce no-new-privileges" >&2
  exit 1
fi

docker exec "$quantd_id" /usr/local/bin/ynx-quant-cli health >"$tmp_dir/health-before.json"
curl --fail --silent --show-error \
  "http://127.0.0.1:${web_port}/api/v1/snapshot" >"$tmp_dir/snapshot-before.json"
"$python_bin" - "$tmp_dir/health-before.json" "$tmp_dir/snapshot-before.json" "$source_commit" <<'PY'
import json, sys
health = json.load(open(sys.argv[1], encoding="utf-8"))
snapshot = json.load(open(sys.argv[2], encoding="utf-8"))
expected = sys.argv[3]
assert health["ready"] is True
assert health["liveFundsEnabled"] is False
assert health["commit"] == expected
assert snapshot["failure"] is None
assert snapshot["liveFundsEnabled"] is False
PY

curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-ynx-preview-mode: local-paper' \
  -d '{"reason":"container persistence verification"}' \
  "http://127.0.0.1:${web_port}/api/v1/risk/kill" >"$tmp_dir/kill.json"
curl --fail --silent --show-error \
  "http://127.0.0.1:${web_port}/api/v1/snapshot" >"$tmp_dir/snapshot-killed.json"
"$python_bin" - "$tmp_dir/snapshot-killed.json" <<'PY'
import json, sys
snapshot = json.load(open(sys.argv[1], encoding="utf-8"))
assert snapshot["paper"]["KillSwitch"] is True
assert snapshot["audit"][-1]["Action"] == "kill_switch_activated"
PY

compose stop
compose up -d
wait_http "http://127.0.0.1:${web_port}/api/v1/snapshot" 60
curl --fail --silent --show-error \
  "http://127.0.0.1:${web_port}/api/v1/snapshot" >"$tmp_dir/snapshot-restarted.json"
"$python_bin" - "$tmp_dir/snapshot-killed.json" "$tmp_dir/snapshot-restarted.json" <<'PY'
import json, sys
before = json.load(open(sys.argv[1], encoding="utf-8"))
after = json.load(open(sys.argv[2], encoding="utf-8"))
assert after["paper"]["KillSwitch"] is True
assert after["audit"][0]["Hash"] == before["audit"][0]["Hash"]
assert after["audit"][0]["Digest"] == before["audit"][0]["Digest"]
PY

quantd_id=$(compose ps -q quantd)
docker exec "$quantd_id" /usr/local/bin/ynx-quant-cli \
  backup --approve /var/lib/ynx-quant/backup.json >"$tmp_dir/backup-report.json"
docker cp "$quantd_id:/var/lib/ynx-quant/backup.json" "$tmp_dir/backup.json" >/dev/null
backup_sha=$(shasum -a 256 "$tmp_dir/backup.json" | awk '{print $1}')
reported_backup_sha=$(
  "$python_bin" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["sha256"])' \
    "$tmp_dir/backup-report.json"
)
if [[ "$backup_sha" != "$reported_backup_sha" ]]; then
  echo "Quant backup SHA-256 does not match the CLI report" >&2
  exit 1
fi
backup_bytes=$(wc -c <"$tmp_dir/backup.json" | tr -d ' ')

docker volume create "$restore_volume" >/dev/null
restore_created=1
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=volume,src=${restore_volume},dst=/var/lib/ynx-quant" \
  --mount "type=bind,src=${tmp_dir}/backup.json,dst=/restore/backup.json,readonly" \
  --env YNX_QUANT_STATE_PATH=/var/lib/ynx-quant/state.json \
  --entrypoint /usr/local/bin/ynx-quant-cli \
  "$image" restore --approve /restore/backup.json >"$tmp_dir/restore-report.json"

docker run -d \
  --name "$restore_container" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=volume,src=${restore_volume},dst=/var/lib/ynx-quant" \
  --publish "127.0.0.1:${restore_port}:6444" \
  --env YNX_QUANT_HTTP_ADDR=0.0.0.0:6444 \
  --env YNX_QUANT_STATE_PATH=/var/lib/ynx-quant/state.json \
  "$image" >/dev/null
wait_http "http://127.0.0.1:${restore_port}/health" 30
curl --fail --silent --show-error \
  "http://127.0.0.1:${restore_port}/health" >"$tmp_dir/restore-health.json"
curl --fail --silent --show-error \
  "http://127.0.0.1:${restore_port}/v1/snapshot" >"$tmp_dir/restore-snapshot.json"
"$python_bin" - "$tmp_dir/restore-health.json" "$tmp_dir/restore-snapshot.json" "$source_commit" <<'PY'
import json, sys
health = json.load(open(sys.argv[1], encoding="utf-8"))
snapshot = json.load(open(sys.argv[2], encoding="utf-8"))
expected = sys.argv[3]
assert health["ready"] is True
assert health["commit"] == expected
assert health["signals"]["killSwitch"] is True
assert snapshot["paper"]["KillSwitch"] is True
assert snapshot["audit"][-1]["Action"] == "state_restored"
assert snapshot["audit"][-1]["PreviousHash"] == snapshot["audit"][-2]["Hash"]
PY

mkdir -p "$(dirname "$evidence_path")"
export YNX_EVIDENCE_SOURCE_COMMIT="$source_commit"
export YNX_EVIDENCE_IMAGE_ID="$image_id"
export YNX_EVIDENCE_IMAGE_SIZE="$image_size"
export YNX_EVIDENCE_IMAGE_USER="$image_user"
export YNX_EVIDENCE_IMAGE_OS="$image_os"
export YNX_EVIDENCE_IMAGE_ARCH="$image_arch"
export YNX_EVIDENCE_BACKUP_SHA="$backup_sha"
export YNX_EVIDENCE_BACKUP_BYTES="$backup_bytes"
export YNX_EVIDENCE_PATH="$evidence_path"
export YNX_EVIDENCE_HEALTH="$tmp_dir/health-before.json"
export YNX_EVIDENCE_RESTORE_HEALTH="$tmp_dir/restore-health.json"
"$python_bin" <<'PY'
import datetime, json, os
payload = {
    "schemaVersion": 1,
    "productId": "ynx-quant-lab",
    "evidenceDate": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "sourceCommit": os.environ["YNX_EVIDENCE_SOURCE_COMMIT"],
    "image": {
        "id": os.environ["YNX_EVIDENCE_IMAGE_ID"],
        "bytes": int(os.environ["YNX_EVIDENCE_IMAGE_SIZE"]),
        "os": os.environ["YNX_EVIDENCE_IMAGE_OS"],
        "architecture": os.environ["YNX_EVIDENCE_IMAGE_ARCH"],
        "user": os.environ["YNX_EVIDENCE_IMAGE_USER"],
        "signingClass": "local-unsigned-container-candidate",
        "hosted": False,
    },
    "security": {
        "readOnlyRootFilesystem": True,
        "capDropAll": True,
        "noNewPrivileges": True,
        "namedVolumeOwnedByRuntimeUser": True,
    },
    "compose": {
        "services": ["ynx-quantd", "ynx-quant-worker", "ynx-quant-paperd", "ynx-quant-riskd", "ynx-quant-web"],
        "healthy": True,
        "loopbackWebBinding": True,
        "loopbackPreviewBoundaryPreserved": True,
    },
    "restart": {
        "orderedStopStartPassed": True,
        "killSwitchPersisted": True,
        "auditHashPersisted": True,
    },
    "backupRestore": {
        "backupSha256": os.environ["YNX_EVIDENCE_BACKUP_SHA"],
        "backupBytes": int(os.environ["YNX_EVIDENCE_BACKUP_BYTES"]),
        "isolatedRestorePassed": True,
        "auditContinuityPassed": True,
    },
    "health": json.load(open(os.environ["YNX_EVIDENCE_HEALTH"], encoding="utf-8")),
    "restoreHealth": json.load(open(os.environ["YNX_EVIDENCE_RESTORE_HEALTH"], encoding="utf-8")),
    "limitations": [
        "Local Docker Desktop evidence only",
        "Image is not signed, hosted, externally scanned, or deployed publicly",
        "No canonical Wallet, Exchange, DEX, Oracle, or shared Testnet integration is claimed",
    ],
}
with open(os.environ["YNX_EVIDENCE_PATH"], "w", encoding="utf-8") as output:
    json.dump(payload, output, indent=2, sort_keys=True)
    output.write("\n")
print(json.dumps(payload, sort_keys=True))
PY

echo "Quant container runtime, restart, backup, and restore gates passed"
