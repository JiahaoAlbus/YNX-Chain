//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"errors"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type objectStateFixture struct {
	state ObjectSigningState
	err   error
	calls int
}

func (s *objectStateFixture) ConsensusSigningStateAt(genesisID []byte, chainID string, local []byte, height int64, round int32) (ObjectSigningState, error) {
	s.calls++
	state := s.state
	state.GenesisID = bytes.Clone(state.GenesisID)
	state.ValidatorAddress, state.ProposerAddress = bytes.Clone(state.ValidatorAddress), bytes.Clone(state.ProposerAddress)
	state.Params.Validator.PubKeyTypes = append([]string(nil), state.Params.Validator.PubKeyTypes...)
	// The query input is also detached from the adapter's immutable identity.
	if len(genesisID) != 0 {
		genesisID[0] ^= 1
	}
	if len(local) != 0 {
		local[0] ^= 1
	}
	return state, s.err
}

func objectStateFor(policy Policy, record KeyRecord, enableHeight int64) *objectStateFixture {
	params := *cmttypes.DefaultConsensusParams()
	params.ABCI.VoteExtensionsEnableHeight = enableHeight
	return &objectStateFixture{state: ObjectSigningState{GenesisID: bytes.Clone(policy.GenesisID), ChainID: policy.ChainID, Height: 100, Round: 0, ValidatorAddress: bytes.Clone(record.ValidatorAddress), ValidatorIndex: 0, ProposerAddress: bytes.Clone(record.ValidatorAddress), Params: params}}
}

func objectProposalFixture() *cmtproto.Proposal {
	v := fixtureVote(100)
	return &cmtproto.Proposal{Type: cmtproto.ProposalType, Height: v.Height, Round: v.Round, PolRound: -1, BlockID: cloneObjectBlockID(v.BlockID), Timestamp: v.Timestamp}
}

func cloneObjectVoteForTest(v *cmtproto.Vote) *cmtproto.Vote {
	copy := *v
	copy.BlockID = cloneObjectBlockID(v.BlockID)
	copy.ValidatorAddress, copy.Extension = bytes.Clone(v.ValidatorAddress), bytes.Clone(v.Extension)
	copy.Signature, copy.ExtensionSignature = bytes.Clone(v.Signature), bytes.Clone(v.ExtensionSignature)
	return &copy
}

func cloneObjectProposalForTest(p *cmtproto.Proposal) *cmtproto.Proposal {
	copy := *p
	copy.BlockID, copy.Signature = cloneObjectBlockID(p.BlockID), bytes.Clone(p.Signature)
	return &copy
}

