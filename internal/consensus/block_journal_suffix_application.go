package consensus

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// newSuffixApplicationForValidatedPrivateState is only used after the prefix
// decoder has reconstructed caller-private state and completed state.Validate.
// CanonicalJSON fully validates the migration on every call. Its JSON roundtrip
// still gives this replay its own migration, including all nested mutable data.
// Unlike NewApplication, it does not validate the migration twice or allocate
// a genesis state which the suffix caller would immediately discard.
func newSuffixApplicationForValidatedPrivateState(migration chain.ConsensusMigrationState, state CommittedState) (*Application, error) {
	payload, err := migration.CanonicalJSON()
	if err != nil {
		return nil, fmt.Errorf("invalid YNX consensus migration state: %w", err)
	}
	var private chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &private); err != nil {
		return nil, fmt.Errorf("clone YNX consensus migration state: %w", err)
	}
	feeRecipient := ""
	for _, validator := range private.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	if feeRecipient == "" {
		return nil, errors.New("YNX migration has no active fee recipient")
	}
	return &Application{migration: private, committed: state, feeRecipient: feeRecipient}, nil
}
