package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"os"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestBlockJournalReaderMatchesCompleteAndPartialOriginalReplay(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	for nonce := uint64(1); nonce <= 2; nonce++ {
		response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{
			Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0),
			Txs: [][]byte{journalTransfer(t, nonce), []byte("original-invalid-transaction")},
		})
		if err != nil || response.TxResults[0].Code != 0 || response.TxResults[1].Code == 0 {
			t.Fatalf("fixture did not execute the real original success/failure: %v", err)
		}
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := bytes.Clone(raw)
	corrupt[len(corrupt)-1] ^= 1
	declaredTail := make([]byte, snapshotJournalHeader)
	binary.BigEndian.PutUint64(declaredTail[:8], blockJournalMaxFrame)
	hash := sha256.Sum256(declaredTail[:8])
	copy(declaredTail[8:40], hash[:])
	for name, data := range map[string][]byte{
		"complete": raw, "partial-last-payload": raw[:len(raw)-1],
		"partial-next-header": append(bytes.Clone(raw), 1), "corrupt-checksum": corrupt,
		"absent-large-tail": append(bytes.Clone(raw), declaredTail...), "wrong-header": []byte("wrong original header"),
	} {
		t.Run(name, func(t *testing.T) {
			original := bytes.Clone(data)
			expected, oldErr := DecodeBlockJournal(context.Background(), data, migration)
			actual, err := DecodeBlockJournalReader(context.Background(), bytes.NewReader(data), int64(len(data)), migration)
			if (err != nil) != (oldErr != nil) {
				t.Fatalf("reader changed the original corruption/partial-tail decision: old=%v new=%v", oldErr, err)
			}
			if err == nil && (!bytes.Equal(actual.SnapshotJSON, expected.SnapshotJSON) || actual.CompleteBytes != expected.CompleteBytes || actual.IncompleteTail != expected.IncompleteTail || actual.ReplayedBlocks != expected.ReplayedBlocks || actual.ReplayedTransactionInputs != expected.ReplayedTransactionInputs || actual.State.AppHash != expected.State.AppHash || actual.State.Initialized != expected.State.Initialized) {
				t.Fatal("reader changed complete reconstruction, replay results or partial-tail boundaries")
			}
			if !bytes.Equal(data, original) {
				t.Fatal("read-only decode changed the original journal bytes")
			}
		})
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.Seek(7, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeBlockJournalReader(context.Background(), file, int64(len(raw)), migration); err != nil {
		t.Fatal(err)
	}
	position, err := file.Seek(0, 1)
	if err != nil || position != 7 {
		t.Fatal("reader changed the caller's original descriptor offset", position, err)
	}
}

func TestBlockJournalReaderRetainsOriginalBoundsAndContext(t *testing.T) {
	migration, _ := journalFixture(t)
	if _, err := DecodeBlockJournalReader(context.Background(), nil, 0, migration); err == nil {
		t.Fatal("nil original reader accepted")
	}
	if _, err := DecodeBlockJournalReader(context.Background(), bytes.NewReader(nil), -1, migration); err == nil {
		t.Fatal("negative original byte count accepted")
	}
	never := &blockJournalNoReadAt{}
	if _, err := DecodeBlockJournalReader(context.Background(), never, 2<<30, migration); err == nil || never.read {
		t.Fatal("oversized input was read or original capacity was relaxed", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := DecodeBlockJournalReader(ctx, never, 0, migration); !errors.Is(err, context.Canceled) || never.read {
		t.Fatal("canceled reader performed replay", err)
	}
}

type blockJournalNoReadAt struct{ read bool }

func (r *blockJournalNoReadAt) ReadAt([]byte, int64) (int, error) {
	r.read = true
	return 0, errors.New("unexpected original reader access")
}