func objectAdapterForTest(t *testing.T, signer *Signer, source ObjectSigningStateSource) *ObjectSigner {
	t.Helper()
	a, err := NewObjectSigner(signer, source)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestObjectSignerRealProposalVotesExtensionsAndRestart(t *testing.T) {
	k, registry, policy := realKeyFixture(t)
	path := filepath.Join(t.TempDir(), "object-state.json")
	s, err := CreateSigner(path, k, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	source := objectStateFor(policy, registry.record, 100)
	a := objectAdapterForTest(t, s, source)
	verify, err := NewCIRCLVerifier(policy, registry, nil)
	if err != nil {
		t.Fatal(err)
	}
	p := objectProposalFixture()
	if err := a.SignProposal(policy.ChainID, p); err != nil {
		t.Fatal(err)
	}
	proposalRequest, err := NewProposalRequestV2(policy.GenesisID, policy.ChainID, registry.record.ValidatorAddress, p)
	if err != nil || verify.Verify(proposalRequest, p.Signature) != nil {
		t.Fatal("actual proposal did not receive a valid dual signature")
	}
	proposalSignature := bytes.Clone(p.Signature)
	if err := a.SignProposal(policy.ChainID, p); err != nil || !bytes.Equal(p.Signature, proposalSignature) {
		t.Fatal("same proposal retry changed its durable signature")
	}
	proposalWire, err := p.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	var proposalRoundtrip cmtproto.Proposal
	if err := proposalRoundtrip.Unmarshal(proposalWire); err != nil || !reflect.DeepEqual(p, &proposalRoundtrip) {
		t.Fatal("actual proposal protobuf roundtrip changed complete signed object")
	}
	badExistingProposal := cloneObjectProposalForTest(p)
	badExistingProposal.Signature[len(badExistingProposal.Signature)-1] ^= 1
	beforeBadProposal := cloneObjectProposalForTest(badExistingProposal)
	if err := a.SignProposal(policy.ChainID, badExistingProposal); err == nil || !reflect.DeepEqual(beforeBadProposal, badExistingProposal) {
		t.Fatal("different existing proposal signature was silently overwritten")
	}
	prevote := fixtureVote(100)
	prevote.Type = cmtproto.PrevoteType
	if err := a.SignVote(policy.ChainID, prevote); err != nil {
		t.Fatal(err)
	}
	prevoteRequest, err := NewVoteRequestV2(policy.GenesisID, policy.ChainID, prevote)
	if err != nil || verify.Verify(prevoteRequest, prevote.Signature) != nil || len(prevote.ExtensionSignature) != 0 {
		t.Fatal("prevote signature or extension rules differ from its actual object")
	}
	vote := fixtureVote(100)
	vote.Extension = []byte("complete application extension")
	if err := a.SignVote(policy.ChainID, vote); err != nil {
		t.Fatal(err)
	}
	ordinary, err := NewVoteRequestV2(policy.GenesisID, policy.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	extension, err := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, vote)
	if err != nil || verify.Verify(ordinary, vote.Signature) != nil || verify.Verify(extension, vote.ExtensionSignature) != nil {
		t.Fatal("actual precommit and complete extension did not both verify")
	}
	original := cloneObjectVoteForTest(vote)
	voteWire, err := vote.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	var voteRoundtrip cmtproto.Vote
	if err := voteRoundtrip.Unmarshal(voteWire); err != nil || !reflect.DeepEqual(vote, &voteRoundtrip) {
		t.Fatal("actual vote protobuf roundtrip changed complete signed object")
	}
	for _, ext := range []bool{false, true} {
		bad := cloneObjectVoteForTest(vote)
		if ext {
			bad.ExtensionSignature[len(bad.ExtensionSignature)-1] ^= 1
		} else {
			bad.Signature[len(bad.Signature)-1] ^= 1
		}
		before := cloneObjectVoteForTest(bad)
		if err := a.SignVote(policy.ChainID, bad); err == nil || !reflect.DeepEqual(before, bad) {
			t.Fatal("different existing vote signature was silently overwritten")
		}
	}
	for _, branch := range []string{"ML", "SLH"} {
		for _, ext := range []bool{false, true} {
			bad := bytes.Clone(vote.Signature)
			request := ordinary
			if ext {
				bad, request = bytes.Clone(vote.ExtensionSignature), extension
			}
			envelope, err := ParseEnvelope(bad)
			if err != nil {
				t.Fatal(err)
			}
			if branch == "ML" {
				envelope.MLDSA87[10] ^= 1
			} else {
				envelope.SLHDSASHA2256f[10] ^= 1
			}
			bad, err = envelope.MarshalBinary()
			if err != nil || verify.Verify(request, bad) == nil {
				t.Fatal("object adapter signature did not require both real algorithms")
			}
		}
	}
	for _, mutate := range []func(*cmtproto.Vote){
		func(v *cmtproto.Vote) { v.BlockID.Hash[0] ^= 1 },
		func(v *cmtproto.Vote) { v.BlockID.PartSetHeader.Hash[0] ^= 1 },
		func(v *cmtproto.Vote) { v.Height++ },
		func(v *cmtproto.Vote) { v.Round++ },
		func(v *cmtproto.Vote) { v.Timestamp = v.Timestamp.Add(time.Nanosecond) },
		func(v *cmtproto.Vote) { v.ValidatorAddress[0] ^= 1 },
	} {
		bad := cloneObjectVoteForTest(vote)
		mutate(bad)
		q, err := NewVoteRequestV2(policy.GenesisID, policy.ChainID, bad)
		if err != nil || verify.Verify(q, vote.Signature) == nil {
			t.Fatal("ordinary signature accepted changed full vote")
		}
		e, err := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, bad)
		if err != nil || verify.Verify(e, vote.ExtensionSignature) == nil {
			t.Fatal("extension signature did not bind the complete ordinary vote")
		}
	}
	changedExtension := cloneObjectVoteForTest(vote)
	changedExtension.Extension[0] ^= 1
	q, err := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, changedExtension)
	if err != nil || verify.Verify(q, vote.ExtensionSignature) == nil {
		t.Fatal("changed full extension accepted")
	}
	if err := a.SignVote(policy.ChainID, changedExtension); err == nil {
		t.Fatal("same reserved H/R/extension allowed conflicting bytes")
	}
	// Caller-owned signature buffers cannot mutate the durable signature cache.
	vote.Signature[0] ^= 1
	vote.ExtensionSignature[0] ^= 1
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = ResumeSigner(path, k, registry)
	if err != nil {
		t.Fatal(err)
	}
	a = objectAdapterForTest(t, s, source)
	retry := cloneObjectVoteForTest(original)
	retry.Signature, retry.ExtensionSignature = nil, nil
	if err := a.SignVote(policy.ChainID, retry); err != nil || !reflect.DeepEqual(retry, original) {
		t.Fatal("restart failed to reuse both original exact vote signatures")
	}
	conflict := cloneObjectVoteForTest(retry)
	conflict.BlockID.Hash[0] ^= 1
	before := cloneObjectVoteForTest(conflict)
	if err := a.SignVote(policy.ChainID, conflict); err == nil || !reflect.DeepEqual(conflict, before) {
		t.Fatal("restart conflict changed the caller object or escaped signing history")
	}
	oldProposal := objectProposalFixture()
	if err := a.SignProposal(policy.ChainID, oldProposal); err == nil || len(oldProposal.Signature) != 0 {
		t.Fatal("object adapter bypassed durable step regression")
	}
	source.state.Height = 101
	next := fixtureVote(101)
	if err := a.SignVote(policy.ChainID, next); err != nil {
		t.Fatal(err)
	}
	source.state.Height = 100 // Valid historical source view cannot roll signer back.
	earlier := cloneObjectVoteForTest(original)
	earlier.Signature, earlier.ExtensionSignature = nil, nil
	beforeEarlier := cloneObjectVoteForTest(earlier)
	if err := a.SignVote(policy.ChainID, earlier); err == nil || !reflect.DeepEqual(earlier, beforeEarlier) {
		t.Fatal("trusted older view bypassed durable height regression")
	}
}

