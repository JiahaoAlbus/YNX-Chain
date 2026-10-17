//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// No private key or old state is copied: alias.json is a symlink to the exact
// currently locked state. Resume must not read it under a different .lock and
// then replace the symlink with a forked signing history during checkpointing.
func TestSignerStateSymlinkCannotForkLiveHistory(t *testing.T) {
	key, registry, policy := realKeyFixture(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	aliasPath := filepath.Join(dir, "alias.json")
	signer, err := CreateSigner(path, key, policy, registry, registry.record.ValidatorAddress, registry.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer signer.Close()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(path, aliasPath); err != nil {
		t.Fatal(err)
	}
	alias, resumeErr := ResumeSigner(aliasPath, key, registry)
	if resumeErr != nil {
		info, err := os.Lstat(aliasPath)
		if err != nil || info.Mode()&os.ModeSymlink == 0 {
			t.Fatal("rejected alias resume still replaced the original symlink")
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("rejected alias resume modified the live original state")
		}
		if _, err := signer.Sign(fixtureRequest(t, 100)); err != nil {
			t.Fatal("rejecting the alias disabled the legitimate live signer")
		}
		return
	}
	defer alias.Close()
	// Exercise both real signatures before reporting RED, rather than stopping
	// at the fact that a second handle opened successfully.
	voteA, voteB := fixtureVote(100), fixtureVote(100)
	voteB.BlockID.Hash[0] ^= 1
	requestA, err := NewVoteRequest(policy.ChainID, voteA)
	if err != nil {
		t.Fatal(err)
	}
	requestB, err := NewVoteRequest(policy.ChainID, voteB)
	if err != nil {
		t.Fatal(err)
	}
	signatureA, err := signer.Sign(requestA)
	if err != nil {
		t.Fatal("original signer failed to sign its first precommit")
	}
	signatureB, err := alias.Sign(requestB)
	if err != nil {
		t.Fatal("symlink resume opened a second live handle instead of rejecting the alias")
	}
	verifier, err := NewCIRCLVerifier(policy, registry, nil)
	if err != nil {
		t.Fatal(err)
	}
	if verifier.Verify(requestA, signatureA) != nil || verifier.Verify(requestB, signatureB) != nil {
		t.Fatal("alias produced invalid signatures instead of the expected real dual-signature counterexample")
	}
	t.Fatal("symlink alias forked one live history and emitted two valid conflicting precommits at the same height and round")
}
