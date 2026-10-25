package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func persistenceMigration(t *testing.T) chain.ConsensusMigrationState {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func persistenceApplication(t *testing.T, m chain.ConsensusMigrationState, path, layout string) *Application {
	t.Helper()
	var a *Application
	var err error
	switch layout {
	case "memory":
		a, err = NewApplication(m)
	case "atomic-json":
		a, err = NewPersistentApplication(m, path)
	case "snapshot-journal-v1":
		a, err = NewJournaledApplication(m, path)
	case "block-journal-v2":
		a, err = NewBlockJournaledApplication(m, path)
	default:
		t.Fatal("unknown test layout")
	}
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func persistenceQuery(t *testing.T, a *Application) ApplicationPersistenceView {
	t.Helper()
	before, _ := json.Marshal(a.committed)
	response, err := a.Query(context.Background(), &abci.RequestQuery{Path: ApplicationPersistencePath})
	var result ApplicationPersistenceView
	if err != nil || response == nil || response.Code != 0 {
		t.Fatal("persistence query failed", response, err)
	}
	if err = json.Unmarshal(response.Value, &result); err != nil {
		t.Fatal(err)
	}
	if err = ValidateApplicationPersistenceView(result); err != nil || response.Height != result.StateHeight || result.StateHeight != a.committed.Height || result.StateAppHash != a.committed.AppHash {
		t.Fatal("persistence observation changed coordinates", result, err)
	}
	after, _ := json.Marshal(a.committed)
	if !bytes.Equal(before, after) {
		t.Fatal("query mutated committed application")
	}
	return result
}

func persistenceFinalize(t *testing.T, a *Application) {
	t.Helper()
	if _, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: a.committed.Height + 1}); err != nil {
		t.Fatal(err)
	}
}

func persistenceCommit(t *testing.T, a *Application) {
	t.Helper()
	if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func TestApplicationPersistenceObservesActualStorageAndColdRecovery(t *testing.T) {
	m := persistenceMigration(t)
	for _, layout := range []string{"memory", "atomic-json", "snapshot-journal-v1", "block-journal-v2"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "original-state")
			a := persistenceApplication(t, m, path, layout)
			initial := persistenceQuery(t, a)
			wantStored := layout == "block-journal-v2"
			if initial.Persistence != wantStored || initial.Storage != layout {
				t.Fatal("path configuration was mistaken for a persisted checkpoint", initial)
			}
			persistenceFinalize(t, a)
			if pending := persistenceQuery(t, a); pending != initial {
				t.Fatal("Finalize published pending persistence", pending, initial)
			}
			persistenceCommit(t, a)
			observed := persistenceQuery(t, a)
			if observed.Persistence != (layout != "memory") || observed.StateHeight != initial.StateHeight+1 {
				t.Fatal("real Commit outcome not observed", observed)
			}
			if layout == "memory" {
				if observed.PersistenceError != "memory_only" {
					t.Fatal(observed)
				}
				if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("in-memory status created storage", err)
				}
				return
			}
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			_ = persistenceQuery(t, a)
			cold := persistenceApplication(t, m, path, layout)
			if restored := persistenceQuery(t, cold); restored != observed {
				t.Fatal("cold recovery did not retain actual durable coordinates", restored, observed)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(original, after) {
				t.Fatal("observation/cold read rewrote original state", err)
			}
		})
	}
}

func TestApplicationPersistenceSaveFailureKeepsFirstCauseAndPending(t *testing.T) {
	m := persistenceMigration(t)
	for _, afterRename := range []bool{false, true} {
		name := "before-rename"
		if afterRename {
			name = "after-rename"
		}
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "original-state")
			a := persistenceApplication(t, m, path, "atomic-json")
			persistenceFinalize(t, a)
			persistenceCommit(t, a)
			before := persistenceQuery(t, a)
			persistenceFinalize(t, a)
			pending, _ := json.Marshal(a.pending)
			first := errors.New("original persistence failure with private path /private/synthetic-source")
			a.persistenceHooks = &committedPersistenceHooks{}
			want := "save_failed"
			if afterRename {
				a.persistenceHooks.syncDirectory = func(string) error { return first }
				want = "durability_uncertain"
			} else {
				a.persistenceHooks.beforeRename = func() error { return first }
			}
			_, err := a.Commit(context.Background(), &abci.RequestCommit{})
			if !errors.Is(err, first) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != afterRename {
				t.Fatal("original save result changed", err)
			}
			failed := persistenceQuery(t, a)
			if failed.Persistence || failed.PersistenceError != want || failed.StateHeight != before.StateHeight || failed.StateAppHash != before.StateAppHash || !errors.Is(a.persistence.firstError, first) {
				t.Fatal("failed/UNKNOWN save published durability or lost first cause", failed)
			}
			after, _ := json.Marshal(a.pending)
			if !bytes.Equal(pending, after) {
				t.Fatal("persistence observation changed pending state")
			}
			if afterRename {
				cold, err := newPersistentApplication(m, path, nil, &committedPersistenceHooks{syncDirectory: func(string) error { return first }})
				if err == nil || cold != nil {
					t.Fatal("cold failed directory Sync returned a live durable app")
				}
				restored := persistenceQuery(t, persistenceApplication(t, m, path, "atomic-json"))
				if !restored.Persistence || restored.StateHeight != a.pending.Height || restored.StateAppHash != a.pending.AppHash {
					t.Fatal("actual loaded and Sync-confirmed UNKNOWN file did not recover", restored)
				}
			}
			second := errors.New("later failure must not replace first cause")
			a.persistenceHooks = &committedPersistenceHooks{beforeRename: func() error { return second }}
			if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); !errors.Is(err, second) {
				t.Fatal(err)
			}
			if got := persistenceQuery(t, a); got.PersistenceError != want || !errors.Is(a.persistence.firstError, first) {
				t.Fatal("later failure replaced original persistence first cause", got)
			}
			// Explicitly reconfirm the SAME preserved pending state. No transaction
			// is re-admitted and the query itself never triggers a retry or write.
			a.persistenceHooks = nil
			persistenceCommit(t, a)
			if got := persistenceQuery(t, a); !got.Persistence || got.PersistenceError != "" || got.StateHeight != before.StateHeight+1 || a.persistence.firstError != nil {
				t.Fatal("real successful reconfirmation did not clear unresolved failure", got)
			}
		})
	}
}