func TestObjectSignerTrustedStateAndExtensionRulesBeforeReservation(t *testing.T) {
	k, registry, policy := realKeyFixture(t)
	s, err := CreateSigner(filepath.Join(t.TempDir(), "state.json"), k, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	source := objectStateFor(policy, registry.record, 0)
	a := objectAdapterForTest(t, s, source)
	writes := 0
	s.write = func(path string, state signerState, create bool) error {
		writes++
		return writeSignerState(path, state, create)
	}
	for _, tc := range []struct {
		name   string
		change func(*objectStateFixture, *cmtproto.Vote)
	}{
		{"source unavailable", func(s *objectStateFixture, _ *cmtproto.Vote) { s.err = errors.New("trusted state unavailable") }},
		{"wrong source genesis", func(s *objectStateFixture, _ *cmtproto.Vote) { s.state.GenesisID[0] ^= 1 }},
		{"wrong source chain", func(s *objectStateFixture, _ *cmtproto.Vote) { s.state.ChainID = "other-chain" }},
		{"wrong source height", func(s *objectStateFixture, _ *cmtproto.Vote) { s.state.Height++ }},
		{"wrong source round", func(s *objectStateFixture, _ *cmtproto.Vote) { s.state.Round++ }},
		{"wrong source validator", func(s *objectStateFixture, _ *cmtproto.Vote) { s.state.ValidatorAddress[0] ^= 1 }},
		{"wrong source index", func(s *objectStateFixture, _ *cmtproto.Vote) { s.state.ValidatorIndex++ }},
		{"invalid params", func(s *objectStateFixture, _ *cmtproto.Vote) { s.state.Params.ABCI.VoteExtensionsEnableHeight = -1 }},
		{"missing params", func(s *objectStateFixture, _ *cmtproto.Vote) { s.state.Params = cmttypes.ConsensusParams{} }},
		{"wrong vote validator", func(_ *objectStateFixture, v *cmtproto.Vote) { v.ValidatorAddress[0] ^= 1 }},
		{"wrong vote index", func(_ *objectStateFixture, v *cmtproto.Vote) { v.ValidatorIndex++ }},
		{"disabled extension", func(_ *objectStateFixture, v *cmtproto.Vote) { v.Extension = []byte("peer cannot enable extensions") }},
		{"future extension activation", func(s *objectStateFixture, v *cmtproto.Vote) {
			s.state.Params.ABCI.VoteExtensionsEnableHeight = 101
			v.Extension = []byte("too early")
		}},
		{"prevote extension", func(s *objectStateFixture, v *cmtproto.Vote) {
			s.state.Params.ABCI.VoteExtensionsEnableHeight = 100
			v.Type = cmtproto.PrevoteType
			v.Extension = []byte{1}
		}},
		{"nil block extension", func(s *objectStateFixture, v *cmtproto.Vote) {
			s.state.Params.ABCI.VoteExtensionsEnableHeight = 100
			v.BlockID = cmtproto.BlockID{}
			v.Extension = []byte{1}
		}},
		{"old signature encoding", func(_ *objectStateFixture, v *cmtproto.Vote) { v.Signature = make([]byte, 64) }},
		{"oversized extension", func(_ *objectStateFixture, v *cmtproto.Vote) { v.Extension = make([]byte, (1<<20)+1) }},
		{"oversized signature", func(_ *objectStateFixture, v *cmtproto.Vote) { v.Signature = make([]byte, EnvelopeSize+1) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			*source = *objectStateFor(policy, registry.record, 0)
			vote := fixtureVote(100)
			tc.change(source, vote)
			before := cloneObjectVoteForTest(vote)
			if err := a.SignVote(policy.ChainID, vote); err == nil || !reflect.DeepEqual(vote, before) || writes != 0 || s.state.Height != 0 {
				t.Fatal("invalid peer/source input mutated object or reserved signer state")
			}
		})
	}
	*source = *objectStateFor(policy, registry.record, 0)
	vote := fixtureVote(100)
	if err := a.SignVote("other-chain", vote); err == nil || len(vote.Signature) != 0 || writes != 0 {
		t.Fatal("cross-chain object signing was accepted")
	}
	source.state.ProposerAddress[0] ^= 1
	proposal := objectProposalFixture()
	if err := a.SignProposal(policy.ChainID, proposal); err == nil || len(proposal.Signature) != 0 || writes != 0 {
		t.Fatal("local signer replaced trusted proposer selection")
	}
	if _, err := NewObjectSigner(s, nil); err == nil {
		t.Fatal("missing trusted source accepted")
	}
	if _, err := NewObjectSigner(nil, source); err == nil {
		t.Fatal("missing durable signer accepted")
	}
	var absent *ObjectSigner
	if absent.SignVote(policy.ChainID, vote) == nil || a.SignVote(policy.ChainID, nil) == nil || absent.SignProposal(policy.ChainID, proposal) == nil || a.SignProposal(policy.ChainID, nil) == nil {
		t.Fatal("nil object/adapter did not fail closed")
	}
}

func TestObjectSignerEmptyEnabledExtensionAndNilVote(t *testing.T) {
	k, registry, policy := realKeyFixture(t)
	for _, scenario := range []string{"empty-enabled", "disabled", "nil-block"} {
		t.Run(scenario, func(t *testing.T) {
			s, err := CreateSigner(filepath.Join(t.TempDir(), "state.json"), k, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			source := objectStateFor(policy, registry.record, 100)
			vote := fixtureVote(100)
			if scenario == "disabled" {
				source.state.Params.ABCI.VoteExtensionsEnableHeight = 0
			}
			if scenario == "nil-block" {
				vote.BlockID = cmtproto.BlockID{}
			}
			a := objectAdapterForTest(t, s, source)
			if err := a.SignVote(policy.ChainID, vote); err != nil {
				t.Fatal(err)
			}
			verify, err := NewCIRCLVerifier(policy, registry, nil)
			if err != nil {
				t.Fatal(err)
			}
			base, err := NewVoteRequestV2(policy.GenesisID, policy.ChainID, vote)
			if err != nil || verify.Verify(base, vote.Signature) != nil {
				t.Fatal("ordinary vote did not verify")
			}
			if scenario == "empty-enabled" {
				ext, err := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, vote)
				if err != nil || verify.Verify(ext, vote.ExtensionSignature) != nil {
					t.Fatal("enabled empty extension was not signed")
				}
			} else if len(vote.ExtensionSignature) != 0 {
				t.Fatal("disabled or nil-block vote gained extension authority")
			}
		})
	}
}

func TestObjectSignerDurabilityFailuresNeverMutateObjects(t *testing.T) {
	k, registry, policy := realKeyFixture(t)
	for _, proposal := range []bool{false, true} {
		for _, stage := range []string{"reserve-failure", "reserve-unknown", "signature-failure", "signature-unknown"} {
			name := "vote/" + stage
			if proposal {
				name = "proposal/" + stage
			}
			t.Run(name, func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "state.json")
				s, err := CreateSigner(path, k, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
				if err != nil {
					t.Fatal(err)
				}
				defer func() { s.Close() }()
				source := objectStateFor(policy, registry.record, 0)
				a := objectAdapterForTest(t, s, source)
				s.write = objectFailureWriter(stage, 0)
				p, v := objectProposalFixture(), fixtureVote(100)
				beforeP, beforeV := cloneObjectProposalForTest(p), cloneObjectVoteForTest(v)
				sign := func() error {
					if proposal {
						return a.SignProposal(policy.ChainID, p)
					}
					return a.SignVote(policy.ChainID, v)
				}
				for i := 0; i < 2; i++ {
					err := sign()
					if err == nil || !reflect.DeepEqual(p, beforeP) || !reflect.DeepEqual(v, beforeV) {
						t.Fatal("failed or still-uncertain signing exposed/mutated object")
					}
					if (stage == "reserve-unknown" || stage == "signature-unknown") && !errors.Is(err, ErrSignerDurabilityUncertain) {
						t.Fatal("UNKNOWN lost its durability classification")
					}
				}
				if stage != "reserve-failure" {
					if s.state.Height != 100 || len(s.state.Message) == 0 {
						t.Fatal("failed signer forgot original reservation")
					}
					if proposal {
						bad := objectProposalFixture()
						bad.BlockID.Hash[0] ^= 1
						if a.SignProposal(policy.ChainID, bad) == nil || len(bad.Signature) != 0 {
							t.Fatal("failure allowed conflicting proposal")
						}
					} else {
						bad := fixtureVote(100)
						bad.BlockID.Hash[0] ^= 1
						if a.SignVote(policy.ChainID, bad) == nil || len(bad.Signature) != 0 {
							t.Fatal("failure allowed conflicting vote")
						}
					}
				}
				persistedSignature := bytes.Clone(s.state.Signature)
				if err := s.Close(); err != nil {
					t.Fatal(err)
				}
				s, err = ResumeSigner(path, k, registry)
				if err != nil {
					t.Fatal(err)
				}
				a = objectAdapterForTest(t, s, source)
				if err := sign(); err != nil {
					t.Fatal(err)
				}
				var request Request
				var signature []byte
				if proposal {
					request, err = NewProposalRequestV2(policy.GenesisID, policy.ChainID, registry.record.ValidatorAddress, p)
					signature = p.Signature
				} else {
					request, err = NewVoteRequestV2(policy.GenesisID, policy.ChainID, v)
					signature = v.Signature
				}
				if err != nil {
					t.Fatal(err)
				}
				verify, err := NewCIRCLVerifier(policy, registry, nil)
				if err != nil || verify.Verify(request, signature) != nil {
					t.Fatal("restart retry did not complete original dual signature")
				}
				if len(persistedSignature) != 0 && !bytes.Equal(persistedSignature, signature) {
					t.Fatal("UNKNOWN retry replaced already-persisted signature")
				}
			})
		}
	}
}

