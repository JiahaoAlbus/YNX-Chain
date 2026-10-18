package consensus

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestNativeDeltaOrderedBalancedAndPersistent(t *testing.T) {
	rng := rand.New(rand.NewSource(6423))
	var root *nativeDelta[int64]
	want := map[string]int64{}
	type saved struct {
		root   *nativeDelta[int64]
		values map[string]int64
	}
	var history []saved
	var check func(*nativeDelta[int64], string, string) int
	check = func(n *nativeDelta[int64], lower, upper string) int {
		if n == nil {
			return 0
		}
		if (lower != "" && n.key <= lower) || (upper != "" && n.key >= upper) {
			t.Fatal("tree order changed")
		}
		left, right := check(n.left, lower, n.key), check(n.right, n.key, upper)
		height := max(left, right) + 1
		if n.height != height || left-right > 1 || right-left > 1 {
			t.Fatal("AVL height/balance invariant failed")
		}
		return height
	}
	for i := 0; i < 3000; i++ {
		key := fmt.Sprintf("key-%04d", rng.Intn(1024))
		value := rng.Int63() - rng.Int63()
		root = deltaPut(root, key, value)
		want[key] = value
		check(root, "", "")
		if i%128 == 0 {
			copyMap := map[string]int64{}
			for k, v := range want {
				copyMap[k] = v
			}
			history = append(history, saved{root, copyMap})
		}
	}
	for _, version := range append(history, saved{root, want}) {
		got := map[string]int64{}
		var keys []string
		deltaWalk(version.root, func(key string, value int64) { got[key] = value; keys = append(keys, key) })
		if !reflect.DeepEqual(got, version.values) || !sort.StringsAreSorted(keys) || deltaCount(version.root) != len(got) {
			t.Fatal("later update mutated an older tree version")
		}
		if deltaHeight(version.root) > int(2*math.Log2(float64(len(got)+1))) {
			t.Fatal("tree depth is unbounded")
		}
		for key, value := range version.values {
			if got, ok := deltaGet(version.root, key); !ok || got != value {
				t.Fatal("tree lookup differs from map oracle")
			}
		}
	}
}

func nativeProjection(t *testing.T, state executionState) []byte {
	t.Helper()
	data, err := json.Marshal(struct {
		Accounts []chain.ConsensusAccount
		Fees     []BFTFeeEvent
	}{cloneExecutionAccounts(state), state.feeEvents.events()})
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestNativeDeltaDifferentialSequencesAndBranches(t *testing.T) {
	var keys []*secp256k1.PrivateKey
	var addresses []string
	for i := byte(161); i < 166; i++ {
		key := deterministicPrivateKey(i)
		keys = append(keys, key)
		addresses = append(addresses, mustNativeAddress(t, key))
	}
	var accounts []chain.ConsensusAccount
	for _, address := range addresses[:3] {
		accounts = append(accounts, chain.ConsensusAccount{Address: address, Balance: 1000, Lots: map[string]int64{"c": 300, "a": 350, "b": 350, "zero": 0}})
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].Address < accounts[j].Address })
	oldState, newState := executionState{accounts: cloneAccounts(accounts)}, executionState{accounts: cloneAccounts(accounts)}
	legacy, app := &Application{migration: chain.ConsensusMigrationState{Network: chain.DefaultNetworkConfig("testnet")}}, &Application{migration: chain.ConsensusMigrationState{Network: chain.DefaultNetworkConfig("testnet")}}
	rng := rand.New(rand.NewSource(6423))
	for i := 0; i < 400; i++ {
		from := rng.Intn(len(keys))
		to := (from + 1 + rng.Intn(len(keys)-1)) % len(keys)
		nonce := uint64(1)
		if index, exists := accountIndex(oldState.accounts, addresses[from]); exists {
			nonce = oldState.accounts[index].Nonce + 1
		}
		if i%11 == 0 {
			nonce++
		}
		tx, err := NewSignedTransfer(keys[from], 6423, addresses[to], int64(1+rng.Intn(330)), nonce)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := EncodeSignedTransaction(tx)
		if err != nil {
			t.Fatal(err)
		}
		fee := []string{"ynx_sparse_fee", addresses[from], addresses[to]}[i%3]
		legacy.feeRecipient, app.feeRecipient = fee, fee
		before := nativeProjection(t, newState)
		oldNext, oldExecution, oldErr := legacyNativeApply(legacy, oldState, raw, int64(i+2), time.Unix(100+int64(i), 0))
		newNext, newExecution, newErr := app.applyTransaction(newState, raw, int64(i+2), time.Unix(100+int64(i), 0))
		if (oldErr == nil) != (newErr == nil) || transactionCode(oldErr) != transactionCode(newErr) || !reflect.DeepEqual(oldExecution, newExecution) {
			t.Fatalf("step %d execution/result differs: old=%v new=%v", i, oldErr, newErr)
		}
		if oldErr != nil && oldErr.Error() != newErr.Error() {
			t.Fatal("failure reason changed")
		}
		if !bytes.Equal(before, nativeProjection(t, newState)) {
			t.Fatal("attempt mutated its input branch")
		}
		if oldErr == nil {
			if !bytes.Equal(nativeProjection(t, oldNext), nativeProjection(t, newNext)) {
				t.Fatalf("canonical result differs at step %d", i)
			}
			// A sibling from the same old root must not overwrite newNext.
			_, _, _ = app.applyTransaction(newState, raw, int64(i+2), time.Unix(100+int64(i), 0))
			if !bytes.Equal(nativeProjection(t, oldNext), nativeProjection(t, newNext)) {
				t.Fatal("sibling branch overwrote prior result")
			}
			oldState, newState = oldNext, newNext
		}
		if i%37 == 0 {
			newState = cloneExecutionStateValue(newState)
		}
		if !bytes.Equal(nativeProjection(t, oldState), nativeProjection(t, newState)) {
			t.Fatal("full-clone boundary lost sparse state")
		}
	}
}

