package faucet

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestAdmissionProcessFenceAndRestart(t *testing.T) {
	if mode := os.Getenv("YNX_TEST_ADMISSION_CHILD"); mode != "" {
		var cfg Config
		if err := json.Unmarshal([]byte(os.Getenv("YNX_TEST_ADMISSION_CONFIG")), &cfg); err != nil {
			t.Fatal(err)
		}
		s, err := New(cfg)
		if mode == "locked" {
			if err == nil {
				s.Close()
				t.Fatal("second process acquired live DB")
			}
			if !strings.Contains(err.Error(), "timeout") {
				t.Fatal(err)
			}
			return
		}
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		req := Request{Address: "ynx_process_recipient", RequestID: admissionTestID}
		if _, status, err := s.Request(context.Background(), req, "192.0.2.1"); status != 200 || err != nil {
			t.Fatalf("cold receipt: %d %v", status, err)
		}
		req.RequestID = "other_0123456789abcdef0123456789abcdef"
		if _, status, _ := s.Request(context.Background(), req, "192.0.2.1"); status != 429 {
			t.Fatalf("quota lost across processes: %d", status)
		}
		return
	}
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	up := httptest.NewServer(api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken}))
	defer up.Close()
	cfg := admissionTestConfig(t, up.URL)
	s := openTestFaucet(t, cfg)
	if _, status, err := s.Request(context.Background(), Request{Address: "ynx_process_recipient", RequestID: admissionTestID}, "192.0.2.1"); status != 201 || err != nil {
		t.Fatal(status, err)
	}
	raw, _ := json.Marshal(cfg)
	run := func(mode string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAdmissionProcessFenceAndRestart$")
		cmd.Env = append(os.Environ(), "YNX_TEST_ADMISSION_CHILD="+mode, "YNX_TEST_ADMISSION_CONFIG="+string(raw))
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v %s", mode, err, out)
		}
	}
	run("locked")
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	run("restarted")
	if account, _ := core.Account("ynx_process_recipient"); account.Balance != 100 {
		t.Fatal("process restart reminted")
	}
}

func TestAdmissionUpstreamTimeoutPreservesIntentAndQuota(t *testing.T) {
	core := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	handler := api.NewServerWithConfig(core, api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	var posts atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/faucet/requests" && posts.Add(1) == 1 {
			handler.ServeHTTP(httptest.NewRecorder(), r)
			select {
			case <-r.Context().Done():
			case <-time.After(time.Second):
			}
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer up.Close()
	cfg := admissionTestConfig(t, up.URL)
	s := openTestFaucet(t, cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	req := Request{Address: "ynx_timeout_recipient", RequestID: admissionTestID}
	receipt, status, err := s.Request(ctx, req, "192.0.2.1")
	cancel()
	if err == nil || status != 503 || !receipt.RetrySameRequest || receipt.RequestID != req.RequestID {
		t.Fatal(receipt, status, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestFaucet(t, cfg)
	if _, status, err := s.Request(context.Background(), req, "192.0.2.1"); status != 200 || err != nil {
		t.Fatal(status, err)
	}
	changed := req
	changed.Amount = 101
	if _, status, _ := s.Request(context.Background(), changed, "192.0.2.1"); status != 409 {
		t.Fatal(status)
	}
	changed = req
	changed.RequestID = "other_0123456789abcdef0123456789abcdef"
	if _, status, _ := s.Request(context.Background(), changed, "192.0.2.1"); status != 429 {
		t.Fatal(status)
	}
	if account, _ := core.Account(req.Address); account.Balance != 100 {
		t.Fatal("timeout retry reminted")
	}
}
