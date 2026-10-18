package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
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

func TestSharedReplayCandidateRealFilesStillHashValidateAndCheckBusiness(t *testing.T) {
	app, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(t.TempDir(), "other.blocks")
	otherApp, err := consensus.NewBlockJournaledApplication(migration, other)
	if err != nil {
		t.Fatal(err)
	}
	response, err := otherApp.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0), Txs: [][]byte{raw}})
	if err != nil || response.TxResults[0].Code != 0 {
		t.Fatal("second actual node store execution failed", err)
	}
	if _, err := otherApp.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	otherData, err := os.ReadFile(other)
	if err != nil || !bytes.Equal(data, otherData) {
		t.Fatal("independent committed stores differ", err)
	}
	if err := os.Chmod(other, 0600); err != nil {
		t.Fatal(err)
	}
	r, err := newDurableReader(migration, []string{path, other})
	if err != nil {
		t.Fatal(err)
	}
	r.sharedReplay = &sharedReplayCache{}
	first, err := r.verify(context.Background(), path, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.verify(context.Background(), other, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	s := r.stats()
	if first.StoreSHA256 != second.StoreSHA256 || first.AppHash != second.AppHash || s.SharedReplay.FullReplays != 1 || s.SharedReplay.Hits != 1 || s.BlockReplayTxInputs != 1 || s.TransactionVerifications != 2 || s.SnapshotValidations != 2 || s.BytesHashed != uint64(2*len(data)) {
		t.Fatal("candidate skipped fresh input/business checks or failed to remove duplicate replay", s)
	}
	encoded, err := json.Marshal(s.SharedReplay)
	if err != nil {
		t.Fatal(err)
	}
	var observed map[string]any
	if err := json.Unmarshal(encoded, &observed); err != nil {
		t.Fatal(err)
	}
	if observed["workPhases"] == nil {
		t.Fatal("actual replay and private state validation completed, but producer/copy/JSON/validation costs are missing")
	}
	work := s.SharedReplay.WorkPhases
	if work.Produce.Calls != 1 || work.CanonicalCopy.Calls != 2 || work.PrivateJSON.Calls != 1 || work.PrivateValidate.Calls != 1 || work.CanonicalCopyBytes != uint64(2*s.SharedReplay.CachedCanonicalBytes) {
		t.Fatalf("actual work calls/copy bytes differ: %+v", work)
	}
	for _, phase := range []sharedReplayPhaseWork{work.Produce, work.CanonicalCopy, work.PrivateJSON, work.PrivateValidate} {
		if phase.Errors != 0 || phase.DurationNs <= 0 {
			t.Fatalf("actual work cost absent: %+v", work)
		}
	}
	s.SharedReplay.WorkPhases.Produce.Calls = 999
	if r.stats().SharedReplay.WorkPhases.Produce.Calls != 1 {
		t.Fatal("work snapshot aliases retained counters")
	}
	t.Logf("real_signed_store_replay_cost_not_business_tps=%s", encoded)
	// State and nested account arrays belong to individual path slots.
	if r.slots[path].state == r.slots[other].state || &r.slots[path].state.Accounts[0] == &r.slots[other].state.Accounts[0] {
		t.Fatal("mutable state escaped across paths")
	}
	bad := append([]byte(nil), data...)
	bad[len(bad)-2] ^= 1
	if err := os.WriteFile(other, bad, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), other, raw, height); err == nil {
		t.Fatal("same-size tamper used old success")
	}
	if err := os.Remove(other); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), other, raw, height); !errors.Is(err, errDurableNotReady) {
		t.Fatal("deleted node file reused success", err)
	}
	if err := os.WriteFile(other, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), other, raw, height+1); !errors.Is(err, errDurableNotReady) {
		t.Fatal("future height accepted", err)
	}
	badTx := append([]byte(nil), raw...)
	badTx[len(badTx)-4] ^= 1
	if _, err := r.verify(context.Background(), other, badTx, height); err == nil {
		t.Fatal("cached replay skipped transaction signature")
	}
	if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1802736001, 0)}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	changed, err := r.verify(context.Background(), path, raw, height)
	if err != nil || changed.Height != height+1 || changed.StoreSHA256 == first.StoreSHA256 || r.stats().SharedReplay.FullReplays != 3 {
		t.Fatal("changed bytes failed full replay", changed, err, r.stats())
	}
}

func TestSharedReplayCandidatePublicationAndQuorumRemainRequired(t *testing.T) {
	for _, mode := range []string{"valid", "stale_info", "bad_quorum"} {
		t.Run(mode, func(t *testing.T) {
			g, c, jobs := groupedObservationFixture(t)
			g.reader.sharedReplay = &sharedReplayCache{}
			for _, slot := range g.reader.slots {
				clearDurableCache(slot)
			}
			if mode == "stale_info" {
				c.info.Response.LastBlockHeight--
			}
			if mode == "bad_quorum" {
				c.commit.Commit.Signatures[0].Signature[0] ^= 1
			}
			g.step(context.Background(), jobs)
			for _, job := range jobs {
				confirmed := g.results[job.index].Status == "confirmed" && verifiedBusinessInclusion(g.results[job.index])
				if confirmed != (mode == "valid") {
					t.Fatal("candidate changed final business gate", mode, g.results[job.index])
				}
			}
		})
	}
}

