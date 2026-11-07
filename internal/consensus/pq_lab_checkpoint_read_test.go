//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func checkpointReadFixture(t *testing.T, transfers int) (PQLabNetworkPlan, string, PQLabWorkloadManifest) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 2, Transfers: transfers, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	root := filepath.Join(pqLabWorkloadTemp(t), "network")
	p, err := GeneratePQLabNetwork(source.Migration, PQLabNetworkOptions{RootDir: root, BaseP2P: 31656, BaseRPC: 31757})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	pin := pqLabSHA(raw)
	_, m, _, err := loadPQLab(root, pin)
	if err != nil {
		t.Fatal(err)
	}
	corpus, err := source.WriteCorpus(filepath.Join(root, "workload"), m)
	if err != nil {
		t.Fatal(err)
	}
	persistPQLabTestCheckpoint(t, p, pin, nil)
	return p, pin, corpus
}

// Continue each original initialized disk store through the existing actual
// BlockExecutor harness. The registry-specific helper above intentionally only
// admits registry transactions, so ordinary corpus execution uses this helper.
func checkpointReadApplyOriginal(t *testing.T, p PQLabNetworkPlan, pin string, tx []byte) {
	t.Helper()
	_, m, b, err := loadPQLab(p.RootDir, pin)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(p.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	f := &validatorRegistryFixture{migration: m, bootstrap: b, pins: p.pins(), raw: raw, doc: doc, legacy: map[string]ed25519.PrivateKey{}}
	for _, n := range p.Nodes {
		pv, e := LoadPQOriginalLegacyValidator(n.LegacyKeyFile, n.LegacyStateFile, p.ChainID)
		if e != nil {
			t.Fatal(e)
		}
		key := pv.Key.PrivKey.(cmted.PrivKey)
		f.legacy[string(n.ValidatorAddress)] = ed25519.PrivateKey(key)
		defer clear(key)
	}
	var firstResult []byte
	for _, n := range p.Nodes {
		app, e := NewPersistentApplicationWithBootstrap(m, n.StatePath, b)
		if e != nil {
			t.Fatal(e)
		}
		database, e := dbm.NewGoLevelDB("state", filepath.Join(n.Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		blocks, e := dbm.NewGoLevelDB("blockstore", filepath.Join(n.Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(database, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocks), path: n.StatePath}
		h.proxy = startEngineTestProxy(t, app)
		state := h.apply(t, cmttypes.Txs{tx})
		result, e := h.raw.LoadFinalizeBlockResponse(state.LastBlockHeight)
		if e != nil {
			t.Fatal(e)
		}
		if len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
			t.Fatal("original corpus failed actual execution", result)
		}
		encoded, e := result.Marshal()
		if e != nil {
			t.Fatal(e)
		}
		if firstResult == nil {
			firstResult = encoded
		} else if !bytes.Equal(firstResult, encoded) {
			t.Fatal("full original four-node execution responses differ")
		}
		if e = h.proxy.Stop(); e != nil {
			t.Fatal(e)
		}
		if e = database.Close(); e != nil {
			t.Fatal(e)
		}
		if e = blocks.Close(); e != nil {
			t.Fatal(e)
		}
	}
	t.Logf("CHECKPOINT_ORIGINAL_RESULT bytes=%d sha256=%s allFourEqual=true", len(firstResult), pqLabSHA(firstResult))
}

func TestPQLabCheckpointReadJournalOriginalParity(t *testing.T) {
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	f := pqLabBoundFixture(t, source.Migration)
	witness, err := newValidatedMigration(f.migration, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	for _, layout := range []string{"snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(pqLabWorkloadTemp(t), "state")
			var app *Application
			if layout == "snapshot-journal" {
				app, err = NewJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
			} else {
				app, err = NewBlockJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = app.InitChain(context.Background(), f.initRequest(t)); err != nil {
				t.Fatal(err)
			}
			response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(f.migration.Height) + 1, Time: time.Unix(1700000000, 0).UTC(), NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash)})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			r := &pqLabCheckpointRead{witness: witness, height: app.committed.Height, appHash: app.committed.AppHash, metrics: &PQLabMetrics{}}
			initial, err := r.read(0, path, capturePQEngineState)
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				old, e := readPQEngineCommittedStateOwned(path, witness, nil, nil, capturePQEngineState)
				if e != nil {
					t.Fatal(e)
				}
				a, _ := encodeCommittedStateJSON(old)
				b, _ := encodeCommittedStateJSON(*initial)
				hash, hashErr := hex.DecodeString(old.AppHash)
				if !bytes.Equal(a, b) || hashErr != nil || !bytes.Equal(response.AppHash, hash) {
					t.Fatal("journal full state/response differs")
				}
				if current, e := r.read(0, path, capturePQEngineState); e != nil || current != nil {
					t.Fatal("same journal source should reuse only mathematics", e)
				}
			}
			original, e := os.ReadFile(path)
			if e != nil {
				t.Fatal(e)
			}
			file, e := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = file.Write([]byte{1, 2, 3}); e != nil {
				t.Fatal(e)
			}
			if e = file.Close(); e != nil {
				t.Fatal(e)
			}
			if _, e = r.read(0, path, capturePQEngineState); e == nil {
				t.Fatal("same-scope incomplete journal tail accepted")
			}
			if e = os.WriteFile(path, original, 0600); e != nil {
				t.Fatal(e)
			}
			if _, e = r.read(0, path, capturePQEngineState); e != nil {
				t.Fatal("original journal bytes no longer accepted", e)
			}
		})
	}
}

