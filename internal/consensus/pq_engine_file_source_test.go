package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"os"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestPQEngineFileSourceBindsActualHeightHashAndIndependentPin(t *testing.T) {
	f, app, auth, schedule, path, _ := persistentEngineAuthorizationFixture(t)
	hash, _ := hex.DecodeString(app.committed.AppHash)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := LoadPQEngineSnapshot(f.migration, path, f.bootstrap, auth, app.committed.Height, hash)
	if err != nil || snapshot.through != app.committed.Height {
		t.Fatal("exact committed authority rejected", err)
	}
	source, err := NewPQEngineFileSource(f.migration, path, f.bootstrap, auth)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.CommittedPQEngineSnapshot(); err == nil {
		t.Fatal("file primed signer authority without an actual engine checkpoint")
	}
	prior, err := source.ConsensusAuthorityForState(f.bootstrap.record.ChainID, app.committed.Height, hash)
	if err != nil {
		t.Fatal(err)
	}
	if latest, err := source.CommittedPQEngineSnapshot(); err != nil || latest != prior {
		t.Fatal("signer did not use the engine authenticated checkpoint", err)
	}
	if _, err := app.ConsensusAuthorityForState(f.bootstrap.record.ChainID, app.committed.Height, hash); err != nil {
		t.Fatal("in-process app rejected its actual committed engine checkpoint", err)
	}
	if _, err := source.ConsensusAuthorityForState("foreign-chain", app.committed.Height, hash); err == nil {
		t.Fatal("file source accepted another engine chain")
	}
	for _, tc := range []struct {
		height int64
		hash   []byte
	}{
		{app.committed.Height - 1, hash}, {app.committed.Height + 1, hash},
		{app.committed.Height, bytes.Repeat([]byte{1}, 32)}, {app.committed.Height, nil},
	} {
		if _, err := LoadPQEngineSnapshot(f.migration, path, f.bootstrap, auth, tc.height, tc.hash); err == nil {
			t.Fatal("file authority accepted foreign height or AppHash")
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("read-only engine authority changed the ledger")
	}
	nextHash, err := snapshot.ExpectedValidatorHash(schedule.AuthorizedAt + 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: schedule.AuthorizedAt, NextValidatorsHash: nextHash}); err != nil {
		t.Fatal(err)
	}
	pendingHash, _ := hex.DecodeString(app.pending.AppHash)
	if _, err := app.ConsensusAuthorityForState(f.bootstrap.record.ChainID, app.pending.Height, pendingHash); err == nil {
		t.Fatal("pending Finalize became in-process engine authority")
	}
	if _, err := LoadPQEngineSnapshot(f.migration, path, f.bootstrap, auth, app.pending.Height, pendingHash); err == nil {
		t.Fatal("pending Finalize became file authority before Commit")
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPQEngineSnapshot(f.migration, path, f.bootstrap, nil, app.committed.Height, pendingHash); err == nil {
		t.Fatal("restored engine schedule authorized itself without independent pin")
	}
	if _, err := LoadPQEngineSnapshot(f.migration, path, f.bootstrap, auth, app.committed.Height, pendingHash); err != nil {
		t.Fatal("committed exact profile rejected", err)
	}
	if _, err := app.ConsensusAuthorityForState(f.bootstrap.record.ChainID, app.committed.Height, pendingHash); err != nil {
		t.Fatal("in-process authority did not advance after actual Commit", err)
	}
	if _, err := app.ConsensusAuthorityForState(f.bootstrap.record.ChainID, schedule.RegistryHeight, hash); err == nil {
		t.Fatal("current app fabricated a prior committed checkpoint")
	}
	if _, err := source.ConsensusAuthorityForState(f.bootstrap.record.ChainID, app.committed.Height, pendingHash); err != nil {
		t.Fatal("file source rejected actual next committed checkpoint", err)
	}
	retained, err := source.ConsensusAuthorityForState(f.bootstrap.record.ChainID, schedule.RegistryHeight, hash)
	if err != nil || retained != prior {
		t.Fatal("Commit invalidated the engine's prior authenticated checkpoint", err)
	}
	if _, err := source.ConsensusAuthorityForState(f.bootstrap.record.ChainID, schedule.RegistryHeight, pendingHash); err == nil {
		t.Fatal("source promoted a hash from another height")
	}
	if _, err := LoadPQEngineSnapshot(f.migration, path, f.bootstrap, auth, schedule.RegistryHeight, hash); err == nil {
		t.Fatal("new file fabricated old authority/AppHash")
	}
}
