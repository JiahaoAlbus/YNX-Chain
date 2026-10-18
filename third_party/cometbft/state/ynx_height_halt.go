package state

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"sync"
)

// HeightHalt is a local maintenance barrier, never consensus authority. Both
// consensus and block sync must use the same instance. Enter precedes signing
// or saving a new block; Committed follows the complete ApplyVerifiedBlock.
type HeightHalt struct {
	mu       sync.Mutex
	initial  int64
	entered  int64
	target   int64
	state    State
	err      error
	terminal bool
	done     chan struct{}
}

var ErrHeightHalt = errors.New("local height halt prevents further consensus work")

func NewHeightHalt(committed State) (*HeightHalt, error) {
	if committed.ChainID == "" || committed.InitialHeight < 1 || committed.LastBlockHeight < 0 || committed.LastBlockHeight == math.MaxInt64 {
		return nil, errors.New("height halt requires an actual committed chain checkpoint")
	}
	return &HeightHalt{initial: committed.InitialHeight, entered: committed.LastBlockHeight, state: copyHeightHaltState(committed), done: make(chan struct{})}, nil
}

// Arm accepts one future target only. An entered but not yet committed height
// counts: a late request must not claim a checkpoint below a signature or an
// in-flight application commit. A rejected request is terminal, not ignored.
func (h *HeightHalt) Arm(height int64) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.terminal {
		return ErrHeightHalt
	}
	if h.target != 0 || height < h.initial || height <= h.state.LastBlockHeight || height < h.entered || height == math.MaxInt64 {
		err := errors.New("height halt request is duplicate, invalid, or already entered beyond its target")
		h.failLocked(err)
		return err
	}
	h.target = height
	return nil
}

// Enter is intentionally before any signing context, vote extension, proposal
// creation, block-store save or application execution at this height.
func (h *HeightHalt) Enter(height int64) bool {
	if h == nil {
		return true
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.terminal {
		return false
	}
	if height < h.initial || (h.target != 0 && height > h.target) {
		h.failLocked(fmt.Errorf("consensus work at height %d exceeds the local halt boundary", height))
		return false
	}
	if height > h.entered {
		h.entered = height
	}
	return true
}

// Committed may only receive the state returned by successful full block
// application. It never interrupts an in-flight Commit/Store.Save/WriteSync.
func (h *HeightHalt) Committed(committed State) bool {
	if h == nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if committed.ChainID != h.state.ChainID || committed.LastBlockHeight < h.state.LastBlockHeight {
		h.failLocked(errors.New("height halt committed checkpoint changed chain or regressed"))
		return true
	}
	h.state = copyHeightHaltState(committed)
	if h.terminal {
		return true
	}
	if h.target != 0 && committed.LastBlockHeight >= h.target {
		if committed.LastBlockHeight != h.target {
			h.failLocked(errors.New("height halt checkpoint passed its target"))
		} else {
			h.terminal = true
			close(h.done)
		}
		return true
	}
	return false
}

func (h *HeightHalt) Blocked() bool {
	if h == nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.terminal
}

func (h *HeightHalt) Fail(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.failLocked(err)
}

func (h *HeightHalt) failLocked(err error) {
	if !h.terminal {
		h.err, h.terminal = err, true
		close(h.done)
	}
}

// Done signals either a reached checkpoint or a failure; it is not evidence
// that the node, databases, custody session or writer leases have closed.
func (h *HeightHalt) Done() <-chan struct{} {
	if h == nil {
		return nil
	}
	return h.done
}

func (h *HeightHalt) Result() (State, int64, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.terminal {
		return State{}, 0, errors.New("height halt has not completed")
	}
	if h.err != nil {
		return State{}, h.target, h.err
	}
	if h.target == 0 || h.state.LastBlockHeight != h.target {
		return State{}, h.target, errors.New("height halt lacks the exact committed checkpoint")
	}
	return copyHeightHaltState(h.state), h.target, nil
}

func copyHeightHaltState(s State) State {
	copy := s
	if s.Validators != nil {
		copy.Validators = s.Validators.Copy()
	}
	if s.NextValidators != nil {
		copy.NextValidators = s.NextValidators.Copy()
	}
	if s.LastValidators != nil {
		copy.LastValidators = s.LastValidators.Copy()
	}
	copy.AppHash = bytes.Clone(s.AppHash)
	copy.LastResultsHash = bytes.Clone(s.LastResultsHash)
	copy.LastBlockID.Hash = bytes.Clone(s.LastBlockID.Hash)
	copy.LastBlockID.PartSetHeader.Hash = bytes.Clone(s.LastBlockID.PartSetHeader.Hash)
	copy.ConsensusParams.Validator.PubKeyTypes = append([]string(nil), s.ConsensusParams.Validator.PubKeyTypes...)
	return copy
}
