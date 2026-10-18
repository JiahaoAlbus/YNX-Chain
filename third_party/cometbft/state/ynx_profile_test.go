package state

import (
	"bytes"
	"strings"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
)

func TestYNXProfileActualStateUpdateHeaderAndHistoricalStore(t *testing.T) {
	legacy := ed25519.GenPrivKeyFromSecret([]byte("public-profile-state-qa-only"))
	genesis := &types.GenesisDoc{ChainID: "ynx-profile-state-qa", InitialHeight: 10, GenesisTime: time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC), ConsensusParams: types.DefaultConsensusParams(), Validators: []types.GenesisValidator{{PubKey: legacy.PubKey(), Power: 10}}}
	old, err := MakeGenesisState(genesis)
	if err != nil {
		t.Fatal(err)
	}
	oldHash := old.ConsensusParams.Hash()
	block, err := old.MakeBlock(10, nil, &types.Commit{}, nil, legacy.PubKey().Address())
	if err != nil {
		t.Fatal(err)
	}
	if err := validateBlock(old, block); err != nil {
		t.Fatal("real old-height block rejected:", err)
	}
	parts, err := block.MakePartSet(types.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := types.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
	profile := ynxpq.ConsensusProfile{GenesisID: bytes.Repeat([]byte{1}, 32), ChainID: genesis.ChainID, ParamsUpdateHeight: 10, ActivationHeight: 13, ScheduleHash: bytes.Repeat([]byte{2}, 32), RegistryRoot: bytes.Repeat([]byte{3}, 32)}
	wire, err := profile.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	response := &abci.ResponseFinalizeBlock{ConsensusParamUpdates: &cmtproto.ConsensusParams{YnxProfile: wire, Validator: &cmtproto.ValidatorParams{PubKeyTypes: []string{ed25519.KeyType, ynxpq.KeyType}}}}
	next, err := updateState(old, id, &block.Header, response, nil)
	if err != nil {
		t.Fatal(err)
	}
	if next.LastHeightConsensusParamsChanged != 11 || bytes.Equal(next.ConsensusParams.Hash(), oldHash) || !bytes.Equal(block.ConsensusHash, oldHash) || len(old.ConsensusParams.YNXProfile) != 0 {
		t.Fatal("profile did not become effective exactly at H+1 without changing H")
	}
	vote := &types.Vote{Type: cmtproto.PrecommitType, Height: 10, Round: 0, BlockID: id, Timestamp: block.Time.Add(time.Second), ValidatorAddress: legacy.PubKey().Address(), ValidatorIndex: 0}
	vote.Signature, err = legacy.Sign(types.VoteSignBytes(genesis.ChainID, vote.ToProto()))
	if err != nil {
		t.Fatal(err)
	}
	commit := &types.Commit{Height: 10, Round: 0, BlockID: id, Signatures: []types.CommitSig{vote.CommitSig()}}
	nextBlock, err := next.MakeBlock(11, nil, commit, nil, legacy.PubKey().Address())
	if err != nil {
		t.Fatal(err)
	}
	if err := validateBlock(next, nextBlock); err != nil {
		t.Fatal("new profile header and real historical Ed commit rejected:", err)
	}
	nextBlock.ConsensusHash = bytes.Clone(oldHash)
	if err := validateBlock(next, nextBlock); err == nil || !strings.Contains(err.Error(), "ConsensusHash") {
		t.Fatal("actual block validation ignored profile commitment:", err)
	}
	db := dbm.NewMemDB()
	defer db.Close()
	store := NewStore(db, StoreOptions{})
	if err := store.Save(old); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(next); err != nil {
		t.Fatal(err)
	}
	restored, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored.ConsensusParams.Hash(), next.ConsensusParams.Hash()) {
		t.Fatal("actual state store lost profile on reload")
	}
	past, err := store.LoadConsensusParams(10)
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.LoadConsensusParams(11)
	if err != nil {
		t.Fatal(err)
	}
	if len(past.YNXProfile) != 0 || !bytes.Equal(past.Hash(), oldHash) || !bytes.Equal(current.YNXProfile, wire) {
		t.Fatal("historical params were overwritten by profile")
	}
	profile.ChainID = "another-qa-chain"
	foreign, _ := profile.MarshalBinary()
	response.ConsensusParamUpdates.YnxProfile = foreign
	if _, err := updateState(old, id, &block.Header, response, nil); err == nil {
		t.Fatal("actual state admitted another chain profile")
	}
	profile.ChainID = genesis.ChainID
	profile.ParamsUpdateHeight = 9
	wrongHeight, _ := profile.MarshalBinary()
	response.ConsensusParamUpdates.YnxProfile = wrongHeight
	if _, err := updateState(old, id, &block.Header, response, nil); err == nil {
		t.Fatal("actual state admitted profile at wrong Finalize height")
	}
}
