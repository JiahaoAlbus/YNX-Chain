package consensus

import (
	"bytes"
	"errors"
	"fmt"

	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/types"
)

func (h *Handshaker) SetConsensusAuthoritySource(source types.ConsensusAuthoritySource) {
	h.pqAuthoritySource = source
}

func (h *Handshaker) consensusReplayStore(state sm.State, replayHeight int64) (sm.Store, error) {
	if h.pqAuthoritySource == nil {
		return h.stateStore, nil
	}
	checkpointHeight := state.LastBlockHeight
	if checkpointHeight == 0 {
		checkpointHeight = state.InitialHeight - 1
	}
	checkpointHash := bytes.Clone(state.AppHash)
	if h.pqAppHeight > checkpointHeight {
		if h.pqAppHeight != checkpointHeight+1 || replayHeight != h.pqAppHeight {
			return nil, errors.New("unsupported application-ahead consensus authority checkpoint")
		}
		result, err := h.stateStore.LoadLastFinalizeBlockResponse(h.pqAppHeight)
		if err != nil {
			return nil, err
		}
		// Unlike the stock old-version compatibility fallback, Info cannot
		// manufacture an absent durable AppHash for PQ signing authority.
		if result == nil || len(result.AppHash) == 0 || !bytes.Equal(result.AppHash, h.pqAppHash) {
			return nil, errors.New("application-ahead authority requires exact persisted Finalize AppHash")
		}
		checkpointHeight, checkpointHash = h.pqAppHeight, bytes.Clone(result.AppHash)
	} else if h.pqAppHeight == checkpointHeight && !bytes.Equal(h.pqAppHash, checkpointHash) {
		return nil, errors.New("application Info differs from committed engine checkpoint")
	}
	// If the app was behind, prior ExecCommitBlock replay has now reached
	// state.LastBlockHeight and checked its hash against stored block headers.
	authority, err := h.pqAuthoritySource.ConsensusAuthorityForState(state.ChainID, checkpointHeight, checkpointHash)
	if err != nil {
		return nil, fmt.Errorf("load exact replay authority checkpoint: %w", err)
	}
	return sm.WithHandshakeConsensusAuthorityStore(h.stateStore, h.pqAuthoritySource, authority, checkpointHeight)
}
