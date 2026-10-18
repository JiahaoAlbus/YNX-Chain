package node

import (
	"bytes"
	"errors"

	abci "github.com/cometbft/cometbft/abci/types"
	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/types"
)

// ProofSourceView exposes only reads of stores already owned by this node.
// It does not configure RPC, query a PrivValidator, initialize genesis chunks,
// reopen databases, or give callers Save/Bootstrap/signing methods.
type ProofSourceView struct{ node *Node }

func (n *Node) ProofSourceView() (*ProofSourceView, error) {
	if n == nil || n.stateStore == nil || n.blockStore == nil || n.consensusState == nil {
		return nil, errors.New("original initialized node stores are required")
	}
	return &ProofSourceView{node: n}, nil
}

func (v *ProofSourceView) LoadState() (sm.State, error) {
	s, err := v.node.stateStore.Load()
	if err != nil {
		return sm.State{}, err
	}
	c := v.node.consensusState.GetState()
	if s.ChainID != c.ChainID || s.LastBlockHeight != c.LastBlockHeight || !bytes.Equal(s.AppHash, c.AppHash) || !s.LastBlockID.Equals(c.LastBlockID) {
		return sm.State{}, errors.New("node checkpoint is crossing commit; no proof-source snapshot available")
	}
	return s, nil
}
func (v *ProofSourceView) LoadValidators(h int64) (*types.ValidatorSet, error) {
	return v.node.stateStore.LoadValidators(h)
}
func (v *ProofSourceView) LoadFinalizeBlockResponse(h int64) (*abci.ResponseFinalizeBlock, error) {
	return v.node.stateStore.LoadFinalizeBlockResponse(h)
}
func (v *ProofSourceView) LoadBlock(h int64) *types.Block { return v.node.blockStore.LoadBlock(h) }
func (v *ProofSourceView) LoadBlockCommit(h int64) *types.Commit {
	return v.node.blockStore.LoadBlockCommit(h)
}
func (v *ProofSourceView) LoadSeenCommit(h int64) *types.Commit {
	return v.node.blockStore.LoadSeenCommit(h)
}
