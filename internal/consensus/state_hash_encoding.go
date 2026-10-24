package consensus

import (
	"fmt"
	"sync"
	"sync/atomic"
)

const (
	StateHashOriginalJSON  = "original-json"
	StateHashCachedFeeJSON = "cached-fee-time-json"
)

var stateHashEncodingSelection struct {
	once   sync.Once
	cached bool
	calls  atomic.Uint64
	errors atomic.Uint64
}

// ConfigureStateHashEncoding selects an exact-byte hash implementation before
// the first hash or report read. The first selection/use freezes the choice for
// this process; a later differing selection fails. It changes no hash domain,
// canonical bytes, full-state validation or persistence rules. Callers must
// explicitly select the candidate; existing applications keep the original.
func ConfigureStateHashEncoding(mode string) error {
	if mode != StateHashOriginalJSON && mode != StateHashCachedFeeJSON {
		return fmt.Errorf("unsupported state hash encoding %q", mode)
	}
	stateHashEncodingSelection.once.Do(func() { stateHashEncodingSelection.cached = mode == StateHashCachedFeeJSON })
	if (mode == StateHashCachedFeeJSON) != stateHashEncodingSelection.cached {
		return fmt.Errorf("state hash encoding is already fixed for this process")
	}
	return nil
}

// StateHashEncodingMeasurements reports actual selected-path attempts/errors.
// Reading it freezes an otherwise unconfigured process on the original path.
// These are process-wide counters, not transaction, validation or finality proof.
func StateHashEncodingMeasurements() (mode string, calls, failures uint64) {
	stateHashEncodingSelection.once.Do(func() {})
	mode = StateHashOriginalJSON
	if stateHashEncodingSelection.cached {
		mode = StateHashCachedFeeJSON
	}
	return mode, stateHashEncodingSelection.calls.Load(), stateHashEncodingSelection.errors.Load()
}
