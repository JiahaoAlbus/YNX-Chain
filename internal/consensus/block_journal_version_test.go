package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

// Build historical records independently of the decoder's replay-version hook.
// Execute actual signed classic transfers, then retain the exact pre-protocol
// state/response projection: d47b0fb8bf817093d1da0cd0dc8b08725bfae0f7
// never stored NativeTransfers, TraceLots or PQ authorization fields. The old
// version's hash projection is also exercised by state_compatibility_test.go.
// This fixture does not generate its expected result by calling the reader
// under test or by setting Application.replayStateVersion.
func historicalBlockJournalFixture(t *testing.T, version int) (chain.ConsensusMigrationState, string, []byte, CommittedState) {
	t.Helper()
	migration, path := journalFixture(t)
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	data := []byte(blockJournalMagic + migration.StateHash + "\n")
	var previous CommittedState
	for nonce := uint64(1); nonce <= 3; nonce++ {
		wire := journalTransfer(t, nonce)
		request := &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0).UTC(), Txs: [][]byte{wire, wire}}
		response, err := app.FinalizeBlock(context.Background(), request)
		if err != nil || len(response.TxResults) != 2 || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce {
			t.Fatal("fixture classic execution differs", err, response)
		}
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		old := app.committed
		old.Version = version
		// Unmarshal into a fresh value: removed fields must not survive from
		// the normal runtime's state when constructing the old wire object.
		var projected CommittedState
		if err := json.Unmarshal(historicalPerformanceStateJSON(t, old), &projected); err != nil {
			t.Fatal(err)
		}
		projected.AppHash, err = projected.calculateHash()
		if err != nil {
			t.Fatal(err)
		}
		if err := projected.Validate(migration); err != nil {
			t.Fatal("invalid historical checkpoint fixture", err)
		}
		record := blockJournalRecord{Kind: "checkpoint", Snapshot: &projected}
		if nonce > 1 {
			requestBytes, err := request.Marshal()
			if err != nil {
				t.Fatal(err)
			}
			response.AppHash, err = hex.DecodeString(projected.AppHash)
			if err != nil {
				t.Fatal(err)
			}
			responseHash, err := finalizeResponseHash(response)
			if err != nil {
				t.Fatal(err)
			}
			record = blockJournalRecord{Kind: "block", Request: requestBytes, BeforeAppHash: previous.AppHash, AppHash: projected.AppHash, ResponseHash: responseHash}
		}
		payload, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		data = append(data, journalRecord(payload)...)
		previous = projected
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return migration, path, data, previous
}

func versionJournalRecords(t *testing.T, data []byte, migration chain.ConsensusMigrationState) []blockJournalRecord {
	t.Helper()
	header := []byte(blockJournalMagic + migration.StateHash + "\n")
	if !bytes.HasPrefix(data, header) {
		t.Fatal("journal header changed")
	}
	r := bytes.NewReader(data[len(header):])
	var records []blockJournalRecord
	for r.Len() != 0 {
		payload, _, partial, err := readBlockJournalFrame(r)
		if err != nil || partial || len(payload) == 0 {
			t.Fatal("expected a complete original-format frame", err)
		}
		var record blockJournalRecord
		if err := decodeStrictJSON(payload, &record); err != nil {
			t.Fatal(err)
		}
		records = append(records, record)
	}
	return records
}

func TestBlockJournalHistoricalVersionReplay(t *testing.T) {
	for _, version := range []int{12, 13} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			migration, path, original, expected := historicalBlockJournalFixture(t, version)
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := DecodeBlockJournal(context.Background(), original, migration)
			if err != nil || decoded.IncompleteTail || decoded.ReplayedBlocks != 2 || decoded.CompleteBytes != len(original) || !journalStateEqual(t, decoded.State, expected) {
				t.Fatal("decoder did not preserve historical state and response hashes", err)
			}
			app, err := NewBlockJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			if !journalStateEqual(t, app.committed, expected) || app.committed.Version != version || app.replayStateVersion != 0 || app.blockJournal.stateVersion != version || len(app.committed.NativeTransfers) != 0 || app.committed.TraceLots != nil {
				t.Fatal("reader changed original state or leaked decoder-only execution mode")
			}
			afterInfo, statErr := os.Stat(path)
			after, readErr := os.ReadFile(path)
			if statErr != nil || readErr != nil || !bytes.Equal(original, after) || !os.SameFile(info, afterInfo) || !info.ModTime().Equal(afterInfo.ModTime()) {
				t.Fatal("startup rewrote original journal evidence", statErr, readErr)
			}
			check, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: journalTransfer(t, 3)})
			if err != nil || check.Code != CodeInvalidNonce {
				t.Fatal("old replay lost nonce history", err)
			}
			// Recompute framing checksums; these must still fail semantic replay.
			for _, corrupt := range []string{"checkpoint_version", "response_hash", "new_domain_delta"} {
				t.Run(corrupt, func(t *testing.T) {
					records := versionJournalRecords(t, original, migration)
					switch corrupt {
					case "checkpoint_version":
						records[0].Snapshot.Version = 25 - version // swap v12/v13
					case "response_hash":
						records[1].ResponseHash = fmt.Sprintf("%064x", 1)
					case "new_domain_delta":
						// A delta cannot select a new version through its result hash.
						modern := expected
						modern.Version = CommittedStateVersion
						newHash, err := modern.calculateHash()
						if err != nil {
							t.Fatal(err)
						}
						records[1].AppHash = newHash
					}
					forged := []byte(blockJournalMagic + migration.StateHash + "\n")
					for _, record := range records {
						payload, err := json.Marshal(record)
						if err != nil {
							t.Fatal(err)
						}
						forged = append(forged, journalRecord(payload)...)
					}
					if _, err := DecodeBlockJournal(context.Background(), forged, migration); err == nil {
						t.Fatal("checksummed journal tampering changed its replay domain or response")
					}
				})
			}
		})
	}
}

