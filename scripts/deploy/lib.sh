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

ynx_ssh() {
  local remote
  remote="$(ynx_remote)"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN ssh -i %q %q' "${SSH_KEY_PATH:?}" "$remote"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  ssh -i "${SSH_KEY_PATH:?}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12 "$remote" "$@"
}

ynx_scp() {
  local src="$1" dest="$2" remote
  remote="$(ynx_remote)"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN scp -i %q %q %q:%q\n' "${SSH_KEY_PATH:?}" "$src" "$remote" "$dest"
    return 0
  fi
  scp -i "${SSH_KEY_PATH:?}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12 "$src" "$remote:$dest"
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
