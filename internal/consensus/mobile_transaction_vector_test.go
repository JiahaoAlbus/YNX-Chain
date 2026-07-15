package consensus

import (
	"encoding/json"
	"os"
	"testing"
)

func TestMobileNativeTransferVector(t *testing.T) {
	payload, err := os.ReadFile("../../testdata/mobile-native-transfer-vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Payload string `json:"payload"`
		Hash    string `json:"hash"`
	}
	if err := json.Unmarshal(payload, &vector); err != nil {
		t.Fatal(err)
	}
	tx, err := DecodeSignedTransaction([]byte(vector.Payload))
	if err != nil {
		t.Fatalf("mobile transaction does not decode canonically: %v", err)
	}
	if err := tx.Verify(6423); err != nil {
		t.Fatalf("mobile transaction signature does not verify: %v", err)
	}
	if got := SignedTransactionHash([]byte(vector.Payload)); got != vector.Hash {
		t.Fatalf("mobile transaction hash mismatch: got %s want %s", got, vector.Hash)
	}
	if tx.From != "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf" || tx.To != "0xffffffffffffffffffffffffffffffffffffffff" || tx.Amount != 25 || tx.Fee != 1 || tx.Nonce != 7 {
		t.Fatalf("mobile transaction fields changed: %+v", tx)
	}
}
