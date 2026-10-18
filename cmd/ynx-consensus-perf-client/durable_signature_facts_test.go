package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestStreamingWorkloadSignatureFactsNeverAuthorizeAbsentExecution(t *testing.T) {
	_, migration, path, raw, height := durableReaderFixture(t)
	reader, err := newDurableReaderWithLimits(migration, []string{path}, 16<<20, 16<<20)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := reader.verify(context.Background(), path, raw, height); err != nil {
			t.Fatal(err)
		}
	}
	facts := reader.stats().SignatureFacts
	if facts == nil || facts.Verified != 1 || facts.Hits != 1 {
		t.Fatal("successful signature not reused", facts)
	}
	original, err := consensus.DecodeSignedTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	next, err := consensus.NewSignedTransfer(secp256k1.PrivKeyFromBytes([]byte{111}), migration.Network.ChainID, original.To, 3, 2)
	if err != nil {
		t.Fatal(err)
	}
	absent, err := consensus.EncodeSignedTransaction(next)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := reader.verify(context.Background(), path, absent, height); err == nil {
			t.Fatal("valid signature granted absent fee/nonce execution")
		}
	}
	facts = reader.stats().SignatureFacts
	if facts.Verified != 2 || facts.Hits != 2 {
		t.Fatal("absent execution did not exercise verified-fact hit", facts)
	}
}

func TestStreamingWorkloadSignatureFactsBindChainBytesAndOwnership(t *testing.T) {
	_, migration, _, raw, _ := durableReaderFixture(t)
	var facts durableSignatureFacts
	owned := append([]byte(nil), raw...)
	first, err := facts.decode(raw, migration.Network.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	first.From = "changed caller value"
	raw[0] = '!'
	if _, err := facts.decode(raw, migration.Network.ChainID); err == nil {
		t.Fatal("modified bytes reused valid fact")
	}
	again, err := facts.decode(owned, migration.Network.ChainID)
	if err != nil || again.From == first.From {
		t.Fatal("caller mutation escaped", err)
	}
	if _, err := facts.decode(owned, migration.Network.ChainID+1); err == nil {
		t.Fatal("cross-chain fact reused")
	}
	for _, mutate := range []func(*consensus.SignedTransaction){
		func(tx *consensus.SignedTransaction) { tx.Version++ },
		func(tx *consensus.SignedTransaction) { tx.PublicKey = "00" },
	} {
		changed := again
		mutate(&changed)
		changedRaw, err := json.Marshal(changed)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := facts.decode(changedRaw, migration.Network.ChainID); err == nil {
			t.Fatal("foreign version/public-key context accepted")
		}
	}
	again.Amount++
	invalid, err := json.Marshal(again)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := facts.decode(invalid, migration.Network.ChainID); err == nil {
			t.Fatal("tampered amount accepted")
		}
	}
	if stats := facts.stats(); stats.Verified != 1 || stats.Entries != 1 || stats.Hits != 1 {
		t.Fatal("failed signature retained", stats)
	}
}

func TestStreamingWorkloadSignatureFactsEvictUnderCountAndByteCaps(t *testing.T) {
	_, migration, _, raw, _ := durableReaderFixture(t)
	tx, err := consensus.DecodeSignedTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	var facts durableSignatureFacts
	key := secp256k1.PrivKeyFromBytes([]byte{111})
	for i := 1; i <= durableSignatureCapacity+1; i++ {
		signed, err := consensus.NewSignedTransfer(key, migration.Network.ChainID, tx.To, 3, uint64(i))
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := consensus.EncodeSignedTransaction(signed)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := facts.decode(encoded, migration.Network.ChainID); err != nil {
			t.Fatal(err)
		}
	}
	if stats := facts.stats(); stats.Entries != durableSignatureCapacity || stats.StringBytes > durableSignatureStringLimit {
		t.Fatal("entry cap exceeded", stats)
	}
	// The original canonical decoder must reject padding, even after the
	// unpadded signed envelope has been seen.
	padded := append(append([]byte(nil), raw...), bytes.Repeat([]byte(" "), 10000)...)
	if _, err := facts.decode(padded, migration.Network.ChainID); err == nil {
		t.Fatal("noncanonical padded input accepted")
	}
	// Synthetic private storage-admission fixtures exercise the byte ceiling
	// independently of cryptography. They never pass decode or business gates.
	for i := 0; i < 220; i++ {
		memoryOnly := fmt.Sprintf("synthetic storage-boundary fixture %d %s", i, padded)
		key := durableSignatureKey{chain: migration.Network.ChainID, digest: sha256.Sum256([]byte(memoryOnly))}
		facts.rememberVerified(key, memoryOnly, tx)
		if stats := facts.stats(); stats.Entries > durableSignatureCapacity || stats.StringBytes > durableSignatureStringLimit {
			t.Fatal("byte cap exceeded", stats)
		}
	}
	if facts.stats().Entries >= durableSignatureCapacity {
		t.Fatal("byte pressure failed to evict count-bounded entries")
	}
	before := facts.stats()
	if _, err := facts.decode(raw, migration.Network.ChainID); err != nil {
		t.Fatal(err)
	}
	if after := facts.stats(); after.Verified != before.Verified+1 {
		t.Fatal("evicted fact was not reverified", before, after)
	}
}

// Repeated observations of one genuinely executed transaction, never 256 new
// business transactions. Both readers use exactly the same immutable file.
func TestStreamingWorkloadSignatureFactsMatchedWarmReadCost(t *testing.T) {
	_, migration, path, raw, height := durableReaderFixture(t)
	before, err := newDurableReader(migration, []string{path})
	if err != nil {
		t.Fatal(err)
	}
	after, err := newDurableReaderWithLimits(migration, []string{path}, 16<<20, 16<<20)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	first, err := before.verify(ctx, path, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := after.verify(ctx, path, raw, height); err != nil {
		t.Fatal(err)
	}
	times := map[string]int64{}
	for _, sample := range []struct {
		name   string
		reader *durableReader
	}{{"legacy", before}, {"explicit_cached", after}, {"explicit_cached", after}, {"legacy", before}} {
		started := time.Now()
		for i := 0; i < 64; i++ {
			got, err := sample.reader.verify(ctx, path, raw, height)
			if err != nil || !got.SnapshotCacheHit || got.AppHash != first.AppHash || got.StoreSHA256 != first.StoreSHA256 {
				t.Fatal("matched current-file evidence differs", err)
			}
		}
		times[sample.name] += time.Since(started).Nanoseconds()
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, reader := range []*durableReader{before, after} {
		stats := reader.stats()
		if stats.Attempts != 129 || stats.TransactionVerifications != 129 || stats.BytesHashed != 129*uint64(info.Size()) || stats.SnapshotValidations != 1 {
			t.Fatal("matched observations skipped original gates", stats)
		}
	}
	facts := after.stats().SignatureFacts
	if facts.Verified != 1 || facts.Hits != 128 {
		t.Fatal("matched crypto facts differ", facts)
	}
	report := map[string]any{"scope": "128 warm observations per mode of one real executed transaction, not business TPS or network finality", "order": "legacy,cached,cached,legacy;64 observations each", "fileBytes": info.Size(), "elapsedNs": times, "cachedFacts": facts, "stateHash": first.AppHash, "sameStoreSHA256": first.StoreSHA256}
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("matched_warm_readback_cost %s", encoded)
}
