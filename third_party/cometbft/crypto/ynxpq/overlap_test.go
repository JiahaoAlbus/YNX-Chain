package ynxpq_test

import (
	"bytes"
	"encoding/binary"
	"errors"
	"testing"
	"time"

	"github.com/cometbft/cometbft/crypto/ynxpq"
	"github.com/cometbft/cometbft/light"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmtversion "github.com/cometbft/cometbft/proto/tendermint/version"
	"github.com/cometbft/cometbft/types"
	"github.com/cometbft/cometbft/version"
)

func TestRealPQStableAddressRotationDoesNotCountOldTrustedKey(t *testing.T) {
	old, next := newFixture(t), newFixture(t)
	var parts [][]byte
	for rest := next.wire; len(rest) > 0; {
		n := int(binary.BigEndian.Uint32(rest))
		rest = rest[4:]
		parts = append(parts, bytes.Clone(rest[:n]))
		rest = rest[n:]
	}
	parts[4] = old.key.Address()
	parts[6] = u32(8)
	parts[8] = u32(11)
	next.wire = fields(parts...)
	decoded, err := ynxpq.DecodePubKey(next.wire)
	if err != nil {
		t.Fatal(err)
	}
	next.key = decoded.WithAuthorizer(ynxpq.AuthorizerFunc(func(binding []byte, h int64, r int32, k ynxpq.Kind) error {
		if !bytes.Equal(binding, next.wire) || h < 11 || h >= 20 || r < 0 || k != ynxpq.Precommit {
			return errors.New("outside rotated fixture history")
		}
		return nil
	}))
	old.key = old.key.WithAuthorizer(ynxpq.AuthorizerFunc(func(binding []byte, h int64, r int32, k ynxpq.Kind) error {
		if !bytes.Equal(binding, old.wire) || h != 10 || r < 0 || k != ynxpq.Precommit {
			return errors.New("retired key at new height")
		}
		return nil
	}))
	oldSet := types.NewValidatorSet([]*types.Validator{types.NewValidator(old.key, 10)})
	nextSet := types.NewValidatorSet([]*types.Validator{types.NewValidator(next.key, 10)})
	now := time.Date(2026, 10, 18, 1, 2, 30, 0, time.UTC)
	trusted := &types.SignedHeader{Header: &types.Header{Height: 10, ChainID: "ynx-engine-test", Time: now.Add(-20 * time.Second), NextValidatorsHash: nextSet.Hash()}}
	makeHeader := func(height int64) *types.SignedHeader {
		header := &types.Header{Version: cmtversion.Consensus{Block: version.BlockProtocol}, ChainID: "ynx-engine-test", Height: height, Time: now.Add(time.Duration(height-20) * time.Second), ValidatorsHash: nextSet.Hash(), NextValidatorsHash: nextSet.Hash(), ProposerAddress: next.key.Address()}
		id := types.BlockID{Hash: header.Hash(), PartSetHeader: types.PartSetHeader{Total: 1, Hash: bytes.Repeat([]byte{71}, 32)}}
		vote := &types.Vote{Type: cmtproto.PrecommitType, Height: height, Round: 0, BlockID: id, Timestamp: header.Time, ValidatorAddress: next.key.Address(), ValidatorIndex: 0}
		message, err := next.key.OrdinarySigningBytes(types.VoteSignBytes("ynx-engine-test", vote.ToProto()))
		if err != nil {
			t.Fatal(err)
		}
		vote.Signature = next.sign(t, message)
		binary.BigEndian.PutUint64(vote.Signature[len("YNX-CONSENSUS-SIG/v0.2\x00")+4:], 8)
		if err := vote.Verify("ynx-engine-test", next.key); err != nil {
			t.Fatal("actual rotated dual signature", err)
		}
		return &types.SignedHeader{Header: header, Commit: &types.Commit{Height: height, Round: 0, BlockID: id, Signatures: []types.CommitSig{vote.CommitSig()}}}
	}
	adjacent := makeHeader(11)
	if err := light.VerifyAdjacent(trusted, adjacent, nextSet, time.Hour, now, time.Second); err != nil {
		t.Fatal("adjacent trusted NextValidatorsHash must authorize real new key", err)
	}
	jump := makeHeader(12)
	before := bytes.Clone(jump.Commit.Signatures[0].Signature)
	err = light.VerifyNonAdjacent(trusted, oldSet, jump, nextSet, time.Hour, now, time.Second, light.DefaultTrustLevel)
	var insufficient light.ErrNewValSetCantBeTrusted
	if !errors.As(err, &insufficient) {
		t.Fatal("rotation must require normal bisection, not old-address trust or fatal signature mismatch", err)
	}
	if !bytes.Equal(before, jump.Commit.Signatures[0].Signature) || jump.Commit.Signatures[0].BlockIDFlag != types.BlockIDFlagCommit {
		t.Fatal("overlap filtering mutated the genuine current commit")
	}
	if err := nextSet.VerifyCommitLight("ynx-engine-test", jump.Commit.BlockID, 12, jump.Commit); err != nil {
		t.Fatal(err)
	}
	if err := oldSet.VerifyCommitLight("ynx-engine-test", jump.Commit.BlockID, 12, jump.Commit); err == nil {
		t.Fatal("retired full key accepted new epoch")
	}
}