// This uses the existing private test seam to perform real writes and simulate
// failures on either side of durability acknowledgement. No production callback
// is exposed by ObjectSigner, and all actual signature computations use CIRCL.
func objectFailureWriter(stage string, only Kind) func(string, signerState, bool) error {
	return func(path string, state signerState, create bool) error {
		reservation := stage == "reserve-failure" || stage == "reserve-unknown"
		match := (only == 0 || state.Kind == only) && (reservation == (len(state.Signature) == 0))
		if !match {
			return writeSignerState(path, state, create)
		}
		if stage == "reserve-unknown" || stage == "signature-unknown" {
			if err := writeSignerState(path, state, create); err != nil {
				return err
			}
			return ErrSignerDurabilityUncertain
		}
		return errors.New("simulated pre-rename signer write failure")
	}
}

func TestObjectSignerExtensionSecondPhaseFailureNeverLeaksPartialVote(t *testing.T) {
	k, registry, policy := realKeyFixture(t)
	for _, stage := range []string{"reserve-failure", "reserve-unknown", "signature-failure", "signature-unknown"} {
		t.Run(stage, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.json")
			s, err := CreateSigner(path, k, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { s.Close() }()
			source := objectStateFor(policy, registry.record, 100)
			a := objectAdapterForTest(t, s, source)
			s.write = objectFailureWriter(stage, VoteExtension)
			vote := fixtureVote(100)
			vote.Extension = []byte("must retain this complete extension")
			before := cloneObjectVoteForTest(vote)
			for i := 0; i < 2; i++ {
				if err := a.SignVote(policy.ChainID, vote); err == nil || !reflect.DeepEqual(vote, before) {
					t.Fatal("extension failure returned a partially usable vote")
				}
			}
			ordinary := bytes.Clone(s.state.Signature)
			var persistedExtension []byte
			if s.state.Kind == VoteExtension {
				ordinary, persistedExtension = bytes.Clone(s.state.PrecommitSignature), bytes.Clone(s.state.Signature)
			}
			if len(ordinary) != EnvelopeSize || len(vote.Signature) != 0 || len(vote.ExtensionSignature) != 0 {
				t.Fatal("ordinary durable result was missing or leaked before extension success")
			}
			bad := cloneObjectVoteForTest(vote)
			bad.BlockID.Hash[0] ^= 1
			if a.SignVote(policy.ChainID, bad) == nil || len(bad.Signature) != 0 {
				t.Fatal("second-phase failure forgot the exact ordinary vote")
			}
			if s.state.Kind == VoteExtension {
				bad = cloneObjectVoteForTest(vote)
				bad.Extension[0] ^= 1
				if a.SignVote(policy.ChainID, bad) == nil || len(bad.Signature) != 0 || len(bad.ExtensionSignature) != 0 {
					t.Fatal("reserved extension conflict leaked ordinary signature")
				}
			}
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			s, err = ResumeSigner(path, k, registry)
			if err != nil {
				t.Fatal(err)
			}
			a = objectAdapterForTest(t, s, source)
			if err := a.SignVote(policy.ChainID, vote); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(vote.Signature, ordinary) || (len(persistedExtension) != 0 && !bytes.Equal(vote.ExtensionSignature, persistedExtension)) {
				t.Fatal("recovery replaced original durable vote history")
			}
			verify, err := NewCIRCLVerifier(policy, registry, nil)
			if err != nil {
				t.Fatal(err)
			}
			base, err := NewVoteRequestV2(policy.GenesisID, policy.ChainID, vote)
			if err != nil || verify.Verify(base, vote.Signature) != nil {
				t.Fatal("recovered ordinary vote does not verify")
			}
			ext, err := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, vote)
			if err != nil || verify.Verify(ext, vote.ExtensionSignature) != nil {
				t.Fatal("recovered extension does not bind original full vote")
			}
		})
	}
}

