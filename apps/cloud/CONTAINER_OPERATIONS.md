# YNX Cloud container operations

## Scope and truth boundary

`infra/docker/ynx-cloudd.Dockerfile` packages the bounded Cloud control plane and the Cloud/Docs static clients. It is a local and CI container-delivery candidate. Its existence does not prove production object-store durability, public deployment, hosted downloads, production signing, or central Wallet registration.

The image runs as numeric user `10001:10001`, keeps the root filesystem read-only in the supplied Compose profile, drops all Linux capabilities, enables `no-new-privileges`, and persists mutable state only in `/var/lib/ynx-cloud`. The production runtime never enables the local development Wallet verifier.

## Build and start

```sh
docker compose -f infra/docker/cloud-compose.yml build
docker compose -f infra/docker/cloud-compose.yml up -d
curl --fail http://127.0.0.1:8092/health/live
```

Public liveness proves only that the process is running. Traffic admission must still use the authenticated readiness endpoint and must fail closed while central Wallet or configured providers are unavailable.

## Stop and remove

```sh
docker compose -f infra/docker/cloud-compose.yml down
```

Do not add `--volumes` during an ordinary rollback or restart. The named volume contains Cloud metadata and bounded local object bytes. Delete it only after a verified export, backup, retention review, and explicit operator approval.

## Backup and restore

Stop writers before the drill. Use a one-off container against the same named volume to create a recovery bundle in an operator-mounted destination, then restore into a new empty volume or directory. Verify manifest hashes before cutover and retain the previous volume read-only until the rollback window closes.

## CI evidence

The Cloud security workflow builds the exact Dockerfile, cold-starts the container with the same least-privilege controls, checks `/health/live`, and verifies the configured numeric user. GitHub Actions run `30275578270` completed successfully for source commit `d11c382da10ab0629c7d322c83c9ddef24925328`. This is exact-source image build and cold-start evidence; it is not image vulnerability-scan evidence, immutable hosting, public deployment, production provenance, attestation, or signing.
