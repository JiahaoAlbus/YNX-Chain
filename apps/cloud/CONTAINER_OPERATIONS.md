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

The Cloud security workflow builds the exact Dockerfile, cold-starts the container with the same least-privilege controls, checks `/health/live`, verifies the configured numeric user, scans the exact image for Critical and High OS/library vulnerabilities including unfixed findings, and preserves the JSON report even when the scan fails. GitHub Actions run `30279314603` completed successfully for source commit `76f5c92cee7f5105f9e84059d0ae8fed75337e2c`; Trivy 0.70.0 reported zero configured-scope Critical/High findings and uploaded Artifact `8658138768`, whose report SHA-256 is `a4dedb64da62978c03264526d74767b83cdbf835a69a38f2274618864c96a97b`. This evidence is bound to that image, scanner database, time and severity scope. It is not immutable image hosting, continuous monitoring, public deployment, reproducible provenance, production attestation, or signing.
