package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestPQWalletIdentityOriginalPinsCurrentStateAndPendingIsolation(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	path := filepath.Join(t.TempDir(), "identity.json")
	a := newPinnedRegistryApp(t, f, path)
	read := func() PQWalletIdentityView {
		t.Helper()
		r, err := a.Query(context.Background(), &abci.RequestQuery{Path: PQWalletIdentityPath})
		if err != nil || r.Code != 0 {
			t.Fatalf("actual identity query: %+v %v", r, err)
		}
		var v PQWalletIdentityView
		if err = json.Unmarshal(r.Value, &v); err != nil {
			t.Fatal(err)
		}
		if err = ValidatePQWalletIdentityView(v, r.Height); err != nil {
			t.Fatal(err)
		}
		return v
	}
	before := read()
	if before.CometGenesisSHA256 != f.pins.CometGenesisSHA256 || before.NativeGenesisHash != f.pins.OriginalGenesisHash || before.MigrationStateHash != f.pins.MigrationStateHash || before.InitialHeight != f.doc.InitialHeight {
		t.Fatal("query substituted native/raw Comet genesis or migration identity")
	}
	committed := mustJSON(t, a.committed)
	h := a.committed.Height + 1
	if _, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash)}); err != nil {
		t.Fatal(err)
	}
	if read() != before || !bytes.Equal(committed, mustJSON(t, a.committed)) {
		t.Fatal("pending state or query changed identity checkpoint")
	}
	if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	after := read()
	if after.CurrentStateHeight != h || after.CurrentStateAppHash != a.committed.AppHash || after.CometGenesisSHA256 != before.CometGenesisSHA256 {
		t.Fatal("committed identity checkpoint did not advance faithfully")
	}
	cold, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	a = cold
	if read() != after {
		t.Fatal("cold identity lost original pins/current state")
	}
}

func TestPQWalletIdentityRefusesUnpinnedOrRelabeledState(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	a := newPinnedRegistryApp(t, f, "")
	for _, req := range []*abci.RequestQuery{{Path: PQWalletIdentityPath, Height: a.committed.Height + 1}, {Path: PQWalletIdentityPath, Height: -1}, {Path: PQWalletIdentityPath, Prove: true}, {Path: PQWalletIdentityPath, Data: []byte("peer bootstrap")}} {
		r, err := a.Query(context.Background(), req)
		if err != nil || r.Code == 0 || len(r.Value) != 0 {
			t.Fatal("identity query accepted unsupported proof, data or relabeled height", err)
		}
	}
	r := &abci.ResponseQuery{Height: a.committed.Height}
	if !queryPQIdentity(r, &abci.RequestQuery{Path: PQWalletIdentityPath}, a.committed, f.migration, nil) || r.Code == 0 || len(r.Value) != 0 {
		t.Fatal("identity silently manufactured independent bootstrap")
	}
	for _, mode := range []string{"uninitialized", "zero-height"} {
		state := a.committed
		if mode == "uninitialized" {
			state.Initialized = false
		} else {
			state.Height = 0
		}
		r := &abci.ResponseQuery{Height: state.Height}
		if !queryPQIdentity(r, &abci.RequestQuery{Path: PQWalletIdentityPath}, state, f.migration, f.bootstrap) || r.Code == 0 || len(r.Value) != 0 {
			t.Fatal("non-committed identity was reported", mode)
		}
	}
	var v PQWalletIdentityView
	r, err := a.Query(context.Background(), &abci.RequestQuery{Path: PQWalletIdentityPath})
	if err != nil || r.Code != 0 {
		t.Fatal("identity fixture unavailable", err)
	}
	if err = json.Unmarshal(r.Value, &v); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"source", "height", "comet", "native", "algorithm", "initial", "overflow"} {
		bad := v
		switch mode {
		case "source":
			bad.Source = "peer"
		case "height":
			bad.CurrentStateHeight++
		case "comet":
			bad.CometGenesisSHA256 = ""
		case "native":
			bad.NativeGenesisHash = "0x" + bad.NativeGenesisHash
		case "algorithm":
			bad.HashAlgorithm = "blockHash"
		case "initial":
			bad.InitialHeight++
		case "overflow":
			bad.CurrentStateHeight = math.MaxInt64
		}
		height := v.CurrentStateHeight
		if mode == "overflow" {
			height = math.MaxInt64
		}
		if ValidatePQWalletIdentityView(bad, height) == nil {
			t.Fatal("accepted identity mismatch", mode)
		}
	}
	a.bootstrap = nil
	r, err = a.Query(context.Background(), &abci.RequestQuery{Path: PQWalletIdentityPath})
	if err != nil || r.Code == 0 || len(r.Value) != 0 {
		t.Fatal("actual unpinned application query silently substituted native genesis", err)
	}
}
