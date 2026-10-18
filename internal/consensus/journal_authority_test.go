package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
)

func openAuthorityTestJournal(f *validatorRegistryFixture, path string, block bool, authorization *PQEngineAuthorization) (*Application, error) {
	if block {
		if authorization != nil {
			return NewBlockJournaledApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, authorization)
		}
		return NewBlockJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
	}
	if authorization != nil {
		return NewJournaledApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, authorization)
	}
	return NewJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
}

// Both layouts are populated through the real normal writer and ABCI ingress.
// Original real PoP events come from the shared committed-engine fixture; no
// checkpoint is hand-seeded and no private state is relabeled initialized.
func registeredAuthorityJournal(t *testing.T, block bool) (*validatorRegistryFixture, *Application, *PQEngineAuthorization, *PQEngineSchedule, string) {
	t.Helper()
	f, reference, _ := committedEngineFixture(t)
	path := filepath.Join(t.TempDir(), "original.journal")
	a, err := openAuthorityTestJournal(f, path, block, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.InitChain(context.Background(), f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	var txs [][]byte
	for _, event := range reference.committed.ValidatorRegistry.Events {
		tx, err := EncodeValidatorRegistryTransaction(event.Wire)
		if err != nil {
			t.Fatal(err)
		}
		txs = append(txs, tx)
	}
	result, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: txs})
	if err != nil || len(result.TxResults) != len(txs) {
		t.Fatal("normal journal registry ingress failed", err)
	}
	for _, tx := range result.TxResults {
		if tx.Code != 0 {
			t.Fatal(tx.Log)
		}
	}
	if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if !journalStateEqual(t, a.committed, reference.committed) {
		t.Fatal("normal journal registry differs from actual atomic executor")
	}
	schedule, err := NewPQEngineSchedule(f.bootstrap, a.committed.ValidatorRegistry, a.committed.Height, a.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := NewPQEngineAuthorization(raw, hash)
	if err != nil {
		t.Fatal(err)
	}
	a, err = openAuthorityTestJournal(f, path, block, authorization)
	if err != nil {
		t.Fatal("cold journal lost independently authorized registry", err)
	}
	return f, a, authorization, schedule, path
}

func finalizeAuthorityJournal(t *testing.T, a *Application, height int64) {
	t.Helper()
	snapshot, err := a.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	next, err := snapshot.ExpectedValidatorHash(height + 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, NextValidatorsHash: next}); err != nil {
		t.Fatal(err)
	}
}

func TestAuthorizedJournalsRealRegistryScheduleAndColdContinuation(t *testing.T) {
	for _, block := range []bool{false, true} {
		name := "snapshot"
		if block {
			name = "block"
		}
		t.Run(name, func(t *testing.T) {
			f, a, auth, schedule, path := registeredAuthorityJournal(t, block)
			originalAccounts := mustJSON(t, a.committed.Accounts)
			originalRegistry := mustJSON(t, a.committed.ValidatorRegistry)
			for height := schedule.AuthorizedAt; height <= schedule.ActivationHeight+2; height++ {
				before, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				previous := a.committed.AppHash
				finalizeAuthorityJournal(t, a, height)
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(before, after) || a.committed.AppHash != previous {
					t.Fatal("pending schedule mutated durable journal or committed state", err)
				}
				if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
					t.Fatal(err)
				}
				cold, err := openAuthorityTestJournal(f, path, block, auth)
				if err != nil || !journalStateEqual(t, cold.committed, a.committed) {
					t.Fatal("authorized normal journal cold replay changed complete state", err)
				}
				if cold.bootstrap != f.bootstrap || cold.committed.bootstrap != f.bootstrap || cold.pqEngineAuthorization != auth || cold.replayStateVersion != 0 {
					t.Fatal("trusted runtime source was dropped or decoder-only mode leaked")
				}
				a = cold
			}
			if !bytes.Equal(originalAccounts, mustJSON(t, a.committed.Accounts)) || !bytes.Equal(originalRegistry, mustJSON(t, a.committed.ValidatorRegistry)) {
				t.Fatal("schedule replay changed balances, nonce or full registration history")
			}
			if _, err := openAuthorityTestJournal(f, path, block, nil); err == nil {
				t.Fatal("saved schedule granted authority without independent pin")
			}
			if block {
				if _, err := NewBlockJournaledApplication(f.migration, path); err == nil {
					t.Fatal("legacy constructor trusted serialized registry")
				}
			} else if _, err := NewJournaledApplication(f.migration, path); err == nil {
				t.Fatal("legacy constructor trusted serialized registry")
			}
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			broken := append(bytes.Clone(original), 1, 2, 3)
			if err := os.WriteFile(path, broken, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := openAuthorityTestJournal(f, path, block, auth); err == nil {
				t.Fatal("authorized journal silently accepted an incomplete tail")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(after, broken) {
				t.Fatal("refused journal tail was truncated or rewritten", err)
			}
		})
	}
}

func TestAuthorizedJournalsUnknownRetainsCandidateAndReconcilesOriginal(t *testing.T) {
	for _, block := range []bool{false, true} {
		for _, stage := range []string{"append_header_written", "append_synced"} {
			name := "snapshot/" + stage
			if block {
				name = "block/" + stage
			}
			t.Run(name, func(t *testing.T) {
				f, a, auth, schedule, path := registeredAuthorityJournal(t, block)
				// First commit the schema/schedule checkpoint. The injected fault
				// targets a normal same-version append, not a different format.
				finalizeAuthorityJournal(t, a, schedule.AuthorizedAt)
				if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
					t.Fatal(err)
				}
				previous := a.committed.AppHash
				finalizeAuthorityJournal(t, a, schedule.AuthorizedAt+1)
				candidate := mustJSON(t, *a.pending)
				fault := func(at string) error {
					if at == stage {
						return errors.New("public synthetic journal persistence interruption")
					}
					return nil
				}
				if block {
					a.blockJournal.io.fault = fault
				} else {
					a.journal.fault = fault
				}
				if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
					t.Fatal("injected incomplete/unknown append reported success")
				}
				if a.pending == nil || !bytes.Equal(candidate, mustJSON(t, *a.pending)) || a.committed.AppHash != previous {
					t.Fatal("uncertain append lost exact candidate or advanced committed state")
				}
				if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
					t.Fatal("poisoned writer silently retried UNKNOWN")
				}
				before, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				cold, err := openAuthorityTestJournal(f, path, block, auth)
				if stage == "append_header_written" {
					if err == nil {
						t.Fatal("cold authorized writer concealed a partial UNKNOWN frame")
					}
				} else if err != nil || !bytes.Equal(candidate, mustJSON(t, cold.committed)) {
					t.Fatal("complete unacknowledged record failed exact cold reconciliation", err)
				}
				after, readErr := os.ReadFile(path)
				if readErr != nil || !bytes.Equal(before, after) {
					t.Fatal("recovery changed original unknown journal bytes", readErr)
				}
			})
		}
	}
}

