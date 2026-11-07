package consensus

import (
	"bytes"
	"errors"
	"math"

	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/types"
)

// confirmRuntimeReplayCheckpoint authenticates an application's result against
// an already committed local engine checkpoint. For an older application, the
// next stored block header contains the prior AppHash and AppVersion. An app
// one block ahead is not confirmed here: normal mock replay must Save the real
// engine state first, then the store's post-Save hook confirms it.
func (h *Handshaker) confirmRuntimeReplayCheckpoint(state sm.State, height int64, appHash []byte) error {
	consumer, ok := h.pqAuthoritySource.(types.ConsensusRuntimeCheckpointConsumer)
	if !ok || height == 0 || height > state.LastBlockHeight {
		return nil
	}
	if height < 0 || height == math.MaxInt64 {
		return errors.New("invalid runtime replay checkpoint height")
	}
	expected, version := state.AppHash, state.Version.Consensus.App
	if height < state.LastBlockHeight {
		next := h.store.LoadBlock(height + 1)
		if next == nil || next.Height != height+1 || next.ChainID != state.ChainID {
			return errors.New("runtime replay requires the actual next stored block header")
		}
		expected, version = next.AppHash, next.Version.App
	}
	if !bytes.Equal(appHash, expected) {
		return errors.New("runtime replay AppHash differs from committed engine history")
	}
	return consumer.ConfirmConsensusRuntimeCheckpoint(state.ChainID, height, bytes.Clone(expected), version)
}
