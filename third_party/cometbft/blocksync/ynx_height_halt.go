package blocksync

import (
	"errors"

	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/types"
)

// SetHeightHalt shares the consensus barrier with the block sync execution
// path. The installer must call this before starting the node/reactors.
func (r *Reactor) SetHeightHalt(halt *sm.HeightHalt) error {
	if halt == nil || r.IsRunning() || r.heightHalt != nil {
		return errors.New("height halt must be installed once before block sync starts")
	}
	r.heightHalt = halt
	return nil
}

// applySyncedBlock is the existing block-sync save/apply sequence. Signature
// and block validation remain in poolRoutine immediately before this call.
// The barrier is checked before the first durable side effect and notified
// only after the complete application/state-store commit returns.
func (r *Reactor) applySyncedBlock(state sm.State, block *types.Block, parts *types.PartSet, commit *types.Commit, extended *types.ExtendedCommit, extensionsEnabled bool) (sm.State, bool, error) {
	if !r.heightHalt.Enter(block.Height) {
		return state, true, nil
	}
	if extensionsEnabled {
		r.store.SaveBlockWithExtendedCommit(block, parts, extended)
	} else {
		r.store.SaveBlock(block, parts, commit)
	}
	next, err := r.blockExec.ApplyVerifiedBlock(state, types.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}, block)
	if err != nil {
		return state, false, err
	}
	return next, r.heightHalt.Committed(next), nil
}
