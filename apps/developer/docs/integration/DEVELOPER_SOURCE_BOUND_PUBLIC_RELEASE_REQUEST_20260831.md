# Developer source-bound public release: single-use operator request

Status: `PREPARED_NOT_AUTHORIZED`

This is a bounded request for one production operator transaction. It does not
authorize Developer to use SSH, mutate Caddy, change Wallet/Chain services,
request an account, sign, or send a transaction.

## Frozen candidate

- Branch: `codex/ynx-code-platform-v1`
- Commit: `bd5eb349fff3f31c8cca933affe9150ac1b8b978`
- Tree: `e9afa1549cab59de67e2891a3f4ee17a7fa17326`
- Expected public release: `0.2.0-testnet-preview-bd5eb349fff3-candidate`
- Public origin: `https://developer.ynxweb4.com/`
- Candidate service only: `ynx-code-candidate.service` on loopback `18113`

The current public readback is the earlier d405 candidate:
`0.2.0-testnet-preview-d4052228a226-candidate`. Its response lacks exact
`sourceCommit` and `sourceTree`, so it is not enough for the new source-bound
runtime gate. Do not treat a page load or an HTTP 200 as a promotion result.

## Requested lease

Grant one operator-only lease, restricted to this host, source commit, service,
candidate root, state root, and one invocation of:

```bash
sudo env \
  YNX_CODE_DEPLOY_COMMIT=bd5eb349fff3f31c8cca933affe9150ac1b8b978 \
  YNX_CODE_LXD_PACKAGE_NETWORK=ynx-pkg-egress \
  apps/developer/scripts/deploy-public-candidate-transaction.sh
```

The lease must expire after the invocation and must not permit wildcard commits,
other services, Caddy changes, artifact publication, or account actions.

## Operator preconditions

Before any write, fail closed unless all are true:

1. The checked-out source is clean, its `HEAD` equals the frozen commit, and it
   is an ancestor of `origin/codex/ynx-code-platform-v1`.
2. `developer.ynxweb4.com` still routes only to `ynx-code-candidate.service`
   through loopback `18113`; no Caddy change is part of this request.
3. The current candidate target, environment, unit, and workspace state are
   snapshotted by the transaction before the service stops.
4. `ynx-pkg-egress` and `ynx-code-package-egress-acl` exist and pass the
   repository verifier. Missing or broader egress is a hard stop.
5. The immutable candidate directory for the frozen commit and its staging
   directory do not already exist.

## Required result envelope

Success requires all transaction gates, including archive tests/build, reviewed
LXD image fingerprint, cloud/container checks, package persistence, restart
recovery, and external HTTPS health. The public `/healthz` response must equal:

```json
{
  "ok": true,
  "version": "0.2.0-testnet-preview-bd5eb349fff3-candidate",
  "sourceCommit": "bd5eb349fff3f31c8cca933affe9150ac1b8b978",
  "sourceTree": "e9afa1549cab59de67e2891a3f4ee17a7fa17326"
}
```

Return the passed evidence directory, image fingerprint, immutable source/tree,
public health payload hash, evidence SHA-256 manifest, and the exact rollback
target captured before cutover. Do not include credentials, workspace contents,
Wallet data, account identifiers, or browser data.

## Automatic rollback

On any preflight, build, restart, local health, public health, or interrupted
session failure, the transaction must restore the transaction-captured prior
candidate symlink, environment, and unit; restart only
`ynx-code-candidate.service`; and preserve workspace state. It must report
`rolled-back` with the prior target and snapshot hash. Do not guess a rollback
target or hand-edit the public candidate pointer.

## Gates intentionally still false after a successful deployment

This request can prove source-bound public runtime identity only. It cannot
prove browser-visible Provider approval/reject, `0x1917` account lifecycle,
Wallet Product Session lifecycle, installed Windows artifact hosting, public
macOS DMG hosting/notarization, signing, store release, or Central integration.
