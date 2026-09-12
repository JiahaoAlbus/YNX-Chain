package bftgateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestEVMSendRawTransactionClassifiesCometDuplicateAsTransactionRejection(t *testing.T) {
	senderKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 61))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 62))
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	payload, _, err := consensus.NewEthereumDynamicFeeTransfer(senderKey, 6423, 0, 1, 2, recipient, 1)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/broadcast_tx_commit" || r.URL.Query().Get("tx") != fmt.Sprintf("0x%x", payload) {
			t.Fatalf("unexpected duplicate broadcast request: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"code":    -32603,
				"message": "Internal error",
				"data":    "tx already exists in cache",
			},
		})
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	params := json.RawMessage(fmt.Sprintf(`["0x%x"]`, payload))
	result, code, err := gateway.evmSendRawTransaction(context.Background(), params)
	if err == nil || result != nil || code != -32003 || !strings.Contains(strings.ToLower(err.Error()), "duplicate") || !strings.Contains(strings.ToLower(err.Error()), "already exists in cache") {
		t.Fatalf("duplicate Comet transaction was not classified as a transaction rejection: result=%v code=%d err=%v", result, code, err)
	}
}
