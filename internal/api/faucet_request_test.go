package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
)

func TestFaucetHTTPRetainsIntentAcrossUncertainResult(t *testing.T) {
	dir := t.TempDir()
	cfg := chain.DefaultNetworkConfig("testnet")
	d, err := chain.NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	s := newServerWithConfig(d, ServerConfig{FaucetCoreAuthToken: token})
	id := "req_abcdef0123456789abcdef0123456789"
	request := func(amount int64) *httptest.ResponseRecorder {
		payload, _ := json.Marshal(map[string]any{"address": "ynx_http_faucet_retry", "amount": amount, "requestId": id})
		r := httptest.NewRequest(http.MethodPost, "/faucet", bytes.NewReader(payload))
		r.Header.Set(FaucetCoreAuthorityHeader, token)
		w := httptest.NewRecorder()
		s.handleFaucet(w, r)
		return w
	}
	unblock := obstructReceiptCheckpoint(t, filepath.Join(dir, "devnet-state.integrity-version.tmp"))
	w := request(100)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected uncertain 503: %d %s", w.Code, w.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	hash, _ := chain.FaucetRequestHash(cfg.ChainID, id)
	if result["transactionHash"] != hash || result["requestId"] != id || result["status"] != "transaction_durability_uncertain" {
		t.Fatalf("lost retry binding: %v", result)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("uncertain response cacheable")
	}
	unblock()
	d, err = chain.NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	s = newServerWithConfig(d, ServerConfig{FaucetCoreAuthToken: token})
	w = request(100)
	var tx chain.Transaction
	if err := json.Unmarshal(w.Body.Bytes(), &tx); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || tx.Hash != hash || w.Header().Get("X-YNX-Faucet-Idempotency") != chain.FaucetRequestVersion {
		t.Fatalf("cold exact retry: %d %s", w.Code, w.Body.String())
	}
	if w = request(101); w.Code != http.StatusConflict {
		t.Fatalf("changed payload accepted: %d %s", w.Code, w.Body.String())
	}
	account, _ := d.Account("ynx_http_faucet_retry")
	if account.Balance != 100 {
		t.Fatal("HTTP retry duplicated credit")
	}
}

func TestFaucetModelIsExplicitAndReadOnly(t *testing.T) {
	for _, nativeFees := range []bool{false, true} {
		d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
		if err := d.SetEthereumNativeTransfers(nativeFees); err != nil {
			t.Fatal(err)
		}
		s := newServerWithConfig(d, ServerConfig{})
		value, err := s.evmResult("ynx_getFaucetModel", nil)
		if err != nil {
			t.Fatal(err)
		}
		model := value.(map[string]any)
		if model["version"] != chain.FaucetRequestVersion || model["chainId"] != "0x1917" || model["legacyRequestSafeRetry"] != false || model["consensusFinality"] != false {
			t.Fatalf("wrong model: %v", model)
		}
		if _, err = s.evmResult("ynx_getFaucetModel", []any{"unexpected"}); err == nil {
			t.Fatal("accepted unexpected model parameters")
		}
		marker := filepath.Join(t.TempDir(), "freeze")
		if err := os.WriteFile(marker, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		handler := mutationfreeze.Wrap(NewServerWithConfig(d, ServerConfig{ReadOnlyReplica: true}), marker)
		query := `{"jsonrpc":"2.0","id":1,"method":"ynx_getFaucetModel","params":[]}`
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/evm", strings.NewReader(query)))
		if out.Code != 200 || strings.Contains(out.Body.String(), `"error"`) || !strings.Contains(out.Body.String(), chain.FaucetRequestVersion) {
			t.Fatalf("model blocked while frozen: %d %s", out.Code, out.Body.String())
		}
		mixed := `[` + query + `,{"jsonrpc":"2.0","id":2,"method":"eth_sendRawTransaction","params":["0x01"]}]`
		out = httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/evm", strings.NewReader(mixed)))
		if out.Code != 503 {
			t.Fatal("mixed write escaped freeze")
		}
	}
}
