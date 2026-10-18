package consensus

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
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
	return newJournaledApplicationWithRuntimeAuthority(state, path, bootstrap, authorization, nil, block)
}

// Runtime plans are independent operator inputs, just as for atomic JSON.
// Recovery never constructs a runtime cursor: only the normal engine's actual
// ConfirmConsensusRuntimeCheckpoint channel permits subsequent execution.
func NewJournaledApplicationWithRuntimeUpgrade(migration chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap, pq *PQEngineAuthorization, authorization *RuntimeUpgradeAuthorization) (*Application, error) {
	if err := validateRuntimeUpgradeBootstrap(migration, bootstrap, authorization); err != nil {
		return nil, err
	}
	return newJournaledApplicationWithRuntimeAuthority(migration, path, bootstrap, pq, authorization, false)
}

func NewBlockJournaledApplicationWithRuntimeUpgrade(migration chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap, pq *PQEngineAuthorization, authorization *RuntimeUpgradeAuthorization) (*Application, error) {
	if err := validateRuntimeUpgradeBootstrap(migration, bootstrap, authorization); err != nil {
		return nil, err
	}
	return newJournaledApplicationWithRuntimeAuthority(migration, path, bootstrap, pq, authorization, true)
}

func newJournaledApplicationWithRuntimeAuthority(state chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization, block bool) (*Application, error) {
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
		a.blockJournal, committed, err = openBlockJournalWithRuntimeAuthority(path, a.migration, bootstrap, authorization, runtime)
	} else {
		a.journal, committed, err = openSnapshotJournalWithRuntimeAuthority(path, a.migration, bootstrap, authorization, runtime)
	}
	if err != nil {
		return nil, err
	}
	// The writer opener validates before recovery Sync. Do not return a live
	// Application whose committed view has dropped its private trusted source.
	committed.bootstrap = bootstrap
	a.committed, a.statePath, a.pqEngineAuthorization = committed, path, authorization
	a.runtimeUpgradeAuthorization = runtime
	return a, nil
}

// A runtime upgrade requires the original existing initialized journal. Read
// and validate it without acquiring/creating lock files, recovery Sync, or a
// substitute genesis. The writer revalidates the same file under its lock and
// checks authority again before Sync; this preflight grants no execution.
func preflightRuntimeJournalAuthority(path string, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap, pq *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization, block bool) (_ os.FileInfo, result error) {
	if err := validateRuntimeUpgradeBootstrap(migration, bootstrap, runtime); err != nil {
		return nil, err
	}
	f, err := journalRegularFile(path, os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	defer func() { result = errors.Join(result, f.Close()) }()
	before, err := f.Stat()
	if err != nil {
		return nil, err
	}
	capacity := int64(len(snapshotJournalMagic) + 65 + (snapshotJournalHeader+snapshotJournalMaxPayload)*snapshotJournalCompactRecords)
	if block {
		capacity = int64(len(blockJournalMagic) + 65 + blockJournalMaxFrame + blockJournalCheckpointBlocks*(2*blockJournalMaxRequest+snapshotJournalHeader))
	}
	if before.Size() <= 0 || before.Size() > capacity {
		return nil, errors.New("runtime journal is empty or exceeds existing layout capacity")
	}
	data, err := io.ReadAll(io.LimitReader(f, before.Size()+1))
	if err != nil {
		return nil, err
	}
	after, err := f.Stat()
	if err != nil || !samePQStateFile(before, after) || int64(len(data)) != before.Size() {
		return nil, errors.New("runtime journal changed during authority preflight")
	}
	var state CommittedState
	if block {
		authority := &blockJournalReplayAuthority{bootstrap: bootstrap, engine: pq, runtime: runtime}
		decoded, err := decodeBlockJournalWithAuthority(context.Background(), data, migration, nil, authority)
		if err != nil {
			return nil, err
		}
		if decoded.IncompleteTail || decoded.CompleteBytes != len(data) {
			return nil, errors.New("runtime block journal has an incomplete tail; original bytes retained")
		}
		state = decoded.State
	} else {
		decoded, err := decodeSnapshotJournalWithBootstrap(context.Background(), data, migration, bootstrap)
		if err != nil {
			return nil, err
		}
		if decoded.IncompleteTail || decoded.CompleteBytes != len(data) {
			return nil, errors.New("runtime snapshot journal has an incomplete tail; original bytes retained")
		}
		state = decoded.State
	}
	if err := validateJournalRuntimeAuthority(state, migration, bootstrap, pq, runtime); err != nil {
		return nil, err
	}
	current, err := os.Lstat(path)
	if err != nil || !samePQStateFile(before, current) {
		return nil, errors.New("runtime journal replaced during authority preflight")
	}
	return before, nil
}

func validateJournalRuntimeAuthority(state CommittedState, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap, pq *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization) error {
	if err := validateJournalAuthority(state, migration, bootstrap, pq); err != nil {
		return err
	}
	_, err := runtimeStateApplicationVersion(state, runtime)
	return err
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
