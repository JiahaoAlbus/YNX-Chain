package bundler

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestBundlerSignsForCurrentNonceAndVerifiesCommittedEvidence(t *testing.T) {
	bundlerKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 91))
	bundlerAddress, _ := consensus.NativeAddress(bundlerKey.PubKey().SerializeCompressed())
	ownerKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 92))
	owner, _ := consensus.NativeAddress(ownerKey.PubKey().SerializeCompressed())
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 93))
	recipient, _ := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	_, signer, _ := ed25519.GenerateKey(nil)
	callHash := sha256.Sum256([]byte("bundler test call"))
	now := time.Date(2026, 7, 23, 4, 0, 0, 0, time.UTC)
	operation := assetauth.UserOperation{Version: 1, ChainID: assetauth.MandateChainID, Account: owner, ProductID: "wallet", NonceDomain: "wallet", Calls: []assetauth.AccountCall{{Target: recipient, Method: "transfer", ValueYNXT: 1, PayloadHash: hex.EncodeToString(callHash[:])}}, MaxFeeYNXT: 1, ValidAfter: now, ValidUntil: now.Add(time.Hour)}
	message, _ := operation.SigningBytes()
	operation.Signature = ed25519.Sign(signer, message)
	input := consensus.UserOperationExecutePayload{Operation: operation}
	receiptID := "0123456789abcdef01234567"
	receiptEvent := consensus.BFTUserOperationEvent{ID: receiptID, OperationHash: consensus.UserOperationHash(operation), Account: owner, Bundler: bundlerAddress, FeePayer: owner, CallCount: 1, ValueYNXT: 1, FeeYNXT: 1, BlockHeight: 10, ExecutedAt: now, TransactionHash: strings.Repeat("b", 64), AuditHash: strings.Repeat("a", 64)}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/health":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		case r.URL.Path == "/accounts/"+bundlerAddress:
			_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: bundlerAddress, Nonce: 7, Lots: map[string]int64{}})
		case r.URL.Path == "/aa/user-operations" && r.Method == http.MethodPost:
			raw, _ := io.ReadAll(r.Body)
			tx, err := consensus.DecodeSignedApplicationAction(raw)
			if err != nil || tx.Verify(6423) != nil || tx.Action != consensus.ActionUserOperationExecute || tx.Signer != bundlerAddress || tx.Nonce != 8 {
				t.Fatalf("unexpected Bundler action: %+v %v", tx, err)
			}
			txHash := consensus.ApplicationActionHash(raw)
			event := consensus.BFTUserOperationEvent{ID: consensus.ApplicationActionRecordID("user-operation", txHash), OperationHash: consensus.UserOperationHash(operation), Account: owner, Bundler: bundlerAddress, FeePayer: owner, CallCount: 1, ValueYNXT: 1, FeeYNXT: 1, BlockHeight: 10, ExecutedAt: now, TransactionHash: txHash, AuditHash: strings.Repeat("a", 64)}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"source": "ynx-consensus-abci", "asOf": now, "version": "abci-state-v11", "coverage": "exact", "failure": false, "userOperation": event})
		case r.URL.Path == "/aa/user-operations/"+receiptID && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"source": "ynx-consensus-abci", "asOf": now, "version": "abci-state-v11", "coverage": "exact", "failure": false, "userOperation": receiptEvent})
		case r.URL.Path == "/aa/user-operations/ffffffffffffffffffffffff" && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"source": "untrusted-cache", "asOf": now, "version": "unknown", "coverage": "exact", "failure": false, "userOperation": receiptEvent})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	service, err := New(Config{GatewayURL: upstream.URL, APIKey: "bundler-test-key-1234", PrivateKey: bundlerKey})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service.Handler())
	defer server.Close()

	payload, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, server.URL+"/user-operations", strings.NewReader(string(payload)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-Bundler-Key", "bundler-test-key-1234")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("unexpected Bundler status %d", response.StatusCode)
	}
	var result struct {
		Failure        bool                            `json:"failure"`
		BundlerAddress string                          `json:"bundlerAddress"`
		UserOperation  consensus.BFTUserOperationEvent `json:"userOperation"`
	}
	if json.NewDecoder(response.Body).Decode(&result) != nil || result.Failure || result.BundlerAddress != bundlerAddress || result.UserOperation.OperationHash != consensus.UserOperationHash(operation) {
		t.Fatalf("unexpected Bundler response: %+v", result)
	}

	unauthorized, err := http.NewRequest(http.MethodPost, server.URL+"/user-operations", strings.NewReader(string(payload)))
	if err != nil {
		t.Fatal(err)
	}
	unauthorized.Header.Set("Content-Type", "application/json")
	denied, err := http.DefaultClient.Do(unauthorized)
	if err != nil {
		t.Fatal(err)
	}
	defer denied.Body.Close()
	if denied.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized Bundler request returned %d", denied.StatusCode)
	}

	receiptRequest, err := http.NewRequest(http.MethodGet, server.URL+"/user-operations/"+receiptID, nil)
	if err != nil {
		t.Fatal(err)
	}
	receiptRequest.Header.Set("X-YNX-Bundler-Key", "bundler-test-key-1234")
	receiptResponse, err := http.DefaultClient.Do(receiptRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer receiptResponse.Body.Close()
	if receiptResponse.StatusCode != http.StatusOK {
		t.Fatalf("unexpected receipt status %d", receiptResponse.StatusCode)
	}
	var receiptResult gatewayUserOperationResponse
	if err := json.NewDecoder(receiptResponse.Body).Decode(&receiptResult); err != nil || receiptResult.Source != "ynx-consensus-abci" || receiptResult.UserOperation.ID != receiptID {
		t.Fatalf("unexpected receipt response: %+v %v", receiptResult, err)
	}

	mismatchRequest, err := http.NewRequest(http.MethodGet, server.URL+"/user-operations/ffffffffffffffffffffffff", nil)
	if err != nil {
		t.Fatal(err)
	}
	mismatchRequest.Header.Set("X-YNX-Bundler-Key", "bundler-test-key-1234")
	mismatchResponse, err := http.DefaultClient.Do(mismatchRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer mismatchResponse.Body.Close()
	if mismatchResponse.StatusCode != http.StatusBadGateway {
		t.Fatalf("untrusted receipt evidence returned %d", mismatchResponse.StatusCode)
	}
}
