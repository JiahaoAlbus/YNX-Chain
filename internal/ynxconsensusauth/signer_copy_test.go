//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"path/filepath"
	"reflect"
	"testing"
)

// This is the same whole-value copy as copied := *original, before the first
// Sign call. Reflection keeps the runtime regression executable on the broken
// implementation even when go vet rejects its embedded mutex's value copy.
// It does not inspect or modify any private field or private-key material.
func copySignerHandleForRegression(original *Signer) *Signer {
	copied := new(Signer)
	reflect.ValueOf(copied).Elem().Set(reflect.ValueOf(original).Elem())
	return copied
}

func TestSignerCopiedHandleCannotEquivocate(t *testing.T) {
	key, registry, policy := realKeyFixture(t)
	signer, err := CreateSigner(filepath.Join(t.TempDir(), "state.json"), key, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer signer.Close()
	copied := copySignerHandleForRegression(signer)
	defer copied.Close()
	voteA := fixtureVote(100)
	voteB := fixtureVote(100)
	voteB.BlockID.Hash[0] ^= 1
	requestA, err := NewVoteRequestV2(policy.GenesisID, policy.ChainID, voteA)
	if err != nil {
		t.Fatal(err)
	}
	requestB, err := NewVoteRequestV2(policy.GenesisID, policy.ChainID, voteB)
	if err != nil {
		t.Fatal(err)
	}
	first, err := signer.Sign(requestA)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := NewCIRCLVerifier(policy, registry, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifier.Verify(requestA, first); err != nil {
		t.Fatal("first real dual signature was invalid")
	}
	second, err := copied.Sign(requestB)
	if err == nil {
		if verifyErr := verifier.Verify(requestB, second); verifyErr != nil {
			t.Fatal("copied handle emitted a conflicting but invalid signature")
		}
		t.Fatal("copied signer emitted two valid conflicting precommits at the same height and round")
	}
	if len(second) != 0 {
		t.Fatal("rejected conflicting request emitted signature bytes")
	}
	again, err := copied.Sign(requestA)
	if err != nil || !bytes.Equal(first, again) {
		t.Fatal("copied handle did not share the durable exact-replay signature")
	}
}

func TestSignerCopiedHandleCloseClosesOriginal(t *testing.T) {
	key, registry, policy := realKeyFixture(t)
	path := filepath.Join(t.TempDir(), "state.json")
	signer, err := CreateSigner(path, key, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer signer.Close()
	copied := copySignerHandleForRegression(signer)
	if err := copied.Close(); err != nil {
		t.Fatal(err)
	}
	// Resume proves that the copied handle actually released the OS lock. The
	// old original must now be closed; otherwise it can sign alongside resumed.
	resumed, err := ResumeSigner(path, key, registry)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.Close()
	request := fixtureRequest(t, 100)
	if signature, err := signer.Sign(request); err == nil || len(signature) != 0 {
		t.Fatal("original handle signed after a copied handle closed its shared OS lock")
	}
	if signature, err := copied.Sign(request); err == nil || len(signature) != 0 {
		t.Fatal("closed copied handle still signed")
	}
	if signature, err := resumed.Sign(request); err != nil || len(signature) == 0 {
		t.Fatal("legitimate resumed signer could not sign")
	}
}
