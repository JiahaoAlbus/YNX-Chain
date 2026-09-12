package api

import (
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestNativeIdentityProjectionPreservesAccountsAndSeparatesSystems(t *testing.T) {
	address := "0x1234567890123456789012345678901234567890"
	alias, err := accountaddress.Encode(address)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{address, alias, "0X" + strings.ToUpper(address[2:])} {
		if got := nativeEVMIdentity(value); got != address {
			t.Fatalf("account payload changed: %s", got)
		}
	}
	faucet := nativeEVMIdentity("ynx_faucet")
	if !accountaddress.IsCanonical(faucet) || faucet == nativeEVMIdentity("ynx_faucet ") || faucet == nativeEVMIdentity("ynx_rewards") {
		t.Fatal("system identity domain is not exact or distinct")
	}
	tx := chain.Transaction{From: "ynx_faucet", To: alias}
	projected := evmTx(tx)
	if projected["from"] != faucet || projected["to"] != address {
		t.Fatal("transaction identity mapping disagrees")
	}
	native := projected["ynxNativeIdentity"].(map[string]any)
	if native["from"] != "ynx_faucet" || native["to"] != alias || tx.To != alias {
		t.Fatal("native identity was lost or mutated")
	}
	if nativeEVMRecipient("") != nil {
		t.Fatal("empty recipient must remain null")
	}
}

func TestNativeFaucetReceiptAndFullBlockUseSameIdentityProjection(t *testing.T) {
	dir := t.TempDir()
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	address := "0x1234567890123456789012345678901234567890"
	tx, err := d.Faucet(address, 100)
	if err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if err = d.SetEthereumNativeTransfers(true); err != nil {
		t.Fatal(err)
	}
	s := newServerWithConfig(d, ServerConfig{})
	receipt, err := s.transactionReceiptResult([]any{tx.Hash}, true)
	if err != nil {
		t.Fatal(err)
	}
	r := receipt.(map[string]any)
	if !accountaddress.IsCanonical(r["from"].(string)) || r["from"] != nativeEVMIdentity(tx.From) || r["to"] != address {
		t.Fatal("invalid receipt addresses")
	}
	legacy := r["ynxNativeTransaction"].(map[string]any)
	if len(legacy) != 4 || legacy["amountYNXT"] != "100" || legacy["feeYNXT"] != "0" || legacy["nonce"] == nil || legacy["type"] == nil {
		t.Fatalf("legacy exact four-field receipt changed: %+v", legacy)
	}
	native := r["ynxNativeIdentity"].(map[string]any)
	if native["from"] != tx.From {
		t.Fatal("system identity missing")
	}
	got, _, err := s.ethereumNativeResult("eth_getTransactionByHash", []any{tx.Hash})
	if err != nil {
		t.Fatal(err)
	}
	if got.(map[string]any)["from"] != r["from"] {
		t.Fatal("transaction/receipt mismatch")
	}
	block, _, err := s.ethereumNativeResult("eth_getBlockByNumber", []any{"latest", true})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, v := range block.(map[string]any)["transactions"].([]any) {
		item := v.(map[string]any)
		if item["hash"] == tx.Hash {
			found = true
			if item["from"] != r["from"] {
				t.Fatal("block/receipt mismatch")
			}
		}
	}
	if !found {
		t.Fatal("faucet missing from full block")
	}
	if a, _ := d.Account(address); a.Balance != 100 {
		t.Fatal("projection changed balance")
	}
	cold, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	saved, _ := cold.Transaction(tx.Hash)
	if saved.From != tx.From || saved.To != tx.To {
		t.Fatal("projection changed persisted identity")
	}
}
