#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
excluded_path='tools/scaffold-ynx-chain.mjs'

scan_with_rg() {
  local output status
  set +e
  output=$(rg -n --hidden -g '!.git/**' -g "!${excluded_path}" -e "${pattern}" . 2>&1)
  status=$?
  set -e

  case "${status}" in
    0)
      printf '%s\n' "${output}"
      return 10
      ;;
    1)
      return 0
      ;;
    *)
      printf 'secret scan failed: rg exited %s\n%s\n' "${status}" "${output}" >&2
      return 20
      ;;
  esac
}

scan_with_git_grep() {
  local command_name file output status file_list
  local found=0
  local scan_error=0

  for command_name in git grep mktemp; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      printf 'secret scan failed: required fallback command %s is unavailable\n' "${command_name}" >&2
      return 20
    fi
  done
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "secret scan failed: fallback requires a Git worktree" >&2
    return 20
  fi

  file_list=$(mktemp)
  if ! git ls-files -z --cached --others --exclude-standard >"${file_list}"; then
    rm -f "${file_list}"
    echo "secret scan failed: could not enumerate Git-known files" >&2
    return 20
  fi

  while IFS= read -r -d '' file; do
    [[ "${file}" == "${excluded_path}" ]] && continue
    [[ -L "${file}" ]] && continue
    [[ -f "${file}" ]] || continue

    set +e
    output=$(grep -nIH -E -- "${pattern}" "${file}" 2>&1)
    status=$?
    set -e

    case "${status}" in
      0)
        printf '%s\n' "${output}"
        found=1
        ;;
      1)
        ;;
      *)
        printf 'secret scan failed: grep exited %s for %s\n%s\n' "${status}" "${file}" "${output}" >&2
        scan_error=1
        ;;
    esac
  done <"${file_list}"
  rm -f "${file_list}"

  if (( scan_error != 0 )); then
    return 20
  fi
  if (( found != 0 )); then
    return 10
  fi
  return 0
}

set +e
if command -v rg >/dev/null 2>&1; then
  scan_with_rg
  status=$?
else
  scan_with_git_grep
  status=$?
fi
set -e

case "${status}" in
  0)
    echo "secret scan passed"
    ;;
  10)
    echo "possible secret found" >&2
    exit 1
    ;;
  *)
    echo "secret scan could not complete" >&2
    exit 2
    ;;
esac