func TestObjectSignerCopiedHandlesShareDurableConflictGuard(t *testing.T) {
	k, registry, policy := realKeyFixture(t)
	s, err := CreateSigner(filepath.Join(t.TempDir(), "state.json"), k, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a := objectAdapterForTest(t, s, objectStateFor(policy, registry.record, 0))
	copy := *a
	votes := []*cmtproto.Vote{fixtureVote(100), fixtureVote(100)}
	votes[1].BlockID.Hash[0] ^= 1
	adapters := []*ObjectSigner{a, &copy}
	errs := make([]error, 2)
	start := make(chan struct{})
	var done sync.WaitGroup
	for i := range votes {
		done.Add(1)
		go func(i int) { defer done.Done(); <-start; errs[i] = adapters[i].SignVote(policy.ChainID, votes[i]) }(i)
	}
	close(start)
	done.Wait()
	successes := 0
	for i, err := range errs {
		if err == nil {
			successes++
		} else if len(votes[i].Signature) != 0 {
			t.Fatal("conflicting concurrent call exposed a signature")
		}
	}
	if successes != 1 {
		t.Fatal("copied adapters forked or lost shared durable H/R/S guard")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := NewObjectSigner(s, objectStateFor(policy, registry.record, 0)); err == nil {
		t.Fatal("closed durable signer accepted")
	}
	unsigned := fixtureVote(100)
	before := cloneObjectVoteForTest(unsigned)
	if a.SignVote(policy.ChainID, unsigned) == nil || !reflect.DeepEqual(unsigned, before) {
		t.Fatal("closed adapter mutated caller object")
	}
}
