package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func journalFixture(t *testing.T) (chain.ConsensusMigrationState, string) {
	t.Helper()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	for _, seed := range []byte{11, 12} {
		if _, err := devnet.Faucet(mustNativeAddress(t, deterministicPrivateKey(seed)), 10000); err != nil {
			t.Fatal(err)
		}
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	return migration, filepath.Join(t.TempDir(), "state.journal")
}

func journalTransfer(t *testing.T, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedTransfer(deterministicPrivateKey(11), 6423, mustNativeAddress(t, deterministicPrivateKey(13)), 1, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func commitJournalBlock(t *testing.T, app *Application, nonce uint64) []byte {
	t.Helper()
	raw := journalTransfer(t, nonce)
	check, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
	if err != nil || check.Code != 0 {
		t.Fatal("valid signed next nonce refused", err)
	}
	height := int64(app.migration.Height) + int64(nonce)
	r, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+int64(nonce), 0), Txs: [][]byte{raw, raw}})
	if err != nil || len(r.TxResults) != 2 || r.TxResults[0].Code != 0 || r.TxResults[1].Code != CodeInvalidNonce {
		t.Fatal("execution/rollback behavior changed", err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestSnapshotJournalActualTransactionsMatchAtomicAcrossCompactions(t *testing.T) {
	migration, path := journalFixture(t)
	journal, err := NewJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	atomic, err := NewPersistentApplication(migration, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	compactions := 0
	for nonce := uint64(1); nonce <= 36; nonce++ {
		before := journal.journal.compactions
		raw := commitJournalBlock(t, journal, nonce)
		compactions += journal.journal.compactions - before
		commitJournalBlock(t, atomic, nonce)
		if !journalStateEqual(t, journal.committed, atomic.committed) {
			t.Fatal("full committed state differs", nonce)
		}
		loaded, err := NewJournaledApplication(migration, path)
		if err != nil {
			t.Fatal(err)
		}
		if !journalStateEqual(t, loaded.committed, atomic.committed) {
			t.Fatal("journal restart differs from atomic", nonce)
		}
		stored, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := DecodeSnapshotJournal(context.Background(), stored, migration)
		if err != nil || decoded.IncompleteTail || decoded.CompleteBytes != len(stored) || decoded.Records != loaded.journal.records || !journalStateEqual(t, decoded.State, loaded.committed) {
			t.Fatal("read-only journal decoder differs from writer recovery", err)
		}
		check, err := loaded.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
		if err != nil || check.Code != CodeInvalidNonce {
			t.Fatal("restart lost replay fence", err)
		}
		journal = loaded
	}
	if compactions != 2 {
		t.Fatal("did not cross two compaction boundaries", compactions)
	}
	if len(journal.committed.FeeEvents) != 36 {
		t.Fatal("failed duplicate charged a fee")
	}
	if _, err := NewPersistentApplication(migration, path); err == nil {
		t.Fatal("legacy reader silently accepted incompatible journal")
	}
}

func journalRecord(payload []byte) []byte {
	header := make([]byte, snapshotJournalHeader)
	binary.BigEndian.PutUint64(header[:8], uint64(len(payload)))
	sum := sha256.Sum256(header[:8])
	copy(header[8:40], sum[:])
	sum = journalRecordDigest(header[:8], payload)
	copy(header[40:], sum[:])
	return append(header, payload...)
}

func TestSnapshotJournalTornTailRecoveryAndCompleteCorruption(t *testing.T) {
	for _, mode := range []string{"partial_header", "partial_payload", "payload_corrupt", "length_corrupt", "header_checksum_corrupt", "oversize", "legacy", "permissions", "wrong_migration", "migration_header"} {
		t.Run(mode, func(t *testing.T) {
			migration, path := journalFixture(t)
			app, err := NewJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			commitJournalBlock(t, app, 1)
			prior, _ := os.ReadFile(path)
			priorState := app.committed
			pending := priorState
			pending.Height++
			payload, err := encodeCommittedStateJSON(pending)
			if err != nil {
				t.Fatal(err)
			}
			record := journalRecord(payload)
			torn := mode == "partial_header" || mode == "partial_payload"
			switch mode {
			case "partial_header":
				record = record[:snapshotJournalHeader/2]
			case "partial_payload":
				record = record[:snapshotJournalHeader+len(payload)/2]
			case "payload_corrupt":
				record[len(record)-2] ^= 1
			case "length_corrupt":
				record[7] ^= 1
			case "header_checksum_corrupt":
				record[8] ^= 1
			case "oversize":
				binary.BigEndian.PutUint64(record[:8], snapshotJournalMaxPayload+1)
				sum := sha256.Sum256(record[:8])
				copy(record[8:40], sum[:])
			case "legacy":
				prior = []byte("{}")
				record = nil
			case "permissions":
			case "wrong_migration":
				migration.StateHash = "different"
			case "migration_header":
				prior[len(snapshotJournalMagic)] ^= 1
			}
			mutated := append(append([]byte(nil), prior...), record...)
			if err := os.WriteFile(path, mutated, 0o600); err != nil {
				t.Fatal(err)
			}
			if mode == "permissions" {
				if err := os.Chmod(path, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			loaded, err := NewJournaledApplication(migration, path)
			if !torn {
				if err == nil {
					t.Fatal("complete corruption or unsafe state accepted")
				}
				return
			}
			if err != nil || !journalStateEqual(t, loaded.committed, priorState) {
				t.Fatal("torn suffix lost preceding durable state", err)
			}
			unchanged, _ := os.ReadFile(path)
			if !bytes.Equal(unchanged, mutated) {
				t.Fatal("recovery read changed original evidence")
			}
			commitJournalBlock(t, loaded, 2)
			reloaded, err := NewJournaledApplication(migration, path)
			if err != nil || reloaded.committed.Height != priorState.Height+1 || len(reloaded.committed.FeeEvents) != 2 {
				t.Fatal("torn tail was not safely replaced on actual commit", err)
			}
		})
	}
}

func TestSnapshotJournalFaultBoundariesRetainEvidenceAndRetireWriter(t *testing.T) {
	for _, stage := range []string{"append_header_written", "append_payload_written", "append_synced", "compaction_synced", "compaction_renamed"} {
		t.Run(stage, func(t *testing.T) {
			migration, path := journalFixture(t)
			app, err := NewJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			priorNonce := uint64(1)
			if stage == "compaction_synced" || stage == "compaction_renamed" {
				priorNonce = 16
			}
			for nonce := uint64(1); nonce <= priorNonce; nonce++ {
				commitJournalBlock(t, app, nonce)
			}
			previous := app.committed
			app.journal.fault = func(at string) error {
				if release, readErr := LockSnapshotJournalRead(path); !errors.Is(readErr, ErrSnapshotJournalBusy) {
					if release != nil {
						release()
					}
					t.Fatal("readback entered active writer", readErr)
				}
				if at == stage {
					return errors.New("injected persistence boundary failure")
				}
				return nil
			}
			raw := journalTransfer(t, priorNonce+1)
			_, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: previous.Height + 1, Time: time.Unix(1802736000+int64(priorNonce)+1, 0), Txs: [][]byte{raw}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
				t.Fatal("fault did not stop commit")
			}
			if !journalStateEqual(t, app.committed, previous) || app.pending == nil || !app.journal.poisoned {
				t.Fatal("uncertain persistence published memory state")
			}
			before, _ := os.ReadFile(path)
			if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
				t.Fatal("uncertain commit automatically retried")
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) {
				t.Fatal("retry changed uncertain disk evidence")
			}
			recovered, err := NewJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			want := previous.Height
			// A complete observed record after an error is an unknown prior outcome,
			// not a successful ACK. Recovery must reconcile it instead of resubmitting.
			if stage == "append_payload_written" || stage == "append_synced" {
				want++
			}
			if recovered.committed.Height != want {
				t.Fatal("recovery selected wrong complete state", stage, recovered.committed.Height, want)
			}
		})
	}
}

func TestSnapshotJournalStateSyncRestorePersistsThroughJournal(t *testing.T) {
	migration, source, _, _ := stateSyncSourceApplication(t)
	path := filepath.Join(t.TempDir(), "restored.journal")
	target, err := NewJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	info, err := source.Info(ctx, &abci.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := source.ListSnapshots(ctx, &abci.RequestListSnapshots{})
	if err != nil || len(listed.Snapshots) != 1 {
		t.Fatal("missing source snapshot", err)
	}
	snapshot := listed.Snapshots[0]
	offer, err := target.OfferSnapshot(ctx, &abci.RequestOfferSnapshot{Snapshot: cloneABCSnapshot(snapshot), AppHash: info.LastBlockAppHash})
	if err != nil || offer.Result != abci.ResponseOfferSnapshot_ACCEPT {
		t.Fatal("snapshot refused", err)
	}
	for i := uint32(0); i < snapshot.Chunks; i++ {
		chunk, err := source.LoadSnapshotChunk(ctx, &abci.RequestLoadSnapshotChunk{Height: snapshot.Height, Format: snapshot.Format, Chunk: i})
		if err != nil {
			t.Fatal(err)
		}
		applied, err := target.ApplySnapshotChunk(ctx, &abci.RequestApplySnapshotChunk{Index: i, Chunk: chunk.Chunk, Sender: "owned-source"})
		if err != nil || applied.Result != abci.ResponseApplySnapshotChunk_ACCEPT {
			t.Fatal("journal state sync persistence failed", err)
		}
	}
	recovered, err := NewJournaledApplication(migration, path)
	if err != nil || !journalStateEqual(t, recovered.committed, source.committed) {
		t.Fatal("restored snapshot did not survive journal restart", err)
	}
}

func TestSnapshotJournalWriterConflictDoesNotPublishOrRetry(t *testing.T) {
	migration, path := journalFixture(t)
	first, err := NewJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	stale, err := NewJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	commitJournalBlock(t, first, 1)
	raw := journalTransfer(t, 1)
	_, err = stale.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + 1, Time: time.Unix(1802736001, 0), Txs: [][]byte{raw}})
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	if _, err := stale.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
		t.Fatal("stale writer overwrote newer state")
	}
	if stale.committed.Initialized || stale.pending == nil || !stale.journal.poisoned {
		t.Fatal("failed persistence published memory state")
	}
	if _, err := stale.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
		t.Fatal("uncertain store automatically retried")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("stale writer changed evidence")
	}
	lock, err := first.journal.lock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewJournaledApplication(migration, path); err == nil {
		t.Fatal("concurrent writer lock bypassed")
	}
	releaseJournalLock(lock)
}

func TestSnapshotJournalAbruptProcessExit(t *testing.T) {
	if root := os.Getenv("YNX_JOURNAL_EXIT_ROOT"); root != "" {
		raw, err := os.ReadFile(filepath.Join(root, "migration.json"))
		if err != nil {
			t.Fatal(err)
		}
		var migration chain.ConsensusMigrationState
		if err := json.Unmarshal(raw, &migration); err != nil {
			t.Fatal(err)
		}
		app, err := NewJournaledApplication(migration, filepath.Join(root, "state.journal"))
		if err != nil {
			t.Fatal(err)
		}
		if stage := os.Getenv("YNX_JOURNAL_EXIT_STAGE"); stage != "" {
			app.journal.fault = func(at string) error {
				if at == stage {
					fmt.Println("JOURNAL_EXIT_STAGE", stage)
					os.Exit(17)
				}
				return nil
			}
		}
		commitJournalBlock(t, app, uint64(len(app.committed.FeeEvents)+1))
		os.Exit(17)
	}
	migration, path := journalFixture(t)
	app, err := NewJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	commitJournalBlock(t, app, 1)
	raw, err := json.Marshal(migration)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(path), "migration.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestSnapshotJournalAbruptProcessExit$")
	cmd.Env = append(os.Environ(), "YNX_JOURNAL_EXIT_ROOT="+filepath.Dir(path))
	output, err := cmd.CombinedOutput()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 17 {
		t.Fatalf("unexpected child outcome %v %s", err, output)
	}
	recovered, err := NewJournaledApplication(migration, path)
	if err != nil || len(recovered.committed.FeeEvents) != 2 || recovered.committed.Height != int64(migration.Height)+2 {
		t.Fatal("acknowledged second commit lost after process exit", err)
	}
	check, err := recovered.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: journalTransfer(t, 2)})
	if err != nil || check.Code != CodeInvalidNonce {
		t.Fatal("abrupt restart lost committed nonce", err)
	}
}

