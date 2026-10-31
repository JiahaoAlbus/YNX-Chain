#!/bin/sh
set -eu
# Run from the repository root. Default checks are already included by the
# original `make test`; the native mode is the minimal extra CI owner hook.
export GOMAXPROCS="${GOMAXPROCS:-2}"
case "${1:-stub}" in
  stub)
    go test -mod=readonly -p 1 -count=1 -timeout=90s ./internal/securelink/... ./cmd/ynx-secure-link
    ;;
  native)
    test "$(pkg-config --modversion openssl)" = "3.6.4"
    export CGO_ENABLED=1 GOTOOLCHAIN=local
    go test -mod=readonly -race -p 1 -count=1 -timeout=90s -v -tags securelink_openssl ./internal/securelink/... ./cmd/ynx-secure-link
    go vet -mod=readonly -tags securelink_openssl ./internal/securelink/... ./cmd/ynx-secure-link
    ;;
  ci-scope)
    # Event SHAs are data, not shell expressions. Unknown/mixed scope fails;
    # only the new LINK-only events may omit the original Chain job.
    python3 - <<'PY'
import os, re, subprocess

def git(*args):
    return subprocess.check_output(['git', *args])

def commit(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise SystemExit('invalid event-bound commit SHA')
    git('cat-file', '-e', value + '^{commit}')
    return value

def paths(base, head):
    return [p for p in git('diff', '--no-renames', '--name-only', '-z', base, head).split(b'\0') if p]

def owned(p):
    return p == b'.github/workflows/chain-core.yml' or p.startswith((b'cmd/ynx-secure-link/', b'cmd/ynx-secure-link-caller/', b'internal/securelink/'))

event, ref, target = (os.environ.get(k, '') for k in ('LINK_EVENT', 'LINK_REF', 'LINK_BASE_REF'))
head = commit(os.environ.get('LINK_HEAD', ''))
exclusive = (event == 'push' and ref == 'refs/heads/codex/v5-link-native-ci') or (event == 'pull_request' and target == 'codex/ynx-pq-perf-integration')
if exclusive:
    authorized = commit('d5fa3245ad14421e6acee6dc1962052f9e005d34')
    # Check the full candidate delta, including deletions/renames, so a later
    # push cannot hide an earlier unapproved CORE change behind its before SHA.
    git('merge-base', '--is-ancestor', authorized, head)
    if any(not owned(p) for p in paths(authorized, head)):
        raise SystemExit('outside authorized LINK closure; original CORE owner/gates required')

if event == 'workflow_dispatch':
    changed = True
elif event == 'pull_request':
    base = commit(os.environ.get('LINK_BASE', ''))
    common = commit(git('merge-base', base, head).decode().strip())
    changes = paths(common, head)
    changed = any(owned(p) or p in (b'go.mod', b'go.sum', b'scripts/verify/github-actions-pins-check.mjs') for p in changes)
elif event == 'push':
    before = os.environ.get('LINK_BEFORE', '')
    if before == '0' * 40:
        changed = True
    else:
        changes = paths(commit(before), head)
        changed = any(owned(p) or p in (b'go.mod', b'go.sum', b'scripts/verify/github-actions-pins-check.mjs') for p in changes)
else:
    raise SystemExit('unsupported workflow event')
print('changed=' + str(changed).lower())
print('exclusive_link=' + str(exclusive).lower())
PY
    ;;
  *) printf '%s\n' 'usage: sh cmd/ynx-secure-link/check.sh [stub|native|ci-scope]' >&2; exit 2 ;;
esac