func TestPQLabCheckpointReadSameInputSevenHeightParity(t *testing.T) {
	p, pin, corpus := checkpointReadFixture(t, 3)
	beforeCache, afterCache := NewPQLabStaticCache(), NewPQLabStaticCache()
	defer beforeCache.Close()
	defer afterCache.Close()
	var beforeNS, afterNS int64
	for at := 0; at <= len(corpus.Transactions); at++ {
		if at > 0 {
			raw, err := os.ReadFile(filepath.Join(p.RootDir, "workload", corpus.Transactions[at-1].Envelope.Path))
			if err != nil {
				t.Fatal(err)
			}
			checkpointReadApplyOriginal(t, p, pin, raw)
		}
		raw, err := os.ReadFile(p.Nodes[0].StatePath)
		if err != nil {
			t.Fatal(err)
		}
		var actual CommittedState
		if err = json.Unmarshal(raw, &actual); err != nil {
			t.Fatal(err)
		}
		beforeMetrics, afterMetrics := &PQLabMetrics{}, &PQLabMetrics{}
		before, err := legacyPQLabSenderCheckpointF27(p.RootDir, pin, "", actual.Height, actual.AppHash, beforeMetrics, beforeCache)
		if err != nil {
			t.Fatal(err)
		}
		after, err := LoadPQLabSenderCheckpointCached(p.RootDir, pin, "", actual.Height, actual.AppHash, afterMetrics, afterCache)
		if err != nil {
			t.Fatal(err)
		}
		for repeat := 0; repeat < 2; repeat++ {
			if err = before.current(); err != nil {
				t.Fatal(err)
			}
			if err = after.current(); err != nil {
				t.Fatal(err)
			}
		}
		left, _ := encodeCommittedStateJSON(before.state)
		right, _ := encodeCommittedStateJSON(after.state)
		if !bytes.Equal(left, right) || !bytes.Equal(left, raw) || !bytes.Equal(before.network, after.network) || before.migrationHash != after.migrationHash {
			t.Fatalf("same complete checkpoint bytes/nonce/balance/AppHash differ beforeAfter=%v beforeFile=%v network=%v migration=%v", bytes.Equal(left, right), bytes.Equal(left, raw), bytes.Equal(before.network, after.network), before.migrationHash == after.migrationHash)
		}
		for _, node := range p.Nodes {
			cold, err := NewPersistentApplicationWithBootstrap(beforeCache.entry.witness.migration, node.StatePath, beforeCache.entry.witness.bootstrap)
			if err != nil {
				t.Fatal(err)
			}
			coldRaw, _ := encodeCommittedStateJSON(cold.committed)
			if !bytes.Equal(raw, coldRaw) {
				t.Fatal("cold complete state differs")
			}
		}
		a, b := beforeMetrics.Snapshot().Stages, afterMetrics.Snapshot().Stages
		if a["checkpoint.nodeReadAndValidate"].Calls != 12 || b["checkpoint.nodeReadAndValidate"].Calls != 12 || b["checkpoint.captureCurrentBytes"].Calls != 12 || b["checkpoint.fullStateValidation"].Calls != 1 || b["checkpoint.exactBytesValidationReuse"].Calls != 11 {
			t.Fatal("fresh-source or full-validation/reuse denominators differ", a, b)
		}
		beforeNS += a["checkpoint.nodeReadAndValidate"].ElapsedNS
		afterNS += b["checkpoint.nodeReadAndValidate"].ElapsedNS
		t.Logf("CHECKPOINT_PARITY height=%d stateBytes=%d rawSHA=%s appHash=%s freshCaptures=12 fullValidationBefore=12 fullValidationAfter=1 exactReuse=11 beforeNodeNS=%d afterNodeNS=%d", actual.Height, len(raw), pqLabSHA(raw), actual.AppHash, a["checkpoint.nodeReadAndValidate"].ElapsedNS, b["checkpoint.nodeReadAndValidate"].ElapsedNS)
		if at < len(corpus.Transactions) {
			// An independently selected wrong checkpoint is never rescued by a
			// previous invocation's validated bytes or an immutable static owner.
			if _, err := LoadPQLabSenderCheckpointCached(p.RootDir, pin, "", actual.Height+1, actual.AppHash, nil, afterCache); err == nil {
				t.Fatal("foreign expected height accepted")
			}
		}
	}
	t.Logf("CHECKPOINT_COST heights=7 freshCaptures=84 beforeFullValidations=84 afterFullValidations=7 beforeNodeNS=%d afterNodeNS=%d noNetworkOrTPS=true", beforeNS, afterNS)
}

