package consensus

import (
	"bytes"
	"errors"
	"testing"
	"time"

	cstypes "github.com/cometbft/cometbft/consensus/types"
	"github.com/cometbft/cometbft/crypto"
	"github.com/cometbft/cometbft/libs/log"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/types"
)

// Uses an actual Ed signer to observe engine call order. Crypto authority is
// not mocked; PQ dual signatures and root history are covered by integration.
type contextTrackingPV struct {
	types.MockPV
	heightCalls  int
	heightError  error
	contextError error
	chain        string
	height       int64
	round        int32
	actual       *types.ValidatorSet
	contextSeen  bool
	signed       int
	proposals    int
}

func (p *contextTrackingPV) GetPubKeyForHeight(chain string, h int64) (crypto.PubKey, error) {
	p.heightCalls++
	if p.heightError != nil {
		return nil, p.heightError
	}
	if chain != p.chain || h != p.height {
		return nil, errors.New("wrong requested height")
	}
	return p.MockPV.GetPubKey()
}
func (p *contextTrackingPV) SetConsensusSigningContext(chain string, h int64, r int32, set *types.ValidatorSet) error {
	p.contextSeen = false
	if p.contextError != nil {
		return p.contextError
	}
	if chain != p.chain || h != p.height || r != p.round || set == p.actual || !bytes.Equal(set.Hash(), p.actual.Hash()) ||
		!bytes.Equal(set.GetProposer().Address, p.actual.GetProposer().Address) || set.GetProposer().ProposerPriority != p.actual.GetProposer().ProposerPriority {
		return errors.New("not the actual detached round set")
	}
	p.contextSeen = true
	return nil
}
func (p *contextTrackingPV) SignVote(chain string, v *cmtproto.Vote) error {
	if !p.contextSeen || chain != p.chain || v.Height != p.height || v.Round != p.round {
		return errors.New("signing before actual context")
	}
	p.signed++
	return p.MockPV.SignVote(chain, v)
}
func (p *contextTrackingPV) SignProposal(chain string, proposal *cmtproto.Proposal) error {
	if !p.contextSeen || chain != p.chain || proposal.Height != p.height || proposal.Round != p.round {
		return errors.New("proposal signing before actual context")
	}
	p.proposals++
	return p.MockPV.SignProposal(chain, proposal)
}

func TestYNXActualSignVoteConsumesHeightKeyAndRoundContext(t *testing.T) {
	pv := &contextTrackingPV{MockPV: types.NewMockPV(), chain: "ynx-context-test", height: 10, round: 3}
	pub, err := pv.MockPV.GetPubKey()
	if err != nil {
		t.Fatal(err)
	}
	other := types.NewMockPV()
	otherPub, err := other.GetPubKey()
	if err != nil {
		t.Fatal(err)
	}
	vals := types.NewValidatorSet([]*types.Validator{types.NewValidator(pub, 10), types.NewValidator(otherPub, 20)})
	vals.IncrementProposerPriority(7)
	pv.actual = vals
	cs := &State{privValidator: pv, wal: nilWAL{}, state: sm.State{ChainID: pv.chain, ConsensusParams: *types.DefaultConsensusParams()},
		RoundState: cstypes.RoundState{Height: pv.height, Round: pv.round, Validators: vals}}
	cs.Logger = log.NewNopLogger()
	if err := cs.updatePrivValidatorPubKey(); err != nil || pv.heightCalls != 1 {
		t.Fatal("actual height-aware key call missing", err)
	}
	vote, err := cs.signVote(cmtproto.PrevoteType, nil, types.PartSetHeader{}, nil)
	if err != nil || pv.signed != 1 || !pv.contextSeen {
		t.Fatal("actual signVote did not consume context", err)
	}
	if err := vote.Verify(pv.chain, pub); err != nil {
		t.Fatal("real signature invalid", err)
	}
	block := types.MakeBlock(pv.height, nil, &types.Commit{}, nil)
	block.Header.ValidatorsHash = vals.Hash()
	block.Header.ChainID = pv.chain
	block.Header.Time = time.Now().UTC()
	parts, err := block.MakePartSet(types.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	cs.ValidBlock, cs.ValidBlockParts, cs.ValidRound = block, parts, 0
	cs.internalMsgQueue = make(chan msgInfo, int(parts.Total())+2)
	pv.contextSeen = false
	cs.defaultDecideProposal(pv.height, pv.round)
	if pv.proposals != 1 || !pv.contextSeen {
		t.Fatal("actual proposal signer missed round context")
	}
	message := <-cs.internalMsgQueue
	proposal, ok := message.Msg.(*ProposalMessage)
	if !ok || !proposal.Proposal.VerifySignature(pv.chain, pub) {
		t.Fatal("actual proposal caller did not enqueue a real signature")
	}
	queued := len(cs.internalMsgQueue)
	pv.contextError = errors.New("committed authority unavailable")
	cs.defaultDecideProposal(pv.height, pv.round)
	if pv.proposals != 1 || len(cs.internalMsgQueue) != queued {
		t.Fatal("failed context signed or enqueued proposal")
	}
	if _, err := cs.signVote(cmtproto.PrevoteType, nil, types.PartSetHeader{}, nil); err == nil || pv.signed != 1 {
		t.Fatal("context failure still signed")
	}
	pv.heightError = errors.New("requested epoch unavailable")
	if err := cs.updatePrivValidatorPubKey(); err == nil || cs.privValidatorPubKey != nil {
		t.Fatal("failed height lookup kept stale key")
	}
	if _, err := cs.signVote(cmtproto.PrevoteType, nil, types.PartSetHeader{}, nil); err == nil || pv.signed != 1 {
		t.Fatal("failed lookup reused old cached key")
	}
}
