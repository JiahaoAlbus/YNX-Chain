package consensus

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func openRuntimeJournalTest(f runtimeUpgradeFixture, path string, block bool, pq *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization) (*Application, error) {
	if block {
		return NewBlockJournaledApplicationWithRuntimeUpgrade(f.migration, path, f.bootstrap, pq, runtime)
	}
	return NewJournaledApplicationWithRuntimeUpgrade(f.migration, path, f.bootstrap, pq, runtime)
}

// The shared fixture executes real signed legacy transfers. Persist its exact
// historical state through the original layout writer, not a decoder-generated
// expected result or an invented initialized/genesis checkpoint.
func writeRuntimeJournalFixture(t *testing.T, f runtimeUpgradeFixture, state CommittedState, block bool) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "original.journal")
	if block {
		writer, _, err := openBlockJournal(path, f.migration)
		if err != nil {
			t.Fatal(err)
		}
		if err := writer.replaceCheckpoint(state, f.migration); err != nil {
			t.Fatal(err)
		}
	} else {
		writer, _, err := openSnapshotJournal(path, f.migration)
		if err != nil {
			t.Fatal(err)
		}
		if err := writer.save(state, f.migration, nil); err != nil {
			t.Fatal(err)
		}
	}
	return path
}

func runtimeJournalBytes(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestRuntimeJournalNormalWriterPreservesHistoricalDomainsAndRequiresEngine(t *testing.T) {
	for _, version := range []int{12, 13} {
		for _, block := range []bool{false, true} {
			t.Run(fmt.Sprintf("v%d/block=%t", version, block), func(t *testing.T) {
				f := newRuntimeUpgradeFixture(t, version)
				path := writeRuntimeJournalFixture(t, f, f.old[0], block)
				atomic, _ := openRuntimeConsumerFixture(t, f, f.old[0])
				for nonce := uint64(2); nonce <= 5; nonce++ {
					original := runtimeJournalBytes(t, path)
					app, err := openRuntimeJournalTest(f, path, block, nil, f.authorization)
					if err != nil {
						t.Fatal("RUNTIME_JOURNAL_FACTORY_UNAVAILABLE", err)
					}
					if !bytes.Equal(original, runtimeJournalBytes(t, path)) || !journalStateEqual(t, app.committed, atomic.committed) || app.runtimeUpgradeCursor != nil || app.replayStateVersion != 0 || app.bootstrap != f.bootstrap || app.committed.bootstrap != f.bootstrap {
						t.Fatal("cold journal changed full history/accounts/nonces or self-authorized execution")
					}
					info, err := app.Info(context.Background(), &abci.RequestInfo{})
					wantVersion := f.plan.OldApplicationVersion
					if app.committed.Height >= f.plan.UpgradeHeight {
						wantVersion = f.plan.NewApplicationVersion
					}
					if err != nil || info.AppVersion != wantVersion || info.LastBlockHeight != atomic.committed.Height {
						t.Fatal("Info changed original runtime identity", err)
					}
					request := runtimeConsumerRequest(t, f, nonce)
					before := mustJSON(t, app.committed)
					if _, err := app.FinalizeBlock(context.Background(), request); err == nil || app.pending != nil || !bytes.Equal(before, mustJSON(t, app.committed)) {
						t.Fatal("cold file-only runtime executed without fresh engine confirmation")
					}
					confirmRuntimeConsumer(t, app, f.plan, app.committed)
					confirmRuntimeConsumer(t, atomic, f.plan, atomic.committed)
					priorHeight := app.runtimeUpgradeCursor.height
					for _, candidate := range []*Application{app, atomic} {
						check, err := candidate.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: request.Txs[0]})
						if err != nil || check.Code != 0 {
							t.Fatal("genuine signed next transaction rejected", err)
						}
					}
					response, err := app.FinalizeBlock(context.Background(), request)
					if err != nil || len(response.TxResults) != 2 || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce {
						t.Fatal("normal signed journal execution/duplicate rollback changed", err)
					}
					reference, err := atomic.FinalizeBlock(context.Background(), request)
					if err != nil {
						t.Fatal(err)
					}
					gotHash, err := finalizeResponseHash(response)
					wantHash, wantErr := finalizeResponseHash(reference)
					if err != nil || wantErr != nil || gotHash != wantHash {
						t.Fatal("journal changed complete atomic Finalize response", err, wantErr)
					}
					for _, candidate := range []*Application{app, atomic} {
						if _, err := candidate.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
							t.Fatal(err)
						}
					}
					if !journalStateEqual(t, app.committed, atomic.committed) || app.runtimeUpgradeCursor.height != priorHeight {
						t.Fatal("Commit changed complete history or impersonated engine checkpoint")
					}
					if nonce <= 3 && !journalStateEqual(t, app.committed, f.old[nonce-1]) {
						t.Fatal("old v12/v13 state/hash was promoted or rewritten")
					}
					if nonce == 4 && (!journalStateEqual(t, app.committed, f.next) || response.ConsensusParamUpdates == nil || response.ConsensusParamUpdates.Version == nil || response.ConsensusParamUpdates.Version.App != f.plan.NewApplicationVersion) {
						t.Fatal("U state/hash/actual AppVersion update differs from atomic runtime")
					}
					if _, err := app.FinalizeBlock(context.Background(), runtimeConsumerRequest(t, f, nonce+1)); err == nil {
						t.Fatal("next live block bypassed engine checkpoint confirmation")
					}
				}
				cold, err := openRuntimeJournalTest(f, path, block, nil, f.authorization)
				if err != nil || !journalStateEqual(t, cold.committed, atomic.committed) || cold.runtimeUpgradeCursor != nil {
					t.Fatal("post-U tail failed exact cold replay", err)
				}
			})
		}
	}
}