func TestNativeDeltaLateFeeFailurePreservesPriorOverlay(t *testing.T) {
	key := deterministicPrivateKey(171)
	sender := mustNativeAddress(t, key)
	receiver := mustNativeAddress(t, deterministicPrivateKey(172))
	app := &Application{migration: chain.ConsensusMigrationState{Network: chain.DefaultNetworkConfig("testnet")}, feeRecipient: "ynx_sparse_fee"}
	state := executionState{accounts: []chain.ConsensusAccount{{Address: sender, Balance: 100, Lots: map[string]int64{"lot": 3}}}}
	apply := func(state executionState, nonce uint64) (executionState, error) {
		tx, err := NewSignedTransfer(key, 6423, receiver, 1, nonce)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := EncodeSignedTransaction(tx)
		if err != nil {
			t.Fatal(err)
		}
		next, _, err := app.applyTransaction(state, raw, 2, time.Unix(100, 0))
		return next, err
	}
	first, err := apply(state, 1)
	if err != nil {
		t.Fatal(err)
	}
	before := nativeProjection(t, first)
	if _, err := apply(first, 2); err == nil || transactionCode(err) != CodeInsufficientYNXT {
		t.Fatal("expected late fee-lot failure")
	}
	if !bytes.Equal(before, nativeProjection(t, first)) {
		t.Fatal("failed fee movement mutated prior sparse lots")
	}
}

func TestNativeDeltaFanInZeroLotsAndOwnedMaterialization(t *testing.T) {
	var keys []*secp256k1.PrivateKey
	var accounts []chain.ConsensusAccount
	for i := byte(1); i <= 64; i++ {
		key := deterministicPrivateKey(i)
		keys = append(keys, key)
		accounts = append(accounts, chain.ConsensusAccount{Address: mustNativeAddress(t, key), Balance: 10, Lots: map[string]int64{fmt.Sprintf("lot-%04d", i): 10}})
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].Address < accounts[j].Address })
	receiver := mustNativeAddress(t, deterministicPrivateKey(181))
	fee := mustNativeAddress(t, deterministicPrivateKey(182))
	app := &Application{migration: chain.ConsensusMigrationState{Network: chain.DefaultNetworkConfig("testnet")}, feeRecipient: fee}
	legacy := &Application{migration: app.migration, feeRecipient: fee}
	oldState, newState := executionState{accounts: cloneAccounts(accounts)}, executionState{accounts: cloneAccounts(accounts)}
	var prefix executionState
	var prefixBytes []byte
	for round := uint64(1); round <= 2; round++ {
		for i, key := range keys {
			amount := int64(1)
			if round == 2 {
				amount = 7
			} // Spend all remaining value, retaining zero-valued lot keys.
			tx, err := NewSignedTransfer(key, 6423, receiver, amount, round)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
			oldNext, _, oldErr := legacyNativeApply(legacy, oldState, raw, int64(round)+1, time.Unix(100+int64(round), 0))
			newNext, _, newErr := app.applyTransaction(newState, raw, int64(round)+1, time.Unix(100+int64(round), 0))
			if oldErr != nil || newErr != nil || !bytes.Equal(nativeProjection(t, oldNext), nativeProjection(t, newNext)) {
				t.Fatalf("fan-in %d/%d differs: %v %v", round, i, oldErr, newErr)
			}
			oldState, newState = oldNext, newNext
			if round == 1 && i == 31 {
				prefix = newState
				prefixBytes = nativeProjection(t, prefix)
			}
		}
	}
	if !bytes.Equal(prefixBytes, nativeProjection(t, prefix)) {
		t.Fatal("later dense lot updates overwrote a previous root")
	}
	canonical := cloneExecutionStateValue(newState)
	for i := range canonical.accounts {
		if i == 0 {
			canonical.accounts[i].Balance++
			canonical.accounts[i].Lots["mutation-probe"] = 1
		}
	}
	if !bytes.Equal(nativeProjection(t, oldState), nativeProjection(t, newState)) {
		t.Fatal("materialized maps alias the immutable sparse state")
	}
	for _, key := range keys {
		address := mustNativeAddress(t, key)
		index, _ := accountIndex(oldState.accounts, address)
		if oldState.accounts[index].Balance != 0 || len(oldState.accounts[index].Lots) != 1 {
			t.Fatal("zero lot retention fixture did not fully spend")
		}
	}
}
