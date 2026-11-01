#!/usr/bin/env bash
set -euo pipefail
# New fixed DATA/math C lifecycle only. No Root, keeper/decision/once, archive,
# release or mobile claim. Existing full CI suite remains the owning runner.
export GOMAXPROCS="${GOMAXPROCS:-2}"
export GOMEMLIMIT="${GOMEMLIMIT:-1536MiB}"
export CGO_ENABLED=1
go test -p=1 -count=1 -timeout=120s -run '^TestNetworkResourceMaterialPUBLICCurrentAndBorrowLifecycle$' ./internal/ynxresourceconsent
go test -p=1 -count=1 -timeout=120s -run '^TestNetworkResourceConsentCABIPUBLIC(ActualFixedLifecycle|RegistryCapacityAndDebt)$' ./cmd/ynx-artifact-release-cabi
