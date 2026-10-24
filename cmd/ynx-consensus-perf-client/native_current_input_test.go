package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"os"
	"testing"
	"time"
)

func TestNativeStreamingCurrentInputReuseAvoidsDuplicateDecode(t *testing.T) {
	_, migration, first, raw, height := durableJournalFixture(t, "block-journal")
	second := first + ".peer"
	if _, err := consensus.NewBlockJournaledApplication(migration, second); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(first)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(second, data, 0600); err != nil {
		t.Fatal(err)
	}
	o := nativeStreamingOptions()
	o.durableCacheByteBudget = 64 << 20
	o.nativeCurrentInputReuse = true
	r, err := newWorkloadDurableReader(migration, []string{first, second}, o)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.configureNativeStreamingReplay(o); err != nil {
		t.Fatal(err)
	}
	one, err := r.verify(context.Background(), first, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	two, err := r.verify(context.Background(), second, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	if one.AppHash != two.AppHash || one.SnapshotSHA256 != two.SnapshotSHA256 || one.StoreSHA256 != two.StoreSHA256 {
		t.Fatal("identical fresh stores changed business identity")
	}
	actual := r.stats()
	if actual.SnapshotValidations != 1 || actual.TransactionVerifications != 2 || !two.SnapshotCacheHit {
		t.Fatalf("duplicate current input decoded/validated again: validations=%d verification=%d hit=%v", actual.SnapshotValidations, actual.TransactionVerifications, two.SnapshotCacheHit)
	}
	parts := actual.PrefixReplay.WorkPhases.CertificatePublishDetails
	if parts == nil || parts.PayloadCopy.Calls != 1 || parts.StrictJSON.Calls != 1 || parts.NativeClone.Calls != 1 || parts.PrefixBytesHashed != uint64(len(data)) || parts.PayloadBytes == 0 {
		t.Fatalf("real native certificate child timing/bytes absent: %+v", parts)
	}
	parts.StrictJSON.Calls = 999
	if r.stats().PrefixReplay.WorkPhases.CertificatePublishDetails.StrictJSON.Calls != 1 {
		t.Fatal("caller timing mutation reached private reader totals")
	}
	r.prefixStats.WorkPhases.CertificatePublishDetails.CanonicalNative = &consensus.BlockJournalPrefixPhase{Calls: 1, DurationNs: 1}
	r.stats().PrefixReplay.WorkPhases.CertificatePublishDetails.CanonicalNative.Calls = 999
	if r.stats().PrefixReplay.WorkPhases.CertificatePublishDetails.CanonicalNative.Calls != 1 {
		t.Fatal("canonical phase snapshot aliases reader")
	}
}

func currentInputFixture(t *testing.T) (*durableReader, *consensus.Application, string, string, []byte, int64) {
	t.Helper()
	app, migration, first, raw, height := durableJournalFixture(t, "block-journal")
	second := first + ".peer"
	if _, err := consensus.NewBlockJournaledApplication(migration, second); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(first)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(second, data, 0600); err != nil {
		t.Fatal(err)
	}
	o := nativeStreamingOptions()
	o.durableCacheByteBudget = 64 << 20
	o.nativeCurrentInputReuse = true
	r, err := newWorkloadDurableReader(migration, []string{first, second}, o)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.configureNativeStreamingReplay(o); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{first, second} {
		if _, err = r.verify(context.Background(), path, raw, height); err != nil {
			t.Fatal(err)
		}
	}
	return r, app, first, second, raw, height
}

func TestNativeStreamingCurrentInputPublicationNeverMutatesPeerOrHighWater(t *testing.T) {
	r, app, first, second, raw, height := currentInputFixture(t)
	old := r.slots[second].state
	oldHash := old.AppHash
	oldJSON, err := json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	if r.slots[first].state != old {
		t.Fatal("identical validated input did not reuse immutable publication")
	}
	key := secp256k1.PrivKeyFromBytes([]byte{111})
	recipient, _ := consensus.NativeAddress(secp256k1.PrivKeyFromBytes([]byte{112}).PubKey().SerializeCompressed())
	successor, err := consensus.NewSignedTransfer(key, r.migration.Network.ChainID, recipient, 3, 2)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := consensus.EncodeSignedTransaction(successor)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1802736001, 0), Txs: [][]byte{wire}}); err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {

		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	next, err := r.verify(context.Background(), first, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	if next.Height != height+1 || next.AppHash == oldHash || old.Height != height || old.AppHash != oldHash {
		t.Fatalf("publication nextHeight=%d want=%d nextHash=%s oldHash=%s peerHeight=%d peerHash=%s", next.Height, height+1, next.AppHash, oldHash, old.Height, old.AppHash)
	}
	stillJSON, err := json.Marshal(old)
	if err != nil || !bytes.Equal(oldJSON, stillJSON) {
		t.Fatal("new suffix mutated immutable peer state arrays/maps", err)
	}
	previous, err := r.verify(context.Background(), second, raw, height)
	if err != nil || previous.AppHash != oldHash {
		t.Fatal("lagging current peer was replaced by newer cached state", err)
	}
	inventory, err := r.prefixDecoder.NativeCloneCacheInventory(context.Background())
	if err != nil || inventory.Height != height+1 {
		t.Fatal("lagging peer lowered decoder high-water checkpoint", err, inventory)
	}
	clearDurableCache(r.slots[first])
	clearDurableCache(r.slots[second])
	if r.stats().CurrentInputReuse.RetainedInputBytes != 0 || r.cachedStoreInputBytes() != 0 {
		t.Fatal("eviction retained unpublished input generations")
	}
}

func TestNativeStreamingCurrentInputStillRejectsCryptoFeeNonceAndScope(t *testing.T) {
	r, _, _, second, raw, height := currentInputFixture(t)
	tx, err := consensus.DecodeSignedTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	tx.Amount++
	tampered, err := json.Marshal(tx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.verify(context.Background(), second, tampered, height); err == nil {
		t.Fatal("shared snapshot skipped signature verification")
	}
	key := secp256k1.PrivKeyFromBytes([]byte{111})
	to, _ := consensus.NativeAddress(secp256k1.PrivKeyFromBytes([]byte{112}).PubKey().SerializeCompressed())
	missing, err := consensus.NewSignedTransfer(key, r.migration.Network.ChainID, to, 3, 2)
	if err != nil {
		t.Fatal(err)
	}
	unseen, err := consensus.EncodeSignedTransaction(missing)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.verify(context.Background(), second, unseen, height); err == nil {
		t.Fatal("valid signature without committed fee/nonce accepted")
	}
	r.migration.Network.ChainID++
	if _, err = r.verify(context.Background(), second, raw, height); err == nil {
		t.Fatal("cross-chain shared snapshot accepted")
	}
}

func TestNativeStreamingCurrentInputRejectsRenameDuringCaptureAndFreshTruncation(t *testing.T) {
	r, _, first, second, raw, height := currentInputFixture(t)
	f, err := os.Open(second)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(second)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(second, second+".old"); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(second, data, 0600); err != nil {
		t.Fatal(err)
	}
	if r.checkCurrentInputFile(context.Background(), second, f, before) == nil {
		t.Fatal("replacement inode during observation accepted")
	}
	if _, err = r.verify(context.Background(), second, raw, height); err != nil {
		t.Fatal("fresh complete replacement was not rechecked", err)
	}
	if err = os.WriteFile(second, data[:len(data)-1], 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.verify(context.Background(), second, raw, height); err == nil {
		t.Fatal("truncated current file borrowed peer's newer state")
	}
	if _, err = r.verify(context.Background(), first, raw, height); err != nil {
		t.Fatal("failed peer poisoned intact current snapshot", err)
	}
}

func TestNativeStreamingCurrentInputConcurrentScopeUsesOriginalBudgetGate(t *testing.T) {
	r, _, first, second, raw, height := currentInputFixture(t)
	done := make(chan error, 16)
	for i := 0; i < 16; i++ {
		path := first
		if i%2 == 1 {
			path = second
		}
		go func() { _, err := r.verify(context.Background(), path, raw, height); done <- err }()
	}
	for i := 0; i < 16; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	stats := r.stats()
	if stats.SnapshotValidations != 1 || stats.TransactionVerifications != 18 || stats.CurrentInputReuse.Hits != 1 || stats.ReaderBudget.CachedInputBytes > stats.ReaderBudget.CacheInputByteBudget || stats.CurrentInputReuse.RetainedInputBytes != stats.ReaderBudget.CachedInputBytes {
		t.Fatal("actual shared input/budget/counter coverage differs", stats)
	}
}

func TestNativeStreamingCurrentInputIndependentStoresBeforeAfter(t *testing.T) {
	_, migration, first, raw, height := durableJournalFixture(t, "block-journal")
	second := first + ".independent"
	app, err := consensus.NewBlockJournaledApplication(migration, second)
	if err != nil {
		t.Fatal(err)
	}
	if response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0), Txs: [][]byte{raw}}); err != nil || response == nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
		t.Fatal("independent real execution failed", err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(first)
	b, _ := os.ReadFile(second)
	if !bytes.Equal(a, b) {
		t.Fatal("independently executed identical block produced different input; cannot claim reuse")
	}
	var previous durableEvidence
	for _, enabled := range []bool{false, true} {
		o := nativeStreamingOptions()
		o.durableCacheByteBudget = 64 << 20
		o.nativeCurrentInputReuse = enabled
		r, err := newWorkloadDurableReader(migration, []string{first, second}, o)
		if err != nil {
			t.Fatal(err)
		}
		if err = r.configureNativeStreamingReplay(o); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{first, second} {
			got, err := r.verify(context.Background(), path, raw, height)
			if err != nil {
				t.Fatal(err)
			}
			if previous.AppHash != "" && (got.AppHash != previous.AppHash || got.StoreSHA256 != previous.StoreSHA256 || got.SnapshotSHA256 != previous.SnapshotSHA256) {
				t.Fatal("before/after real business/store identities differ")
			}
			previous = got
		}
		stats := r.stats()
		want := uint64(2)
		if enabled {
			want = 1
		}
		if stats.SnapshotValidations != want || stats.TransactionVerifications != 2 {
			t.Fatal("decode work or per-transaction verification changed", stats)
		}
		t.Logf("same_process_independent_real_stores_component_only reuse=%v validations=%d verification=%d readerHoldNs=%d no_network_or_BFT_TPS", enabled, stats.SnapshotValidations, stats.TransactionVerifications, stats.ReaderGate.HoldNs)
	}
	o := nativeStreamingOptions()
	o.nativeStream8 = false
	o.nativeCurrentInputReuse = true
	if validateNativeStreamingOptions(o) == nil {
		t.Fatal("current input reuse enabled outside scoped native stream")
	}
}

func TestNativeStreamingCurrentInputCanceledLookupKeepsPriorPublication(t *testing.T) {
	r, _, first, _, _, _ := currentInputFixture(t)
	slot := r.slots[first]
	previous := slot.state
	r.profileMu.Lock()
	defer r.profileMu.Unlock()
	slot.mu.Lock()
	defer slot.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if hit, err := r.reuseCapturedInput(ctx, slot, slot.capturedInput, slot.digest); err == nil || hit {
		t.Fatal("canceled lookup promoted content")
	}
	if slot.state != previous || r.currentInputReuseStats.Errors != 1 || r.currentInputReuseStats.Attempts != r.currentInputReuseStats.Hits+r.currentInputReuseStats.Misses+r.currentInputReuseStats.Errors {
		t.Fatal("canceled lookup changed publication or fabricated completed work")
	}
}
