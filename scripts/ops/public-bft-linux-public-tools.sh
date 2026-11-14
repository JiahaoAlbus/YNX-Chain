#!/usr/bin/env bash
# Sourceable adapters for original public DATA tools. No approval or phase here.
set -euo pipefail

public_bft_linux_tools_enabled() {
  [[ -n "${PUBLIC_BFT_LINUX_TOOL_ROLE:-}" ]]
}

public_bft_linux_tool() {
  local operation="$1"; shift
  case "${PUBLIC_BFT_LINUX_TOOL_ROLE:-}" in primary|singapore|silicon-valley|seoul) ;; *) echo 'fixed original public tool role required' >&2; return 1;; esac
  [[ "${DEPLOY_DRY_RUN:-0}" != 1 ]] || { echo 'remote math cannot be manufactured by dry-run' >&2; return 1; }
  [[ "${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}" == "$(git rev-parse HEAD)" ]] || { echo 'public tool source/runtime full commit differs' >&2; return 1; }
  python3 -B scripts/ops/public-bft-linux-public-tools.py client \
    "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:?original transaction required}" \
    "$PUBLIC_BFT_LINUX_TOOL_ROLE" "${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:?original role intake required}" \
    "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT" "${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:?independent SOURCE required}" "$operation" "$@"
}

# Only bulk public bytes use this original local filesystem. Transaction,
# service/custody paths and all remote operator ASCII constraints stay intact.
public_bft_public_data_root() {
  if ! public_bft_linux_tools_enabled; then printf '%s\n' "$1"; return; fi
  python3 -B scripts/ops/public-bft-linux-public-tools.py data-root "$1"
}

public_bft_package_call() {
  local binary="$1"; shift
  if ! public_bft_linux_tools_enabled; then "$binary" "$@"; return; fi
  # This is an exact grammar, not a forwarded arbitrary argv shell.
  if [[ $# == 2 && "$1" == -verify-migration-state ]]; then
    public_bft_linux_tool verify-migration "$2"
  elif [[ $# == 4 && "$1" == -verify-migration-state && "$3" == -migration-public-summary && "$4" == json ]]; then
    public_bft_linux_tool migration-summary "$2"
  elif [[ $# == 4 && "$1" == -verify-migration-state && "$3" == -migration-public-summary && "$4" == json-account ]]; then
    public_bft_linux_tool migration-account-summary "$2"
  elif [[ $# == 4 && "$1" == -verify-package && "$3" == -operator-plan-hash ]]; then
    public_bft_linux_tool verify-package "$2" "$4"
  elif [[ $# == 9 && "$1" == -derive-bootstrap && "$2" == -migration-state && "$4" == -validator-manifest && "$6" == -validator-manifest-sha256 && "$8" == -genesis-time ]]; then
    public_bft_linux_tool derive-bootstrap "$3" "$5" "$7" "$9"
  elif [[ $# == 12 && "$1" == -migration-state && "$3" == -validator-manifest && "$5" == -genesis-time && "$7" == -operator-plan && "$9" == -operator-plan-hash && "${11}" == -output ]]; then
    public_bft_linux_tool generate-package "$2" "$4" "$6" "$8" "${10}" "${12}"
  else
    echo 'unapproved Linux public package argv; no arbitrary command or legacy fallback' >&2; return 64
  fi
}

public_bft_linux_tool_for_role() {
  local role="$1"; shift
  case "$role" in primary|singapore|silicon-valley|seoul) ;; *) return 64;; esac
  local original_role="${PUBLIC_BFT_LINUX_TOOL_ROLE:?}" bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:?}"
  [[ "$bundle" == *"-$original_role-"* ]] || return 1
  bundle="${bundle/-$original_role-/-$role-}"
  PUBLIC_BFT_LINUX_TOOL_ROLE="$role" CONSENSUS_CANDIDATE_RUNTIME_BUNDLE="$bundle" public_bft_linux_tool "$@"
}

public_bft_linux_stage() {
  local role="$1" profile="$2" original_role="${PUBLIC_BFT_LINUX_TOOL_ROLE:?}"
  local bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:?}"
  [[ "$bundle" == *"-$original_role-"* ]] || return 1
  bundle="${bundle/-$original_role-/-$role-}"
  PUBLIC_BFT_LINUX_TOOL_ROLE="$role" CONSENSUS_CANDIDATE_RUNTIME_BUNDLE="$bundle" \
    public_bft_linux_tool stage-public "$profile"
}

# Read a binary pin from the exact original SOURCE retained by inventory.
# This is metadata only; each real target still hashes installed bytes and
# the bridge validates the complete original eight-ELF bundle before use.
public_bft_runtime_binary_sha() {
  python3 -B - "$1/SOURCE.json" "$2" "${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:?}" <<'PINS'
import hashlib,json,pathlib,sys
p,name,pin=sys.argv[1:];raw=pathlib.Path(p).read_bytes()
assert hashlib.sha256(raw).hexdigest()==pin
v=json.loads(raw);assert name in v['binaries'];print(v['binaries'][name]['sha256'])
PINS
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then return 0; fi
cd "$(dirname "$0")/../.."
if [[ "${1:-}" == transport ]]; then
  [[ $# == 7 ]] || exit 64
  # Fixed original host/key selectors. Nothing is forwarded to the host other
  # than the public request. In particular no SSH credential or agent travels.
  source scripts/ops/lib.sh
  ynx_ops_init
  role="$2"; tx="$3"; request="$4"; helper="$5"
  [[ "$6" == execute || "$6" == read ]] && action="$6" || exit 64
  case "$role" in
    primary) user="$PRIMARY_NODE_USER"; host="$PRIMARY_NODE_HOST"; key="$PRIMARY_NODE_SSH_KEY";;
    singapore) user="$SG_NODE_USER"; host="$SG_NODE_HOST"; key="$SG_NODE_SSH_KEY";;
    silicon-valley) user="$SILICON_VALLEY_NODE_USER"; host="$SILICON_VALLEY_NODE_HOST"; key="$SILICON_VALLEY_NODE_SSH_KEY";;
    seoul) user="$SEOUL_NODE_USER"; host="$SEOUL_NODE_HOST"; key="$SEOUL_NODE_SSH_KEY";;
    *) exit 64;;
  esac
  command="$(python3 -B scripts/ops/public-bft-linux-public-tools.py bootstrap-command "$role" "$tx" "$request" "$helper" "$action" "$7")" || exit
  # Keep every original transport/host-key/control option. Force no agent
  # forwarding before its destination, rather than making it a remote argv.
  ssh() { command ssh -a -o ForwardAgent=no "$@"; }
  YNX_DEPLOY_CONNECTION_ATTEMPTS=1 ynx_ops_ssh "$role" "$user" "$host" "$key" "$command"
else
  source scripts/ops/lib.sh
  ynx_ops_init
  public_bft_package_call "${PUBLIC_BFT_MIGRATION_VERIFIER:-unused}" "$@"
fi