func TestBlockJournalVersionUpgradeUsesCompleteNextCheckpoint(t *testing.T) {
	for _, version := range []int{12, 13} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			migration, path, _, old := historicalBlockJournalFixture(t, version)
			app, err := NewBlockJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			commitJournalBlock(t, app, 4)
			if app.committed.Version != CommittedStateVersion || app.committed.Height != old.Height+1 || len(app.committed.FeeEvents) != 4 || len(app.committed.NativeTransfers) != 1 || app.blockJournal.io.records != 1 || app.blockJournal.blocks != 0 {
				t.Fatal("upgrade did not preserve old records and commit the complete next state")
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			records := versionJournalRecords(t, data, migration)
			if len(records) != 1 || records[0].Kind != "checkpoint" || records[0].Snapshot == nil || len(records[0].Request) != 0 || !journalStateEqual(t, *records[0].Snapshot, app.committed) {
				t.Fatal("upgrade appended a mixed-domain delta instead of the full next checkpoint")
			}
			cold, err := NewBlockJournaledApplication(migration, path)
			if err != nil || !journalStateEqual(t, cold.committed, app.committed) || cold.replayStateVersion != 0 {
				t.Fatal("new-domain checkpoint did not recover", err)
			}
			commitJournalBlock(t, cold, 5)
			reloaded, err := NewBlockJournaledApplication(migration, path)
			if err != nil || !journalStateEqual(t, reloaded.committed, cold.committed) || reloaded.blockJournal.blocks != 1 || len(reloaded.committed.NativeTransfers) != 2 {
				t.Fatal("same-version delta after upgrade did not recover", err)
			}
		})
	}
}

func TestBlockJournalVersionUpgradeFailurePreservesEvidence(t *testing.T) {
	for _, version := range []int{12, 13} {
		for _, stage := range []string{"compaction_synced", "compaction_renamed"} {
			t.Run(fmt.Sprintf("v%d/%s", version, stage), func(t *testing.T) {
				migration, path, original, old := historicalBlockJournalFixture(t, version)
				app, err := NewBlockJournaledApplication(migration, path)
				if err != nil {
					t.Fatal(err)
				}
				wire := journalTransfer(t, 4)
				response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: old.Height + 1, Time: time.Unix(1802736004, 0).UTC(), Txs: [][]byte{wire}})
				if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
					t.Fatal("next actual transfer failed", err)
				}
				expected := *app.pending
				fired := false
				app.blockJournal.io.fault = func(at string) error {
					if at == stage {
						fired = true
						return errors.New("injected version checkpoint boundary failure")
					}
					return nil
				}
				if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil || !fired {
					t.Fatal("requested upgrade durability failure was not observed", err)
				}
				if !journalStateEqual(t, app.committed, old) || app.pending == nil || !journalStateEqual(t, *app.pending, expected) || !app.blockJournal.io.poisoned {
					t.Fatal("uncertain checkpoint published or erased pending intent")
				}
				uncertain, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if stage == "compaction_synced" && !bytes.Equal(original, uncertain) {
					t.Fatal("pre-rename failure changed original journal")
				}
				app.blockJournal.io.fault = nil
				if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
					t.Fatal("uncertain checkpoint was automatically retried")
				}
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(uncertain, after) {
					t.Fatal("poisoned retry changed original outcome evidence", err)
				}
				cold, err := NewBlockJournaledApplication(migration, path)
				if err != nil {
					t.Fatal(err)
				}
				want := old
				if stage == "compaction_renamed" {
					want = expected
					records := versionJournalRecords(t, uncertain, migration)
					if len(records) != 1 || records[0].Snapshot == nil || !journalStateEqual(t, *records[0].Snapshot, expected) {
						t.Fatal("post-rename UNKNOWN does not contain the complete next checkpoint")
					}
				}
				if !journalStateEqual(t, cold.committed, want) {
					t.Fatal("recovery did not reconcile the exact original checkpoint outcome")
				}
				check, err := cold.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: wire})
				wantCode := uint32(0)
				if stage == "compaction_renamed" {
					wantCode = CodeInvalidNonce
				}
				if err != nil || check.Code != wantCode {
					t.Fatal("recovery nonce does not match reconciled state", err)
				}
			})
		}
	}
}
