package video

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const gatewayTestAccount = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"

func TestGatewayWalletContractRejectsReplayTamperAndWrongProduct(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	root := t.TempDir()
	key := []byte("test-gateway-attestation-key-32-bytes")
	cfg := Config{Root: root, IntegrityKey: []byte("test-video-integrity-key-32-bytes!!"), Scanner: testScanner{}, Processor: testProcessor{}, Now: func() time.Time { return now }}
	s, err := NewService(cfg)
	if err != nil {
		t.Fatal(err)
	}
	auth := GatewaySessionAuth{Service: s, Key: key, Now: func() time.Time { return now }, Clients: map[string]GatewayClient{
		"ynx-video-mobile-v1": {BundleID: "com.ynxweb4.video", Scopes: []string{"video.comment", "video.history", "video.read", "video.report", "video.subscribe"}},
	}}
	request := func(path string, mutate func(map[string]string)) *http.Request {
		r, _ := http.NewRequest(http.MethodGet, path, nil)
		fields := map[string]string{"time": now.Format(time.RFC3339Nano), "expires": now.Add(time.Hour).Format(time.RFC3339Nano), "nonce": "nonce-contract-vector-00001", "binding": strings.Repeat("a", 64), "client": "ynx-video-mobile-v1", "bundle": "com.ynxweb4.video", "account": gatewayTestAccount, "scopes": "video.comment video.history video.read video.report video.subscribe"}
		if mutate != nil {
			mutate(fields)
		}
		headers, signErr := SignGatewayRequest(key, r, nil, fields)
		if signErr != nil {
			t.Fatal(signErr)
		}
		for name, value := range headers {
			r.Header.Set(name, value)
		}
		return r
	}
	if account, err := auth.Account(request("/v1/videos", nil)); err != nil || account != gatewayTestAccount {
		t.Fatalf("valid central session rejected: %s %v", account, err)
	}
	if _, err := auth.Account(request("/v1/videos", nil)); err == nil || !strings.Contains(err.Error(), "replay") {
		t.Fatalf("exact replay accepted: %v", err)
	}
	if _, err := auth.Account(request("/v1/history", func(f map[string]string) { f["bundle"] = "com.attacker.video" })); err == nil {
		t.Fatal("cross-app session accepted")
	}
	restarted, err := NewService(cfg)
	if err != nil {
		t.Fatal(err)
	}
	auth.Service = restarted
	if _, err := auth.Account(request("/v1/videos", nil)); err == nil || !strings.Contains(err.Error(), "replay") {
		t.Fatalf("replay survived restart: %v", err)
	}
}

func TestStateIntegrityAndAuditChainRejectTamper(t *testing.T) {
	root := t.TempDir()
	cfg := Config{Root: root, IntegrityKey: []byte("test-video-integrity-key-32-bytes!!"), Scanner: testScanner{}, Processor: testProcessor{}}
	s, err := NewService(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.EnsureChannel(gatewayTestAccount, "integrity", "Integrity"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "state.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	channels := state["channels"].(map[string]any)
	for _, item := range channels {
		item.(map[string]any)["Name"] = "Tampered"
	}
	mutated, _ := json.Marshal(state)
	if err = os.WriteFile(path, mutated, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = NewService(cfg); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("tampered state reopened: %v", err)
	}
}
