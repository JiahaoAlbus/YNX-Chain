package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func nativeVerificationFixture(t *testing.T) (*Application, []byte) {
	t.Helper()
	key := deterministicPrivateKey(101)
	sender := mustNativeAddress(t, key)
	recipient := mustNativeAddress(t, deterministicPrivateKey(102))
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 10000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplication(migration, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := NewSignedTransfer(key, migration.Network.ChainID, recipient, 3, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return app, raw
}

func TestNativeVerificationBindsBytesChainAndOwnedValues(t *testing.T) {
	app, raw := nativeVerificationFixture(t)
	original := append([]byte(nil), raw...)
	tx, err := app.decodeVerifiedNativeTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := tx
	tx.Amount++
	got, err := app.decodeVerifiedNativeTransaction(raw)
	if err != nil || got != want {
		t.Fatal("cached value was mutable", err)
	}
	// Changing caller-owned bytes cannot rewrite the retained payload.
	raw[0] = '['
	if _, err := app.decodeVerifiedNativeTransaction(raw); err == nil {
		t.Fatal("mutated caller bytes hit valid entry")
	}
	copy(raw, original)
	if got, err := app.decodeVerifiedNativeTransaction(raw); err != nil || got != want {
		t.Fatal("caller mutation changed retained valid entry", err)
	}
	app.migration.Network.ChainID++
	if _, err := app.decodeVerifiedNativeTransaction(raw); err == nil {
		t.Fatal("cross-chain cache reuse accepted")
	}
	app.migration.Network.ChainID--
	// A matching key alone is insufficient: force a collision in the private
	// unit-test store and require an exact-byte miss, without counting it as
	// a successfully verified transaction.
	key := nativeVerificationKey{chainID: app.migration.Network.ChainID, digest: sha256.Sum256(raw)}
	var cache nativeVerificationCache
	cache.rememberVerified(key, "different bytes", want)
	if _, ok := cache.lookup(key, raw); ok {
		t.Fatal("cache relied only on digest")
	}
	stats := app.nativeVerification.stats()
	if stats.Entries != 1 || stats.SuccessfulVerifications != 1 || stats.Hits < 2 {
		t.Fatalf("unexpected verified cache stats: %+v", stats)
	}
}

func TestNativeVerificationRejectsInvalidWithoutCaching(t *testing.T) {
	app, raw := nativeVerificationFixture(t)
	valid, err := DecodeSignedTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.decodeVerifiedNativeTransaction(raw); err != nil {
		t.Fatal(err)
	}
	invalid := [][]byte{nil, []byte(" " + string(raw)), append(append([]byte(nil), raw...), '\n'), bytes.Repeat([]byte{'x'}, MaxSignedTransactionSize+1)}
	for _, mutate := range []func(*SignedTransaction){
		func(tx *SignedTransaction) { tx.Amount++ },
		func(tx *SignedTransaction) { tx.Nonce++ },
		func(tx *SignedTransaction) { tx.Fee++ },
		func(tx *SignedTransaction) { tx.From = tx.To },
		func(tx *SignedTransaction) { tx.ChainID++ },
		func(tx *SignedTransaction) { tx.Signature = "" },
		func(tx *SignedTransaction) { tx.Signature = "00" },
		func(tx *SignedTransaction) { tx.PublicKey = strings.Repeat("00", 33) },
	} {
		tx := valid
		mutate(&tx)
		payload, err := json.Marshal(tx)
		if err != nil {
			t.Fatal(err)
		}
		invalid = append(invalid, payload)
	}
	for i, payload := range invalid {
		for j := 0; j < 2; j++ {
			if _, err := app.decodeVerifiedNativeTransaction(payload); err == nil {
				t.Fatalf("invalid case %d accepted", i)
			}
		}
	}
	if stats := app.nativeVerification.stats(); stats.Entries != 1 || stats.SuccessfulVerifications != 1 {
		t.Fatalf("invalid envelopes entered cache: %+v", stats)
	}
}

func TestNativeVerificationCacheBoundsAndEviction(t *testing.T) {
	var cache nativeVerificationCache
	for i := 0; i < nativeVerificationCapacity+1; i++ {
		raw := fmt.Sprintf("bounded-algorithm-fixture-%d", i)
		cache.rememberVerified(nativeVerificationKey{chainID: 1, digest: sha256.Sum256([]byte(raw))}, raw, SignedTransaction{})
	}
	first := []byte("bounded-algorithm-fixture-0")
	if _, ok := cache.lookup(nativeVerificationKey{chainID: 1, digest: sha256.Sum256(first)}, first); ok {
		t.Fatal("oldest entry was not evicted")
	}
	if stats := cache.stats(); stats.Entries != nativeVerificationCapacity {
		t.Fatalf("entry count bound failed: %+v", stats)
	}
	// These private-store strings exercise byte accounting only; they are not
	// signed, executed, admitted or included in any throughput measurement.
	var byteBound nativeVerificationCache
	for i := 0; i < 6; i++ {
		raw := strings.Repeat(string(rune('a'+i)), 1<<20)
		byteBound.rememberVerified(nativeVerificationKey{digest: sha256.Sum256([]byte(raw))}, raw, SignedTransaction{})
	}
	if stats := byteBound.stats(); stats.RetainedStringBytes > nativeVerificationStringBytes || stats.Entries != 4 {
		t.Fatalf("string byte bound failed: %+v", stats)
	}
	oversized := strings.Repeat("x", nativeVerificationStringBytes+1)
	before := byteBound.stats()
	byteBound.rememberVerified(nativeVerificationKey{digest: sha256.Sum256([]byte(oversized))}, oversized, SignedTransaction{})
	after := byteBound.stats()
	if after.Entries != before.Entries || after.RetainedStringBytes != before.RetainedStringBytes {
		t.Fatal("oversized cache entry was retained")
	}
}

func TestNativeVerificationConcurrentPublication(t *testing.T) {
	app, raw := nativeVerificationFixture(t)
	want, err := DecodeSignedTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := app.decodeVerifiedNativeTransaction(raw)
			if err != nil || got != want {
				t.Errorf("concurrent verification changed result: %v", err)
			}
		}()
	}
	wg.Wait()
	if stats := app.nativeVerification.stats(); stats.Entries != 1 || stats.Lookups != 16 || stats.SuccessfulVerifications < 1 || stats.Hits+stats.SuccessfulVerifications != 16 {
		t.Fatalf("concurrent publication did not reconcile: %+v", stats)
	}
}

