package consensus

import (
	"encoding/hex"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

var _ cmttypes.ConsensusRuntimeCheckpointConsumer = (*Application)(nil)

// NewPersistentApplicationWithRuntimeUpgrade installs an independent plan but
// cannot authorize execution from the application file alone. The normal
// in-process engine must confirm its actual durable checkpoint during handshake.
// PQ activation remains a separate, optional operator authorization.
func NewPersistentApplicationWithRuntimeUpgrade(migration chain.ConsensusMigrationState, path string, bootstrap *ConsensusBootstrap, pq *PQEngineAuthorization, authorization *RuntimeUpgradeAuthorization) (*Application, error) {
	plan, err := authorization.Plan()
	if err != nil {
		return nil, err
	}
	if bootstrap == nil || bootstrap.record.CometGenesisSHA256 != plan.CometGenesisSHA256 || bootstrap.record.Params.Version == nil || bootstrap.record.Params.Version.App != plan.OldApplicationVersion || bootstrap.record.MigrationStateHash != plan.MigrationStateHash || migration.OriginalGenesisHash != plan.OriginalGenesisHash {
		return nil, errors.New("runtime upgrade does not bind the original bootstrap and historical application version")
	}
	a, err := newPersistentApplicationWithAuthorization(migration, path, bootstrap, nil, pq)
	if err != nil {
		return nil, err
	}
	a.runtimeUpgradeAuthorization = authorization
	if _, err := a.runtimeApplicationVersionLocked(); err != nil {
		return nil, err
	}
	return a, nil
}

// ConfirmConsensusRuntimeCheckpoint is called by the repository-owned engine
// after real state Save/WriteSync, or by ordinary handshake replay after checking
// stored block headers. No ABCI method, network request, or state reader calls it.
func (a *Application) ConfirmConsensusRuntimeCheckpoint(chainID string, height int64, appHash []byte, appVersion uint64) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.runtimeUpgradeAuthorization == nil {
		return nil
	}
	if a.bootstrap == nil || a.pending != nil || len(appHash) != 32 {
		return errors.New("runtime checkpoint cannot confirm pending or unbound application state")
	}
	trusted := runtimeUpgradeCheckpoint{chainID: chainID, cometGenesisSHA256: a.bootstrap.record.CometGenesisSHA256, height: height, appHash: hex.EncodeToString(appHash), appVersion: appVersion}
	if a.runtimeUpgradeCursor == nil {
		cursor, err := newRuntimeUpgradeCursor(a.runtimeUpgradeAuthorization, a.migration, a.committed, trusted)
		if err != nil {
			return err
		}
		a.runtimeUpgradeCursor = cursor
		return nil
	}
	return a.runtimeUpgradeCursor.confirmCommitted(a.migration, a.committed, trusted)
}

// Info may describe an already validated file before handshake, but this does
// not create a cursor or grant permission to execute the next block.
func (a *Application) runtimeApplicationVersionLocked() (uint64, error) {
	return runtimeStateApplicationVersion(a.committed, a.runtimeUpgradeAuthorization)
}

func runtimeStateApplicationVersion(state CommittedState, authorization *RuntimeUpgradeAuthorization) (uint64, error) {
	if authorization == nil {
		return ApplicationVersion, nil
	}
	p, err := authorization.Plan()
	if err != nil {
		return 0, err
	}
	if !state.Initialized || state.Height <= 0 || state.ChainID != p.NativeChainID || state.MigrationStateHash != p.MigrationStateHash {
		return 0, errors.New("runtime upgrade requires an existing initialized historical checkpoint")
	}
	if state.Height <= p.CheckpointHeight {
		if state.Version != p.OldStateVersion || (state.Height == p.CheckpointHeight && state.AppHash != p.CheckpointAppHash) {
			return 0, errors.New("runtime upgrade file differs from independently pinned historical profile")
		}
		return p.OldApplicationVersion, nil
	}
	if state.Version != 18 && state.Version != 19 && state.Version != 20 {
		return 0, errors.New("runtime upgrade file uses an unsupported post-upgrade schema")
	}
	return p.NewApplicationVersion, nil
}

// Normal startup cannot silently promote an old hash domain. Decoder-only
// journal tools retain their explicit historical behavior; public factories
// must use this check before starting any application or node.
func (a *Application) ValidateNormalRuntime() error {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.committed.Version <= 13 && a.runtimeUpgradeAuthorization == nil {
		return errors.New("historical runtime requires an independently pinned upgrade plan and an in-process engine checkpoint channel")
	}
	_, err := a.runtimeApplicationVersionLocked()
	return err
}

func (a *Application) prepareRuntimeUpgradeExecution(state executionState, height int64) (executionState, error) {
	if a.runtimeUpgradeAuthorization == nil {
		return state, nil
	}
	mode, err := a.runtimeUpgradeCursor.modeForNext(a.committed, height)
	if err != nil {
		return state, err
	}
	state.hashVersion = mode.hashVersion
	if mode.hashVersion != 0 {
		// committedExecutionStateView normally initializes modern trace data
		// when leaving an old file. Historical replay must keep old nil data.
		state.traceLots = a.committed.TraceLots
	}
	return state, nil
}

func (a *Application) prepareConsensusExecution(state executionState, height int64) (executionState, error) {
	state, err := a.prepareRuntimeUpgradeExecution(state, height)
	if err != nil {
		return state, err
	}
	return preparePQEngineExecution(state, height, a.pqEngineAuthorization)
}

func validateHistoricalRuntimeEnvelope(state executionState, kind string) error {
	if state.hashVersion == 12 || state.hashVersion == 13 {
		switch kind {
		case ValidatorRegistryTransactionType, PQActionType, PQTransferType, PQMigrationType, PQRevocationType, PQWholeType, PQEthereumValueType:
			return errors.New("new protocol transaction is not admitted under the historical runtime profile")
		}
	}
	return nil
}

// Merge only the authorized Version update. Preserve PQ profile/validator and
// any other independently validated response fields rather than replacing them.
func (a *Application) applyRuntimeUpgradeResponse(height int64, response *abci.ResponseFinalizeBlock) error {
	if a.runtimeUpgradeAuthorization == nil {
		return nil
	}
	mode, err := a.runtimeUpgradeCursor.modeForNext(a.committed, height)
	if err != nil {
		return err
	}
	p, _ := a.runtimeUpgradeAuthorization.Plan()
	if height != p.UpgradeHeight {
		return nil
	}
	if response.ConsensusParamUpdates == nil {
		response.ConsensusParamUpdates = &cmtproto.ConsensusParams{}
	}
	params := response.ConsensusParamUpdates
	if params.Version != nil && params.Version.App != mode.appVersion {
		return errors.New("runtime and other consensus AppVersion updates conflict")
	}
	params.Version = &cmtproto.VersionParams{App: mode.appVersion}
	return nil
}

func withRuntimeUpgradeSnapshot(snapshot *PQEngineSnapshot, err error, authorization *RuntimeUpgradeAuthorization) (*PQEngineSnapshot, error) {
	if err != nil || snapshot == nil || authorization == nil {
		return snapshot, err
	}
	plan, err := authorization.Plan()
	if err != nil {
		return nil, err
	}
	if snapshot.bootstrap.record.CometGenesisSHA256 != plan.CometGenesisSHA256 || snapshot.bootstrap.record.MigrationStateHash != plan.MigrationStateHash {
		return nil, errors.New("runtime params differ from independently pinned snapshot bootstrap")
	}
	copy := *snapshot
	copy.runtimeUpgradePlan = &plan
	return &copy, nil
}
