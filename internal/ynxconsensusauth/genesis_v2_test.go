//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestConsensusGenesisV2WireAndUnboundInputsFailClosed(t *testing.T) {
	vote := fixtureVote(100)
	proposal := objectProposalFixture()
	for _, genesis := range [][]byte{nil, make([]byte, 32), bytes.Repeat([]byte{1}, 31), bytes.Repeat([]byte{1}, 33)} {
		if _, err := NewVoteRequestV2(genesis, "ynx-research-only", vote); err == nil {
			t.Fatal("invalid genesis accepted for vote")
		}
		if _, err := NewProposalRequestV2(genesis, "ynx-research-only", vote.ValidatorAddress, proposal); err == nil {
			t.Fatal("invalid genesis accepted for proposal")
		}
		if _, err := NewVoteExtensionRequestV2(genesis, "ynx-research-only", vote); err == nil {
			t.Fatal("invalid genesis accepted for extension")
		}
	}
	if _, err := NewVoteRequest("ynx-research-only", vote); err == nil {
		t.Fatal("v1 unbound vote constructor still authorizes signing")
	}
	if _, err := NewProposalRequest("ynx-research-only", vote.ValidatorAddress, proposal); err == nil {
		t.Fatal("v1 unbound proposal constructor still authorizes signing")
	}
	if _, err := NewVoteExtensionRequest("ynx-research-only", vote); err == nil {
		t.Fatal("v1 unbound extension constructor still authorizes signing")
	}
	r := fixtureRequest(t, 100)
	message, err := r.SigningBytes(7)
	if err != nil {
		t.Fatal(err)
	}
	p := len(messageTag)
	if string(message[:p]) != "YNX-CONSENSUS-MESSAGE/v0.2\x00" || binary.BigEndian.Uint32(message[p:]) != ConsensusGenesisVersion {
		t.Fatal("missing explicit v2 domain/version")
	}
	p += 16 // version, kind, epoch
	if binary.BigEndian.Uint32(message[p:]) != 32 || !bytes.Equal(message[p+4:p+36], fixtureGenesis()) {
		t.Fatal("full genesis32 missing from frozen field order")
	}
	decoded, err := decodeSignerMessage(message, 7)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := decoded.SigningBytes(7)
	if err != nil || !bytes.Equal(replay, message) {
		t.Fatal("v2 durable message roundtrip changed full bytes")
	}
	oldVersion := r
	oldVersion.version = Version
	if _, err := oldVersion.SigningBytes(7); err == nil {
		t.Fatal("unbound request version accepted")
	}
	registry := fixtureRegistry()
	for _, policy := range []Policy{
		{Version: Version, ChainID: registry.record.ChainID, ActivationHeight: 100},
		{Version: Version, GenesisID: fixtureGenesis(), ChainID: registry.record.ChainID, ActivationHeight: 100},
		{Version: ConsensusGenesisVersion, ChainID: registry.record.ChainID, ActivationHeight: 100},
		{Version: ConsensusGenesisVersion, GenesisID: bytes.Repeat([]byte{0x82}, 32), ChainID: registry.record.ChainID, ActivationHeight: 100},
	} {
		if _, err := NewCIRCLVerifier(policy, registry, nil); err == nil {
			t.Fatal("unbound/mismatched policy accepted")
		}
	}
	// A caller may not mutate the constructor's policy or request after capture.
	genesis := fixtureGenesis()
	request, err := NewVoteRequestV2(genesis, registry.record.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	policy := Policy{Version: ConsensusGenesisVersion, GenesisID: genesis, ChainID: registry.record.ChainID, ActivationHeight: 100}
	verifier, err := NewVerifier(policy, registry, &providerSpy{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	genesis[0] ^= 1
	if !bytes.Equal(request.genesisID, fixtureGenesis()) || !bytes.Equal(verifier.policy.GenesisID, fixtureGenesis()) {
		t.Fatal("caller rewrote captured genesis")
	}
	wire := fixtureEnvelope(t)
	oldEnvelope := bytes.Clone(wire)
	copy(oldEnvelope, []byte("YNX-CONSENSUS-SIG/v0.1\x00"))
	binary.BigEndian.PutUint32(oldEnvelope[len(envelopeTag):], 1)
	if _, err := ParseEnvelope(oldEnvelope); err == nil {
		t.Fatal("v1 envelope accepted as v2")
	}
	if err := verifier.Verify(request, oldEnvelope); err == nil {
		t.Fatal("v1 envelope reached active v2 authority")
	}
	registry.anchor.GenesisID[0] ^= 1
	if err := verifier.Verify(request, wire); err == nil {
		t.Fatal("registry anchor changed after constructor without rejection")
	}
}

func TestConsensusGenesisV2AllObjectKindsAndCommit(t *testing.T) {
	key, registryA, policyA := realKeyFixture(t)
	registryB := &registryFixture{record: registryA.record, anchor: RegistryAnchor{GenesisID: bytes.Repeat([]byte{0x82}, 32), ChainID: policyA.ChainID}}
	policyB := policyA
	policyB.GenesisID = bytes.Clone(registryB.anchor.GenesisID)
	verifierA, err := NewCIRCLVerifier(policyA, registryA, nil)
	if err != nil {
		t.Fatal(err)
	}
	verifierB, err := NewCIRCLVerifier(policyB, registryB, nil)
	if err != nil {
		t.Fatal("legitimate B verifier must construct:", err)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	signer, err := CreateSigner(path, key, policyA, registryA, registryA.record.ValidatorAddress, registryA.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = signer.Close() }()
	source := objectStateFor(policyA, registryA.record, 100)
	adapter := objectAdapterForTest(t, signer, source)
	proposal := objectProposalFixture()
	if err := adapter.SignProposal(policyA.ChainID, proposal); err != nil {
		t.Fatal(err)
	}
	proposalA, err := NewProposalRequestV2(policyA.GenesisID, policyA.ChainID, registryA.record.ValidatorAddress, proposal)
	if err != nil {
		t.Fatal(err)
	}
	proposalB, err := NewProposalRequestV2(policyB.GenesisID, policyB.ChainID, registryB.record.ValidatorAddress, proposal)
	if err != nil {
		t.Fatal(err)
	}
	assertDomains := func(a, b Request, signature []byte) {
		t.Helper()
		if err := verifierA.Verify(a, signature); err != nil {
			t.Fatal("same-genesis real signature rejected:", err)
		}
		if err := verifierB.Verify(a, signature); err == nil {
			t.Fatal("A request/signature crossed B policy")
		}
		if err := verifierB.Verify(b, signature); err == nil {
			t.Fatal("A signature verified over B full message with identical HRS/keys")
		}
		ba, errA := a.SigningBytes(registryA.record.Epoch)
		bb, errB := b.SigningBytes(registryB.record.Epoch)
		if errA != nil || errB != nil || bytes.Equal(ba, bb) {
			t.Fatal("genesis did not change full signing bytes")
		}
	}
	assertDomains(proposalA, proposalB, proposal.Signature)
	prevote := fixtureVote(100)
	prevote.Type = cmtproto.PrevoteType
	if err := adapter.SignVote(policyA.ChainID, prevote); err != nil {
		t.Fatal(err)
	}
	prevoteA, err := NewVoteRequestV2(policyA.GenesisID, policyA.ChainID, prevote)
	if err != nil {
		t.Fatal(err)
	}
	prevoteB, err := NewVoteRequestV2(policyB.GenesisID, policyB.ChainID, prevote)
	if err != nil {
		t.Fatal(err)
	}
	assertDomains(prevoteA, prevoteB, prevote.Signature)
	vote := fixtureVote(100) // Trusted params require a signature even for empty extension.
	if err := adapter.SignVote(policyA.ChainID, vote); err != nil {
		t.Fatal(err)
	}
	ordinaryA, err := NewVoteRequestV2(policyA.GenesisID, policyA.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	ordinaryB, err := NewVoteRequestV2(policyB.GenesisID, policyB.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	extensionA, err := NewVoteExtensionRequestV2(policyA.GenesisID, policyA.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	extensionB, err := NewVoteExtensionRequestV2(policyB.GenesisID, policyB.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	assertDomains(ordinaryA, ordinaryB, vote.Signature)
	assertDomains(extensionA, extensionB, vote.ExtensionSignature)
	if len(vote.ExtensionSignature) != EnvelopeSize {
		t.Fatal("empty enabled extension was not durably signed")
	}
	blockID, err := cmttypes.BlockIDFromProto(&vote.BlockID)
	if err != nil {
		t.Fatal(err)
	}
	vals := &cmttypes.ValidatorSet{Validators: []*cmttypes.Validator{{Address: bytes.Clone(vote.ValidatorAddress), VotingPower: 1}}}
	commit := &cmttypes.Commit{Height: vote.Height, Round: vote.Round, BlockID: *blockID, Signatures: []cmttypes.CommitSig{{BlockIDFlag: cmttypes.BlockIDFlagCommit, ValidatorAddress: bytes.Clone(vote.ValidatorAddress), Timestamp: vote.Timestamp, Signature: bytes.Clone(vote.Signature)}}}
	if err := verifierA.VerifyCommit(vals, *blockID, 100, commit); err != nil {
		t.Fatal("same genesis commit rejected:", err)
	}
	if err := verifierB.VerifyCommit(vals, *blockID, 100, commit); err == nil {
		t.Fatal("commit verification reused A signature under B genesis")
	}
	original := cloneObjectVoteForTest(vote)
	if err := signer.Close(); err != nil {
		t.Fatal(err)
	}
	signer, err = ResumeSigner(path, key, registryA)
	if err != nil {
		t.Fatal(err)
	}
	adapter = objectAdapterForTest(t, signer, source)
	retry := fixtureVote(100)
	if err := adapter.SignVote(policyA.ChainID, retry); err != nil || !reflect.DeepEqual(retry, original) {
		t.Fatal("cold v2 retry lost original ordinary/extension signatures", err)
	}
	conflict := fixtureVote(100)
	conflict.BlockID.Hash[0] ^= 1
	if err := adapter.SignVote(policyA.ChainID, conflict); err == nil || len(conflict.Signature) != 0 || len(conflict.ExtensionSignature) != 0 {
		t.Fatal("cold v2 conflict emitted partial signatures")
	}
	// A different trusted source view cannot rebind an open adapter or its disk.
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	source.state.GenesisID = bytes.Clone(policyB.GenesisID)
	foreign := fixtureVote(100)
	if err := adapter.SignVote(policyA.ChainID, foreign); err == nil || len(foreign.Signature) != 0 || len(foreign.ExtensionSignature) != 0 {
		t.Fatal("foreign object source mutated caller")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("foreign object source changed HRS history")
	}
}

func TestConsensusGenesisV2DuplicateEvidenceUsesSameAnchor(t *testing.T) {
	f := newEvidenceFixture(t, cmtproto.PrecommitType, false)
	if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, f.source); err != nil {
		t.Fatal(err)
	}
	policyB := f.policy
	policyB.GenesisID = bytes.Repeat([]byte{0x82}, 32)
	registryB := &evidenceTestRegistry{anchor: RegistryAnchor{GenesisID: bytes.Clone(policyB.GenesisID), ChainID: policyB.ChainID}, records: append([]KeyRecord(nil), f.registry.records...)}
	verifierB, err := NewCIRCLVerifier(policyB, registryB, nil)
	if err != nil {
		t.Fatal(err)
	}
	stateB := copyEvidenceState(f.source.state)
	stateB.GenesisID = bytes.Clone(policyB.GenesisID)
	if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, &evidenceTestSource{state: stateB}); err == nil {
		t.Fatal("evidence accepted wrong source anchor")
	}
	if err := verifierB.VerifyDuplicateVoteEvidence(f.evidence, &evidenceTestSource{state: stateB}); err == nil {
		t.Fatal("complete A evidence signatures reused on legitimate B registry/state")
	}
}

func TestConsensusGenesisV2RejectsOldOrReboundStateWithoutWrite(t *testing.T) {
	key, registry, policy := realKeyFixture(t)
	path := filepath.Join(t.TempDir(), "state.json")
	signer, err := CreateSigner(path, key, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	signature, err := signer.Sign(fixtureRequest(t, 100))
	if err != nil {
		t.Fatal(err)
	}
	good := signer.state
	if err := signer.Close(); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*signerState){
		"v1 file": func(s *signerState) {
			s.Version = "YNX-CONSENSUS-SIGNER/v1"
			s.Policy.Version = Version
			s.Policy.GenesisID = nil
		},
		"v1 policy":                    func(s *signerState) { s.Policy.Version = Version },
		"missing genesis":              func(s *signerState) { s.Policy.GenesisID = nil },
		"policy differs from registry": func(s *signerState) { s.Policy.GenesisID = bytes.Repeat([]byte{0x82}, 32) },
		"message differs from policy":  func(s *signerState) { s.Message = bytes.Clone(s.Message); s.Message[len(messageTag)+20] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			st := good
			st.Policy.GenesisID = bytes.Clone(good.Policy.GenesisID)
			change(&st)
			before, err := json.Marshal(st)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, before, 0600); err != nil {
				t.Fatal(err)
			}
			resumed, resumeErr := ResumeSigner(path, key, registry)
			if resumed != nil {
				_ = resumed.Close()
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected old/rebound state was rewritten")
			}
			if resumeErr == nil {
				t.Fatal("old/rebound anti-equivocation state was accepted")
			}
			// Create must not overwrite it either; recovery cannot reset existing HRS.
			created, createErr := CreateSigner(path, key, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
			if created != nil {
				_ = created.Close()
			}
			if createErr == nil {
				t.Fatal("Create reset existing old/rebound state")
			}
			after, err = os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("failed Create changed original state")
			}
		})
	}
	// The original v2 bytes remain resumable with the same signature and HRS.
	if err := writeSignerState(path, good, false); err != nil {
		t.Fatal(err)
	}
	resumed, err := ResumeSigner(path, key, registry)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.Close()
	replay, err := resumed.Sign(fixtureRequest(t, 100))
	if err != nil || !bytes.Equal(signature, replay) {
		t.Fatal("valid v2 cold retry changed signature", err)
	}
}

func TestConsensusGenesisV2UnknownCannotChangeAnchorOrLoseFence(t *testing.T) {
	key, registryA, policy := realKeyFixture(t)
	registryB := &registryFixture{record: registryA.record, anchor: RegistryAnchor{GenesisID: bytes.Repeat([]byte{0x82}, 32), ChainID: policy.ChainID}}
	for _, stage := range []string{"reservation", "signature"} {
		t.Run(stage, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.json")
			signer, err := CreateSigner(path, key, policy, registryA, registryA.record.ValidatorAddress, registryA.record.Epoch)
			if err != nil {
				t.Fatal(err)
			}
			writes := 0
			signer.write = func(p string, st signerState, create bool) error {
				writes++
				if err := writeSignerState(p, st, create); err != nil {
					return err
				}
				if stage == "reservation" || writes == 2 {
					return ErrSignerDurabilityUncertain
				}
				return nil
			}
			request := fixtureRequest(t, 100)
			if signature, err := signer.Sign(request); !errors.Is(err, ErrSignerDurabilityUncertain) || len(signature) != 0 || !signer.uncertain {
				t.Fatal("UNKNOWN emitted signature or lost fence", err)
			}
			savedSignature := bytes.Clone(signer.state.Signature)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			foreign, err := NewVoteRequestV2(registryB.anchor.GenesisID, policy.ChainID, fixtureVote(100))
			if err != nil {
				t.Fatal(err)
			}
			priorWrites := writes
			if signature, err := signer.Sign(foreign); err == nil || len(signature) != 0 || writes != priorWrites || !signer.uncertain {
				t.Fatal("foreign request reconfirmed or bypassed UNKNOWN")
			}
			if err := signer.Close(); err != nil {
				t.Fatal(err)
			}
			coldB, resumeErr := ResumeSigner(path, key, registryB)
			if coldB != nil {
				_ = coldB.Close()
			}
			after, err := os.ReadFile(path)
			if resumeErr == nil || err != nil || !bytes.Equal(before, after) {
				t.Fatal("foreign cold resume overwrote UNKNOWN HRS")
			}
			coldA, err := ResumeSigner(path, key, registryA)
			if err != nil {
				t.Fatal(err)
			}
			defer coldA.Close()
			conflict := fixtureRequest(t, 100)
			conflict.canonical[0] ^= 1
			if signature, err := coldA.Sign(conflict); err == nil || len(signature) != 0 {
				t.Fatal("UNKNOWN cold recovery forgot reserved full message")
			}
			signature, err := coldA.Sign(request)
			if err != nil {
				t.Fatal(err)
			}
			if len(savedSignature) != 0 && !bytes.Equal(savedSignature, signature) {
				t.Fatal("reconciled UNKNOWN signature changed")
			}
			verify, err := NewCIRCLVerifier(policy, registryA, nil)
			if err != nil || verify.Verify(request, signature) != nil {
				t.Fatal("same genesis UNKNOWN recovery failed real dual verification", err)
			}
		})
	}
}
