package trustgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const (
	testAPIKey      = "local-trust-api-key"
	testUpstreamKey = "local-trust-upstream-key"
)

func TestGatewayRequiresDedicatedKeys(t *testing.T) {
	_, err := New(Config{ChainURL: "http://127.0.0.1:6420"})
	if err == nil || !strings.Contains(err.Error(), "YNX_TRUST_API_KEY") {
		t.Fatalf("expected API key error, got %v", err)
	}
	_, err = New(Config{ChainURL: "http://127.0.0.1:6420", APIKey: testAPIKey})
	if err == nil || !strings.Contains(err.Error(), "YNX_TRUST_GATEWAY_UPSTREAM_KEY") {
		t.Fatalf("expected upstream key error, got %v", err)
	}
	if _, err := New(Config{ChainURL: "http://ynx-chaind:6420", APIKey: testAPIKey, UpstreamKey: testUpstreamKey}); err != nil {
		t.Fatalf("expected private service URL to work: %v", err)
	}
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 111))
	address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	unsafe := t.TempDir() + "/unsafe.key"
	if err := os.WriteFile(unsafe, key.Serialize(), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{ChainURL: "http://127.0.0.1:6420", APIKey: testAPIKey, UpstreamMode: UpstreamBFT, SignerKeyPath: unsafe, SignerAddress: address}); err == nil || !strings.Contains(err.Error(), "mode-restricted") {
		t.Fatalf("unsafe BFT Trust signer permissions accepted: %v", err)
	}
}

func TestBFTTrustSerializesNonceBindsActorAndFailsClosed(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 112))
	address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	var mu sync.Mutex
	var nonce uint64
	broadcasts := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/accounts/"+address:
			mu.Lock()
			n := nonce
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: address, Balance: 100, Nonce: n})
		case r.Method == http.MethodGet && r.URL.Path == "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"chainId": 6423, "height": 10, "network": "YNX Testnet", "nativeCurrencySymbol": "YNXT"})
		case r.Method == http.MethodPost && r.URL.Path == "/governance/requests":
			raw, _ := io.ReadAll(r.Body)
			var tx consensus.SignedApplicationAction
			if json.Unmarshal(raw, &tx) != nil || tx.Verify(6423) != nil {
				http.Error(w, "bad tx", 400)
				return
			}
			var p consensus.GovernanceRequestPayload
			_ = json.Unmarshal(tx.Payload, &p)
			mu.Lock()
			defer mu.Unlock()
			if tx.Nonce != nonce+1 {
				http.Error(w, "nonce", 422)
				return
			}
			nonce = tx.Nonce
			broadcasts++
			hash := consensus.ApplicationActionHash(raw)
			record := consensus.BFTGovernanceRequest{GovernanceRequest: chain.GovernanceRequest{ID: consensus.ApplicationActionRecordID("governance-request", hash), Requester: p.Requester, Subject: p.Subject, Action: p.Action, Status: "pending_review", CreatedAt: time.Now().UTC()}, Signer: address, BlockHeight: 1, TxHash: hash, AuditHash: strings.Repeat("a", 64)}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(record)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	service, err := New(Config{ChainURL: upstream.URL, APIKey: testAPIKey, UpstreamMode: UpstreamBFT, SignerKey: fmt.Sprintf("%064x", 112), SignerAddress: address, ChainID: 6423})
	if err != nil {
		t.Fatal(err)
	}
	const count = 8
	var wg sync.WaitGroup
	errs := make(chan error, count)
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := []byte(fmt.Sprintf(`{"requester":"spoofed","subject":"subject-%d","action":"review","assetType":"address","scope":"one","description":"bounded","evidence":["case:%d"]}`, i, i))
			resp, err := service.Proxy(context.Background(), http.MethodPost, "/governance/requests", "", body, fmt.Sprintf("request-%d", i))
			if err != nil {
				errs <- err
				return
			}
			if resp.Status != http.StatusCreated {
				errs <- fmt.Errorf("status %d", resp.Status)
				return
			}
			var record consensus.BFTGovernanceRequest
			if json.Unmarshal(resp.Body, &record) != nil || record.Requester != address {
				errs <- errors.New("signer binding mismatch")
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	mu.Lock()
	gotNonce, gotBroadcasts := nonce, broadcasts
	mu.Unlock()
	if gotNonce != count || gotBroadcasts != count {
		t.Fatalf("concurrent Trust nonce mismatch: nonce=%d broadcasts=%d", gotNonce, gotBroadcasts)
	}
	if _, err := service.Proxy(context.Background(), http.MethodPost, "/trust/unknown-mutation", "", []byte(`{"subject":"x"}`), "unsupported"); err == nil || !strings.Contains(err.Error(), "not BFT-backed") {
		t.Fatalf("unsupported Trust mutation did not fail closed: %v", err)
	}
	if nonce != count {
		t.Fatal("unsupported mutation consumed nonce")
	}
}

