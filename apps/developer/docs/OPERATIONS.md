# YNX Developer operations

Build the Web product with `npm run build`. Static hosting must provide bounded,
authenticated same-origin proxy equivalents and a version/health endpoint before
`deployedStaging` can become true. Never place a provider or Wallet secret in the
bundle.

Build the unsigned local macOS package with `scripts/package-local-macos.sh` and
verify the extracted artifact with `scripts/verify-local-macos-package.sh`. The
packager refuses tracked uncommitted Developer changes and embeds source commit,
Git tree, runtime checkpoint, platform/signing class and SBOM SHA-256. Record the
final ZIP SHA-256 and bytes externally because a package cannot embed its own
non-circular final digest.
The verifier must launch the extracted App twice, require a real bounded C++
compile, prove workspace persistence, verify child cleanup and require a
complete CycloneDX inventory containing the bundled Node/npm runtime and native
dependencies. A package that only passes static resource inspection is not
eligible for the official direct-download URL.
Windows packaging and cold launch run on a real Windows host through
`developer-windows.yml`; use its JSON evidence and artifact checksum, never the
macOS structural source check, for Windows claims.

The SQLite workspace store retains only the latest 50 immutable text revisions
per owner/project (up to roughly 100 MiB of payload at the 2 MiB workspace limit,
before SQLite overhead). History survives an application restart on the same
volume, and the product can export an individual revision as JSON. This is not a
backup of the SQLite volume or container filesystem. Production operations must
still provide encrypted off-host backup, retention monitoring and a tested restore
procedure; never infer disaster recovery from the in-product History panel.

## Public candidate transaction

The reviewed Linux host deploy path is
`scripts/deploy-public-candidate-transaction.sh`. Run it only from a clean clone
whose HEAD is the exact pushed commit on `origin/codex/ynx-code-platform-v1`:

```bash
sudo env YNX_CODE_DEPLOY_COMMIT=<40-hex-commit> \
  YNX_CODE_LXD_PACKAGE_NETWORK=<reviewed-egress-network> \
  apps/developer/scripts/deploy-public-candidate-transaction.sh
```

`YNX_CODE_LXD_PACKAGE_NETWORK` must name a dedicated LXD network whose host
firewall policy permits registry egress but not private/control-plane targets.
Package installation fails closed when it is absent. The runtime attaches that
network only for an approved exact npm or binary-wheel Python install and removes
it before returning success; cleanup uncertainty stops the affected container. Preserve this value
in the protected candidate environment rather than a repository file.

The transaction builds and tests an archive of that commit before changing the
service, creates a uniquely named OpenJDK 21 LXD image, requires its immutable
64-hex fingerprint, and installs the source under an immutable full-commit
directory. It stops the candidate only after those preflight gates, captures a
root-only state snapshot and SHA-256, updates only the candidate release/image
environment, and atomically changes the `current` symlink.

After start it must pass the nine-runtime, seven-LSP container gate, Chain tools, Wallet
readiness, full public candidate gate, signed-session/workspace restart recovery
and the external HTTPS health/version check. Failure restores the previous
symlink, protected environment and systemd unit, then restarts the prior
candidate. It deliberately does not overwrite forward-compatible workspace
state during rollback, because doing so could erase work created after cutover.
The temporary state and environment backups live only under root-owned `/run`
and are deleted after success or restoration. Persistent evidence contains no
secrets or workspace contents and is written under
`/var/lib/ynx-code-candidate/deploy-evidence/<transaction>`.

The current public service remains the seven-runtime `17ee9ae5` candidate until
this transaction returns `passed`, the immutable image fingerprint and evidence
hashes are copied into the release record, and an independent public probe sees
the exact new release string.

Production release requires owner-controlled Developer ID and Authenticode
identities, notarization/installer policy, signed update metadata, rollback,
hosted immutable artifacts and clean-install/cold-start proof. An ad-hoc or
unsigned Testnet Preview must remain visibly classified and must not self-update.
