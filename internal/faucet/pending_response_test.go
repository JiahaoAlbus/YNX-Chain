package faucet

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestPendingResponseAndReadOnlyCompletion(t *testing.T) {
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	gate := make(chan struct{})
	var posts atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			posts.Add(1)
			<-gate
		}
		handler.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	s := openTestFaucet(t, admissionTestConfig(t, upstream.URL))
	server := httptest.NewServer(NewServer(s).Handler())
	defer server.Close()
	req := Request{Address: "0x00000000000000000000000000000000000000a1", RequestID: "pending_0123456789abcdef0123456789abcdef"}
	input, _ := json.Marshal(req)
	response, err := server.Client().Post(server.URL+"/request", "application/json", bytes.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	var pending Response
	if err := json.NewDecoder(response.Body).Decode(&pending); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 202 || pending.Status != "pending" || pending.RequestID != req.RequestID || pending.Transaction.Hash != "" || !pending.RetrySameRequest {
		t.Fatalf("unsafe pending response: %d %+v", response.StatusCode, pending)
	}
	status, code, err := s.RequestStatus(context.Background(), req.RequestID)
	if err != nil || code != 202 || status.Status != "pending" || posts.Load() != 1 {
		t.Fatalf("inflight status: %d %+v %v posts=%d", code, status, err, posts.Load())
	}
	close(gate)
	deadline := time.Now().Add(3 * time.Second)
	for {
		status, code, err = s.RequestStatus(context.Background(), req.RequestID)
		if err == nil && code == 200 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("completion: %d %+v %v", code, status, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if status.Status != "accepted" || status.Transaction.Hash != pending.TransactionHash || posts.Load() != 1 {
		t.Fatalf("exact receipt: %+v posts=%d", status, posts.Load())
	}
	if account, _ := core.Account(req.Address); account.Balance != 100 {
		t.Fatalf("credited %d", account.Balance)
	}
}

func TestPendingAdmissionResumesAfterFaucetRestart(t *testing.T) {
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	gate := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" && posts.Add(1) == 1 {
			<-gate
			http.Error(w, "first attempt stopped before Core mutation", 503)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	cfg := admissionTestConfig(t, upstream.URL)
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	req := Request{Address: "0x00000000000000000000000000000000000000a2", RequestID: "restart_0123456789abcdef0123456789abcdef"}
	result, code, err := s.Request(context.Background(), req, "192.0.2.9")
	if err != nil || code != 202 || result.Status != "pending" {
		t.Fatalf("first response: %d %+v %v", code, result, err)
	}
	close(gate)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	deadline := time.Now().Add(4 * time.Second)
	for {
		result, code, err = s.RequestStatus(context.Background(), req.RequestID)
		if err == nil && code == 200 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("restart completion: %d %+v %v posts=%d", code, result, err, posts.Load())
		}
		time.Sleep(10 * time.Millisecond)
	}
	if posts.Load() != 2 || result.Status != "accepted" || result.Transaction.Hash != result.TransactionHash {
		t.Fatalf("resume mismatch: %+v posts=%d", result, posts.Load())
	}
	if account, _ := core.Account(req.Address); account.Balance != 100 {
		t.Fatalf("credited %d", account.Balance)
	}
}

func TestPendingResponseNeverConfirmsFailedCoreMutation(t *testing.T) {
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	gate := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" {
			<-gate
			http.Error(w, "checkpoint unavailable", http.StatusServiceUnavailable)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	s := openTestFaucet(t, admissionTestConfig(t, upstream.URL))
	req := Request{Address: "0x00000000000000000000000000000000000000a3", RequestID: "failed_0123456789abcdef0123456789abcdef"}
	first, code, err := s.Request(context.Background(), req, "192.0.2.10")
	if err != nil || code != 202 || first.Status != "pending" {
		t.Fatalf("first response: %d %+v %v", code, first, err)
	}
	close(gate)
	time.Sleep(30 * time.Millisecond)
	status, code, err := s.RequestStatus(context.Background(), req.RequestID)
	if err != nil || code != 202 || status.Status != "pending" || status.Transaction.Hash != "" {
		t.Fatalf("false receipt: %d %+v %v", code, status, err)
	}
	if account, _ := core.Account(req.Address); account.Balance != 0 {
		t.Fatalf("uncommitted credit %d", account.Balance)
	}
}
