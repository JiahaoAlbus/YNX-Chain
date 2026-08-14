#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(cd "$script_dir/.." && pwd)

cd "$project_dir"

# Lifecycle scripts are denied by default. node-pty is the one reviewed native
# dependency required by the terminal broker and is rebuilt by exact name.
npm ci --ignore-scripts
npm rebuild node-pty

# The web DAP broker runs debugpy over stdio inside the existing no-network
# sandbox. Use the upstream cross-platform wheel by exact URL and digest so the
# candidate never resolves an unreviewed transitive artifact at install time.
debugpy_version=1.8.21
debugpy_sha256=b1e37d333663c8851516a47364ef473da127f9caebe4417e6df6f5825a7e9a92
debugpy_url=https://files.pythonhosted.org/packages/95/51/67e7cf11a53e40694f720457d5b3a1cdaaa3d5a9a633e482f225456b93ff/debugpy-1.8.21-py2.py3-none-any.whl
debugpy_root="$project_dir/.ynx-debugpy"
if [[ ! -x "$debugpy_root/bin/python" ]] || ! "$debugpy_root/bin/python" -c "import debugpy,sys; sys.exit(0 if debugpy.__version__ == '$debugpy_version' else 1)"; then
  stage=$(mktemp -d "$project_dir/.ynx-debugpy-stage.XXXXXX")
  cleanup_debugpy_stage() { find "$stage" -depth -delete 2>/dev/null || true; }
  trap cleanup_debugpy_stage EXIT
  wheel="$stage/debugpy-${debugpy_version}-py2.py3-none-any.whl"
  curl --proto '=https' --tlsv1.2 -fL --retry 4 --connect-timeout 20 "$debugpy_url" -o "$wheel"
  node - "$wheel" "$debugpy_sha256" <<'NODE'
const fs = require("node:fs"), crypto = require("node:crypto");
const [file, expected] = process.argv.slice(2);
const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (actual !== expected) throw new Error(`debugpy wheel digest mismatch: ${actual}`);
NODE
  python=""
  for candidate in "${YNX_CODE_PYTHON3:-}" "$(command -v python3 || true)" /usr/bin/python3 /opt/homebrew/bin/python3; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    if "$candidate" --version >/dev/null 2>&1 && "$candidate" -m venv --copies "$stage/runtime" >/dev/null 2>&1; then
      python="$candidate"
      break
    fi
    find "$stage/runtime" -depth -delete 2>/dev/null || true
  done
  [[ -n "$python" ]] || { printf 'A working Python 3 venv runtime is required for the reviewed debugpy adapter.\n' >&2; exit 1; }
  "$stage/runtime/bin/python" -m ensurepip --upgrade >/dev/null
  "$stage/runtime/bin/python" -m pip install --no-index --no-deps "$wheel" >/dev/null
  "$stage/runtime/bin/python" -c "import debugpy,sys; sys.exit(0 if debugpy.__version__ == '$debugpy_version' else 1)"
  [[ ! -e "$debugpy_root" ]] || { printf 'Existing debugpy runtime failed verification.\n' >&2; exit 1; }
  mv "$stage/runtime" "$debugpy_root"
  cleanup_debugpy_stage
  trap - EXIT
fi
