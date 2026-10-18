package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmt "github.com/cometbft/cometbft/types"
)

func TestStreamingWorkloadReaderRequiresExplicitCoupledLimits(t *testing.T) {
	o := streamingOptions()
	o.durableStoreByteLimit = 32 << 20
	o.durableCacheByteBudget = 32 << 20
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*options){func(o *options) { o.durableCacheByteBudget = 0 }, func(o *options) { o.durableCacheByteBudget = 16 << 20 }, func(o *options) { o.durableCacheByteBudget = (2 << 30) + 1 }, func(o *options) { o.durableStoreByteLimit = 513 << 20 }, func(o *options) { o.durableStoreByteLimit = -1 }} {
		candidate := o
		mutate(&candidate)
		if validateOptions(candidate) == nil {
			t.Fatal("uncoupled large reader accepted", candidate)
		}
	}
	o.streamingWorkload = false
	o.evidenceByteBudget = 0
	o.rounds = 2
	if _, _, err := durableReadLimits(o); err == nil {
		t.Fatal("legacy reader could choose large limit")
	}
	limit, budget, err := durableReadLimits(options{})
	if err != nil || limit != 16<<20 || budget != 0 {
		t.Fatal("default readback limits changed", limit, budget, err)
	}
}

// One real executed/persisted native transfer in a valid framed checkpoint with
// synthetic JSON whitespace padding. Tests byte limits, never large-history TPS.
func paddedCheckpointFixture(t *testing.T) (chain.ConsensusMigrationState, string, cmt.Tx, int64, []byte) {
	t.Helper()
	_, migration, file, tx, height := durableReaderFixture(t)
	stateJSON, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var state consensus.CommittedState
	if err := json.Unmarshal(stateJSON, &state); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(struct {
		Kind     string                    `json:"kind"`
		Snapshot *consensus.CommittedState `json:"snapshot"`
	}{"checkpoint", &state})
	if err != nil {
		t.Fatal(err)
	}
	payload := append(bytes.Repeat([]byte(" "), 16<<20+1024), body...)
	frame := make([]byte, 72)
	binary.BigEndian.PutUint64(frame[:8], uint64(len(payload)))
	lengthHash := sha256.Sum256(frame[:8])
	copy(frame[8:40], lengthHash[:])
	hash := sha256.New()
	hash.Write(frame[:8])
	hash.Write(payload)
	copy(frame[40:], hash.Sum(nil))
	data := []byte("YNX_ABCI_BLOCK_JOURNAL_V2\n" + migration.StateHash + "\n")
	data = append(data, frame...)
	data = append(data, payload...)
	path := filepath.Join(t.TempDir(), "large-checkpoint")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return migration, path, tx, height, data
}
func TestStreamingWorkloadReaderCrossesByteLimitAndEvictsWithoutStaleFallback(t *testing.T) {
	migration, first, tx, height, data := paddedCheckpointFixture(t)
	second := filepath.Join(t.TempDir(), "other-checkpoint")
	if err := os.WriteFile(second, data, 0600); err != nil {
		t.Fatal(err)
	}
	legacy, err := newDurableReader(migration, []string{first})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.verify(context.Background(), first, tx, height); err == nil {
		t.Fatal("legacy 16MiB cap expanded")
	}
	reader, err := newDurableReaderWithLimits(migration, []string{first, second}, 32<<20, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	a, err := reader.verify(context.Background(), first, tx, height)
	if err != nil {
		t.Fatal(err)
	}
	again, err := reader.verify(context.Background(), first, tx, height)
	if err != nil || !again.SnapshotCacheHit {
		t.Fatal("exact fresh-byte hit missing", err)
	}
	b, err := reader.verify(context.Background(), second, tx, height)
	if err != nil || a.AppHash != b.AppHash || a.SnapshotSHA256 != b.SnapshotSHA256 {
		t.Fatal("large actual execution evidence differs", err)
	}
	stats := reader.stats()
	if stats.ReaderBudget == nil || stats.ReaderBudget.CachedInputBytes > 32<<20 || stats.ReaderBudget.Evictions != 1 {
		t.Fatal("encoded input cache budget ignored", stats.ReaderBudget)
	}
	reloaded, err := reader.verify(context.Background(), first, tx, height)
	if err != nil || reloaded.SnapshotCacheHit || reloaded.AppHash != a.AppHash {
		t.Fatal("evicted state did not revalidate", err)
	}
	if err := os.WriteFile(first, data[:len(data)-1], 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.verify(context.Background(), first, tx, height); err == nil {
		t.Fatal("partial current checkpoint reused old state")
	}
	actual, err := os.ReadFile(first)
	if err != nil || len(actual) != len(data)-1 {
		t.Fatal("reader repaired truncated input", err)
	}
	t.Logf("synthetic_padding_actual_native_state input_bytes=%d cache_budget=%d evictions=%d; one real transfer, no history capacity/TPS claim", len(data), stats.ReaderBudget.CacheInputByteBudget, reader.stats().ReaderBudget.Evictions)
}
