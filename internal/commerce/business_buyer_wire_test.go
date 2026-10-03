package commerce

import (
	"encoding/json"
	"testing"
)

func TestBuyerWirePreservesOriginalActorAndIntegerAmount(t *testing.T) {
	verified := &verifiedBusinessRequest{walletAccount: "ynx_original", principal: Principal{Account: "0x_original", Role: "buyer"}}
	source := map[string]any{"order": map[string]any{"Buyer": "0x_original", "TotalYNXT": json.Number("9007199254740993")}, "foreign": map[string]any{"Buyer": "0x_other"}}
	result := buyerWalletWire(source, verified).(map[string]any)
	order := result["order"].(map[string]any)
	if order["Buyer"] != "0x_original" || order["WalletBuyer"] != "ynx_original" || order["TotalYNXT"].(json.Number).String() != "9007199254740993" {
		t.Fatal("original buyer/amount changed")
	}
	if _, ok := result["foreign"].(map[string]any)["WalletBuyer"]; ok {
		t.Fatal("foreign actor projected")
	}
	if _, ok := source["order"].(map[string]any)["WalletBuyer"]; ok {
		t.Fatal("original record changed")
	}
	verified.principal.Role = "seller"
	if _, ok := buyerWalletWire(source, verified).(map[string]any)["order"].(map[string]any)["WalletBuyer"]; ok {
		t.Fatal("seller received buyer identity projection")
	}
}
