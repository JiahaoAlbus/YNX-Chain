package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestFaucetAuthorityRejectsBeforeAnyStateChange(t *testing.T) {
	token := strings.Repeat("a", 64)
	for _, route := range []string{"/faucet", "/faucet/requests"} {
		for _, network := range []string{"testnet", "mainnet"} {
			for _, tc := range []struct {
				name, configured string
				headers          []string
				want             int
			}{
				{"unconfigured", "", nil, 503}, {"placeholder-config", "configured", []string{"configured"}, 503},
				{"absent", token, nil, 401}, {"placeholder", token, []string{"configured"}, 401},
				{"wrong", token, []string{strings.Repeat("b", 64)}, 401},
				{"duplicate", token, []string{token, token}, 401},
			} {
				t.Run(network+route+tc.name, func(t *testing.T) {
					d := chain.NewDevnet(chain.DefaultNetworkConfig(network))
					before := d.ExplorerSummary()
					h := NewServerWithConfig(d, ServerConfig{FaucetCoreAuthToken: tc.configured})
					r := httptest.NewRequest("POST", route, strings.NewReader(`{"address":"0x1111111111111111111111111111111111111111","amount":100,"requestId":"req_0123456789abcdef0123456789abcdef"}`))
					for _, v := range tc.headers {
						r.Header.Add(FaucetCoreAuthorityHeader, v)
					}
					w := httptest.NewRecorder()
					h.ServeHTTP(w, r)
					if w.Code != tc.want || w.Header().Get("Cache-Control") != "no-store" {
						t.Fatalf("unexpected auth response %d", w.Code)
					}
					a, _ := json.Marshal(before)
					b, _ := json.Marshal(d.ExplorerSummary())
					if !bytes.Equal(a, b) {
						t.Fatal("rejected funding changed ledger")
					}
					if strings.Contains(w.Body.String(), token) {
						t.Fatal("token leaked")
					}
				})
			}
		}
	}
}

func TestFaucetAuthorityPreservesSameIntentAcrossRestartAndRotation(t *testing.T) {
	dir := t.TempDir()
	cfg := chain.DefaultNetworkConfig("testnet")
	token := strings.Repeat("a", 64)
	body := `{"address":"0x1111111111111111111111111111111111111111","amount":100,"requestId":"req_0123456789abcdef0123456789abcdef"}`
	var hash string
	for i := 0; i < 2; i++ {
		d, err := chain.NewPersistentDevnet(cfg, dir)
		if err != nil {
			t.Fatal(err)
		}
		if i == 1 {
			token = strings.Repeat("b", 64)
		}
		s := newServerWithConfig(d, ServerConfig{FaucetCoreAuthToken: token})
		r := httptest.NewRequest("POST", "/faucet/requests", strings.NewReader(body))
		r.Header.Set(FaucetCoreAuthorityHeader, token)
		w := httptest.NewRecorder()
		s.withHeaders(s.mux).ServeHTTP(w, r)
		want := http.StatusCreated
		if i == 1 {
			want = http.StatusOK
		}
		if w.Code != want {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		var tx chain.Transaction
		if err = json.Unmarshal(w.Body.Bytes(), &tx); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			hash = tx.Hash
		} else if tx.Hash != hash {
			t.Fatal("rotation changed request identity")
		}
		a, _ := d.Account("0x1111111111111111111111111111111111111111")
		if a.Balance != 100 {
			t.Fatal("duplicate credit")
		}
		model, err := s.evmResult("ynx_getFaucetModel", nil)
		if err != nil {
			t.Fatal(err)
		}
		m := model.(map[string]any)["authority"].(map[string]any)
		if m["required"] != true || m["configured"] != true || m["version"] != FaucetCoreAuthorityVersion {
			t.Fatal("wrong authority capability")
		}
	}
}
