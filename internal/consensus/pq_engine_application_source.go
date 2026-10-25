package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"

	cmttypes "github.com/cometbft/cometbft/types"
)

var _ cmttypes.ConsensusAuthoritySource = (*Application)(nil)

// ConsensusAuthorityForState binds a detached committed view to the engine's
// actual checkpoint. It does not publish pending Finalize state and does not
// call back into an engine lock. The same source supports an in-process app
// without routing an authenticated view through a network response.
func (a *Application) ConsensusAuthorityForState(chainID string, height int64, appHash []byte) (cmttypes.ConsensusAuthority, error) {
	if a == nil || len(appHash) != 32 {
		return nil, errors.New("missing application authority or trusted full AppHash")
	}
	a.mu.RLock()
	bootstrap := a.bootstrap
	if bootstrap == nil || chainID != bootstrap.record.ChainID || height != a.committed.Height {
		a.mu.RUnlock()
		return nil, errors.New("application authority differs from the engine's actual chain or committed height")
	}
	hash, err := hex.DecodeString(a.committed.AppHash)
	if err != nil || !bytes.Equal(hash, appHash) {
		a.mu.RUnlock()
		return nil, errors.New("application authority differs from the engine's actual AppHash")
	}
	registry := cloneValidatorRegistry(a.committed.ValidatorRegistry)
	schedule := clonePQEngineSchedule(a.committed.PQEngineSchedule)
	authorization := a.pqEngineAuthorization
	runtimeAuthorization := a.runtimeUpgradeAuthorization
	a.mu.RUnlock()
	if err := authorization.ValidateCommittedSchedule(schedule, height); err != nil {
		return nil, err
	}
	snapshot, err := newPQEngineSnapshot(bootstrap, registry, schedule, height)
	return withRuntimeUpgradeSnapshot(snapshot, err, runtimeAuthorization)
}
