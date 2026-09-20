package faucet

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Two isolated HTTP ingress listeners share one real Faucet service/admission
// store and a temporary persistent Core. No public network or account is used.
func aliasIngress(t *testing.T, service *Service) [2]*httptest.Server {
	t.Helper()
	handler := NewServer(service).Handler()
	servers := [2]*httptest.Server{httptest.NewServer(handler), httptest.NewServer(handler)}
	for _, server := range servers {
		t.Cleanup(server.Close)
	}
	return servers
}

func aliasRequest(server *httptest.Server, alias int, method, path string, payload any) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, server.URL+path, body)
	if err != nil {
		return 0, nil, err
	}
	host := []string{"faucet.ynxweb4.com", "faucet-testnet.ynxweb4.com"}[alias]
	request.Host = host
	request.Header.Set("Origin", "https://"+host)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Real-IP", "192.0.2.42")
	response, err := server.Client().Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if response.Header.Get("Access-Control-Allow-Origin") != "https://"+host {
		return response.StatusCode, raw, fmt.Errorf("alias CORS missing")
	}
	return response.StatusCode, raw, err
}

func TestEndpointAliasesShareMultiuserQuotaAndColdReplay(t *testing.T) {
	core, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken}))
	defer upstream.Close()
	config := admissionTestConfig(t, upstream.URL)
	service := openTestFaucet(t, config)
	aliases := aliasIngress(t, service)
	var group sync.WaitGroup
	for i := 0; i < 40; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			request := Request{Address: fmt.Sprintf("0x%040x", i+1), RequestID: fmt.Sprintf("alias_user_%032d", i)}
			status, _, err := aliasRequest(aliases[i%2], i%2, "POST", "/request", request)
			if err != nil || status != 201 {
				t.Errorf("user %d initial: %d %v", i, status, err)
				return
			}
			status, _, err = aliasRequest(aliases[1-i%2], 1-i%2, "POST", "/request", request)
			if err != nil || status != 200 {
				t.Errorf("user %d cross-alias replay: %d %v", i, status, err)
			}
			if account, _ := core.Account(request.Address); account.Balance != 100 {
				t.Errorf("user %d credited %d", i, account.Balance)
			}
		}(i)
	}
	group.Wait()
	request := Request{Address: fmt.Sprintf("0x%040x", 1), RequestID: "alias_user_00000000000000000000000000000000"}
	changed := request
	changed.Amount = 101
	if status, _, err := aliasRequest(aliases[1], 1, "POST", "/request", changed); err != nil || status != 409 {
		t.Fatalf("alias changed amount: %d %v", status, err)
	}
	for _, ingress := range aliases {
		ingress.Close()
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	service = openTestFaucet(t, config)
	aliases = aliasIngress(t, service)
	if status, _, err := aliasRequest(aliases[1], 1, "POST", "/request", request); err != nil || status != 200 {
		t.Fatalf("cold alias replay: %d %v", status, err)
	}
	request.RequestID = "alias_new_00000000000000000000000000000000"
	if status, _, err := aliasRequest(aliases[0], 0, "POST", "/request", request); err != nil || status != 429 {
		t.Fatalf("cold alias quota: %d %v", status, err)
	}
	if account, _ := core.Account(request.Address); account.Balance != 100 {
		t.Fatal("cold replay reminted")
	}
}

func TestEndpointAliasLostACKRecoversOnOtherAliasAfterRestart(t *testing.T) {
	core, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/faucet/requests" {
			posts.Add(1)
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, r)
			http.Error(w, "fixture lost ACK", 503)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	config := admissionTestConfig(t, upstream.URL)
	service := openTestFaucet(t, config)
	aliases := aliasIngress(t, service)
	request := Request{Address: fmt.Sprintf("0x%040x", 100), RequestID: "alias_lost_0000000000000000000000000000000"}
	if status, _, err := aliasRequest(aliases[0], 0, "POST", "/request", request); err != nil || status != 503 {
		t.Fatalf("lost ACK: %d %v", status, err)
	}
	for _, ingress := range aliases {
		ingress.Close()
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	service = openTestFaucet(t, config)
	aliases = aliasIngress(t, service)
	for i := 0; i < 2; i++ {
		status, raw, err := aliasRequest(aliases[i], i, "GET", "/request-status?requestId="+request.RequestID, nil)
		var receipt Response
		if err != nil || status != 200 || json.Unmarshal(raw, &receipt) != nil || receipt.Status != "accepted" || receipt.RequestID != request.RequestID {
			t.Fatalf("cold recovery: %d %s %v", status, raw, err)
		}
	}
	if posts.Load() != 1 {
		t.Fatalf("GET recovery resent a mint: %d", posts.Load())
	}
	if account, _ := core.Account(request.Address); account.Balance != 100 {
		t.Fatalf("balance %d", account.Balance)
	}
}
