package consensus

import (
	"errors"
	"fmt"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// These constructors retain the original journal format and persistence
// boundaries. Authority is supplied independently on every cold start; saved
// registry/schedule records never supply their own bootstrap or operator pin.
func NewJournaledApplicationWithBootstrap(state chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap) (*Application, error) {
	return newJournaledApplicationWithAuthority(state, path, bootstrap, nil, false)
}

func NewJournaledApplicationWithEngineAuthorization(state chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization) (*Application, error) {
	if authorization == nil {
		return nil, errors.New("journal engine schedule requires independent operator authorization")
	}
	return newJournaledApplicationWithAuthority(state, path, bootstrap, authorization, false)
}

func NewBlockJournaledApplicationWithBootstrap(state chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap) (*Application, error) {
	return newJournaledApplicationWithAuthority(state, path, bootstrap, nil, true)
}

func NewBlockJournaledApplicationWithEngineAuthorization(state chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization) (*Application, error) {
	if authorization == nil {
		return nil, errors.New("block journal engine schedule requires independent operator authorization")
	}
	return newJournaledApplicationWithAuthority(state, path, bootstrap, authorization, true)
}

func newJournaledApplicationWithAuthority(state chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization, block bool) (*Application, error) {
	path = strings.TrimSpace(path)
	if path == "" || bootstrap == nil {
		return nil, errors.New("authorized journal requires an explicit durable path and independent bootstrap")
	}
	// Reuse migration closure/clone/fee-recipient construction. The independent
	// schedule is checked against the recovered registry, not this initial view.
	a, err := newPersistentApplicationWithAuthorization(state, "", bootstrap, nil, nil)
	if err != nil {
		return nil, err
	}
	var committed CommittedState
	if block {
		a.blockJournal, committed, err = openBlockJournalWithAuthority(path, a.migration, bootstrap, authorization)
	} else {
		a.journal, committed, err = openSnapshotJournalWithAuthority(path, a.migration, bootstrap, authorization)
	}
	if err != nil {
		return nil, err
	}
	// The writer opener validates before recovery Sync. Do not return a live
	// Application whose committed view has dropped its private trusted source.
	committed.bootstrap = bootstrap
	a.committed, a.statePath, a.pqEngineAuthorization = committed, path, authorization
	return a, nil
}

// validateJournalAuthority is the final recovery gate before Sync/publication,
// not a rule for an intermediate historical replay checkpoint before R.
func validateJournalAuthority(state CommittedState, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization) error {
	if bootstrap == nil {
		return errors.New("independent journal bootstrap is required")
	}
	if err := bootstrap.matchesMigration(migration); err != nil {
		return err
	}
	state.bootstrap = bootstrap
	if err := state.Validate(migration); err != nil {
		return fmt.Errorf("validate complete authorized journal state: %w", err)
	}
	if err := authorization.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); err != nil {
		return err
	}
	if authorization != nil && state.PQEngineSchedule == nil {
		if authorization.schedule.RegistryHeight != state.Height {
			return errors.New("journal operator schedule must bind the actual committed registry height")
		}
		if _, err := newPQEngineSnapshot(bootstrap, state.ValidatorRegistry, authorization.schedule, authorization.schedule.AuthorizedAt); err != nil {
			return fmt.Errorf("validate independently authorized journal engine candidate: %w", err)
		}
	}
	return nil
}
