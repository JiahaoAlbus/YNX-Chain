package chain

import (
	"errors"
	"math"
	"reflect"
	"strings"
	"sync"
	"testing"
)

const faucetFixtureID = "req_0123456789abcdef0123456789abcdef"

func TestFaucetRequestHashInteroperability(t *testing.T) {
	hash, err := FaucetRequestHash(6423, faucetFixtureID)
	if err != nil || hash != "0x639126c01ca5f10e55e3fc2a2db5d1522fd176e78b24cc9292bda0d405d90fa7" {
		t.Fatalf("unexpected independently computed SHA256 vector: %s %v", hash, err)
	}
	other, _ := FaucetRequestHash(6424, faucetFixtureID)
	if hash == other {
		t.Fatal("request hash did not bind the chain")
	}
}

func TestFaucetRequestPersistenceFailuresAndColdRetry(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-rename", true: "after-rename"}[afterRename], func(t *testing.T) {
			dir := t.TempDir()
			cfg := DefaultNetworkConfig("testnet")
			d, err := NewPersistentDevnet(cfg, dir)
			if err != nil {
				t.Fatal(err)
			}
			before := d.accounts[FaucetAddress].Balance
			path := d.snapshotPath() + ".tmp"
			if afterRename {
				path = d.snapshotIntegrityMarkerPath() + ".tmp"
			}
			unblock := blockSnapshotWrite(t, path)
			tx, _, err := d.FaucetWithRequest("ynx_faucet_retry", 100, faucetFixtureID)
			if err == nil {
				t.Fatal("obstructed write succeeded")
			}
			if afterRename {
				if !errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash == "" {
					t.Fatalf("lost uncertain hash: %v %+v", err, tx)
				}
				second, _, err := d.FaucetWithRequest("ynx_faucet_retry", 100, faucetFixtureID)
				if !errors.Is(err, ErrSnapshotDurabilityUncertain) || second.Hash != tx.Hash {
					t.Fatal("retry lost the original uncertain admission")
				}
				if d.accounts["ynx_faucet_retry"].Balance != 100 || d.accounts[FaucetAddress].Balance != before-100 {
					t.Fatal("uncertain retry credited twice")
				}
			} else {
				if tx.Hash != "" || d.accounts["ynx_faucet_retry"] != nil || d.accounts[FaucetAddress].Balance != before || len(d.pending) != 0 {
					t.Fatal("pre-rename failure did not restore accounts, lots and pending")
				}
			}
			unblock()
			// Simulate a process loss before the HTTP client receives an ACK.
			cold, err := NewPersistentDevnet(cfg, dir)
			if err != nil {
				t.Fatal(err)
			}
			accepted, replayed, err := cold.FaucetWithRequest("ynx_faucet_retry", 100, faucetFixtureID)
			if err != nil || replayed != afterRename {
				t.Fatalf("cold retry: replay=%v err=%v", replayed, err)
			}
			wantHash, _ := FaucetRequestHash(cfg.ChainID, faucetFixtureID)
			if accepted.Hash != wantHash {
				t.Fatal("request hash changed across restart")
			}
			cold.ProduceBlock()
			cold, err = NewPersistentDevnet(cfg, dir)
			if err != nil {
				t.Fatal(err)
			}
			mined, replayed, err := cold.FaucetWithRequest("ynx_faucet_retry", 100, faucetFixtureID)
			if err != nil || !replayed || mined.Hash != accepted.Hash || mined.BlockNum == 0 {
				t.Fatalf("mined replay: %+v %v %v", mined, replayed, err)
			}
			if cold.accounts["ynx_faucet_retry"].Balance != 100 || cold.accounts[FaucetAddress].Balance != before-100 {
				t.Fatal("cold replay changed balances")
			}
			_, proof, found := cold.TransactionWithDurability(mined.Hash)
			if !found || proof.Status != "durable" {
				t.Fatalf("cold mined proof: %+v", proof)
			}
			for _, changed := range []struct {
				address string
				amount  int64
			}{{"ynx_faucet_retry", 101}, {"ynx_other_recipient", 100}} {
				if _, _, err := cold.FaucetWithRequest(changed.address, changed.amount, faucetFixtureID); !errors.Is(err, ErrFaucetRequestConflict) {
					t.Fatal("same ID accepted changed payload", err)
				}
			}
		})
	}
}

func TestFaucetConcurrentExactRetriesAndInvalidRequests(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan Transaction, 16)
	errorsCh := make(chan error, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tx, _, err := d.FaucetWithRequest("ynx_concurrent_recipient", 100, faucetFixtureID)
			results <- tx
			errorsCh <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errorsCh)
	for err := range errorsCh {
		if err != nil {
			t.Fatal(err)
		}
	}
	var first Transaction
	for tx := range results {
		if first.Hash == "" {
			first = tx
		}
		if !reflect.DeepEqual(first, tx) {
			t.Fatal("concurrent retry returned a different transaction")
		}
	}
	if len(d.pending) != 1 || d.accounts["ynx_concurrent_recipient"].Balance != 100 {
		t.Fatal("duplicate concurrent credit")
	}
	for _, id := range []string{"", "short", strings.Repeat("a", 129), strings.Repeat("a", 31) + " ", strings.Repeat("a", 31) + "\x00"} {
		if _, _, err := d.FaucetWithRequest("ynx_invalid_recipient", 100, id); err == nil {
			t.Fatalf("accepted invalid ID %q", id)
		}
	}
	if d.accounts["ynx_invalid_recipient"] != nil {
		t.Fatal("invalid request mutated state")
	}
	d.account("ynx_overflow_recipient").Balance = math.MaxInt64
	if _, _, err := d.FaucetWithRequest("ynx_overflow_recipient", 1, faucetFixtureID+"2"); err == nil {
		t.Fatal("balance overflow accepted")
	}
	if _, _, err := d.FaucetWithRequest(FaucetAddress, 1, faucetFixtureID+"3"); err == nil {
		t.Fatal("faucet self-credit accepted")
	}
}

func TestLegacyFaucetPreRenameFailureDoesNotCredit(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	before := d.accounts[FaucetAddress].Balance
	unblock := blockSnapshotWrite(t, d.snapshotPath()+".tmp")
	if tx, err := d.Faucet("ynx_legacy_retry", 100); err == nil || tx.Hash != "" {
		t.Fatal("failed legacy write reported accepted hash")
	}
	if d.accounts["ynx_legacy_retry"] != nil || d.accounts[FaucetAddress].Balance != before {
		t.Fatal("failed legacy write credited recipient")
	}
	unblock()
	if _, err := d.Faucet("ynx_legacy_retry", 100); err != nil {
		t.Fatal(err)
	}
	if d.accounts["ynx_legacy_retry"].Balance != 100 {
		t.Fatal("legacy retry duplicated credit")
	}
}