func TestBFTTrustRejectsInconsistentCommittedResponse(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 113))
	address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: address, Balance: 10})
			return
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(consensus.BFTGovernanceRequest{GovernanceRequest: chain.GovernanceRequest{ID: strings.Repeat("0", 24), Requester: address}, Signer: address, TxHash: "0x" + strings.Repeat("0", 64)})
	}))
	defer upstream.Close()
	service, err := New(Config{ChainURL: upstream.URL, APIKey: testAPIKey, UpstreamMode: UpstreamBFT, SignerKey: fmt.Sprintf("%064x", 113), SignerAddress: address})
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"subject":"x","action":"review","assetType":"address","scope":"one","description":"bounded","evidence":["case"]}`)
	if _, err := service.Proxy(context.Background(), http.MethodPost, "/governance/requests", "", body, "mismatch"); err == nil {
		t.Fatal("inconsistent committed Trust response accepted")
	}
}

func TestBFTTrustInjectsSignerForLabelEvidenceAndTracking(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 114))
	address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	service, err := New(Config{ChainURL: "http://127.0.0.1:6420", APIKey: testAPIKey, UpstreamMode: UpstreamBFT, SignerKey: fmt.Sprintf("%064x", 114), SignerAddress: address})
	if err != nil {
		t.Fatal(err)
	}
	action, payload, err := service.bftTrustPayload("/trust/labels", []byte(`{"subject":"subject","label":"risk","source":"case","evidenceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","appealAvailable":false}`))
	label, ok := payload.(consensus.TrustLabelPayload)
	if err != nil || !ok || action != consensus.ActionTrustLabelCreate || label.Issuer != address || !label.AppealAvailable {
		t.Fatalf("label signer injection failed: action=%s payload=%+v err=%v", action, payload, err)
	}
	action, payload, err = service.bftTrustPayload("/trust/evidence", []byte(`{"subject":"subject"}`))
	evidence, ok := payload.(consensus.TrustEvidencePayload)
	if err != nil || !ok || action != consensus.ActionTrustEvidenceCreate || evidence.Requester != address {
		t.Fatalf("evidence signer injection failed: action=%s payload=%+v err=%v", action, payload, err)
	}
	action, payload, err = service.bftTrustPayload("/trust/tracking-reviews", []byte(`{"requester":"spoofed","subject":"subject","purpose":"single transfer","queryType":"trace","evidence":["case"],"minimumNecessary":true}`))
	tracking, ok := payload.(consensus.TrustTrackingPayload)
	if err != nil || !ok || action != consensus.ActionTrustTrackingCreate || tracking.Requester != address {
		t.Fatalf("tracking signer injection failed: action=%s payload=%+v err=%v", action, payload, err)
	}
}

func TestGatewayHealthTrustChainLawFlowAndRedactedAudit(t *testing.T) {
	chainServer := newChainServer(t)
	auditPath := t.TempDir() + "/audit.jsonl"
	service := newTestService(t, chainServer.URL, auditPath, 40)
	server := httptest.NewServer(NewServerWithBuild(service, buildinfo.Info{Commit: "abc123", Release: "ynx-chain-abc123", BuildTime: "2026-07-11T00:00:00Z"}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health Health
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !health.OK || health.Service != "ynx-trustd" || health.ChainID != 6423 || health.NativeSymbol != "YNXT" || health.Build.Commit != "abc123" || health.BodyLimitBytes != MaxBodyBytes || health.ExportLimitBytes != MaxResponseBytes {
		t.Fatalf("unexpected health: %+v", health)
	}

	resp, err = http.Get(server.URL + "/trust/trace/ynx_trust_subject")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("X-Request-ID") == "" {
		t.Fatalf("expected unauthorized with request ID, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	var trace map[string]any
	doTrustJSON(t, http.MethodGet, server.URL+"/trust/trace/ynx_trust_subject", nil, http.StatusOK, &trace)
	if trace["address"] != "ynx_trust_subject" || len(trace["lots"].([]any)) == 0 {
		t.Fatalf("missing lot lineage trace: %v", trace)
	}

	var label map[string]any
	doTrustJSON(t, http.MethodPost, server.URL+"/trust/labels", map[string]any{"subject": "ynx_trust_subject", "label": "reviewed-risk", "labelType": "risk", "riskWeightBps": 125, "confidenceBps": 8100, "source": "trust-gateway-test", "evidenceHash": "sha256:trust-gateway-evidence", "expiryHours": 24, "reviewRequired": true}, http.StatusCreated, &label)
	if label["assetEffect"] != "none_advisory_only" || label["appealAvailable"] != true {
		t.Fatalf("unsafe Trust label: %v", label)
	}
	var faucetTx map[string]any
	doChainJSON(t, http.MethodPost, chainServer.URL+"/faucet", map[string]any{"address": "ynx_transaction_label_subject", "amount": 10}, http.StatusCreated, &faucetTx)
	var transactionLabel map[string]any
	doTrustJSON(t, http.MethodPost, server.URL+"/trust/labels", map[string]any{"subject": faucetTx["hash"], "subjectType": "transaction", "label": "transaction-reviewed-risk", "riskWeightBps": 75, "confidenceBps": 8200, "source": "trust-gateway-test", "evidenceHash": "sha256:transaction-evidence"}, http.StatusCreated, &transactionLabel)
	if transactionLabel["subjectType"] != "transaction" || transactionLabel["subject"] != faucetTx["hash"] || transactionLabel["address"] != "" {
		t.Fatalf("bad transaction risk label: %v", transactionLabel)
	}

	var evidence map[string]any
	doTrustJSON(t, http.MethodPost, server.URL+"/trust/evidence", map[string]any{"subject": "ynx_trust_subject"}, http.StatusCreated, &evidence)
	evidenceID := evidence["id"].(string)
	if evidence["jsonHash"] == "" || evidence["riskSummary"].(map[string]any)["assetEffect"] != "none_advisory_only" {
		t.Fatalf("bad evidence packet: %v", evidence)
	}
	request, _ := http.NewRequest(http.MethodGet, server.URL+"/trust/evidence/"+evidenceID+".pdf", nil)
	request.Header.Set("X-YNX-Trust-Key", testAPIKey)
	resp, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	pdf, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(pdf, []byte("%PDF")) || len(pdf) > MaxResponseBytes {
		t.Fatalf("bad bounded PDF export status=%d size=%d", resp.StatusCode, len(pdf))
	}

	var governance map[string]any
	doTrustJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{"requester": "test-reviewer", "subject": "ynx_trust_subject", "action": "risk label review", "assetType": "stablecoin", "scope": "single transfer", "description": "review scoped evidence", "evidence": []string{"case:test", "tx:0xtest"}}, http.StatusCreated, &governance)
	requestID := governance["id"].(string)
	if governance["classification"] != "REQUIRES_GOVERNANCE_REVIEW" {
		t.Fatalf("bad request validity classification: %v", governance)
	}

	var appeal map[string]any
	doTrustJSON(t, http.MethodPost, server.URL+"/trust/appeals", map[string]any{"requestId": requestID, "subject": "ynx_trust_subject", "appellant": "ynx_trust_subject", "reason": "false positive correction", "evidence": []string{"owner proof"}}, http.StatusCreated, &appeal)
	if appeal["status"] != "SUBMITTED" || appeal["transparencyEntryId"] == "" {
		t.Fatalf("bad appeal: %v", appeal)
	}

	var tracking map[string]any
	doTrustJSON(t, http.MethodPost, server.URL+"/trust/tracking-reviews", map[string]any{"requester": "merchant", "subject": "ynx_trust_subject", "purpose": "single transfer screening", "queryType": "trace", "scope": "single transfer", "description": "minimum necessary review", "evidence": []string{"case:test", "tx:0xtest"}, "minimumNecessary": true, "confidenceBps": 7600, "expiryHours": 24}, http.StatusCreated, &tracking)
	if tracking["classification"] == "OVERBROAD" || tracking["ruleIds"] == nil {
		t.Fatalf("bad tracking review: %v", tracking)
	}

	var transparency map[string]any
	doTrustJSON(t, http.MethodGet, server.URL+"/governance/transparency", nil, http.StatusOK, &transparency)
	if transparency["entryCount"].(float64) < 2 {
		t.Fatalf("missing transparency records: %v", transparency)
	}

	metrics, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metricsBody, _ := io.ReadAll(metrics.Body)
	_ = metrics.Body.Close()
	if !bytes.Contains(metricsBody, []byte("ynx_trust_gateway_requests_total")) || !bytes.Contains(metricsBody, []byte(`native_symbol="YNXT"`)) {
		t.Fatalf("missing metrics: %s", metricsBody)
	}

	audit, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{testAPIKey, testUpstreamKey, "false positive correction", "owner proof", "sha256:trust-gateway-evidence"} {
		if bytes.Contains(audit, []byte(secret)) {
			t.Fatalf("audit contains sensitive value %q: %s", secret, audit)
		}
	}
	if !bytes.Contains(audit, []byte(`"outcome":"unauthorized"`)) || !bytes.Contains(audit, []byte(`"outcome":"accepted"`)) || !bytes.Contains(audit, []byte(`"outcome":"proxied"`)) {
		t.Fatalf("audit outcomes missing: %s", audit)
	}
}

func TestGatewayRateBodyAndExportLimits(t *testing.T) {
	chainServer := newChainServer(t)
	service := newTestService(t, chainServer.URL, t.TempDir()+"/audit.jsonl", 1)
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	for i, expected := range []int{http.StatusOK, http.StatusTooManyRequests} {
		req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/governance/transparency?attempt=%d", server.URL, i), nil)
		req.Header.Set("Authorization", "Bearer "+testAPIKey)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != expected {
			t.Fatalf("request %d expected %d got %d", i, expected, resp.StatusCode)
		}
	}
	service = newTestService(t, chainServer.URL, t.TempDir()+"/audit.jsonl", 5)
	server2 := httptest.NewServer(NewServer(service).Handler())
	defer server2.Close()
	req, _ := http.NewRequest(http.MethodPost, server2.URL+"/trust/evidence", strings.NewReader(`{"subject":"`+strings.Repeat("x", MaxBodyBytes)+`"}`))
	req.Header.Set("X-YNX-Trust-Key", testAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", resp.StatusCode)
	}

	large := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(bytes.Repeat([]byte("x"), MaxResponseBytes+1))
	}))
	defer large.Close()
	largeService, err := New(Config{ChainURL: large.URL, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, AuditLog: t.TempDir() + "/audit.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := largeService.Proxy(context.Background(), http.MethodGet, "/trust/evidence/large.pdf", "", nil, "trust-limit"); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected bounded export error, got %v", err)
	}
}

func newChainServer(t *testing.T) *httptest.Server {
	t.Helper()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet("ynx_trust_subject", 100); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(api.NewServerWithConfig(devnet, api.ServerConfig{TrustGatewayUpstreamKey: testUpstreamKey}))
	for _, target := range []string{"/trust/trace/ynx_trust_subject", "/governance/request-validity-rules"} {
		resp, err := http.Get(server.URL + target)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("configured chain route %s allowed direct bypass: %d", target, resp.StatusCode)
		}
	}
	t.Cleanup(server.Close)
	return server
}
func newTestService(t *testing.T, chainURL, auditPath string, maxRequests int) *Service {
	t.Helper()
	service, err := New(Config{ChainURL: chainURL, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, AuditLog: auditPath, Window: time.Minute, MaxRequests: maxRequests})
	if err != nil {
		t.Fatal(err)
	}
	return service
}
func doTrustJSON(t *testing.T, method, target string, body any, expected int, out any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, target, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Trust-Key", testAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		responseBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected %d got %d: %s", expected, resp.StatusCode, responseBody)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}

func doChainJSON(t *testing.T, method, target string, body any, expected int, out any) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, target, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		responseBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected %d got %d: %s", expected, resp.StatusCode, responseBody)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}