func TestSnapshotJournalAbruptAtPersistenceBoundaries(t *testing.T) {
	for _, stage := range []string{"append_header_written", "append_payload_written", "append_synced", "compaction_synced", "compaction_renamed"} {
		t.Run(stage, func(t *testing.T) {
			migration, path := journalFixture(t)
			app, err := NewJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			prior := uint64(1)
			if stage == "compaction_synced" || stage == "compaction_renamed" {
				prior = 16
			}
			for nonce := uint64(1); nonce <= prior; nonce++ {
				commitJournalBlock(t, app, nonce)
			}
			raw, err := json.Marshal(migration)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(filepath.Dir(path), "migration.json"), raw, 0o600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(os.Args[0], "-test.run=^TestSnapshotJournalAbruptProcessExit$")
			cmd.Env = append(os.Environ(), "YNX_JOURNAL_EXIT_ROOT="+filepath.Dir(path), "YNX_JOURNAL_EXIT_STAGE="+stage)
			output, err := cmd.CombinedOutput()
			var exit *exec.ExitError
			if !errors.As(err, &exit) || exit.ExitCode() != 17 || !bytes.Contains(output, []byte("JOURNAL_EXIT_STAGE "+stage)) {
				t.Fatalf("child did not exit at requested persistence boundary: %v %s", err, output)
			}
			recovered, err := NewJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			want := prior
			if stage == "append_payload_written" || stage == "append_synced" {
				want++
			}
			if recovered.committed.Height != int64(migration.Height)+int64(want) || len(recovered.committed.FeeEvents) != int(want) {
				t.Fatal("wrong recovered state after abrupt boundary exit")
			}
			check, err := recovered.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: journalTransfer(t, want)})
			if err != nil || check.Code != CodeInvalidNonce {
				t.Fatal("abrupt boundary recovery lost nonce replay fence", err)
			}
		})
	}
}