func TestSharedReplayCandidateFailureCancellationAndBoundedRetention(t *testing.T) {
	var cache sharedReplayCache
	key := sha256.Sum256([]byte("key"))
	cause := errors.New("real decode failure")
	calls := 0
	produce := func() (sharedReplayValue, error) { calls++; return sharedReplayValue{}, cause }
	for i := 0; i < 2; i++ {
		if _, err := cache.get(context.Background(), key, produce); !errors.Is(err, cause) {
			t.Fatal(err)
		}
	}
	if calls != 2 || cache.snapshot().Failures != 2 || cache.snapshot().CachedCanonicalBytes != 0 {
		t.Fatal("failure cached as successful snapshot")
	}
	work := cache.snapshot().WorkPhases
	if work.Produce.Calls != 2 || work.Produce.Errors != 2 || work.CanonicalCopy.Calls != 0 {
		t.Fatalf("producer first errors lost: %+v", work)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := cache.get(ctx, key, produce); !errors.Is(err, context.Canceled) || calls != 2 {
		t.Fatal("cancellation invoked decode or returned success")
	}
	if cache.snapshot().WorkPhases != work {
		t.Fatal("pre-cancelled lookup recorded nonexistent work")
	}
	for i := byte(0); i < 3; i++ {
		k := sha256.Sum256([]byte{i})
		if _, err := cache.get(context.Background(), k, func() (sharedReplayValue, error) { return sharedReplayValue{payload: []byte{i}}, nil }); err != nil {
			t.Fatal(err)
		}
	}
	if s := cache.snapshot(); s.CachedCanonicalBytes != 1 || s.CanonicalByteLimit != durableSnapshotLimit || len(cache.flights) != 0 {
		t.Fatal("cache retained generations or unfinished flights", s)
	}
}

func TestSharedReplayCandidateConcurrentSameBytesJoinAndCancel(t *testing.T) {
	var cache sharedReplayCache
	key := sha256.Sum256([]byte("same"))
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		_, err := cache.get(context.Background(), key, func() (sharedReplayValue, error) {
			close(started)
			<-release
			return sharedReplayValue{payload: []byte("valid")}, nil
		})
		done <- err
	}()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	joined := make(chan error, 1)
	go func() {
		_, err := cache.get(ctx, key, func() (sharedReplayValue, error) { return sharedReplayValue{}, errors.New("duplicate producer") })
		joined <- err
	}()
	deadline := time.Now().Add(time.Second)
	for cache.snapshot().Joins != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	cancel()
	if err := <-joined; !errors.Is(err, context.Canceled) {
		t.Fatal("waiting observer ignored cancellation", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	v, err := cache.get(context.Background(), key, func() (sharedReplayValue, error) {
		t.Error("duplicate replay after leader success")
		return sharedReplayValue{}, nil
	})
	if err != nil || string(v.payload) != "valid" || !v.reused || cache.snapshot().FullReplays != 1 || cache.snapshot().WaitNs <= 0 {
		t.Fatal("single-flight result/count/wait differs", v, err, cache.snapshot())
	}
	work := cache.snapshot().WorkPhases
	if work.Produce.Calls != 1 || work.Produce.Errors != 0 || work.CanonicalCopy.Calls != 2 || work.CanonicalCopyBytes != 10 || work.PrivateJSON.Calls != 0 {
		t.Fatalf("join/cancel/hit work differs: %+v", work)
	}

}

func TestSharedReplayCandidateOversizedCanonicalIsNotRetained(t *testing.T) {
	var cache sharedReplayCache
	key := sha256.Sum256([]byte("oversize"))
	calls := 0
	value := make([]byte, durableSnapshotLimit+1)
	for i := 0; i < 2; i++ {
		if _, err := cache.get(context.Background(), key, func() (sharedReplayValue, error) { calls++; return sharedReplayValue{payload: value}, nil }); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 2 || cache.snapshot().CachedCanonicalBytes != 0 || cache.snapshot().Bypasses != 2 {
		t.Fatal("oversized canonical state retained or original decode rejected", cache.snapshot())
	}
}

func TestSharedReplayWorkPhasesRetainPrivateDecodeAndValidationFailures(t *testing.T) {
	_, migration, path, _, _ := durableJournalFixture(t, "block-journal")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err := newDurableReader(migration, []string{path})
	if err != nil {
		t.Fatal(err)
	}
	r.sharedReplay = &sharedReplayCache{}
	digest := sha256.Sum256(data)
	original, err := r.decodeCurrentSnapshot(context.Background(), data, digest)
	if err != nil {
		t.Fatal(err)
	}
	r.sharedReplay.mu.Lock()
	r.sharedReplay.value.payload = []byte("{")
	r.sharedReplay.mu.Unlock()
	if _, err = r.decodeCurrentSnapshot(context.Background(), data, digest); err == nil {
		t.Fatal("malformed cached bytes accepted")
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(original.payload, &fields); err != nil {
		t.Fatal(err)
	}
	fields["appHash"] = json.RawMessage(`"tampered"`)
	bad, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	r.sharedReplay.mu.Lock()
	r.sharedReplay.value.payload = bad
	r.sharedReplay.mu.Unlock()
	if _, err = r.decodeCurrentSnapshot(context.Background(), data, digest); err == nil {
		t.Fatal("invalid private state accepted")
	}
	w := r.sharedReplay.snapshot().WorkPhases
	if w.Produce.Calls != 1 || w.Produce.Errors != 0 || w.PrivateJSON.Calls != 2 || w.PrivateJSON.Errors != 1 || w.PrivateValidate.Calls != 1 || w.PrivateValidate.Errors != 1 {
		t.Fatalf("first errors or phase counts lost: %+v", w)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(data, after) {
		t.Fatal("diagnostic failure changed durable bytes", err)
	}
}
