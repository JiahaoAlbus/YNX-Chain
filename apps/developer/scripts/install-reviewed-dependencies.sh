#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(cd "$script_dir/.." && pwd)

cd "$project_dir"

# Lifecycle scripts are denied by default. node-pty is the one reviewed native
# dependency required by the terminal broker and is rebuilt by exact name.
npm ci --ignore-scripts
npm rebuild node-pty
