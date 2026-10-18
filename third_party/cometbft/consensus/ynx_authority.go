package consensus

import (
	"github.com/cometbft/cometbft/types"
)

// Called while consensus owns cs.mtx; never call back into an engine getter.
func (cs *State) setConsensusSigningContext(height int64, round int32) error {
	if setter, ok := cs.privValidator.(types.ConsensusSigningContextSetter); ok {
		return setter.SetConsensusSigningContext(cs.state.ChainID, height, round, cs.Validators.Copy())
	}
	return nil
}
