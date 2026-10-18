package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestSharedReplayCandidateDeduplicatesExactBytesWithoutSharingMutableState(t *testing.T) {
	_, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	data, err := readBounded(path, durableSnapshotLimit)
	if err != nil {
		t.Fatal(err)
	}
	key := sha256.Sum256(data)
	decoder, err := consensus.NewBlockJournalDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	var cache sharedReplayCache
	calls := 0
	produce := func() (sharedReplayValue, error) {
		calls++
		d, err := decodeDurableSnapshotWithFacts(context.Background(), data, migration, decoder)
		return sharedReplayValue{payload: d.payload, format: d.format, completeBytes: d.completeBytes, incompleteTail: d.incompleteTail}, err
	}
	first, err := cache.get(context.Background(), key, produce)
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte(nil), first.payload...)
	// A caller's byte mutation cannot affect the next replay result.
	first.payload[0] ^= 1
	second, err := cache.get(context.Background(), key, produce)
	if err != nil || !bytes.Equal(second.payload, want) || calls != 1 {
		t.Fatalf("identical current-file content repeated full replay: calls=%d err=%v", calls, err)
	}
	var state consensus.CommittedState
	if err := strictJSON(second.payload, &state); err != nil {
		t.Fatal(err)
	}
	if err := state.Validate(migration); err != nil || state.Height != height {
		t.Fatal("canonical replay result changed", err)
	}
	r, err := newDurableReader(migration, []string{path})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), path, raw, height); err != nil {
		t.Fatal("original fee/nonce verifier failed", err)
	}
}
