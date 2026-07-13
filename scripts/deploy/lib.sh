#!/usr/bin/env bash
set -euo pipefail

ynx_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

ynx_load_env() {
  local env_file="${ENV_FILE:-}"
  if [[ -z "$env_file" ]]; then
    if [[ -f .env.deploy ]]; then
      env_file=.env.deploy
    elif [[ -f .env ]]; then
      env_file=.env
    fi
  fi
  if [[ -n "$env_file" ]]; then
    [[ -f "$env_file" ]] || { echo "env file not found: $env_file"; exit 1; }
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

ynx_require_env() {
  local missing=0
  for key in "$@"; do
    if [[ -z "${!key:-}" ]]; then
      echo "Missing required env: $key"
      missing=1
    fi
  done
  [[ "$missing" == "0" ]] || exit 1
}

ynx_reject_unsafe_env_values() {
  local key value lowered bad=0
  for key in "$@"; do
    value="${!key:-}"
    lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    if [[ "$lowered" == *"placeholder"* || "$lowered" == *"your_key_here"* || "$lowered" == *"changeme"* || "$lowered" == *"example.com"* ]]; then
      echo "Unsafe deployment value in $key"
      bad=1
    fi
  done
  [[ "$bad" == "0" ]] || exit 1
}

ynx_remote() {
  printf '%s@%s' "${SERVER_USER:?}" "${SERVER_HOST:?}"
}

ynx_connection_retry() {
  local label="$1"
  shift
  local attempts="${YNX_DEPLOY_CONNECTION_ATTEMPTS:-3}"
  local delay="${YNX_DEPLOY_CONNECTION_RETRY_DELAY_SECONDS:-3}"
  [[ "$attempts" =~ ^[1-5]$ ]] || { echo "YNX_DEPLOY_CONNECTION_ATTEMPTS must be between 1 and 5"; return 2; }
  [[ "$delay" =~ ^[0-9]+$ ]] && (( delay <= 30 )) || { echo "YNX_DEPLOY_CONNECTION_RETRY_DELAY_SECONDS must be between 0 and 30"; return 2; }
  local attempt command_status
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if "$@"; then
      return 0
    else
      command_status=$?
    fi
    if (( command_status != 255 || attempt == attempts )); then
      return "$command_status"
    fi
    echo "$label connection closed; retrying attempt $((attempt + 1))/$attempts" >&2
    sleep "$delay"
  done
}

ynx_ssh_control_path() {
  local control_dir="${YNX_SSH_CONTROL_DIR:-/tmp/ynx-chain-ssh-$(id -u)-$$}"
  local persist="${YNX_SSH_CONTROL_PERSIST_SECONDS:-60}"
  local connect_timeout="${YNX_SSH_CONNECT_TIMEOUT_SECONDS:-10}"
  [[ "$persist" =~ ^[0-9]+$ ]] && (( persist >= 5 && persist <= 300 )) || {
    echo "YNX_SSH_CONTROL_PERSIST_SECONDS must be between 5 and 300" >&2
    return 2
  }
  [[ "$connect_timeout" =~ ^[0-9]+$ ]] && (( connect_timeout >= 5 && connect_timeout <= 60 )) || {
    echo "YNX_SSH_CONNECT_TIMEOUT_SECONDS must be between 5 and 60" >&2
    return 2
  }
  [[ ! -L "$control_dir" ]] || {
    echo "SSH control directory must not be a symlink: $control_dir" >&2
    return 2
  }
  umask 077
  mkdir -p "$control_dir"
  chmod 0700 "$control_dir"
  printf '%s/ynx-%%C' "$control_dir"
}

ynx_transport_ssh() {
  local label="$1" key="$2" remote="$3"
  shift 3
  local control_path persist connect_timeout
  control_path="$(ynx_ssh_control_path)" || return
  persist="${YNX_SSH_CONTROL_PERSIST_SECONDS:-60}"
  connect_timeout="${YNX_SSH_CONNECT_TIMEOUT_SECONDS:-10}"
  ynx_connection_retry "$label" ssh -i "$key" \
    -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o "ConnectTimeout=$connect_timeout" -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
    -o ControlMaster=auto -o "ControlPersist=${persist}s" -o "ControlPath=$control_path" \
    "$remote" "$@"
}

ynx_transport_scp() {
  local label="$1" key="$2" src="$3" remote="$4" dest="$5"
  local control_path persist connect_timeout
  control_path="$(ynx_ssh_control_path)" || return
  persist="${YNX_SSH_CONTROL_PERSIST_SECONDS:-60}"
  connect_timeout="${YNX_SSH_CONNECT_TIMEOUT_SECONDS:-10}"
  ynx_connection_retry "$label" scp -i "$key" \
    -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o "ConnectTimeout=$connect_timeout" -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
    -o ControlMaster=auto -o "ControlPersist=${persist}s" -o "ControlPath=$control_path" \
    "$src" "$remote:$dest"
}

ynx_ssh() {
  local remote
  remote="$(ynx_remote)"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN ssh -i %q %q' "${SSH_KEY_PATH:?}" "$remote"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  ynx_transport_ssh "ssh" "${SSH_KEY_PATH:?}" "$remote" "$@"
}

ynx_scp() {
  local src="$1" dest="$2" remote
  remote="$(ynx_remote)"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN scp -i %q %q %q:%q\n' "${SSH_KEY_PATH:?}" "$src" "$remote" "$dest"
    return 0
  fi
  ynx_transport_scp "scp" "${SSH_KEY_PATH:?}" "$src" "$remote" "$dest"
}

ynx_write_kv_env() {
  local out="$1"
  shift
  : > "$out"
  chmod 0600 "$out"
  local key
  for key in "$@"; do
    printf '%s=%q\n' "$key" "${!key:-}" >> "$out"
  done
}
