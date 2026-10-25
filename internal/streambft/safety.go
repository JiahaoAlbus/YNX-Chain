package streambft

import (
	"errors"
	"fmt"
)

type SafetyState struct {
	LastVotedView uint64 `json:"lastVotedView"`
	LockedView    uint64 `json:"lockedView"`
	LockedBlockID string `json:"lockedBlockId"`
}

// CanVote enforces one vote per monotonically increasing view and the HotStuff
// locked-QC rule. The caller persists the returned state before sending a vote.
func (state SafetyState) CanVote(proposal Proposal, parentQC QuorumCertificate, validators []Validator) (SafetyState, error) {
	if proposal.View <= state.LastVotedView {
		return state, fmt.Errorf("view %d was already voted or is stale", proposal.View)
	}
	leader, err := DeterministicLeader(validators, proposal.View)
	if err != nil {
		return state, err
	}
	if proposal.Leader != leader {
		return state, fmt.Errorf("proposal leader %s does not match deterministic leader %s", proposal.Leader, leader)
	}
	if err := parentQC.Validate(validators); err != nil {
		return state, fmt.Errorf("parent QC: %w", err)
	}
	if proposal.ParentID != parentQC.BlockID {
		return state, errors.New("proposal does not extend its parent QC")
	}
	if parentQC.View < state.LockedView && proposal.ParentID != state.LockedBlockID {
		return state, errors.New("proposal violates the locked-QC rule")
	}
	next := state
	next.LastVotedView = proposal.View
	if parentQC.View > next.LockedView {
		next.LockedView = parentQC.View
		next.LockedBlockID = parentQC.BlockID
	}
	return next, nil
}

type CertifiedBlock struct {
	ID       string            `json:"id"`
	ParentID string            `json:"parentId"`
	View     uint64            `json:"view"`
	QC       QuorumCertificate `json:"qc"`
}

func ThreeChainCommit(grandparent, parent, child CertifiedBlock, validators []Validator) error {
	if grandparent.ID == "" || parent.ParentID != grandparent.ID || child.ParentID != parent.ID {
		return errors.New("certified blocks do not form a three-chain")
	}
	if !(grandparent.View < parent.View && parent.View < child.View) {
		return errors.New("certified block views are not increasing")
	}
	for _, block := range []CertifiedBlock{grandparent, parent, child} {
		if block.QC.BlockID != block.ID || block.QC.View != block.View {
			return fmt.Errorf("QC does not bind block %s", block.ID)
		}
		if err := block.QC.Validate(validators); err != nil {
			return err
		}
	}
	return nil
}
