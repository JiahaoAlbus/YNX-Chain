package consensus

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestBlockJournalBoundedPrefixHasInstanceLimitsAndOriginalValidation(t *testing.T) {
	migration, path := journalFixture(t)
	for _, limit := range []int{0, (16 << 20) - 1, (512 << 20) + 1} {
		if _, err := NewBoundedBlockJournalNativeClonePrefixDecoder(migration, limit); err == nil {
			t.Fatal("invalid scoped byte limit accepted", limit)
		}
	}
	legacy, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := NewBoundedBlockJournalNativeClonePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	if legacy.ByteLimit() != 16<<20 || scoped.ByteLimit() != 32<<20 || scoped.nativeSuffixSetup {
		t.Fatal("constructor changed original limit or suffix mode")
	}
	oversized := make([]byte, (16<<20)+1)
	if _, err := legacy.Decode(context.Background(), oversized); err == nil || !strings.Contains(err.Error(), "explicit16MiB") {
		t.Fatal("legacy input bound changed", err)
	}
	if _, err := scoped.Decode(context.Background(), oversized); err == nil || strings.Contains(err.Error(), "bound") {
		t.Fatal("scoped input must pass its size gate but fail original journal validation", err)
	}
	if _, err := scoped.Decode(context.Background(), make([]byte, (32<<20)+1)); err == nil || !strings.Contains(err.Error(), "33554432-byte bound") {
		t.Fatal("selected instance input bound was not enforced", err)
	}
	// Invalid larger input must not publish a cache certificate or execution.
	if scoped.prefix != nil || scoped.VerificationStats().SuccessfulVerifications != 0 {
		t.Fatal("invalid larger input published reusable state")
	}
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	for nonce := uint64(1); nonce <= 3; nonce++ {
		raw := journalTransfer(t, nonce)
		if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0), Txs: [][]byte{raw}}); err != nil {
			t.Fatal(err)
		}
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		input, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		want, err := legacy.Decode(context.Background(), input)
		if err != nil {
			t.Fatal(err)
		}
		got, err := scoped.Decode(context.Background(), input)
		if err != nil || got.State.AppHash != want.State.AppHash || string(got.SnapshotJSON) != string(want.SnapshotJSON) || got.State.Height != want.State.Height {
			t.Fatal("scoped limit changed original signed execution/state", err)
		}
		if nonce > 1 && got.ReusedPrefixBytes <= 0 {
			t.Fatal("history extension did not reuse validated prefix")
		}
		corrupt := append([]byte(nil), input...)
		corrupt[0] ^= 1
		if _, err := scoped.Decode(context.Background(), corrupt); err == nil {
			t.Fatal("scoped limit accepted corrupt current journal")
		}
		if _, err := scoped.Decode(context.Background(), input); err != nil {
			t.Fatal("failed input poisoned previously valid prefix", err)
		}
	}
	if legacy.ByteLimit() != 16<<20 {
		t.Fatal("scoped instance modified another decoder")
	}
}