func TestRuntimeJournalInvalidAuthorityHasNoRecoverySideEffects(t *testing.T) {
	f := newRuntimeUpgradeFixture(t, 13)
	_, _, foreignPQ, _, _ := registeredAuthorityJournal(t, false)
	for _, block := range []bool{false, true} {
		t.Run(fmt.Sprintf("block=%t", block), func(t *testing.T) {
			for _, kind := range []string{"nil-plan", "bad-plan-pin", "wrong-checkpoint", "missing-bootstrap", "wrong-bootstrap", "foreign-pq", "half-tail", "missing-source"} {
				t.Run(kind, func(t *testing.T) {
					path := writeRuntimeJournalFixture(t, f, f.old[2], block)
					// Remove only this test's unlocked sidecars. Any invalid
					// constructor must reject before recreating either one.
					for _, suffix := range []string{".lock", ".read.lock"} {
						if err := os.Remove(path + suffix); err != nil {
							t.Fatal(err)
						}
					}
					original := runtimeJournalBytes(t, path)
					candidate := f
					plan := *f.authorization
					var pq *PQEngineAuthorization
					runtime := &plan
					switch kind {
					case "nil-plan":
						runtime = nil
					case "bad-plan-pin":
						plan.hash = strings.Repeat("a", 64)
					case "wrong-checkpoint":
						plan.plan.CheckpointAppHash = strings.Repeat("b", 64)
						plan.hash, _ = plan.plan.Hash()
					case "missing-bootstrap":
						candidate.bootstrap = nil
					case "wrong-bootstrap":
						other := newRuntimeUpgradeFixture(t, 12)
						candidate.bootstrap = other.bootstrap
					case "foreign-pq":
						pq = foreignPQ
					case "half-tail":
						original = append(original, 1, 2, 3)
						if err := os.WriteFile(path, original, 0600); err != nil {
							t.Fatal(err)
						}
					case "missing-source":
						path = filepath.Join(filepath.Dir(path), "absent-parent", "original.journal")
					}
					if _, err := openRuntimeJournalTest(candidate, path, block, pq, runtime); err == nil {
						t.Fatal("invalid independent authority or incomplete original accepted")
					}
					if kind == "missing-source" {
						if _, err := os.Lstat(filepath.Dir(path)); !os.IsNotExist(err) {
							t.Fatal("runtime constructor created substitute directory/genesis", err)
						}
					} else if !bytes.Equal(original, runtimeJournalBytes(t, path)) {
						t.Fatal("refused runtime source was rewritten")
					}
					for _, suffix := range []string{".lock", ".read.lock"} {
						if _, err := os.Lstat(path + suffix); !os.IsNotExist(err) {
							t.Fatal("invalid authority created recovery lock sidecar", suffix, err)
						}
					}
				})
			}
		})
	}
}

