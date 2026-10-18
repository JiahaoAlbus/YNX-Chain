//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// The original v1 source and actual Run12 RED evidence are preserved in testdata.
// V2 requires explicit genesis in setup; both original rejection assertions and
// same-genesis/cold exact retry/HRS controls remain. Both registries deliberately
// authorize the identical complete pair, logical address and epoch.
func TestConsensusGenesisBoundaryReplayRejected(t *testing.T) {
	f := newRegistrationFixture(t)
	anchorA := f.anchor
	anchorB := RegistryAnchor{GenesisID: bytes.Repeat([]byte{0xb8}, 32), ChainID: anchorA.ChainID}
	historyA, err := NewKeyHistory(anchorA)
	if err != nil {
		t.Fatal(err)
	}
	historyB, err := NewKeyHistory(anchorB)
	if err != nil {
		t.Fatal(err)
	}
	intentA := f.first()
	intentB := f.first()
	intentB.GenesisID = bytes.Clone(anchorB.GenesisID)
	operationA := f.sign(t, intentA, 0, 0)
	operationB := f.sign(t, intentB, 0, 0)
	sourceB := &registrationStateFixture{anchor: anchorB, address: bytes.Clone(f.address), legacy: bytes.Clone(f.source.legacy)}
	historyA = mustAppendRegistration(t, historyA, operationA, f.source)
	historyB = mustAppendRegistration(t, historyB, operationB, sourceB)
	if historyA.Root() == historyB.Root() || bytes.Equal(historyA.Anchor().GenesisID, historyB.Anchor().GenesisID) {
		t.Fatal("counterexample did not create two distinct authenticated genesis histories")
	}
	recordA, err := historyA.ConsensusKeysAt(anchorA.ChainID, f.address, 12)
	if err != nil {
		t.Fatal(err)
	}
	recordB, err := historyB.ConsensusKeysAt(anchorB.ChainID, f.address, 12)
	if err != nil {
		t.Fatal(err)
	}
	if recordA.Epoch != recordB.Epoch || !bytes.Equal(recordA.ValidatorAddress, recordB.ValidatorAddress) || !bytes.Equal(recordA.MLDSA87PublicKey, recordB.MLDSA87PublicKey) || !bytes.Equal(recordA.SLHDSASHA2256fPublicKey, recordB.SLHDSASHA2256fPublicKey) {
		t.Fatal("counterexample must hold address, epoch and both keys constant")
	}
	bindingA, err := historyA.PublicKeyBindingAt(anchorA.ChainID, f.address, 12)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := historyB.AuthenticatePublicKeyBinding(bindingA, 12); err == nil {
		t.Fatal("registration identity boundary must reject before testing ordinary consensus messages")
	}
	policy := Policy{Version: ConsensusGenesisVersion, GenesisID: bytes.Clone(anchorA.GenesisID), ChainID: anchorA.ChainID, ActivationHeight: 12}
	vote := fixtureVote(12)
	vote.ValidatorAddress = bytes.Clone(f.address)
	request, err := NewVoteRequestV2(anchorA.GenesisID, anchorA.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "consensus-genesis-A.json")
	signer, err := CreateSigner(path, f.keys[0], policy, historyA, f.address, 1)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = signer.Close() })
	signature, err := signer.Sign(request)
	if err != nil {
		t.Fatal(err)
	}
	verifierA, err := NewCIRCLVerifier(policy, historyA, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifierA.Verify(request, signature); err != nil {
		t.Fatalf("same-genesis positive control: %v", err)
	}
	if err := signer.Close(); err != nil {
		t.Fatal(err)
	}
	coldA, err := ResumeSigner(path, f.keys[0], historyA)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = coldA.Close() })
	replay, err := coldA.Sign(request)
	if err != nil || !bytes.Equal(replay, signature) {
		t.Fatal("same-genesis cold exact retry lost original signature")
	}
	conflictingVote := fixtureVote(12)
	conflictingVote.ValidatorAddress = bytes.Clone(f.address)
	conflictingVote.BlockID.Hash[0] ^= 1
	conflict, err := NewVoteRequestV2(anchorA.GenesisID, anchorA.ChainID, conflictingVote)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := coldA.Sign(conflict); err == nil {
		t.Fatal("same-genesis cold HRS equivocation control did not reject")
	}
	if err := coldA.Close(); err != nil {
		t.Fatal(err)
	}

	t.Run("ordinary_vote_signature_is_bound_to_genesis", func(t *testing.T) {
		policyB := policy
		policyB.GenesisID = bytes.Clone(anchorB.GenesisID)
		verifierB, err := NewCIRCLVerifier(policyB, historyB, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := verifierB.Verify(request, signature); err == nil {
			t.Fatal("genesis A vote signature replayed on genesis B with the same chain ID, logical address, H/R/step, epoch and complete key pair")
		}
		requestB, err := NewVoteRequestV2(anchorB.GenesisID, anchorB.ChainID, vote)
		if err != nil {
			t.Fatal(err)
		}
		if err := verifierB.Verify(requestB, signature); err == nil {
			t.Fatal("genesis A signature verified over reconstructed genesis B full message")
		}
	})
	t.Run("cold_signer_state_cannot_be_rebound_to_genesis", func(t *testing.T) {
		before, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		coldB, resumeErr := ResumeSigner(path, f.keys[0], historyB)
		if coldB != nil {
			_ = coldB.Close()
		}
		after, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before, after) {
			t.Fatal("wrong-genesis resume changed original anti-equivocation file")
		}
		if resumeErr == nil {
			t.Fatal("genesis A durable HRS state resumed against genesis B registry")
		}
	})
}
