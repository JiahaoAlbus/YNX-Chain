package main

import (
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"os"
	"testing"
	"time"
)

func TestObserverNativeFactsPreserveOriginalStateAndIndependentReaderChain(t *testing.T) {
	_, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	control, e := newDurableReader(migration, []string{path})
	if e != nil {
		t.Fatal(e)
	}
	if e = control.configurePrefixReplay(migration, true); e != nil {
		t.Fatal(e)
	}
	want, e := control.verify(context.Background(), path, raw, height)
	if e != nil {
		t.Fatal(e)
	}
	r, e := newDurableReader(migration, []string{path})
	if e != nil {
		t.Fatal(e)
	}
	if e = r.configurePrefixReplay(migration, true); e != nil {
		t.Fatal(e)
	}
	if e = r.configureObserverNativeFacts(); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		got, e := r.verify(context.Background(), path, raw, height)
		if e != nil || got.AppHash != want.AppHash || got.SnapshotSHA256 != want.SnapshotSHA256 {
			t.Fatal("signature reuse changed actual state", e)
		}
	}
	stats := r.stats()
	v := stats.ObserverNativeFacts
	if v == nil || !v.Enabled || v.Lookups != 2 || v.Hits != 2 || v.Misses != 0 || v.FallbackMathVerifications != 0 || v.FallbackFailures != 0 || stats.TransactionVerifications != 2 || stats.ReplayNativeFacts.SuccessfulVerifications != 1 {
		t.Fatal("actual signature work/counters differ", stats)
	}
	v.Hits = 999
	if r.stats().ObserverNativeFacts.Hits != 2 {
		t.Fatal("reported counter pointer aliases reader")
	}
	originalChain := r.migration.Network.ChainID
	r.migration.Network.ChainID++
	if _, e = r.verify(context.Background(), path, raw, height); e == nil {
		t.Fatal("cached signature accepted across observer chain")
	}
	r.migration.Network.ChainID = originalChain
	slot := r.slots[path]
	tx, e := consensus.DecodeSignedTransaction(raw)
	if e != nil {
		t.Fatal(e)
	}
	key := durableFeeKey{hash: consensus.SignedTransactionHash(raw), payer: tx.From, kind: consensus.SignedTransactionType, height: height, fee: tx.Fee}
	delete(slot.fees, key)
	if _, e = r.verify(context.Background(), path, raw, height); e == nil {
		t.Fatal("signature authorized absent fee")
	}
	slot.fees[key] = struct{}{}
	nonce := slot.nonces[tx.From]
	slot.nonces[tx.From] = 0
	if _, e = r.verify(context.Background(), path, raw, height); e == nil {
		t.Fatal("signature authorized absent nonce")
	}
	slot.nonces[tx.From] = nonce
	if _, e = r.verify(context.Background(), path, raw, height+1); e == nil {
		t.Fatal("signature authorized future height")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = r.verify(ctx, path, raw, height); e == nil {
		t.Fatal("cancelled read accepted")
	}
	next, e := consensus.NewSignedTransfer(secp256k1.PrivKeyFromBytes([]byte{111}), migration.Network.ChainID, tx.To, 3, 2)
	if e != nil {
		t.Fatal(e)
	}
	absent, e := consensus.EncodeSignedTransaction(next)
	if e != nil {
		t.Fatal(e)
	}
	before := *r.stats().ObserverNativeFacts
	if _, e = r.verify(context.Background(), path, absent, height); e == nil {
		t.Fatal("valid uncached signature authorized absent execution")
	}
	after := r.stats().ObserverNativeFacts
	if after.Misses != before.Misses+1 || after.FallbackMathVerifications != before.FallbackMathVerifications+1 {
		t.Fatal("miss omitted original full Verify", after)
	}
	before = *after
	if _, e = r.verify(context.Background(), path, []byte("invalid-envelope"), height); e == nil {
		t.Fatal("invalid cache miss accepted")
	}
	after = r.stats().ObserverNativeFacts
	if after.FallbackFailures != before.FallbackFailures+1 {
		t.Fatal("invalid original Decode failure not counted")
	}
	if control.stats().ObserverNativeFacts != nil {
		t.Fatal("default reader enabled observer facts")
	}
}
func TestObserverNativeFactsExactOptionsAndConfiguration(t *testing.T) {
	base := options{manifest: "manifest", transactions: "transactions", concurrency: 8, observers: 4, timeout: 10 * time.Second, poll: 100 * time.Millisecond, rounds: 1, senderMode: "rounds", inclusionMode: "block-scan", offeredRate: 1000, observerPhaseTiming: true, durableStoreByteLimit: durableSnapshotLimit, prefixDurableReplay: true, prefixNativeClone: true, nativeSubmit8: true, observerNativeFacts: true}
	if e := validateOptions(base); e != nil {
		t.Fatal(e)
	}
	for _, kind := range []string{"workers", "prefix", "native", "submit8", "suffix", "timing", "cache"} {
		o := base
		switch kind {
		case "workers":
			o.concurrency = 4
		case "prefix":
			o.prefixDurableReplay = false
		case "native":
			o.prefixNativeClone = false
		case "submit8":
			o.nativeSubmit8 = false
		case "suffix":
			o.nativeSuffixSetup = true
		case "timing":
			o.observerPhaseTiming = false
		case "cache":
			o.durableCacheByteBudget = 16 << 20
		}
		if e := validateOptions(o); e == nil {
			t.Fatal("unsupported mixed mode accepted", kind)
		}
	}
	_, migration, path, _, _ := durableJournalFixture(t, "block-journal")
	r, e := newDurableReader(migration, []string{path})
	if e != nil {
		t.Fatal(e)
	}
	if e = r.configureObserverNativeFacts(); e == nil {
		t.Fatal("unconfigured decoder accepted")
	}
	if e = r.configurePrefixReplayMode(migration, true, true); e != nil {
		t.Fatal(e)
	}
	if e = r.configureObserverNativeFacts(); e == nil {
		t.Fatal("negative network suffix candidate mixed into baseline")
	}
	raw, e := json.Marshal(report{})
	if e != nil {
		t.Fatal(e)
	}
	var reportFields map[string]any
	if e = json.Unmarshal(raw, &reportFields); e != nil {
		t.Fatal(e)
	}
	if _, ok := reportFields["observerNativeFacts"]; ok {
		t.Fatal("default JSON schema changed")
	}
}

