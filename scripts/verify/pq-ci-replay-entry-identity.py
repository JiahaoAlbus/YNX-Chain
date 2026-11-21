#!/usr/bin/env python3
"""Execute the one original, source-pinned CI entry caller with this job's env."""
import os
from pathlib import Path
import subprocess


def extract_caller(source):
    # Build the marker without embedding a second copy of the workflow caller.
    marker = '          if [ "$YNX_ENTRY_EVENT" = ' + "'workflow_dispatch'" + ' ]; then\n'
    if source.count(marker) != 1:
        raise ValueError('exactly one original workflow identity caller required')
    start = source.index(marker)
    end = source.index('\n      - name:', start)
    lines = source[start:end].splitlines()
    if not lines or lines[-1] != '          fi' or any(line and not line.startswith('          ') for line in lines):
        raise ValueError('original identity caller boundary changed')
    body = '\n'.join(line[10:] if line else '' for line in lines) + '\n'
    if body.count('bash scripts/ops/validate-pq-remote-window-entry.sh') != 1 or '${{' in body:
        raise ValueError('original identity caller must use explicit environment and actual callee')
    return body


def main():
    source = Path('.github/workflows/resource-market-ci.yml').read_text()
    subprocess.run(['bash', '-e', '-c', extract_caller(source)], env=os.environ.copy(), check=True, timeout=30)


if __name__ == '__main__':
    main()