func TestRuntimeJournalUnknownPreservesPendingAndRequiresFreshConfirmation(t *testing.T) {
	for _, block := range []bool{false, true} {
		for _, stage := range []string{"append_header_written", "append_synced"} {
			t.Run(fmt.Sprintf("block=%t/%s", block, stage), func(t *testing.T) {
				f := newRuntimeUpgradeFixture(t, 13)
				path := writeRuntimeJournalFixture(t, f, f.old[0], block)
				app, err := openRuntimeJournalTest(f, path, block, nil, f.authorization)
				if err != nil {
					t.Fatal(err)
				}
				confirmRuntimeConsumer(t, app, f.plan, app.committed)
				previous := mustJSON(t, app.committed)
				if _, err := app.FinalizeBlock(context.Background(), runtimeConsumerRequest(t, f, 2)); err != nil {
					t.Fatal(err)
				}
				candidate := mustJSON(t, *app.pending)
				fault := func(at string) error {
					if at == stage {
						return errors.New("synthetic runtime journal persistence interruption")
					}
					return nil
				}
				if block {
					app.blockJournal.io.fault = fault
				} else {
					app.journal.fault = fault
				}
				if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
					t.Fatal("UNKNOWN append was reported successful")
				}
				if app.pending == nil || !bytes.Equal(candidate, mustJSON(t, *app.pending)) || !bytes.Equal(previous, mustJSON(t, app.committed)) || app.runtimeUpgradeCursor.height != f.old[0].Height {
					t.Fatal("UNKNOWN lost original state/pending or advanced cursor")
				}
				if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
					t.Fatal("poisoned writer retried original UNKNOWN")
				}
				original := runtimeJournalBytes(t, path)
				cold, err := openRuntimeJournalTest(f, path, block, nil, f.authorization)
				if stage == "append_header_written" {
					if err == nil {
						t.Fatal("runtime recovery concealed partial UNKNOWN frame")
					}
				} else {
					if err != nil || cold.runtimeUpgradeCursor != nil || !bytes.Equal(candidate, mustJSON(t, cold.committed)) {
						t.Fatal("complete UNKNOWN was lost or self-authorized", err)
					}
					if _, err := cold.FinalizeBlock(context.Background(), runtimeConsumerRequest(t, f, 3)); err == nil {
						t.Fatal("recovery Sync substituted for engine confirmation")
					}
					confirmRuntimeConsumer(t, cold, f.plan, cold.committed)
				}
				if !bytes.Equal(original, runtimeJournalBytes(t, path)) {
					t.Fatal("recovery changed original UNKNOWN bytes")
				}
			})
		}
	}
}

