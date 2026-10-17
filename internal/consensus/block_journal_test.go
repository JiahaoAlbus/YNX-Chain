package consensus

import (
	"bytes"
	"context"
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

func TestBlockJournalOwnsRequestsAndMatchesAtomicAcrossCheckpoints(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	atomic, err := NewPersistentApplication(migration, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	checkpoints := 0
	for nonce := uint64(1); nonce <= 36; nonce++ {
		raw := journalTransfer(t, nonce)
		original := append([]byte(nil), raw...)
		req := &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 123).In(time.FixedZone("caller", 8*3600)), Txs: [][]byte{raw, raw, []byte("invalid-envelope")}, Hash: bytes.Repeat([]byte{11}, 32), NextValidatorsHash: bytes.Repeat([]byte{12}, 32), ProposerAddress: bytes.Repeat([]byte{13}, 20)}
		requestBytes, err := req.Marshal()
		if err != nil {
			t.Fatal(err)
		}
		old, err := atomic.FinalizeBlock(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		response, err := app.FinalizeBlock(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		a, _ := old.Marshal()
		b, _ := response.Marshal()
		if !bytes.Equal(a, b) || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce || response.TxResults[2].Code == 0 {
			t.Fatal("actual transaction results differ")
		}
		if !bytes.Equal(requestBytes, app.pendingBlockRequest) {
			t.Fatal("full request not captured")
		}
		// A caller cannot change the record after FinalizeBlock returns.
		req.Height = 0
		req.Time = time.Time{}
		req.Txs[0][0] ^= 1
		req.Hash[0] ^= 1
		req.ProposerAddress[0] ^= 1
		response.TxResults[0].Data[0] ^= 1
		before := app.blockJournal.io.compactions
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		checkpoints += app.blockJournal.io.compactions - before
		if _, err := atomic.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		if !journalStateEqual(t, app.committed, atomic.committed) {
			t.Fatal("committed full state changed", nonce)
		}
		loaded, err := NewBlockJournaledApplication(migration, path)
		if err != nil || !journalStateEqual(t, loaded.committed, atomic.committed) {
			t.Fatal("checkpoint/delta replay differs", nonce, err)
		}
		check, err := loaded.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: original})
		if err != nil || check.Code != CodeInvalidNonce {
			t.Fatal("delta restart lost replay fence", err)
		}
		app = loaded
	}
	if checkpoints != 2 || len(app.committed.FeeEvents) != 36 {
		t.Fatal("checkpoint boundaries or failed-transaction fee accounting wrong", checkpoints)
	}
	if _, err := NewJournaledApplication(migration, path); err == nil {
		t.Fatal("V1 silently accepted V2")
	}
	if _, err := NewPersistentApplication(migration, path); err == nil {
		t.Fatal("atomic JSON silently accepted V2")
	}
}