func TestNativeVerificationAlwaysRechecksMutableStateAndRestart(t *testing.T) {
	app, raw := nativeVerificationFixture(t)
	ctx := context.Background()
	check := func(want uint32) {
		t.Helper()
		response, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: raw})
		if err != nil || response.Code != want {
			t.Fatalf("mutable state check: got %+v want %d err %v", response, want, err)
		}
	}
	check(0)
	tx, err := DecodeSignedTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	index, _ := accountIndex(app.committed.Accounts, tx.From)
	original := cloneAccounts(app.committed.Accounts)[index]
	app.committed.Accounts[index].Nonce = 1
	check(CodeInvalidNonce)
	app.committed.Accounts[index] = original
	app.committed.Accounts[index].Balance = 0
	check(CodeInsufficientYNXT)
	app.committed.Accounts[index] = original
	app.committed.Accounts[index].Lots = map[string]int64{}
	check(CodeInsufficientYNXT)
	app.committed.Accounts[index] = original
	app.committed.Accounts[index].ResourceUsage.BandwidthUsed = math.MaxInt64
	check(CodeInvalidTx)
	app.committed.Accounts[index] = original
	if stats := app.nativeVerification.stats(); stats.SuccessfulVerifications != 1 || stats.Hits != 4 {
		t.Fatalf("mutable checks did not use the already verified envelope: %+v", stats)
	}
	height := int64(app.migration.Height) + 1
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0).UTC(), Txs: [][]byte{raw}})
	if err != nil || finalized.TxResults[0].Code != 0 {
		t.Fatal("valid cached transaction failed real execution", err)
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	check(CodeInvalidNonce)
	restarted, err := NewPersistentApplication(app.migration, app.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if stats := restarted.nativeVerification.stats(); stats.Entries != 0 || stats.Lookups != 0 {
		t.Fatal("verification cache persisted across restart")
	}
	response, err := restarted.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: raw})
	if err != nil || response.Code != CodeInvalidNonce {
		t.Fatal("restart admitted committed replay", err)
	}
	if stats := restarted.nativeVerification.stats(); stats.SuccessfulVerifications != 1 || stats.Hits != 0 {
		t.Fatal("restart did not reverify the actual signature")
	}
	beforeJSON, err := json.Marshal(app.committed)
	if err != nil {
		t.Fatal(err)
	}
	afterJSON, err := json.Marshal(restarted.committed)
	if err != nil || !bytes.Equal(beforeJSON, afterJSON) {
		t.Fatal("cache changed canonical committed durable state", err)
	}
	if !reflect.DeepEqual(app.committed, restarted.committed) {
		left, right := reflect.ValueOf(app.committed), reflect.ValueOf(restarted.committed)
		for i := 0; i < left.NumField(); i++ {
			if !reflect.DeepEqual(left.Field(i).Interface(), right.Field(i).Interface()) {
				t.Logf("canonical JSON equal; restart normalized Go representation of %s", left.Type().Field(i).Name)
			}
		}
	}
}