func TestAuthorizedJournalsRefuseSubstitutedAuthorityAndRetainOriginal(t *testing.T) {
	for _, block := range []bool{false, true} {
		name := "snapshot"
		if block {
			name = "block"
		}
		t.Run(name, func(t *testing.T) {
			f, a, auth, schedule, path := registeredAuthorityJournal(t, block)
			missing := filepath.Join(t.TempDir(), "missing-original.journal")
			if _, err := openAuthorityTestJournal(f, missing, block, auth); err == nil {
				t.Fatal("schedule for an existing registry created a replacement journal")
			}
			for _, p := range []string{missing, missing + ".lock", missing + ".read.lock"} {
				if _, err := os.Lstat(p); !os.IsNotExist(err) {
					t.Fatal("missing original refusal created a file", p, err)
				}
			}
			finalizeAuthorityJournal(t, a, schedule.AuthorizedAt)
			if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			wrongSchedule, err := NewPQEngineSchedule(f.bootstrap, a.committed.ValidatorRegistry, schedule.RegistryHeight, schedule.ActivationHeight+1)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(wrongSchedule)
			if err != nil {
				t.Fatal(err)
			}
			pin, err := wrongSchedule.Hash()
			if err != nil {
				t.Fatal(err)
			}
			wrongAuth, err := NewPQEngineAuthorization(raw, pin)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := openAuthorityTestJournal(f, path, block, wrongAuth); err == nil {
				t.Fatal("wrong independent schedule replaced committed authority")
			}
			wrongRaw := append(bytes.Clone(f.raw), '\n')
			hash := sha256.Sum256(wrongRaw)
			pins := f.pins
			pins.CometGenesisSHA256 = hex.EncodeToString(hash[:])
			wrongBootstrap, err := NewConsensusBootstrap(wrongRaw, pins, f.migration)
			if err != nil {
				t.Fatal(err)
			}
			other := *f
			other.bootstrap = wrongBootstrap
			if _, err := openAuthorityTestJournal(&other, path, block, auth); err == nil {
				t.Fatal("journal accepted another independently pinned raw genesis")
			}
			if err := os.Chmod(path, 0644); err != nil {
				t.Fatal(err)
			}
			if _, err := openAuthorityTestJournal(f, path, block, auth); err == nil {
				t.Fatal("journal permissions were ignored")
			}
			if err := os.Chmod(path, 0600); err != nil {
				t.Fatal(err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(original, after) {
				t.Fatal("authority/permission refusal changed original journal", err)
			}
			// Recompute the outer state hash and the real frame checksum. The
			// original registry proof must still be validated at cold startup.
			forged := a.committed
			forged.ValidatorRegistry = cloneValidatorRegistry(forged.ValidatorRegistry)
			forged.ValidatorRegistry.Events[0].Wire[0] ^= 1
			forged.AppHash, err = forged.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			var payload []byte
			var data []byte
			if block {
				payload, err = encodeBlockCheckpoint(forged)
				data = []byte(blockJournalMagic + f.migration.StateHash + "\n")
			} else {
				payload, err = encodeCommittedStateJSON(forged)
				data = []byte(snapshotJournalMagic + f.migration.StateHash + "\n")
			}
			if err != nil {
				t.Fatal(err)
			}
			data = append(data, journalRecord(payload)...)
			if err := os.WriteFile(path, data, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := openAuthorityTestJournal(f, path, block, auth); err == nil {
				t.Fatal("rehashed journal bypassed original full registry proof")
			}
			after, err = os.ReadFile(path)
			if err != nil || !bytes.Equal(after, data) {
				t.Fatal("rejected rehashed source was modified", err)
			}
		})
	}
}
