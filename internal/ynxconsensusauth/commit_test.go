//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"errors"
	"path/filepath"
	"testing"

	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type commitRegistry map[string]KeyRecord

func (r commitRegistry) ConsensusKeysAt(chainID string, address []byte, height int64) (KeyRecord, error) {
	record, ok := r[string(address)]
	if !ok || record.ChainID != chainID {
		return KeyRecord{}, errors.New("unregistered validator")
	}
	return record, nil
}

type historicalCommitKeys struct {
	chainID string
	keys    map[string]ed25519.PubKey
}

func (h historicalCommitKeys) VerifyHistorical(chainID string, address []byte, height int64, kind Kind, message, signature []byte) error {
	key, ok := h.keys[string(address)]
	if !ok || chainID != h.chainID || height != 99 || kind != Precommit || !key.VerifySignature(message, signature) {
		return errors.New("historical signature rejected")
	}
	return nil
}

func TestCommitHistoricalSignaturesDoNotAuthorizeActivePQHeight(t *testing.T) {
	policy := Policy{Version: Version, ChainID: "ynx-research-only", ActivationHeight: 100}
	history := historicalCommitKeys{chainID: policy.ChainID, keys: map[string]ed25519.PubKey{}}
	blockID, err := cmttypes.BlockIDFromProto(&fixtureVote(99).BlockID)
	if err != nil {
		t.Fatal(err)
	}
	commit := &cmttypes.Commit{Height: 99, Round: 0, BlockID: *blockID}
	vals := &cmttypes.ValidatorSet{}
	for i := 0; i < 2; i++ {
		key := ed25519.GenPrivKey()
		public := key.PubKey().(ed25519.PubKey)
		history.keys[string(public.Address())] = public
		vals.Validators = append(vals.Validators, &cmttypes.Validator{Address: public.Address(), PubKey: public, VotingPower: 1})
		commit.Signatures = append(commit.Signatures, cmttypes.CommitSig{BlockIDFlag: cmttypes.BlockIDFlagCommit, ValidatorAddress: public.Address(), Timestamp: fixtureVote(99).Timestamp})
		signature, err := key.Sign(commit.VoteSignBytes(policy.ChainID, int32(i)))
		if err != nil {
			t.Fatal(err)
		}
		commit.Signatures[i].Signature = signature
	}
	verifier, err := NewCIRCLVerifier(policy, nil, history)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifier.VerifyCommit(vals, *blockID, 99, commit); err != nil {
		t.Fatal("historical Ed25519 commit lost historical rules:", err)
	}
	commit.Signatures[0].Signature[0] ^= 1
	if err := verifier.VerifyCommit(vals, *blockID, 99, commit); err == nil {
		t.Fatal("corrupted historical signature accepted")
	}
	commit.Signatures[0].Signature[0] ^= 1
	wrongChain := policy
	wrongChain.ChainID = "another-chain"
	other, err := NewCIRCLVerifier(wrongChain, nil, history)
	if err != nil {
		t.Fatal(err)
	}
	if err := other.VerifyCommit(vals, *blockID, 99, commit); err == nil {
		t.Fatal("historical signature crossed chain boundary")
	}
	commit.Height = 100
	if err := verifier.VerifyCommit(vals, *blockID, 100, commit); err == nil {
		t.Fatal("active PQ height fell back to historical classic authority")
	}
}

