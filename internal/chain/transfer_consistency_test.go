package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func transferBusinessState(t *testing.T, d *Devnet) []byte {
	t.Helper()
	d.mu.RLock()
	defer d.mu.RUnlock()
	state, err := json.Marshal(struct {
		Accounts map[string]*Account
		Lots     map[string]TrustTraceLot
		Pending  []Transaction
	}{d.accounts, d.lots, d.pending})
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func assertTransferBusinessState(t *testing.T, d *Devnet, want []byte) {
	t.Helper()
	if got := transferBusinessState(t, d); !bytes.Equal(got, want) {
		t.Fatalf("transfer business state changed unexpectedly\ngot: %s\nwant: %s", got, want)
	}
}

func nativeTransferInput() SignedTransferInput {
	return SignedTransferInput{Hash: "0x" + strings.Repeat("a", 64), From: "0x" + strings.Repeat("1", 40), To: "0x" + strings.Repeat("2", 40), Amount: 5, Fee: 1, Nonce: 1}
}

func submitConsistencyTransfer(d *Devnet, input SignedTransferInput, signed bool) (Transaction, bool, error) {
	if signed {
		return d.SubmitSignedTransfer(input)
	}
	tx, err := d.Transfer(input.From, input.To, input.Amount)
	return tx, false, err
}

func blockSnapshotWrite(t *testing.T, path string) func() {
	t.Helper()
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	// Keep the directory nonempty so the writer's temporary-file cleanup cannot
	// remove the obstruction and accidentally make the next attempt succeed.
	if err := os.WriteFile(filepath.Join(path, "blocker"), []byte("test"), 0o600); err != nil {
		t.Fatal(err)
	}
	return func() {
		t.Helper()
		if err := os.RemoveAll(path); err != nil {
			t.Fatal(err)
		}
	}
}

func readTransferSnapshot(t *testing.T, d *Devnet) *Devnet {
	t.Helper()
	restored := NewDevnet(d.cfg)
	restored.dataDir = d.dataDir
	if err := restored.loadSnapshot(); err != nil {
		t.Fatal(err)
	}
	return restored
}

func TestMoveLotsFailureIsAtomic(t *testing.T) {
	for _, test := range []string{"insufficient lots", "later lot credit overflow"} {
		t.Run(test, func(t *testing.T) {
			d := NewDevnet(DefaultNetworkConfig("testnet"))
			sender, receiver := d.account("sender"), d.account("receiver")
			sender.Lots = map[string]int64{"a": 3, "b": 2}
			d.lots["a"] = TrustTraceLot{LotID: "a", Amount: 3, LastInbound: "original"}
			amount := int64(6)
			if test == "later lot credit overflow" {
				amount = 5
				receiver.Lots["b"] = math.MaxInt64
			}
			before := transferBusinessState(t, d)
			if flows, err := d.moveLotsLocked(sender, receiver, amount); err == nil || len(flows) != 0 {
				t.Fatalf("expected atomic rejection, got flows=%v err=%v", flows, err)
			}
			assertTransferBusinessState(t, d, before)
		})
	}
}

func TestTransferValidationLeavesStateUnchanged(t *testing.T) {
	for _, signed := range []bool{false, true} {
		name := "unsigned"
		if signed {
			name = "native signed"
		}
		t.Run(name, func(t *testing.T) {
			for _, test := range []string{"missing sender", "insufficient balance", "insufficient lots", "amount overflow", "recipient overflow", "fee overflow", "combined credit overflow", "lot credit overflow", "nonce exhaustion", "bandwidth exhaustion"} {
				t.Run(test, func(t *testing.T) {
					d := NewDevnet(DefaultNetworkConfig("testnet"))
					input := nativeTransferInput()
					sender := d.account(input.From)
					sender.Balance = 100
					sender.Lots = map[string]int64{"a": 3, "b": 97}
					switch test {
					case "missing sender":
						delete(d.accounts, input.From)
					case "insufficient balance":
						sender.Balance = 5
					case "insufficient lots":
						sender.Lots["b"] = 1
					case "amount overflow":
						input.Amount = math.MaxInt64
					case "recipient overflow":
						d.account(input.To).Balance = math.MaxInt64
					case "fee overflow":
						d.account(ValidatorAddress).Balance = math.MaxInt64
					case "combined credit overflow":
						d.validators = []Validator{{Address: input.To, Active: true}}
						d.account(input.To).Balance = math.MaxInt64 - input.Amount
					case "lot credit overflow":
						d.account(input.To).Lots["b"] = math.MaxInt64
					case "nonce exhaustion":
						sender.Nonce = math.MaxUint64
					case "bandwidth exhaustion":
						sender.ResourceUsage.BandwidthUsed = math.MaxInt64
					}
					before := transferBusinessState(t, d)
					if tx, replayed, err := submitConsistencyTransfer(d, input, signed); err == nil || tx.Hash != "" || replayed {
						t.Fatalf("invalid transfer accepted: tx=%+v replayed=%v err=%v", tx, replayed, err)
					}
					assertTransferBusinessState(t, d, before)
				})
			}
		})
	}
}

func TestTransferPersistenceFailureRollsBackAndRetries(t *testing.T) {
	for _, mode := range []string{"unsigned", "native signed", "Ethereum signed"} {
		t.Run(mode, func(t *testing.T) {
			input := nativeTransferInput()
			if mode == "Ethereum signed" {
				raw, eth := ethereumFixture(t, "valid")
				input = ethereumInput(raw, eth)
			}
			signed := mode != "unsigned"
			d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if mode == "Ethereum signed" {
				if err := d.SetEthereumNativeTransfers(true); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := d.Faucet(input.From, 100); err != nil {
				t.Fatal(err)
			}
			before := transferBusinessState(t, d)
			unblock := blockSnapshotWrite(t, d.snapshotPath()+".tmp")
			for range 2 {
				tx, replayed, err := submitConsistencyTransfer(d, input, signed)
				if err == nil || errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash != "" || replayed {
					t.Fatalf("pre-rename failure was not rejected: tx=%+v replayed=%v err=%v", tx, replayed, err)
				}
				assertTransferBusinessState(t, d, before)
				assertTransferBusinessState(t, readTransferSnapshot(t, d), before)
			}
			unblock()
			tx, replayed, err := submitConsistencyTransfer(d, input, signed)
			if err != nil || replayed || tx.Hash == "" {
				t.Fatalf("retry after repair: tx=%+v replayed=%v err=%v", tx, replayed, err)
			}
			if d.accounts[input.From].Balance != 100-input.Amount-input.Fee || d.accounts[input.From].Nonce != 1 || d.accounts[input.To].Balance != input.Amount || len(d.pending) != 2 {
				t.Fatal("successful retry did not charge exactly once")
			}
			after := transferBusinessState(t, d)
			restored, err := NewPersistentDevnet(d.cfg, d.dataDir)
			if err != nil {
				t.Fatal(err)
			}
			assertTransferBusinessState(t, restored, after)
			if signed {
				if mode == "Ethereum signed" {
					if err := restored.SetEthereumNativeTransfers(true); err != nil {
						t.Fatal(err)
					}
				}
				for _, target := range []*Devnet{d, restored} {
					if repeated, replayed, err := target.SubmitSignedTransfer(input); err != nil || !replayed || repeated.Hash != tx.Hash {
						t.Fatalf("durable replay failed: tx=%+v replayed=%v err=%v", repeated, replayed, err)
					}
					assertTransferBusinessState(t, target, after)
				}
			}
		})
	}
}

func TestTransferRollbackPreservesAliasedAccountsAndExistingLots(t *testing.T) {
	for _, alias := range []string{"sender is recipient", "sender is validator", "recipient is validator", "new validator"} {
		t.Run(alias, func(t *testing.T) {
			d := NewDevnet(DefaultNetworkConfig("testnet"))
			input := nativeTransferInput()
			sender := d.account(input.From)
			sender.Balance, sender.Nonce = 100, 7
			sender.Lots = map[string]int64{"a": 3, "b": 97}
			d.account(input.To).Lots = map[string]int64{"a": 0, "unrelated": 5}
			d.lots["a"] = TrustTraceLot{LotID: "a", Amount: 3, LastInbound: "original"}
			switch alias {
			case "sender is recipient":
				input.To = input.From
			case "sender is validator":
				d.validators = []Validator{{Address: input.From, Active: true}}
			case "recipient is validator":
				d.validators = []Validator{{Address: input.To, Active: true}}
			case "new validator":
				d.validators = []Validator{{Address: "new validator", Active: true}}
			}
			d.dataDir = t.TempDir()
			unblock := blockSnapshotWrite(t, d.snapshotPath()+".tmp")
			before := transferBusinessState(t, d)
			if _, err := d.Transfer(input.From, input.To, input.Amount); err == nil {
				t.Fatal("expected persistence failure")
			}
			assertTransferBusinessState(t, d, before)
			unblock()
			if _, err := d.Transfer(input.From, input.To, input.Amount); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTransferPostRenameFailurePreservesVisibleSnapshot(t *testing.T) {
	for _, signed := range []bool{false, true} {
		name := "unsigned"
		if signed {
			name = "native signed"
		}
		t.Run(name, func(t *testing.T) {
			d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			input := nativeTransferInput()
			if _, err := d.Faucet(input.From, 100); err != nil {
				t.Fatal(err)
			}
			unblockMarker := blockSnapshotWrite(t, d.snapshotIntegrityMarkerPath()+".tmp")
			tx, replayed, err := submitConsistencyTransfer(d, input, signed)
			if !errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash == "" || replayed {
				t.Fatalf("post-rename outcome was not reported: tx=%+v replayed=%v err=%v", tx, replayed, err)
			}
			if d.accounts[input.From].Balance != 94 || d.accounts[input.From].Nonce != 1 || d.accounts[input.To].Balance != 5 || len(d.pending) != 2 {
				t.Fatal("post-rename state should retain the transfer visible on disk")
			}
			after := transferBusinessState(t, d)
			assertTransferBusinessState(t, readTransferSnapshot(t, d), after)
			if signed {
				// The first retry fails after rename; the second fails before it.
				// Neither can claim durable success or undo the earlier replacement.
				for _, beforeRename := range []bool{false, true} {
					var unblock func()
					if beforeRename {
						unblock = blockSnapshotWrite(t, d.snapshotPath()+".tmp")
					}
					repeated, replayed, err := d.SubmitSignedTransfer(input)
					if !errors.Is(err, ErrSnapshotDurabilityUncertain) || repeated.Hash != tx.Hash || replayed {
						t.Fatalf("uncertain replay returned success: tx=%+v replayed=%v err=%v", repeated, replayed, err)
					}
					assertTransferBusinessState(t, d, after)
					if unblock != nil {
						unblock()
					}
				}
			}
			unblockMarker()
			if signed {
				if repeated, replayed, err := d.SubmitSignedTransfer(input); err != nil || !replayed || repeated.Hash != tx.Hash {
					t.Fatalf("repaired replay: tx=%+v replayed=%v err=%v", repeated, replayed, err)
				}
				assertTransferBusinessState(t, d, after)
			}
			restored, err := NewPersistentDevnet(d.cfg, d.dataDir)
			if err != nil {
				t.Fatal(err)
			}
			assertTransferBusinessState(t, restored, after)
			if repeated, ok := restored.Transaction(tx.Hash); !ok || repeated.Hash != tx.Hash {
				t.Fatal("restart lost the transaction from the replaced snapshot")
			}
		})
	}
}

func TestDurableSnapshotJSONDirectorySyncFailureIsUncertain(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err := os.WriteFile(path, []byte("old snapshot"), 0o600); err != nil {
		t.Fatal(err)
	}
	syncFailure := errors.New("injected directory fsync failure")
	err := writeDurableSnapshotJSONWithDirectorySync(path, map[string]int{"new": 1}, func(directory string) error {
		if directory != filepath.Dir(path) {
			t.Fatal("wrong snapshot directory")
		}
		return syncFailure
	})
	if !errors.Is(err, ErrSnapshotDurabilityUncertain) || !errors.Is(err, syncFailure) {
		t.Fatalf("directory sync failure did not preserve outcome and cause: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var replacement map[string]int
	if err := json.Unmarshal(data, &replacement); err != nil || len(replacement) != 1 || replacement["new"] != 1 {
		t.Fatalf("replacement should already be visible: %s", data)
	}
	if _, err := os.Stat(path + ".tmp"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary file remained after replacement: %v", err)
	}
}
