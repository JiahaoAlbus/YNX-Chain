package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestPQWalletConsensusGenesisExactOriginalOwnedAndCold(t *testing.T) {
	f := newPQInitialFixture(t)
	// Whitespace is part of the independent raw pin. Comet GenesisDoc JSON
	// reserialization must never replace these original complete public bytes.
	input := append([]byte(" \n"), f.f.raw...)
	input = append(input, '\n')
	want := bytes.Clone(input)
	digest := sha256.Sum256(want)
	f.f.pins.CometGenesisSHA256 = hex.EncodeToString(digest[:])
	bootstrap, err := NewConsensusBootstrap(input, f.f.pins, f.f.migration)
	if err != nil {
		t.Fatal(err)
	}
	input[0] = '!'
	f.f.bootstrap = bootstrap
	path := filepath.Join(t.TempDir(), "genesis-query-state.json")
	a := newCommittedPQIdentityApp(t, f.f, path)
	// A caller still holding its Bootstrap cannot mutate the owned App copy.
	bootstrap.rawGenesis[0] = '?'
	before := mustJSON(t, a.committed)
	read := func(app *Application, height int64) *abci.ResponseQuery {
		t.Helper()
		response, err := app.Query(context.Background(), &abci.RequestQuery{Path: PQWalletConsensusGenesisPath, Height: height})
		if err != nil || response.Code != 0 || response.Height != a.committed.Height || !bytes.Equal(response.Value, want) {
			t.Fatal("query lost exact original raw Genesis or current committed coordinate", response, err)
		}
		if sum := sha256.Sum256(response.Value); hex.EncodeToString(sum[:]) != f.f.pins.CometGenesisSHA256 {
			t.Fatal("original raw Genesis no longer matches its independent pin")
		}
		return response
	}
	read(a, 0).Value[0] = '#'
	read(a, a.committed.Height)
	if !bytes.Equal(before, mustJSON(t, a.committed)) {
		t.Fatal("readonly raw Genesis query changed committed state")
	}
	disk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := NewConsensusBootstrap(want, f.f.pins, f.f.migration)
	if err != nil {
		t.Fatal(err)
	}
	cold, err := NewPersistentApplicationWithBootstrap(f.f.migration, path, fresh)
	if err != nil {
		t.Fatal(err)
	}
	read(cold, 0)
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(path)
	if err != nil || !bytes.Equal(disk, after) || !os.SameFile(info, afterInfo) || !info.ModTime().Equal(afterInfo.ModTime()) {
		t.Fatal("cold original Genesis query rewrote its checkpoint", err)
	}
}

func TestPQWalletConsensusGenesisRejectsForeignOrNoncurrentQueries(t *testing.T) {
	f := newPQInitialFixture(t)
	a := newCommittedPQIdentityApp(t, f.f, "")
	for _, request := range []*abci.RequestQuery{
		{Path: PQWalletConsensusGenesisPath, Prove: true}, {Path: PQWalletConsensusGenesisPath, Data: []byte("peer genesis")},
		{Path: PQWalletConsensusGenesisPath, Height: -1}, {Path: PQWalletConsensusGenesisPath, Height: a.committed.Height - 1},
		{Path: PQWalletConsensusGenesisPath, Height: a.committed.Height + 1},
	} {
		response, err := a.Query(context.Background(), request)
		if err != nil || response.Code == 0 || len(response.Value) != 0 {
			t.Fatal("original Genesis query accepted proof/data or another height", response, err)
		}
	}
	for _, mode := range []string{"uninitialized", "zero-height", "foreign-chain", "foreign-migration", "missing-bootstrap", "missing-raw", "changed-raw", "changed-pin", "changed-id", "wrong-envelope-height"} {
		t.Run(mode, func(t *testing.T) {
			state, migration := a.committed, f.f.migration
			bootstrap := detachValidatedBootstrap(a.bootstrap)
			response := &abci.ResponseQuery{Height: state.Height}
			switch mode {
			case "uninitialized":
				state.Initialized = false
			case "zero-height":
				state.Height, response.Height = 0, 0
			case "foreign-chain":
				state.ChainID++
			case "foreign-migration":
				migration.StateHash = "foreign"
			case "missing-bootstrap":
				bootstrap = nil
			case "missing-raw":
				bootstrap.rawGenesis = nil
			case "changed-raw":
				bootstrap.rawGenesis[0] ^= 1
			case "changed-pin":
				bootstrap.record.CometGenesisSHA256 = f.f.pins.MigrationStateHash
			case "changed-id":
				bootstrap.genesisID[0] ^= 1
			case "wrong-envelope-height":
				response.Height++
			}
			if !queryPQConsensusGenesis(response, &abci.RequestQuery{Path: PQWalletConsensusGenesisPath}, state, migration, bootstrap) || response.Code == 0 || len(response.Value) != 0 {
				t.Fatal("invalid original Genesis source released raw bytes", mode, response)
			}
		})
	}
	response := &abci.ResponseQuery{Height: a.committed.Height}
	if queryPQConsensusGenesis(response, &abci.RequestQuery{Path: "/unrelated"}, a.committed, f.f.migration, a.bootstrap) {
		t.Fatal("raw Genesis query intercepted another normal path")
	}
}
