package consensus

import (
	"bytes"
	"errors"
	"testing"

	cstypes "github.com/cometbft/cometbft/consensus/types"
	"github.com/cometbft/cometbft/libs/log"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/types"
)

type checkpointTrackingPV struct {
	*contextTrackingPV
	committed   int64
	hash        []byte
	checkpoints int
	failure     error
}

func (p *checkpointTrackingPV) SetConsensusCheckpointSigningContext(chain string, committed int64, hash []byte, height int64, round int32, set *types.ValidatorSet) error {
	p.contextSeen = false
	p.checkpoints++
	if p.failure != nil {
		return p.failure
	}
	if committed != p.committed || !bytes.Equal(hash, p.hash) {
		return errors.New("wrong actual checkpoint")
	}
	if err := p.contextTrackingPV.SetConsensusSigningContext(chain, height, round, set); err != nil {
		return err
	}
	hash[0] ^= 1 // must be detached from engine AppHash
	return nil
}
func TestYNXActualRemoteCallerPassesCheckpointBeforeHeightKeyAndSign(t *testing.T) {
	for _, initial := range []bool{false, true} {
		t.Run(map[bool]string{false: "committed", true: "non-one-initial-height"}[initial], func(t *testing.T) {
			local := &contextTrackingPV{MockPV: types.NewMockPV(), chain: "checkpoint-chain", height: 9, round: 2}
			key, err := local.MockPV.GetPubKey()
			if err != nil {
				t.Fatal(err)
			}
			set := types.NewValidatorSet([]*types.Validator{types.NewValidator(key, 10)})
			set.IncrementProposerPriority(3)
			local.actual = set
			pv := &checkpointTrackingPV{contextTrackingPV: local, committed: 8, hash: bytes.Repeat([]byte{0x42}, 32)}
			state := sm.State{ChainID: local.chain, InitialHeight: 1, LastBlockHeight: 8, AppHash: bytes.Clone(pv.hash), ConsensusParams: *types.DefaultConsensusParams()}
			if initial {
				state.InitialHeight = 9
				state.LastBlockHeight = 0
			}
			cs := &State{privValidator: pv, wal: nilWAL{}, state: state, RoundState: cstypes.RoundState{Height: 9, Round: 2, Validators: set}}
			cs.Logger = log.NewNopLogger()
			if err = cs.updatePrivValidatorPubKey(); err != nil || pv.checkpoints != 1 || local.heightCalls != 1 || !local.contextSeen {
				t.Fatal("height key was not preceded by exact checkpoint", err)
			}
			vote, err := cs.signVote(cmtproto.PrevoteType, nil, types.PartSetHeader{}, nil)
			if err != nil || pv.checkpoints != 2 || local.signed != 1 || vote.Verify(local.chain, key) != nil {
				t.Fatal("actual signing did not consume checkpoint", err)
			}
			if !bytes.Equal(cs.state.AppHash, pv.hash) || cs.state.LastBlockHeight != state.LastBlockHeight {
				t.Fatal("checkpoint capture changed actual history")
			}
			pv.failure = errors.New("fresh checkpoint missing")
			if err = cs.updatePrivValidatorPubKey(); err == nil || cs.privValidatorPubKey != nil || local.heightCalls != 1 {
				t.Fatal("failed checkpoint retained or fetched a key")
			}
			if _, err = cs.signVote(cmtproto.PrevoteType, nil, types.PartSetHeader{}, nil); err == nil || local.signed != 1 {
				t.Fatal("failed checkpoint still signed")
			}
		})
	}
}
