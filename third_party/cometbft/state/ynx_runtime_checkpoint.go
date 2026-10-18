package state

import (
	"bytes"

	"github.com/cometbft/cometbft/types"
)

// ConfirmRuntimeCheckpoint must follow successful Store.Save/WriteSync. It is
// deliberately separate from BindState, which also runs before engine Save.
func ConfirmRuntimeCheckpoint(source types.ConsensusAuthoritySource, state State) error {
	consumer, ok := source.(types.ConsensusRuntimeCheckpointConsumer)
	if !ok {
		return nil
	}
	height := state.LastBlockHeight
	if height == 0 {
		height = state.InitialHeight - 1
	}
	return consumer.ConfirmConsensusRuntimeCheckpoint(state.ChainID, height, bytes.Clone(state.AppHash), state.Version.Consensus.App)
}
