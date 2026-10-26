package consensus

import (
	"encoding/hex"
	"errors"
	"fmt"

	sm "github.com/cometbft/cometbft/state"
)

// Only the normal application-ahead-by-one Commit boundary is transient.
// Same-height hash/chain conflicts and arbitrary height gaps are refusals.
// The production source exporter still performs one capture without retry.
var errProofHostCheckpointCrossing = errors.New("live engine/application checkpoint changed before capture")

func (app *Application) captureProofHostCommittedJSON(actual sm.State) ([]byte, error) {
	if app == nil {
		return nil, errors.New("original application checkpoint unavailable")
	}
	app.mu.RLock()
	defer app.mu.RUnlock()
	if app.bootstrap == nil || app.bootstrap.record.ChainID != actual.ChainID {
		return nil, errors.New("live engine/application checkpoint chain differs")
	}
	if app.committed.Height != actual.LastBlockHeight {
		if actual.LastBlockHeight >= 0 && app.committed.Height > actual.LastBlockHeight && app.committed.Height-1 == actual.LastBlockHeight {
			return nil, fmt.Errorf("%w: applicationHeight=%d engineHeight=%d", errProofHostCheckpointCrossing, app.committed.Height, actual.LastBlockHeight)
		}
		return nil, fmt.Errorf("live engine/application checkpoint height differs: applicationHeight=%d engineHeight=%d", app.committed.Height, actual.LastBlockHeight)
	}
	if app.committed.AppHash != hex.EncodeToString(actual.AppHash) {
		return nil, errors.New("live engine/application checkpoint AppHash differs at the same height")
	}
	// Do not assume every nested business map/slice is immutable after a shallow
	// copy. Encode the complete current committed value while its normal lock is
	// held, then release before decoding, validation, hashing and cryptography.
	// Large-checkpoint lock latency requires operator measurement; no claim of
	// production live latency or permission to invoke this on a public node.
	return encodeCommittedStateJSON(app.committed)
}