func TestApplicationPersistenceJournalFailedSaveNeedsActualColdConfirmation(t *testing.T) {
	m := persistenceMigration(t)
	for _, layout := range []string{"snapshot-journal-v1", "block-journal-v2"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "original-state")
			a := persistenceApplication(t, m, path, layout)
			persistenceFinalize(t, a)
			persistenceCommit(t, a)
			before := persistenceQuery(t, a)
			persistenceFinalize(t, a)
			failure := errors.New("actual journal save acknowledgement lost after Sync")
			fault := func(stage string) error {
				if stage == "append_synced" {
					return failure
				}
				return nil
			}
			if a.journal != nil {
				a.journal.fault = fault
			} else {
				a.blockJournal.io.fault = fault
			}
			if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); !errors.Is(err, failure) {
				t.Fatal("real journal fault not reached", err)
			}
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			failed := persistenceQuery(t, a)
			if failed.Persistence || failed.PersistenceError != "save_failed" || failed.StateHeight != before.StateHeight {
				t.Fatal("failed journal acknowledged pending state", failed)
			}
			cold := persistenceApplication(t, m, path, layout)
			if restored := persistenceQuery(t, cold); !restored.Persistence || restored.StateHeight != a.pending.Height || restored.StateAppHash != a.pending.AppHash {
				t.Fatal("real full journal recovery not reported", restored)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(original, after) {
				t.Fatal("query repaired or changed original complete journal", err)
			}
		})
	}
}

func TestApplicationPersistenceQueriesCannotRepairMissingOrReplacedState(t *testing.T) {
	m := persistenceMigration(t)
	path := filepath.Join(t.TempDir(), "original-state")
	a := persistenceApplication(t, m, path, "atomic-json")
	persistenceFinalize(t, a)
	persistenceCommit(t, a)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []*abci.RequestQuery{{Path: ApplicationPersistencePath, Prove: true}, {Path: ApplicationPersistencePath, Data: []byte("foreign")}, {Path: ApplicationPersistencePath, Height: -1}, {Path: ApplicationPersistencePath, Height: a.committed.Height + 1}} {
		r, err := a.Query(context.Background(), request)
		if err != nil || r.Code == 0 || len(r.Value) != 0 {
			t.Fatal("unsupported persistence proof/coordinates accepted", r, err)
		}
	}
	if err = os.Rename(path, path+".original"); err != nil {
		t.Fatal(err)
	}
	if got := persistenceQuery(t, a); got.Persistence || got.PersistenceError != "source_unavailable" {
		t.Fatal("missing original was reported durable", got)
	}
	if _, err = os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("query recreated missing state", err)
	}
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if got := persistenceQuery(t, a); got.Persistence || got.PersistenceError != "source_changed" {
		t.Fatal("copied replacement inherited previous inode's acknowledgement", got)
	}
	cold := persistenceApplication(t, m, path, "atomic-json")
	if got := persistenceQuery(t, cold); !got.Persistence {
		t.Fatal("actual validated cold recovery failed", got)
	}
	if err = os.WriteFile(path, []byte("{corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := persistenceQuery(t, cold); got.Persistence || got.PersistenceError != "source_changed" {
		t.Fatal("mutated source was reported unchanged", got)
	}
	if app, err := NewPersistentApplication(m, path); err == nil || app != nil {
		t.Fatal("corrupt recovery produced a persistence observation")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != "{corrupt" {
		t.Fatal("observation repaired corrupt source", err)
	}
}

func TestApplicationPersistenceAuthorizedJournalConstructorObservesRealSync(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	for _, block := range []bool{false, true} {
		path := filepath.Join(t.TempDir(), "original-state")
		var a *Application
		var err error
		if block {
			a, err = NewBlockJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
		} else {
			a, err = NewJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
		}
		if err != nil {
			t.Fatal(err)
		}
		if got := persistenceQuery(t, a); got.Persistence != block {
			t.Fatal("authorized opener confused header-only journal with saved checkpoint", got)
		}
		if _, err = a.InitChain(context.Background(), f.initRequest(t)); err != nil {
			t.Fatal(err)
		}
		if _, err = a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash)}); err != nil {
			t.Fatal(err)
		}
		persistenceCommit(t, a)
		if got := persistenceQuery(t, a); !got.Persistence {
			t.Fatal("authorized normal save did not observe actual record Sync", got)
		}
		original, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if block {
			a, err = NewBlockJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
		} else {
			a, err = NewJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
		}
		if err != nil || !persistenceQuery(t, a).Persistence {
			t.Fatal("authorized cold opener lost actual recovered Sync", err)
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(original, after) {
			t.Fatal("authorized observation mutated original journal", err)
		}
	}
}