func TestRuntimeJournalRehashedCheckpointCannotReplaceIndependentPin(t *testing.T) {
	f := newRuntimeUpgradeFixture(t, 13)
	for _, block := range []bool{false, true} {
		t.Run(fmt.Sprintf("block=%t", block), func(t *testing.T) {
			path := writeRuntimeJournalFixture(t, f, f.old[2], block)
			// Produce a different, fully valid historical execution with real
			// signed transfers. Changing one fee field alone could fail its
			// internal audit before exercising the independent checkpoint pin.
			alternative, _ := openRuntimeConsumerFixture(t, f, f.old[0])
			confirmRuntimeConsumer(t, alternative, f.plan, alternative.committed)
			for nonce := uint64(2); nonce <= 3; nonce++ {
				request := runtimeConsumerRequest(t, f, nonce)
				if nonce == 2 {
					request.Time = request.Time.Add(time.Millisecond)
				}
				if _, err := alternative.FinalizeBlock(context.Background(), request); err != nil {
					t.Fatal(err)
				}
				if _, err := alternative.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
					t.Fatal(err)
				}
				if nonce < 3 {
					confirmRuntimeConsumer(t, alternative, f.plan, alternative.committed)
				}
			}
			changed := alternative.committed
			if err := changed.Validate(f.migration); err != nil {
				t.Fatal("checkpoint negative must contain fully valid executed history", err)
			}
			if changed.Height != f.plan.CheckpointHeight || changed.AppHash == f.plan.CheckpointAppHash {
				t.Fatal("alternative execution did not differ at the independently pinned height")
			}
			var err error
			changed.AppHash, err = changed.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			payload, err := encodeCommittedStateJSON(changed)
			magic := snapshotJournalMagic
			if block {
				magic = blockJournalMagic
				payload, err = encodeBlockCheckpoint(changed)
			}
			if err != nil {
				t.Fatal(err)
			}
			forged := append([]byte(magic+f.migration.StateHash+"\n"), journalRecord(payload)...)
			if err := os.WriteFile(path, forged, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := openRuntimeJournalTest(f, path, block, nil, f.authorization); err == nil {
				t.Fatal("rehashed executed history replaced independently pinned checkpoint")
			}
			if !bytes.Equal(forged, runtimeJournalBytes(t, path)) {
				t.Fatal("rejected rehashed history was normalized or rewritten")
			}
		})
	}
}

func TestRuntimeJournalUpgradeCheckpointUnknownRetainsOriginalDomain(t *testing.T) {
	f := newRuntimeUpgradeFixture(t, 13)
	for _, block := range []bool{false, true} {
		t.Run(fmt.Sprintf("block=%t", block), func(t *testing.T) {
			path := writeRuntimeJournalFixture(t, f, f.old[2], block)
			app, err := openRuntimeJournalTest(f, path, block, nil, f.authorization)
			if err != nil {
				t.Fatal(err)
			}
			confirmRuntimeConsumer(t, app, f.plan, app.committed)
			if _, err := app.FinalizeBlock(context.Background(), runtimeConsumerRequest(t, f, 4)); err != nil {
				t.Fatal(err)
			}
			candidate := mustJSON(t, *app.pending)
			stage := "append_synced"
			if block {
				stage = "compaction_renamed"
			}
			fault := func(at string) error {
				if at == stage {
					return errors.New("synthetic U checkpoint durability interruption")
				}
				return nil
			}
			if block {
				app.blockJournal.io.fault = fault
			} else {
				app.journal.fault = fault
			}
			if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
				t.Fatal("U persistence interruption was acknowledged")
			}
			if app.pending == nil || !bytes.Equal(candidate, mustJSON(t, *app.pending)) || !journalStateEqual(t, app.committed, f.old[2]) || app.runtimeUpgradeCursor.height != f.plan.CheckpointHeight {
				t.Fatal("U UNKNOWN promoted original state/cursor or lost pending")
			}
			original := runtimeJournalBytes(t, path)
			cold, err := openRuntimeJournalTest(f, path, block, nil, f.authorization)
			if err != nil || !bytes.Equal(candidate, mustJSON(t, cold.committed)) || cold.runtimeUpgradeCursor != nil {
				t.Fatal("original U result could not be reconciled without new execution", err)
			}
			if _, err := cold.FinalizeBlock(context.Background(), runtimeConsumerRequest(t, f, 5)); err == nil {
				t.Fatal("U recovery fabricated engine checkpoint authority")
			}
			confirmRuntimeConsumer(t, cold, f.plan, cold.committed)
			if !bytes.Equal(original, runtimeJournalBytes(t, path)) {
				t.Fatal("U recovery rewrote original uncertain bytes")
			}
		})
	}
}
