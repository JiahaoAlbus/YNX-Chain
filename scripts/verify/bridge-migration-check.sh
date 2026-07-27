#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

go test -count=1 -race -run 'TestBridge(V1StateMigratesOnlyAfterLegacyIntegrityVerification|V2StateMigratesToCurrentSchema|V3StateMigratesLifecycleWithHonestCoverage|V4MigrationPreservesResolvedExposureThroughDispute|V5ReconciliationReplayMigratesFailClosed|V6LifecycleMigratesWithoutInventingDestinationAvailability|V6RollbackBackupForwardRecoversDeterministically|ResealedInvalidLifecycleIsRejected|ResealedAttestationAndIndexForgeryIsRejected)$' ./internal/bridgegateway

echo "bridge migration check passed: v1-v6 integrity migration, tamper rejection, and deterministic v6 rollback/forward recovery"