func TestPQLabCheckpointReadCurrentBytesAndCloseGuards(t *testing.T) {
	p, pin, _ := checkpointReadFixture(t, 1)
	cache := NewPQLabStaticCache()
	defer cache.Close()
	entry, err := cache.load(p.RootDir, pin, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	var state CommittedState
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	newRead := func() *pqLabCheckpointRead {
		return &pqLabCheckpointRead{witness: entry.witness, height: state.Height, appHash: state.AppHash}
	}
	r := newRead()
	if _, err = r.read(0, p.Nodes[0].StatePath, capturePQEngineState); err != nil {
		t.Fatal(err)
	}
	first := r.files[0]
	closeFailure := errors.New("original capability close failed")
	changed := errors.New("original source changed after capture")
	for _, tc := range []struct {
		name           string
		current, close error
	}{{"late-current", changed, nil}, {"close", nil, closeFailure}, {"current-and-close", changed, closeFailure}} {
		t.Run(tc.name, func(t *testing.T) {
			closes := 0
			_, err := r.read(0, p.Nodes[0].StatePath, func(path string) (*pqEngineStateRead, error) {
				o, e := capturePQEngineState(path)
				if e != nil {
					return nil, e
				}
				o.checkOriginal = func() error { return tc.current }
				o.closeOriginal = func() error { closes++; return tc.close }
				return o, nil
			})
			if err == nil || closes != 1 || tc.current != nil && !errors.Is(err, tc.current) || tc.close != nil && !errors.Is(err, tc.close) {
				t.Fatal("fresh/close failure hidden", err, closes)
			}
		})
	}
	fresh := newRead()
	if _, err = fresh.read(0, p.Nodes[0].StatePath, func(path string) (*pqEngineStateRead, error) {
		o, e := capturePQEngineState(path)
		if e == nil {
			o.closeOriginal = func() error { return closeFailure }
		}
		return o, e
	}); !errors.Is(err, closeFailure) || fresh.files[0].validated {
		t.Fatal("failed first close published reusable validation", err)
	}
	// Changed encoding still receives the entire original decoder; it is not
	// inserted into a growing cache, and original legal whitespace stays legal.
	if err = os.WriteFile(p.Nodes[0].StatePath, append([]byte(" \n"), raw...), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := r.read(0, p.Nodes[0].StatePath, capturePQEngineState)
	if err != nil || got.AppHash != state.AppHash || !reflect.DeepEqual(first, r.files[0]) {
		t.Fatal("alternate valid original encoding changed semantics", err)
	}
	if err = os.WriteFile(p.Nodes[0].StatePath, []byte(`{"invalid-current":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.read(0, p.Nodes[0].StatePath, capturePQEngineState); err == nil {
		t.Fatal("changed original bypassed full validation")
	}
	if err = os.WriteFile(p.Nodes[0].StatePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	cp, err := LoadPQLabSenderCheckpointCached(p.RootDir, pin, "", state.Height, state.AppHash, nil, cache)
	if err != nil {
		t.Fatal(err)
	}
	if err = cache.Close(); err != nil {
		t.Fatal(err)
	}
	if err = cp.current(); err == nil {
		t.Fatal("closed static source owner resumed checkpoint")
	}
}
