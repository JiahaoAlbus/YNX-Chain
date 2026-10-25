package consensus

import (
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// LoadRuntimeUpgradeAuthorization reads only explicit operator configuration.
// Neither missing pins nor a state file's embedded version enable an upgrade.
func LoadRuntimeUpgradeAuthorization(path, pin string, bootstrap *ConsensusBootstrap, migration chain.ConsensusMigrationState) (*RuntimeUpgradeAuthorization, error) {
	if path == "" && pin == "" {
		return nil, nil
	}
	if path == "" || pin == "" {
		return nil, errors.New("runtime upgrade requires both the canonical plan and its independent hash pin")
	}
	wire, err := readPQOperatorFile(path, MaxRuntimeUpgradePlanBytes, false)
	if err != nil {
		return nil, err
	}
	return NewRuntimeUpgradeAuthorization(wire, pin, bootstrap, migration)
}

// NewPQEngineFileSourceWithRuntimeUpgrade remains read-only. It changes only
// the independently pinned historical parameter view; it never creates or
// advances the application's execution cursor and never confirms a pending file.
func NewPQEngineFileSourceWithRuntimeUpgrade(migration chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap, pq *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization) (*PQEngineFileSource, error) {
	source, err := NewPQEngineFileSource(migration, statePath, bootstrap, pq)
	if err != nil {
		return nil, err
	}
	if runtime != nil {
		plan, err := runtime.Plan()
		if err != nil {
			return nil, err
		}
		if bootstrap.record.CometGenesisSHA256 != plan.CometGenesisSHA256 || bootstrap.record.MigrationStateHash != plan.MigrationStateHash || bootstrap.record.OriginalGenesisHash != plan.OriginalGenesisHash || bootstrap.record.Params.Version == nil || bootstrap.record.Params.Version.App != plan.OldApplicationVersion {
			return nil, errors.New("remote runtime plan differs from independent source bootstrap")
		}
	}
	source.runtimeAuthorization = runtime
	return source, nil
}