func TestBlockJournalReplaysMixedNativeEthereumAndActionWorkflow(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	for _, seed := range []byte{11, 12, 41} {
		if _, err := devnet.Faucet(mustNativeAddress(t, deterministicPrivateKey(seed)), 100000); err != nil {
			t.Fatal(err)
		}
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "mixed.blocks")
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	atomic, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	native := journalTransfer(t, 1)
	eth, _, err := NewEthereumLegacyTransfer(deterministicPrivateKey(12), 6423, 0, 1, mustNativeAddress(t, deterministicPrivateKey(13)), 10)
	if err != nil {
		t.Fatal(err)
	}
	key := deterministicPrivateKey(41)
	permission, err := NewSignedApplicationAction(key, 6423, ActionAIPermissionCreate, AIPermissionPayload{SessionID: "block-journal-session", Requester: "merchant_ops", Scope: "trust_label", Purpose: "replay scoped label", ExpiryHours: 2}, 1)
	if err != nil {
		t.Fatal(err)
	}
	permissionBytes, err := EncodeSignedApplicationAction(permission)
	if err != nil {
		t.Fatal(err)
	}
	proposal, err := NewSignedApplicationAction(key, 6423, ActionAIProposalCreate, AIActionProposalPayload{SessionID: "block-journal-session", Requester: "merchant_ops", Scope: "trust_label", ActionType: "risk label", Description: "replay bounded label", ExpiryHours: 2}, 2)
	if err != nil {
		t.Fatal(err)
	}
	proposalBytes, err := EncodeSignedApplicationAction(proposal)
	if err != nil {
		t.Fatal(err)
	}
	approval, err := NewSignedApplicationAction(key, 6423, ActionAIProposalApprove, AIActionDecisionPayload{ActionID: ApplicationActionRecordID("ai-action", ApplicationActionHash(proposalBytes)), Approver: "reviewer_1", PermissionID: ApplicationActionRecordID("ai-permission", ApplicationActionHash(permissionBytes))}, 3)
	if err != nil {
		t.Fatal(err)
	}
	approvalBytes, err := EncodeSignedApplicationAction(approval)
	if err != nil {
		t.Fatal(err)
	}
	req := &abci.RequestFinalizeBlock{Height: int64(migration.Height) + 1, Time: time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC), Txs: [][]byte{native, eth, permissionBytes, proposalBytes, approvalBytes, native}}
	for _, candidate := range []*Application{atomic, app} {
		r, err := candidate.FinalizeBlock(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		for i, result := range r.TxResults {
			if i < 5 && result.Code != 0 {
				t.Fatal("mixed workflow failed", i, result.Log)
			}
		}
		if r.TxResults[5].Code != CodeInvalidNonce {
			t.Fatal("duplicate nonce not rejected")
		}
		if _, err := candidate.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	loaded, err := NewBlockJournaledApplication(migration, path)
	if err != nil || !journalStateEqual(t, loaded.committed, atomic.committed) || len(loaded.committed.AIActions) != 1 {
		t.Fatal("mixed workflow replay state changed", err)
	}
}

func TestBlockJournalTornTailAndRecomputedChecksumCannotHideReplayMismatch(t *testing.T) {
	for _, mode := range []string{"partial_header", "partial_payload", "checksum", "prior_hash", "post_hash", "response_hash", "height", "request"} {
		t.Run(mode, func(t *testing.T) {
			migration, path := journalFixture(t)
			app, err := NewBlockJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			commitJournalBlock(t, app, 1)
			prior, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			req := &abci.RequestFinalizeBlock{Height: int64(migration.Height) + 2, Time: time.Unix(1802736002, 0), Txs: [][]byte{journalTransfer(t, 2)}}
			if _, err := app.FinalizeBlock(context.Background(), req); err != nil {
				t.Fatal(err)
			}
			record := blockJournalRecord{Kind: "block", Request: append([]byte(nil), app.pendingBlockRequest...), BeforeAppHash: app.committed.AppHash, AppHash: app.pending.AppHash, ResponseHash: app.pendingBlockResponseHash}
			switch mode {
			case "prior_hash":
				record.BeforeAppHash = "wrong"
			case "post_hash":
				record.AppHash = "wrong"
			case "response_hash":
				record.ResponseHash = "wrong"
			case "height":
				req.Height++
				record.Request, _ = req.Marshal()
			case "request":
				record.Request = []byte("bad protobuf")
			}
			payload, err := json.Marshal(record)
			if err != nil {
				t.Fatal(err)
			}
			frame := append(blockJournalFrame(payload), payload...)
			switch mode {
			case "partial_header":
				frame = frame[:snapshotJournalHeader/2]
			case "partial_payload":
				frame = frame[:snapshotJournalHeader+len(payload)/2]
			case "checksum":
				frame[len(frame)-2] ^= 1
			}
			mutated := append(append([]byte(nil), prior...), frame...)
			if err := os.WriteFile(path, mutated, 0o600); err != nil {
				t.Fatal(err)
			}
			loaded, err := NewBlockJournaledApplication(migration, path)
			if mode != "partial_header" && mode != "partial_payload" {
				if err == nil {
					t.Fatal("malformed/replayed delta accepted despite recomputed outer checksum")
				}
				return
			}
			if err != nil || !journalStateEqual(t, loaded.committed, app.committed) {
				t.Fatal("torn delta lost preceding state", err)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(after, mutated) {
				t.Fatal("recovery erased original torn evidence")
			}
			commitJournalBlock(t, loaded, 2)
			final, err := NewBlockJournaledApplication(migration, path)
			if err != nil || len(final.committed.FeeEvents) != 2 {
				t.Fatal("torn suffix replacement failed", err)
			}
		})
	}
}

func TestBlockJournalFrameLengthChecksumIsEnforced(t *testing.T) {
	header := blockJournalFrame([]byte("fixture"))
	header[7] ^= 1
	if _, _, _, err := readBlockJournalFrame(bytes.NewReader(append(header, []byte("fixture")...))); err == nil {
		t.Fatal("length corruption accepted")
	}
}

func TestBlockJournalSnapshotRestoreCreatesCheckpointAndContinues(t *testing.T) {
	migration, source, _, _ := stateSyncSourceApplication(t)
	path := filepath.Join(t.TempDir(), "restored.blocks")
	target, err := NewBlockJournaledApplication(migration, path)
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
		t.Fatal(err)
	}
	snapshot := listed.Snapshots[0]
	offer, err := target.OfferSnapshot(ctx, &abci.RequestOfferSnapshot{Snapshot: cloneABCSnapshot(snapshot), AppHash: info.LastBlockAppHash})
	if err != nil || offer.Result != abci.ResponseOfferSnapshot_ACCEPT {
		t.Fatal("checkpoint restore refused", err)
	}
	for i := uint32(0); i < snapshot.Chunks; i++ {
		chunk, err := source.LoadSnapshotChunk(ctx, &abci.RequestLoadSnapshotChunk{Height: snapshot.Height, Format: snapshot.Format, Chunk: i})
		if err != nil {
			t.Fatal(err)
		}
		applied, err := target.ApplySnapshotChunk(ctx, &abci.RequestApplySnapshotChunk{Index: i, Chunk: chunk.Chunk, Sender: "owned-source"})
		if err != nil || applied.Result != abci.ResponseApplySnapshotChunk_ACCEPT {
			t.Fatal("checkpoint restore failed", err)
		}
	}
	loaded, err := NewBlockJournaledApplication(migration, path)
	if err != nil || !journalStateEqual(t, loaded.committed, source.committed) || loaded.blockJournal.blocks != 0 {
		t.Fatal("restored checkpoint changed", err)
	}
	tx, err := NewSignedTransfer(deterministicPrivateKey(81), 6423, mustNativeAddress(t, deterministicPrivateKey(82)), 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	result, err := loaded.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: info.LastBlockHeight + 1, Time: time.Unix(1802736000, 0), Txs: [][]byte{raw}})
	if err != nil || result.TxResults[0].Code != 0 {
		t.Fatal("restored checkpoint rejected next nonce", err)
	}
	if _, err := loaded.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewBlockJournaledApplication(migration, path)
	if err != nil || !journalStateEqual(t, restarted.committed, loaded.committed) {
		t.Fatal("delta after restored checkpoint lost", err)
	}
}

