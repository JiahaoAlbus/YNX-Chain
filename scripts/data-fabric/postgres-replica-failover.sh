#!/usr/bin/env bash
set -euo pipefail

primary_container="${YNX_TEST_POSTGRES_PRIMARY_CONTAINER:?YNX_TEST_POSTGRES_PRIMARY_CONTAINER is required}"
primary_dsn="${YNX_TEST_POSTGRES_DSN:?YNX_TEST_POSTGRES_DSN is required}"
database_password="${YNX_TEST_POSTGRES_PASSWORD:?YNX_TEST_POSTGRES_PASSWORD is required}"
source_commit="${YNX_DATA_FABRIC_TEST_SOURCE_COMMIT:?YNX_DATA_FABRIC_TEST_SOURCE_COMMIT is required}"
output_dir="${YNX_DATA_FABRIC_FAILOVER_OUTPUT_DIR:?YNX_DATA_FABRIC_FAILOVER_OUTPUT_DIR is required}"
probe_binary="${YNX_DATA_FABRIC_POSTGRES_RESILIENCE_BIN:-/tmp/ynx-data-fabric-postgres-resilience}"
dirty_working_tree="${YNX_DATA_FABRIC_DIRTY_WORKING_TREE:-true}"

database="ynx_data_fabric_test"
database_user="ynx_test"
replication_user="ynx_replica"
replication_password="replication-only-password"
image="postgres:17.10-alpine"
test_id="${GITHUB_RUN_ID:-local}-$$"
network="ynx-df-pg-failover-${test_id}"
standby="ynx-df-pg-standby-${test_id}"
standby_volume="ynx-df-pg-standby-${test_id}"

if [[ ! "$primary_container" =~ ^ynx-df-pg-primary-[a-zA-Z0-9_.-]+$ && ! "$primary_container" =~ ^[0-9a-f]{12,64}$ ]]; then
  printf 'refusing unexpected primary container name\n' >&2
  exit 1
fi
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { printf 'invalid source commit\n' >&2; exit 1; }
[[ "$dirty_working_tree" == "true" || "$dirty_working_tree" == "false" ]] || { printf 'invalid dirty-working-tree state\n' >&2; exit 1; }
[[ -x "$probe_binary" ]] || { printf 'PostgreSQL resilience binary is not executable\n' >&2; exit 1; }
mkdir -p "$output_dir"

