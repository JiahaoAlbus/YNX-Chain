package consensus

import (
	"bytes"
	"errors"
	"github.com/cometbft/cometbft/types"
)

// Called while consensus owns cs.mtx; never call back into an engine getter.
func (cs *State) setConsensusSigningContext(height int64, round int32) error {
	if setter, ok := cs.privValidator.(types.ConsensusCheckpointSigningContextSetter); ok {
		return cs.setConsensusCheckpointSigningContext(setter, height, round)
	}
	if setter, ok := cs.privValidator.(types.ConsensusSigningContextSetter); ok {
		return setter.SetConsensusSigningContext(cs.state.ChainID, height, round, cs.Validators.Copy())
	}
	return nil
}

func (cs *State) setConsensusCheckpointSigningContext(setter types.ConsensusCheckpointSigningContextSetter, height int64, round int32) error {
	if cs.Validators == nil || height != cs.Height || round != cs.Round {
		return errors.New("remote signing context must be the locked actual engine H/R/set")
	}
	committed := cs.state.LastBlockHeight
	if committed == 0 {
		committed = cs.state.InitialHeight - 1
	}
	return setter.SetConsensusCheckpointSigningContext(cs.state.ChainID, committed, bytes.Clone(cs.state.AppHash), height, round, cs.Validators.Copy())
}
