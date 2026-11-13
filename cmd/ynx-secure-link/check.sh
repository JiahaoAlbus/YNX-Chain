#!/bin/sh
set -eu
# Run from the repository root. Default checks are already included by the
# original `make test`; the native mode is the minimal extra CI owner hook.
export GOMAXPROCS="${GOMAXPROCS:-2}"
case "${1:-stub}" in
  stub)
    go test -mod=readonly -p 1 -count=1 -timeout=90s -v ./internal/securelink/... ./cmd/ynx-secure-link
    ;;
  native)
    test "$(pkg-config --modversion openssl)" = "3.6.4"
    export CGO_ENABLED=1 GOTOOLCHAIN=local
    go test -mod=readonly -race -p 1 -count=1 -timeout=150s -v -tags securelink_openssl ./internal/securelink/... ./cmd/ynx-secure-link
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

def p04_workflow_sections(revision):
    workflow = '.github/workflows/chain-core.yml'
    # Additional independent P04 selections leave the legacy runner unchanged.
    selected_steps = {
        b'      - name: Verify the composed P04 and Auth original request identity': 'identity',
        b'      - name: Verify the original Cloud live LINK read routes': 'cloud',
    }
    selected_outputs = {
        b'      p04_request_identity: ${{ steps.paths.outputs.p04_request_identity }}': 'identity',
        b'      p04_cloud_live_read: ${{ steps.paths.outputs.p04_cloud_live_read }}': 'cloud',
        b'      darwin_server_identity: ${{ steps.paths.outputs.darwin_server_identity }}': 'darwin',
        b'      p04_native_docker: ${{ steps.paths.outputs.p04_native_docker }}': 'docker',
    }
    sections = {'shared': [], 'identity': [], 'cloud': [], 'darwin': [], 'docker': []}
    step = 'shared'
    isolated_job = None
    isolated_jobs = {b'  link-darwin-server-identity:': 'darwin', b'  p04-native-docker:': 'docker'}
    for line in git('show', revision + ':' + workflow).splitlines():
        if re.match(rb'^  [a-zA-Z0-9_-]+:$', line):
            isolated_job = isolated_jobs.get(line)
        if line and not line.startswith(b'        '):
            step = selected_steps.get(line, 'shared')
        sections[isolated_job or selected_outputs.get(line, step)].append(line)
    return sections

def owned(p):
    return p == b'.github/workflows/chain-core.yml' or p.startswith((b'cmd/ynx-secure-link/', b'internal/securelink/', b'cmd/ynx-secure-link-caller/ide-finite-get-', b'cmd/ynx-secure-link-caller/ide_finite_get_', b'cmd/ynx-secure-link-caller/ai-mobile-v6-'))

def native_dependency(p):
    # Actual Node dependencies of the native TLS ingress/continuation tests.
    # This only selects required S3 validation; it does not widen the exclusive
    # source lease or permit omitting the original Core gate.
    return p in (
        b'cmd/ynx-secure-link-caller/build.mjs',
        b'cmd/ynx-secure-link-caller/native.c',
        b'cmd/ynx-secure-link-caller/social-directory-transport-native.inc.c',
        b'cmd/ynx-secure-link-caller/inbound-caller.mjs',
        b'cmd/ynx-secure-link-caller/task-grant-transport.mjs',
        b'cmd/ynx-secure-link-caller/task-grant-transport-private.mjs',
        b'cmd/ynx-secure-link-caller/task-read-resource-caller.mjs',
        b'cmd/ynx-secure-link-caller/task-read-resource-continuation.mjs',
        b'cmd/ynx-secure-link-caller/task-read-continuation-tls-peer.mjs',
    )

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

changes = None
if event == 'workflow_dispatch':
    changed = True
elif event == 'pull_request':
    base = commit(os.environ.get('LINK_BASE', ''))
    common = commit(git('merge-base', base, head).decode().strip())
    changes = paths(common, head)
    changed = any(owned(p) or native_dependency(p) or p in (b'go.mod', b'go.sum', b'scripts/verify/github-actions-pins-check.mjs') for p in changes)
elif event == 'push':
    before = os.environ.get('LINK_BEFORE', '')
    if before == '0' * 40:
        changed = True
    else:
        common = commit(before)
        changes = paths(common, head)
        changed = any(owned(p) or native_dependency(p) or p in (b'go.mod', b'go.sum', b'scripts/verify/github-actions-pins-check.mjs') for p in changes)
else:
    raise SystemExit('unsupported workflow event')
# The frozen P04 package consumes its own pinned LINK copy. Changes to the
# outer LINK listener do not change that package's inputs.
p04_consumer = changes is None or any(p.startswith(b'cmd/ynx-secure-link/p04-consumer-deps/') or p in (
    b'cmd/ynx-secure-link-caller/build.mjs', b'scripts/verify/github-actions-pins-check.mjs',
) for p in changes)
p04_request_identity = changes is None or any(p.startswith(b'cmd/ynx-secure-link/p04-request-identity-deps/') for p in changes)
p04_cloud_live_read = changes is None or any(p.startswith(b'cmd/ynx-secure-link/p04-cloud-live-read-deps/') for p in changes)
p04_native_docker = changes is None or any(p == b'cmd/ynx-secure-link/p04-native-docker-ci.mjs' or p.startswith(b'cmd/ynx-secure-link/p04-native-docker-deps/') for p in changes)
if changes is not None and b'cmd/ynx-secure-link/p04-finite-get-consumer-ci.mjs' in changes and not (p04_consumer or p04_request_identity or p04_cloud_live_read or p04_native_docker):
    p04_consumer = True
if changes is not None and b'.github/workflows/chain-core.yml' in changes:
    before_sections, after_sections = p04_workflow_sections(common), p04_workflow_sections(head)
    p04_consumer = p04_consumer or before_sections['shared'] != after_sections['shared']
    p04_request_identity = p04_request_identity or before_sections['identity'] != after_sections['identity']
    p04_cloud_live_read = p04_cloud_live_read or before_sections['cloud'] != after_sections['cloud']
    p04_native_docker = p04_native_docker or before_sections['docker'] != after_sections['docker']
p04_request_identity = p04_request_identity or p04_consumer
p04_cloud_live_read = p04_cloud_live_read or p04_request_identity
print('changed=' + str(changed).lower())
print('exclusive_link=' + str(exclusive).lower())
print('p04_consumer=' + str(p04_consumer).lower())
print('p04_request_identity=' + str(p04_request_identity).lower())
print('p04_cloud_live_read=' + str(p04_cloud_live_read).lower())
print('p04_native_docker=' + str(p04_native_docker).lower())
darwin_server_identity = changes is None or any(p in (
    b'internal/securelink/native/bridge.c',
    b'internal/securelink/native/bridge.h', b'internal/securelink/native/openssl_test.go',
) or p.startswith(b'internal/securelink/native/server_identity') for p in changes)
if changes is not None and b'.github/workflows/chain-core.yml' in changes:
    darwin_server_identity = darwin_server_identity or before_sections['darwin'] != after_sections['darwin']
print('darwin_server_identity=' + str(darwin_server_identity).lower())
PY
    ;;
  *) printf '%s\n' 'usage: sh cmd/ynx-secure-link/check.sh [stub|native|ci-scope]' >&2; exit 2 ;;
esac
