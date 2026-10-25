package consensus

import (
	"bytes"
	"context"
	"os"
	"reflect"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestPreparedSnapshotJSONEncodingRealPairAndDefaults(t *testing.T) {
	migration, path := journalFixture(t)
	before, err := NewBoundedBlockJournalPreparedNativeJSONPrefixDecoder(migration, 32<<20, PreparedNativeOriginalJSON)
	if err != nil {
		t.Fatal(err)
	}
	after, err := NewBoundedBlockJournalPreparedNativeJSONPrefixDecoder(migration, 32<<20, PreparedNativeFeeJSON)
	if err != nil {
		t.Fatal(err)
	}
	defaultDecoder, err := NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, 32<<20)
	if err != nil || defaultDecoder.PreparedNativeJSONEncoding() != PreparedNativeFeeJSON {
		t.Fatal("existing prepared default changed", err)
	}
	if before.PreparedNativeJSONEncoding() != PreparedNativeOriginalJSON || after.PreparedNativeJSONEncoding() != PreparedNativeFeeJSON || before.ByteLimit() != after.ByteLimit() {
		t.Fatal("constructor encoder/bounds differ")
	}
	if d, err := NewBoundedBlockJournalPreparedNativeJSONPrefixDecoder(migration, 32<<20, "unknown"); err == nil || d != nil {
		t.Fatal("unknown encoder accepted")
	}
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	var actualCalls [2]uint64
	for nonce := uint64(1); nonce <= 3; nonce++ {
		raw := journalTransfer(t, nonce)
		response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0).UTC(), Txs: [][]byte{raw, raw}})
		if err != nil || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce {
			t.Fatal("signed/nonce execution differs", err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		a, err := before.DecodeWithCertificateAndSuffixReplayPhaseTiming(context.Background(), data)
		if err != nil {
			t.Fatal(err)
		}
		b, err := after.DecodeWithCertificateAndSuffixReplayPhaseTiming(context.Background(), data)
		if err != nil || !bytes.Equal(a.SnapshotJSON, b.SnapshotJSON) || !reflect.DeepEqual(a.State, b.State) {
			t.Fatal("encoder-only pair changed complete state/bytes", err)
		}
		actualCalls[0] += a.WorkPhases.PreparedEncodeDetails.JSONEncode.Calls
		actualCalls[1] += b.WorkPhases.PreparedEncodeDetails.JSONEncode.Calls
	}
	if actualCalls[0] == 0 || actualCalls[0] != actualCalls[1] {
		t.Fatal("both actual encoder paths required", actualCalls)
	}
}