func TestRealPQCommitChecksAllSignaturesAndStrictWeightedQuorum(t *testing.T) {
	policy := Policy{Version: Version, ChainID: "ynx-research-only", ActivationHeight: 100}
	registry := commitRegistry{}
	vals := &cmttypes.ValidatorSet{}
	blockID, err := cmttypes.BlockIDFromProto(&fixtureVote(100).BlockID)
	if err != nil {
		t.Fatal(err)
	}
	commit := &cmttypes.Commit{Height: 100, Round: 0, BlockID: *blockID}
	for i := 0; i < 4; i++ {
		key, a, b, err := GenerateCandidateKey()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(key.Destroy)
		address := bytes.Repeat([]byte{byte(i + 1)}, 20)
		registry[string(address)] = KeyRecord{Version: Version, ChainID: policy.ChainID, ValidatorAddress: address, Epoch: 1, ValidFromHeight: 100, MLDSA87PublicKey: a, SLHDSASHA2256fPublicKey: b}
		// These are trusted original identities and power. The registered PQ
		// pair is resolved separately; no synthetic Ed25519 key is introduced.
		vals.Validators = append(vals.Validators, &cmttypes.Validator{Address: address, VotingPower: 1})
		vote := fixtureVote(100)
		vote.ValidatorAddress, vote.ValidatorIndex = address, int32(i)
		flag := cmttypes.BlockIDFlagCommit
		if i == 3 {
			vote.BlockID, flag = cmtproto.BlockID{}, cmttypes.BlockIDFlagNil
		}
		request, err := NewVoteRequest(policy.ChainID, vote)
		if err != nil {
			t.Fatal(err)
		}
		signer, err := CreateSigner(filepath.Join(t.TempDir(), "state.json"), key, policy, registry, address, 1)
		if err != nil {
			t.Fatal(err)
		}
		signature, err := signer.Sign(request)
		if closeErr := signer.Close(); err != nil || closeErr != nil {
			t.Fatalf("durable signing: %v / %v", err, closeErr)
		}
		commit.Signatures = append(commit.Signatures, cmttypes.CommitSig{BlockIDFlag: flag, ValidatorAddress: address, Timestamp: vote.Timestamp, Signature: signature})
	}
	verifier, err := NewCIRCLVerifier(policy, registry, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifier.VerifyCommit(vals, *blockID, 100, commit); err != nil {
		t.Fatal(err)
	}
	clone := func() *cmttypes.Commit {
		c := commit.Clone()
		for i := range c.Signatures {
			c.Signatures[i].Signature = bytes.Clone(c.Signatures[i].Signature)
			c.Signatures[i].ValidatorAddress = bytes.Clone(c.Signatures[i].ValidatorAddress)
		}
		return c
	}
	absent := clone()
	absent.Signatures[3] = cmttypes.CommitSig{BlockIDFlag: cmttypes.BlockIDFlagAbsent}
	if err := verifier.VerifyCommit(vals, *blockID, 100, absent); err != nil {
		t.Fatal("valid three-of-four commit with absent voter rejected:", err)
	}
	for _, test := range []struct {
		name string
		edit func(*cmttypes.Commit)
	}{
		{"invalid-nil-signature-after-quorum", func(c *cmttypes.Commit) { c.Signatures[3].Signature[len(c.Signatures[3].Signature)-1] ^= 1 }},
		{"wrong-index", func(c *cmttypes.Commit) { c.Signatures[0], c.Signatures[1] = c.Signatures[1], c.Signatures[0] }},
		{"wrong-height", func(c *cmttypes.Commit) { c.Height++ }},
		{"changed-round", func(c *cmttypes.Commit) { c.Round++ }},
		{"nil-vote-counted-as-commit", func(c *cmttypes.Commit) { c.Signatures[3].BlockIDFlag = cmttypes.BlockIDFlagCommit }},
		{"absent-hides-signature", func(c *cmttypes.Commit) { c.Signatures[0].BlockIDFlag = cmttypes.BlockIDFlagAbsent }},
		{"unknown-flag", func(c *cmttypes.Commit) { c.Signatures[0].BlockIDFlag = 99 }},
		{"truncated-set", func(c *cmttypes.Commit) { c.Signatures = c.Signatures[:3] }},
	} {
		t.Run(test.name, func(t *testing.T) {
			c := clone()
			test.edit(c)
			if err := verifier.VerifyCommit(vals, *blockID, 100, c); err == nil {
				t.Fatal("invalid commit accepted")
			}
		})
	}
	weighted := &cmttypes.ValidatorSet{Validators: append([]*cmttypes.Validator(nil), vals.Validators...)}
	largeNil := *weighted.Validators[3]
	largeNil.VotingPower = 100
	weighted.Validators[3] = &largeNil
	if err := verifier.VerifyCommit(weighted, *blockID, 100, commit); err == nil {
		t.Fatal("signature count substituted for voting power")
	}
	exactTwoThirds := clone()
	exactTwoThirds.Signatures = exactTwoThirds.Signatures[:3]
	exactTwoThirds.Signatures[2] = cmttypes.CommitSig{BlockIDFlag: cmttypes.BlockIDFlagAbsent}
	three := &cmttypes.ValidatorSet{Validators: vals.Validators[:3]}
	if err := verifier.VerifyCommit(three, *blockID, 100, exactTwoThirds); err == nil {
		t.Fatal("exactly two thirds accepted as a quorum")
	}
	duplicate := &cmttypes.ValidatorSet{Validators: append([]*cmttypes.Validator(nil), vals.Validators...)}
	duplicate.Validators[3] = duplicate.Validators[0]
	if err := verifier.VerifyCommit(duplicate, *blockID, 100, commit); err == nil {
		t.Fatal("duplicate validator authority accepted")
	}
	for _, powers := range [][]int64{{0, 1, 1, 1}, {-1, 1, 1, 1}, {cmttypes.MaxTotalVotingPower, 1, 1, 1}} {
		badPower := &cmttypes.ValidatorSet{}
		for i, validator := range vals.Validators {
			copy := *validator
			copy.VotingPower = powers[i]
			badPower.Validators = append(badPower.Validators, &copy)
		}
		if err := verifier.VerifyCommit(badPower, *blockID, 100, commit); err == nil {
			t.Fatal("invalid or overflowing voting power accepted")
		}
	}
}