func TestObserverNativeFactsStillRequireFreshUncorruptedStoreAndRestartReplay(t *testing.T) {
	_, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	original, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	makeReader := func() *durableReader {
		r, e := newDurableReader(migration, []string{path})
		if e != nil {
			t.Fatal(e)
		}
		if e = r.configurePrefixReplay(migration, true); e != nil {
			t.Fatal(e)
		}
		if e = r.configureObserverNativeFacts(); e != nil {
			t.Fatal(e)
		}
		return r
	}
	r := makeReader()
	first, e := r.verify(context.Background(), path, raw, height)
	if e != nil {
		t.Fatal(e)
	}
	damaged := append([]byte(nil), original...)
	damaged[len(damaged)-1] ^= 1
	for _, data := range [][]byte{original[:len(original)-1], damaged} {
		if e = os.WriteFile(path, data, 0600); e != nil {
			t.Fatal(e)
		}
		if _, e = r.verify(context.Background(), path, raw, height); e == nil {
			t.Fatal("cached signature authorized incomplete/corrupt current store")
		}
	}
	if e = os.Remove(path); e != nil {
		t.Fatal(e)
	}
	if _, e = r.verify(context.Background(), path, raw, height); e == nil {
		t.Fatal("cached signature authorized absent current store")
	}
	if e = os.WriteFile(path, original, 0600); e != nil {
		t.Fatal(e)
	}
	recovered, e := r.verify(context.Background(), path, raw, height)
	if e != nil || recovered.SnapshotSHA256 != first.SnapshotSHA256 {
		t.Fatal("original bytes recovery differs", e)
	}
	restarted := makeReader()
	again, e := restarted.verify(context.Background(), path, raw, height)
	if e != nil || again.AppHash != first.AppHash || restarted.stats().ReplayNativeFacts.SuccessfulVerifications != 1 || restarted.stats().ObserverNativeFacts.Hits != 1 {
		t.Fatal("restart omitted actual original replay/verification", e)
	}
}
