package consensus

import (
	"errors"

	sm "github.com/cometbft/cometbft/state"
)

// SetHeightHalt installs a local barrier before Start. Authority and all normal
// signatures remain unchanged; the barrier only stops future local work.
func (cs *State) SetHeightHalt(halt *sm.HeightHalt) error {
	cs.mtx.Lock()
	defer cs.mtx.Unlock()
	if halt == nil || cs.IsRunning() || cs.heightHalt != nil {
		return errors.New("height halt must be installed once before consensus starts")
	}
	cs.heightHalt = halt
	return nil
}