cleanup() {
  docker rm -f "$standby" >/dev/null 2>&1 || true
  docker network disconnect "$network" "$primary_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker volume rm "$standby_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker network connect --alias ynx-df-primary "$network" "$primary_container"

docker exec -e PGPASSWORD="$database_password" "$primary_container" \
  psql -v ON_ERROR_STOP=1 -U "$database_user" -d postgres \
  -c "DROP DATABASE IF EXISTS ${database} WITH (FORCE)" >/dev/null
docker exec -e PGPASSWORD="$database_password" "$primary_container" \
  psql -v ON_ERROR_STOP=1 -U "$database_user" -d postgres \
  -c "CREATE DATABASE ${database} OWNER ${database_user}" >/dev/null
docker exec -e PGPASSWORD="$database_password" "$primary_container" \
  psql -v ON_ERROR_STOP=1 -U "$database_user" -d postgres \
  -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${replication_user}') THEN CREATE ROLE ${replication_user} WITH REPLICATION LOGIN PASSWORD '${replication_password}'; ELSE ALTER ROLE ${replication_user} WITH REPLICATION LOGIN PASSWORD '${replication_password}'; END IF; END \$\$" >/dev/null
docker exec "$primary_container" sh -ec \
  "printf '%s\n' 'host replication ${replication_user} all scram-sha-256' >> /var/lib/postgresql/data/pg_hba.conf"
docker exec -e PGPASSWORD="$database_password" "$primary_container" \
  psql -v ON_ERROR_STOP=1 -U "$database_user" -d postgres -c 'SELECT pg_reload_conf()' >/dev/null

docker volume create "$standby_volume" >/dev/null
docker run --rm -v "$standby_volume:/var/lib/postgresql/data" "$image" \
  sh -ec 'chown -R postgres:postgres /var/lib/postgresql/data'
docker run --rm --user postgres --network "$network" \
  -e PGPASSWORD="$replication_password" -v "$standby_volume:/var/lib/postgresql/data" \
  --entrypoint pg_basebackup "$image" \
  -h ynx-df-primary -U "$replication_user" -D /var/lib/postgresql/data -Fp -Xs -R >/dev/null
docker run -d --name "$standby" --network "$network" -p '127.0.0.1::5432' \
  -v "$standby_volume:/var/lib/postgresql/data" "$image" >/dev/null

for _ in $(seq 1 120); do
  if docker exec "$standby" pg_isready -U "$database_user" -d "$database" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
standby_in_recovery="$(docker exec -e PGPASSWORD="$database_password" "$standby" psql -At -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c 'SELECT pg_is_in_recovery()')"
standby_read_only="$(docker exec -e PGPASSWORD="$database_password" "$standby" psql -At -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c "SELECT current_setting('transaction_read_only')::boolean")"
[[ "$standby_in_recovery" == "t" && "$standby_read_only" == "t" ]] || { printf 'standby is not a read-only recovery replica\n' >&2; exit 1; }

source_release="ynx-data-fabric-${source_commit:0:12}"
YNX_TEST_POSTGRES_DSN="$primary_dsn" YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE=1 \
  "$probe_binary" -phase seed -events 1000 -hot-share-percent 90 -cold-workers 8 \
  -duplicate-attempts 100 -source-commit "$source_commit" -source-release "$source_release" \
  -dirty-working-tree="$dirty_working_tree" -topology streaming-primary-standby \
  > "$output_dir/postgres-replica-failover-seed.json"

primary_flush_lsn="$(docker exec -e PGPASSWORD="$database_password" "$primary_container" psql -At -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c 'SELECT pg_current_wal_flush_lsn()')"
replica_caught_up=false
standby_replay_lsn=""
for _ in $(seq 1 240); do
  standby_replay_lsn="$(docker exec -e PGPASSWORD="$database_password" "$standby" psql -At -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c 'SELECT pg_last_wal_replay_lsn()')"
  caught_up="$(docker exec -e PGPASSWORD="$database_password" "$standby" psql -At -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c "SELECT pg_last_wal_replay_lsn() >= '${primary_flush_lsn}'::pg_lsn")"
  if [[ "$caught_up" == "t" ]]; then
    replica_caught_up=true
    break
  fi
  sleep 0.25
done
[[ "$replica_caught_up" == "true" ]] || { printf 'standby did not replay through the primary flush LSN\n' >&2; exit 1; }

restart_started_unix_nano="$(node -e 'process.stdout.write(String(BigInt(Date.now()) * 1000000n))')"
docker stop --time 10 "$primary_container" >/dev/null
[[ "$(docker inspect -f '{{.State.Running}}' "$primary_container")" == "false" ]] || { printf 'primary did not stop\n' >&2; exit 1; }
docker exec -e PGPASSWORD="$database_password" "$standby" \
  psql -At -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c 'SELECT pg_promote(true, 60)' \
  | grep -qx 't'

standby_port="$(docker port "$standby" 5432/tcp | sed -n '1s/.*://p')"
[[ "$standby_port" =~ ^[0-9]+$ ]] || { printf 'invalid standby host port\n' >&2; exit 1; }
standby_dsn="postgres://${database_user}:${database_password}@127.0.0.1:${standby_port}/${database}?sslmode=disable"
YNX_TEST_POSTGRES_DSN="$standby_dsn" YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE=1 \
  "$probe_binary" -phase verify -events 1000 -hot-share-percent 90 -cold-workers 8 \
  -duplicate-attempts 100 -source-commit "$source_commit" -source-release "$source_release" \
  -dirty-working-tree="$dirty_working_tree" -topology streaming-primary-standby -recovery-kind standby-promotion \
  -restart-started-unix-nano "$restart_started_unix_nano" \
  > "$output_dir/postgres-replica-failover-verify.json"

jq -n \
  --slurpfile seed "$output_dir/postgres-replica-failover-seed.json" \
  --slurpfile verify "$output_dir/postgres-replica-failover-verify.json" \
  --arg primaryFlushLSN "$primary_flush_lsn" \
  --arg standbyReplayLSN "$standby_replay_lsn" '
  {
    schema: "ynx-data-fabric-postgres-replica-failover/v1",
    sourceCommit: $verify[0].sourceCommit,
    sourceRelease: $verify[0].sourceRelease,
    dirtyWorkingTree: $verify[0].dirtyWorkingTree,
    databaseVersion: $verify[0].databaseVersion,
    topology: $verify[0].databaseTopology,
    replicationMode: "asynchronous-streaming",
    standbyWasInRecovery: true,
    standbyWasReadOnly: true,
    primaryFlushLSN: $primaryFlushLSN,
    standbyReplayLSNBeforeFailure: $standbyReplayLSN,
    caughtUpBeforePrimaryStop: true,
    primaryStopped: true,
    promotionMode: "manual-pg-promote",
    promotedWritablePrimary: $verify[0].writablePrimary,
    canonicalEvents: $verify[0].events,
    duplicateRejectsBeforeFailure: $seed[0].duplicateRejects,
    outboxPendingBeforeFailure: $seed[0].transactionalOutboxQueueDepth,
    connectionAttemptsAfterFailure: $verify[0].connectionAttempts,
    acceptingConnectionsRTOMilliseconds: $verify[0].acceptingConnectionsRTOMilliseconds,
    integrityValidatedRTOMilliseconds: $verify[0].integrityValidatedRTOMilliseconds,
    recoveryPointObjectiveLostEvents: $verify[0].recoveryPointObjectiveLostEvents,
    replayApplied: $verify[0].longReplayApplied,
    idempotentReplaySkipped: $verify[0].idempotentReplaySkipped,
    inboxEffects: $verify[0].inboxEffects,
    analyticsFacts: $verify[0].analyticsFacts,
    finalOutboxPending: $verify[0].transactionalOutboxQueueDepth,
    limitations: $verify[0].limitations
  }
  | if .sourceCommit != $seed[0].sourceCommit then error("seed and failover source commits differ") else . end
  | if .topology != "streaming-primary-standby" then error("failover topology mismatch") else . end
  | if .canonicalEvents != 1000 or .recoveryPointObjectiveLostEvents != 0 then error("failover lost canonical events") else . end
  | if .replayApplied != 1000 or .idempotentReplaySkipped != 1000 or .inboxEffects != 1000 or .analyticsFacts != 1000 then error("post-promotion replay invariants failed") else . end
  | if .outboxPendingBeforeFailure != 1000 or .finalOutboxPending != 1000 then error("Outbox changed across failover") else . end
  ' > "$output_dir/postgres-replica-failover.json"

jq -e '
  .standbyWasInRecovery == true
  and .standbyWasReadOnly == true
  and .caughtUpBeforePrimaryStop == true
  and .primaryStopped == true
  and .promotedWritablePrimary == true
  and .recoveryPointObjectiveLostEvents == 0
' "$output_dir/postgres-replica-failover.json" >/dev/null
