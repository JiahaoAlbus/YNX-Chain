# Testnet Deployment Guide

Run `make preflight` before deployment.

Prepare DNS, TLS, SSH, Postgres, Redis, object storage, wallet keys, validator keys, and service secrets from `ENV_INTAKE_FORM.md`.

Run `make deploy-testnet` only after real values are exported or written into ignored local `.env` files.

After deployment, run `make verify-testnet` and update `docs/public-proof/PUBLIC_TESTNET_PROOF.md` with real endpoint evidence.