func journalStateEqual(t *testing.T, a, b CommittedState) bool {
	t.Helper()
	left, err := json.Marshal(a)
	if err != nil {
		t.Fatal(err)
	}
	right, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.Equal(left, right)
}

func TestSnapshotJournalCommitWaitsForBoundedReadback(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	commitJournalBlock(t, app, 1)
	release, err := LockSnapshotJournalRead(path)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	raw := journalTransfer(t, 2)
	_, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + 2, Time: time.Unix(1802736002, 0), Txs: [][]byte{raw}})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := app.Commit(context.Background(), &abci.RequestCommit{}); done <- err }()
	select {
	case err := <-done:
		t.Fatal("readback caused premature Commit outcome", err)
	case <-time.After(20 * time.Millisecond):
	}
	release()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal("legitimate reader poisoned writer", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("commit failed to resume after reader release")
	}
	if app.committed.Height != int64(migration.Height)+2 {
		t.Fatal("resumed commit did not publish state")
	}
}

func TestSnapshotJournalStuckReadbackHasBoundedWriterFailure(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	commitJournalBlock(t, app, 1)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	release, err := LockSnapshotJournalRead(path)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	_, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + 2, Time: time.Unix(1802736002, 0), Txs: [][]byte{journalTransfer(t, 2)}})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
		t.Fatal("stuck reader did not fail within writer bound")
	}
	if time.Since(started) > 3*time.Second || !app.journal.poisoned || app.committed.Height != int64(migration.Height)+1 {
		t.Fatal("bounded reader wait lost committed-state boundary")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("blocked writer changed stored evidence", err)
	}
}
