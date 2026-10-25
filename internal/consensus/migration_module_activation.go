package consensus

import (
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// validateMigrationPreservationClosure admits a fully validated source into
// committed state without granting the authority missing from that source.
// Callers must first validate the complete migration document. The three
// source segments already participate in the state hash, serialization and
// cold-load validation; their original records are never normalized into BFT
// principals. The normal signed action dispatcher separately fences source
// merchant/principal/reviewer operations before charging fees. Independently
// authorized new records and signer-bound claims keep their existing path.
//
// This is deliberately not validateMigrationExecutionClosure: the latter and
// MigrationExecutionBlockers continue to report every unresolved capability.
// Contract, resource and any future unclassified blocker still prevent startup.
func validateMigrationPreservationClosure(m chain.ConsensusMigrationState) error {
	if m.Runtime == nil {
		return validateMigrationExecutionClosure(m)
	}
	projection := CommittedState{Version: CommittedStateVersion, Height: int64(m.Height), ChainID: m.Network.ChainID, MigrationStateHash: m.StateHash}
	if err := validateLegacyPaySource(migrationPaySource(m), projection, m); err != nil {
		return fmt.Errorf("ABCI migration source Pay preservation: %w", err)
	}
	if err := validateLegacyAISource(migrationAISource(m), projection, m); err != nil {
		return fmt.Errorf("ABCI migration source AI preservation: %w", err)
	}
	trust, err := migrationTrustSource(m)
	if err != nil {
		return fmt.Errorf("ABCI migration source Trust preservation: %w", err)
	}
	if err := validateLegacyTrustSource(trust, projection, m); err != nil {
		return fmt.Errorf("ABCI migration source Trust preservation: %w", err)
	}
	return validatePreservationBlockerClasses(collectMigrationExecutionBlockers(m))
}

func validatePreservationBlockerClasses(blockers []classifiedMigrationBlocker) error {
	for _, value := range blockers {
		if value.classification != migrationValidatedSourceAuthorityGap {
			blocker := value.blocker
			return fmt.Errorf("ABCI migration blocked to preserve source business state: %s(%d): %s", blocker.Module, blocker.Records, blocker.Reason)
		}
	}
	return nil
}
