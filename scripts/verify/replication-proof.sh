#!/usr/bin/env bash

ynx_replication_proof_matches() {
  local observed_height="${1:-}"
  local observed_hash="${2:-}"
  local replica_hash="${3:-}"
  local primary_hash="${4:-}"

  [[ "$observed_height" =~ ^[0-9]+$ ]] &&
    (( observed_height > 0 )) &&
    [[ -n "$observed_hash" ]] &&
    [[ -n "$replica_hash" ]] &&
    [[ -n "$primary_hash" ]] &&
    [[ "$replica_hash" == "$observed_hash" ]] &&
    [[ "$primary_hash" == "$observed_hash" ]]
}