func TestBlockJournalAbruptExit(t *testing.T) {
	if root := os.Getenv("YNX_BLOCK_JOURNAL_EXIT_ROOT"); root != "" {
		raw, err := os.ReadFile(filepath.Join(root, "migration.json"))
		if err != nil {
			t.Fatal(err)
		}
		var migration chain.ConsensusMigrationState
		if err := json.Unmarshal(raw, &migration); err != nil {
			t.Fatal(err)
		}
		app, err := NewBlockJournaledApplication(migration, filepath.Join(root, "state.blocks"))
		if err != nil {
			t.Fatal(err)
		}
		if stage := os.Getenv("YNX_BLOCK_JOURNAL_EXIT_STAGE"); stage != "ack" {
			app.blockJournal.io.fault = func(at string) error {
				if at == stage {
					fmt.Println("BLOCK_EXIT_STAGE", stage)
					os.Exit(17)
				}
				return nil
			}
		}
		commitJournalBlock(t, app, uint64(len(app.committed.FeeEvents)+1))
		fmt.Println("BLOCK_EXIT_STAGE", "ack")
		os.Exit(17)
	}
	for _, stage := range []string{"ack", "append_header_written", "append_payload_written", "append_synced", "compaction_synced", "compaction_renamed"} {
		t.Run(stage, func(t *testing.T) {
			migration, tmp := journalFixture(t)
			path := filepath.Join(filepath.Dir(tmp), "state.blocks")
			app, err := NewBlockJournaledApplication(migration, path)
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
			cmd := exec.Command(os.Args[0], "-test.run=^TestBlockJournalAbruptExit$")
			cmd.Env = append(os.Environ(), "YNX_BLOCK_JOURNAL_EXIT_ROOT="+filepath.Dir(path), "YNX_BLOCK_JOURNAL_EXIT_STAGE="+stage)
			output, err := cmd.CombinedOutput()
			var exit *exec.ExitError
			if !errors.As(err, &exit) || exit.ExitCode() != 17 || !bytes.Contains(output, []byte("BLOCK_EXIT_STAGE "+stage)) {
				t.Fatalf("child missed requested boundary %v %s", err, output)
			}
			loaded, err := NewBlockJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			want := prior
			if stage == "ack" || stage == "append_payload_written" || stage == "append_synced" {
				want++
			}
			if loaded.committed.Height != int64(migration.Height)+int64(want) || len(loaded.committed.FeeEvents) != int(want) {
				t.Fatal("wrong abrupt-exit recovered state")
			}
			check, err := loaded.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: journalTransfer(t, want)})
			if err != nil || check.Code != CodeInvalidNonce {
				t.Fatal("abrupt restart lost nonce replay fence", err)
			}
		})
	}
}

func TestBlockJournalFailedWriterRetiresWithoutPublishing(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	commitJournalBlock(t, app, 1)
	previous := app.committed
	app.blockJournal.io.fault = func(stage string) error {
		if stage == "append_payload_written" {
			return errors.New("injected write boundary failure")
		}
		return nil
	}
	_, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: previous.Height + 1, Time: time.Unix(1802736002, 0), Txs: [][]byte{journalTransfer(t, 2)}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
		t.Fatal("injected failure did not stop Commit")
	}
	before, _ := os.ReadFile(path)
	if !journalStateEqual(t, app.committed, previous) || app.pending == nil || !app.blockJournal.io.poisoned {
		t.Fatal("uncertain write published pending state")
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
		t.Fatal("uncertain delta automatically retried")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("retry changed uncertain evidence")
	}
	loaded, err := NewBlockJournaledApplication(migration, path)
	if err != nil || loaded.committed.Height != previous.Height+1 {
		t.Fatal("complete uncertain delta was not reconciled on recovery", err)
	}
}
