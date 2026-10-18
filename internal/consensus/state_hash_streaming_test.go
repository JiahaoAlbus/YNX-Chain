package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestStateHashFeeChunkingMatchesEveryCanonicalByte(t *testing.T) {
	weird := "\x00<>&\"\\\n汉字\u2028\u2029" + string([]byte{0xff})
	for _, count := range []int{0, 1, 255, 256, 257, 511, 512, 513, 2049} {
		fees := make([]BFTFeeEvent, count)
		for i := range fees {
			fees[i] = BFTFeeEvent{ID: weird, PolicyVersion: -1, TxHash: strings.Repeat(weird, 2), Payer: weird, Recipient: weird, TransactionType: weird, GrossFeeYNXT: math.MinInt64 + int64(i), BurnYNXT: math.MaxInt64, Sponsored: i%2 == 0, Source: weird, BlockHeight: int64(i), RecordedAt: time.Date(2026, 10, 18, 1, 2, 3, i, time.FixedZone("offset", -7*3600)), AuditHash: weird}
		}
		state := CommittedState{MigrationStateHash: weird, FeeEvents: fees, Accounts: []chain.ConsensusAccount{{Address: weird, Nonce: math.MaxUint64, Lots: map[string]int64{"z": -1, "feeEvents": 2, weird: 0}}}}
		// Encoding fixtures include deliberately invalid business fields. Their
		// purpose is canonical-byte equivalence, never business acceptance.
		for _, version := range []int{1, 8, 13} {
			doc := state.hashDocument("unchanged-domain", version)
			want, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			var actual bytes.Buffer
			if err := encodeFeeChunkedDocument(&actual, doc); err != nil || !bytes.Equal(actual.Bytes(), want) {
				t.Fatalf("canonical bytes differ count=%d version=%d: %v", count, version, err)
			}
			old, err := hashSingleBufferDocument(doc)
			if err != nil {
				t.Fatal(err)
			}
			got, err := hashCommittedStateDocument(doc)
			if err != nil || got != old {
				t.Fatalf("canonical digest differs count=%d version=%d: %v", count, version, err)
			}
		}
	}
}

type shortStateHashWriter struct{}

func (shortStateHashWriter) Write(p []byte) (int, error) { return len(p) / 2, nil }

func TestStateHashFeeChunkingRejectsLateErrorsAndInvalidFraming(t *testing.T) {
	fees := make([]BFTFeeEvent, 513)
	fees[512].RecordedAt = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
	doc := CommittedState{FeeEvents: fees}.hashDocument("unchanged-domain", 13)
	if _, err := hashSingleBufferDocument(doc); err == nil {
		t.Fatal("old encoder accepted invalid late timestamp")
	}
	if got, err := hashCommittedStateDocument(doc); err == nil || got != "" {
		t.Fatal("late chunk error produced a digest", err)
	}
	fees[512].RecordedAt = time.Time{}
	if err := encodeFeeChunkedDocument(shortStateHashWriter{}, doc); !errors.Is(err, io.ErrShortWrite) {
		t.Fatal("short write was ignored", err)
	}
	for _, raw := range []string{"", "{}\n", "[]\n", "[{}]", "[{}]\nextra"} {
		var output bytes.Buffer
		writer := feeChunkHashWriter{digest: &output, first: true}
		if _, err := writer.Write([]byte(raw)); err == nil {
			t.Fatal("invalid chunk framing accepted", raw)
		}
	}
	for _, raw := range []string{"[]", "{}", `{"feeEvents":null}`, `{"nested":{"feeEvents":[]}}`} {
		if _, _, err := feeArrayBounds([]byte(raw)); err == nil {
			t.Fatal("invalid top-level fee array accepted", raw)
		}
	}
}

func TestStateHashFeeChunkingRealSignedHistoryPreservesRestartAndAudit(t *testing.T) {
	key := deterministicPrivateKey(211)
	sender := mustNativeAddress(t, key)
	recipient := mustNativeAddress(t, deterministicPrivateKey(212))
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 100000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "state.journal")
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	var first []byte
	for block := 0; block < 2; block++ {
		raws := make([][]byte, 256)
		for i := range raws {
			tx, err := NewSignedTransfer(key, migration.Network.ChainID, recipient, 1, uint64(block*256+i+1))
			if err != nil {
				t.Fatal(err)
			}
			raws[i], err = EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
		}
		if first == nil {
			first = raws[0]
		}
		response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(block) + 1, Time: time.Unix(1802736000+int64(block), 0), Txs: raws})
		if err != nil {
			t.Fatal(err)
		}
		for _, result := range response.TxResults {
			if result.Code != 0 {
				t.Fatal("actual transfer rejected", result)
			}
		}
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	if len(app.committed.FeeEvents) != 512 {
		t.Fatal("actual history count differs")
	}
	doc := app.committed.hashDocument("YNX_ABCI_STATE_V13", CommittedStateVersion)
	old, err := hashSingleBufferDocument(doc)
	if err != nil || old != app.committed.AppHash {
		t.Fatal("real state differs from original encoder", err)
	}
	want, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var actual bytes.Buffer
	if err := encodeFeeChunkedDocument(&actual, doc); err != nil || !bytes.Equal(actual.Bytes(), want) {
		t.Fatal("real canonical bytes differ", err)
	}
	restarted, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(app.committed)
	after, _ := json.Marshal(restarted.committed)
	if !bytes.Equal(before, after) {
		t.Fatal("full state changed on restart")
	}
	check, err := restarted.CheckTx(ctx, &abci.RequestCheckTx{Tx: first})
	if err != nil || check.Code == 0 {
		t.Fatal("committed nonce replay accepted", err)
	}
	bad := app.committed
	bad.FeeEvents = append([]BFTFeeEvent(nil), bad.FeeEvents...)
	bad.FeeEvents[300].AuditHash = "tampered"
	if err := bad.Validate(migration); err == nil {
		t.Fatal("later chunk fee audit was skipped")
	}
	t.Log("512 real signed transfers committed and reopened; all canonical bytes match original encoder; not network TPS")
}
