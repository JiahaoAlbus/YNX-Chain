# Developer legacy-service reconciliation: single-use lease request

Status: `PREPARED_NOT_AUTHORIZED`

This request is deliberately narrow. It does **not** authorize a deployment by
Developer, a Caddy change, a Wallet/Chain change, a public claim, or any account
request, signature, or transaction. It asks the production operator for one
fresh, time-bounded lease to reconcile a Developer-internal dependency whose
stale identity makes host-side status reads ambiguous.

## Read-only basis (2026-08-31)

The public route is source-bound to the protected candidate, not to the legacy
Developer Web service:

| Boundary | Observed target | Direct readback |
| --- | --- | --- |
| `developer.ynxweb4.com` Caddy route | `127.0.0.1:18113` | Caddy active configuration |
| `ynx-code-candidate.service` working directory | `/opt/ynx-developer/candidates/d4052228a2261c5ced6a8e8cfcbf763edabf2103/apps/developer` | active PID `1712776` cwd |
| `candidates/current` | `d4052228a2261c5ced6a8e8cfcbf763edabf2103` | resolved symlink |
| Candidate health | `0.2.0-testnet-preview-d4052228a226-candidate` | `127.0.0.1:18113/healthz` and public `/healthz` |

The candidate transaction `20260822T112541Z-d4052228a226` passed. Its image
fingerprint is
`a4b86cbffad3b8c2beb2c538fec5157a3327651a9e6344d153f3fd8cbe386c74`;
the retained pre-switch state receipt is
`8a21e05211cde454ef163dc0a5555a8443f091eb7eb4358d49780c237fa04499
state-before.tar`.

Separately, `ynx-developer-web.service` is a loopback-only dependency for the
candidate's hosted AI path. It presently runs from
`/opt/ynx-developer/current = /opt/ynx-developer/candidates/17ee9ae5`, and its
release drop-in exports `YNX_DEVELOPER_COMMIT=17ee9ae5`. Its direct
`127.0.0.1:18111/health` response confirms that old identity. It is not the
public Caddy target, but it should not remain a stale hidden dependency.

## Frozen repair target

The only permitted repair target is the already immutable Developer candidate:

- source commit: `d4052228a2261c5ced6a8e8cfcbf763edabf2103`
- tree: `89beb658b0971fb20d0d92a6bebc2010fdbb33e7`
- candidate directory:
  `/opt/ynx-developer/candidates/d4052228a2261c5ced6a8e8cfcbf763edabf2103`
- public candidate service: `ynx-code-candidate.service` on `127.0.0.1:18113`
- legacy dependency service: `ynx-developer-web.service` on `127.0.0.1:18111`

No source change, archive rebuild, package installation, LXD image creation,
Caddy reload, or mutation of another product is requested. This is a
configuration-reconciliation transaction only.

## Requested single-use lease

Grant one operator-only lease for this host and this exact target. It must
expire after one reconciliation attempt and include no wildcard commit, host,
service, or path authority.

Permitted writes, in one atomic transaction:

1. Snapshot the existing `/opt/ynx-developer/current` symlink and
   `/etc/systemd/system/ynx-developer-web.service.d/release.conf` under a
   root-owned transaction directory.
2. Set `/opt/ynx-developer/current` to the frozen d405 candidate directory.
3. Set the sole release override to
   `Environment=YNX_DEVELOPER_COMMIT=d4052228a2261c5ced6a8e8cfcbf763edabf2103`.
4. Run `systemctl daemon-reload` and restart only
   `ynx-developer-web.service`; leave Caddy and `ynx-code-candidate.service`
   configuration untouched.
5. Record post-change readbacks for `/health` on `18111`, `/healthz` on
   `18113`, and public `https://developer.ynxweb4.com/healthz`.

The operator must fail closed if any precondition changes from the values in
this document. In particular, no action is authorized if Caddy no longer
routes `developer.ynxweb4.com` to `18113`, or if the candidate service is not
already pinned to d405.

## Exact rollback

On any failed preflight, restart, health readback, or interrupted session:

1. Restore `/opt/ynx-developer/current` to
   `/opt/ynx-developer/candidates/17ee9ae5`.
2. Restore the prior release drop-in exactly; its current SHA-256 is
   `ab7cd2260effd4e879b33a12f6d1cde3905f73aa6e41ed51fa57e49d1330bfa0`.
3. Run `systemctl daemon-reload` and restart only `ynx-developer-web.service`.
4. Preserve the existing d405 candidate, its state directory, Caddy
   configuration, and all workspace data. Do not hand-edit either public
   candidate pointer.

The lease result must retain a transaction identifier, the two before/after
symlink targets, release-drop-in hashes, health payload hashes, service status,
and a `passed` or `rolled-back` result. It must not record credentials, Wallet
data, prompts, account identifiers, or workspace contents.

## Post-lease evidence boundary

This reconciliation can prove only consistent Developer service provenance. It
does not prove a browser-visible IDE journey, desktop installation, Provider
discovery, account approval/reject, `0x1917` switching, signing, or a
transaction. Those remain separate gates; `eth_requestAccounts` still requires
immediate user confirmation.
