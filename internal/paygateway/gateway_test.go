package paygateway

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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
	testAPIKey      = "local-pay-api-key"
	testUpstreamKey = "local-pay-upstream-key"
	testWebhookKey  = "local-pay-webhook-signing-key"
	testMerchantID  = "merchant_gateway_test"
)

func TestGatewayRequiresDedicatedSecrets(t *testing.T) {
	base := Config{ChainURL: "http://127.0.0.1:6420"}
	if _, err := New(base); err == nil || !strings.Contains(err.Error(), "YNX_PAY_MERCHANT_ID") {
		t.Fatalf("expected merchant error, got %v", err)
	}
	base.MerchantID = testMerchantID
	if _, err := New(base); err == nil || !strings.Contains(err.Error(), "YNX_PAY_API_KEY") {
		t.Fatalf("expected API key error, got %v", err)
	}
	base.APIKey = testAPIKey
	if _, err := New(base); err == nil || !strings.Contains(err.Error(), "YNX_PAY_GATEWAY_UPSTREAM_KEY") {
		t.Fatalf("expected upstream key error, got %v", err)
	}
	base.UpstreamKey = testUpstreamKey
	if _, err := New(base); err == nil || !strings.Contains(err.Error(), "YNX_PAY_WEBHOOK_SIGNING_KEY") {
		t.Fatalf("expected webhook key error, got %v", err)
	}
	base.WebhookSigningKey = testWebhookKey
	base.ChainURL = "http://ynx-chaind:6420"
	if _, err := New(base); err != nil {
		t.Fatalf("expected private service DNS URL to be accepted, got %v", err)
	}
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 7))
	address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	unsafePath := t.TempDir() + "/unsafe-pay.key"
	if err := os.WriteFile(unsafePath, key.Serialize(), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = os.Chmod(unsafePath, 0o644)
	if _, err := New(Config{ChainURL: "http://127.0.0.1:6420", MerchantID: testMerchantID, APIKey: testAPIKey, WebhookSigningKey: testWebhookKey, UpstreamMode: UpstreamBFT, SignerKeyPath: unsafePath, SignerAddress: address}); err == nil || !strings.Contains(err.Error(), "mode-restricted") {
		t.Fatalf("unsafe BFT Pay signer permissions accepted: %v", err)
	}
}

func TestGatewayHealthAuthPayFlowAndRedactedAudit(t *testing.T) {
	chainServer := newChainServer(t)
	auditPath := t.TempDir() + "/audit.jsonl"
	service := newTestService(t, chainServer.URL, auditPath, 30)
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
	if resp.StatusCode != http.StatusOK || !health.OK || health.Service != "ynx-payd" || health.ChainID != 6423 || health.NativeSymbol != "YNXT" || health.Build.Commit != "abc123" || !health.MerchantConfigured || !health.SigningConfigured {
		t.Fatalf("unexpected health status=%d body=%+v", resp.StatusCode, health)
	}

	resp, err = http.Post(server.URL+"/pay/intents", "application/json", strings.NewReader(`{"amount":50,"idempotencyKey":"unauthorized"}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("X-Request-ID") == "" {
		t.Fatalf("expected unauthorized with request ID, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	var intent map[string]any
	doPayJSON(t, http.MethodPost, server.URL+"/pay/intents", map[string]any{"amount": 50, "callbackUrl": "https://merchant.example/callback", "idempotencyKey": "intent-key-1"}, http.StatusCreated, &intent)
	if intent["merchant"] != testMerchantID || intent["currency"] != "YNXT" || intent["id"] == "" {
		t.Fatalf("unexpected intent: %v", intent)
	}
	intentID := intent["id"].(string)
	var replay map[string]any
	doPayJSON(t, http.MethodPost, server.URL+"/pay/intents", map[string]any{"amount": 50, "callbackUrl": "https://merchant.example/callback", "idempotencyKey": "intent-key-1"}, http.StatusCreated, &replay)
	if replay["id"] != intentID || replay["amount"] != intent["amount"] {
		t.Fatalf("idempotency replay changed intent: %v original %v", replay, intent)
	}

	var invoice map[string]any
	doPayJSON(t, http.MethodPost, server.URL+"/pay/invoices", map[string]any{"intentId": intentID, "dueInHours": 12, "idempotencyKey": "invoice-key-1"}, http.StatusCreated, &invoice)
	if invoice["intentId"] != intentID || invoice["id"] == "" {
		t.Fatalf("unexpected invoice: %v", invoice)
	}

	var webhook map[string]any
	doPayJSON(t, http.MethodPost, server.URL+"/pay/webhook-signatures", map[string]any{"intentId": intentID, "eventType": "payment_intent.created", "idempotencyKey": "webhook-key-1"}, http.StatusCreated, &webhook)
	if webhook["signature"] == "" || webhook["algorithm"] != "hmac-sha256" || webhook["replaySafe"] != true {
		t.Fatalf("unexpected webhook signature: %v", webhook)
	}
	doPayJSON(t, http.MethodPost, server.URL+"/pay/webhook-signatures", map[string]any{"intentId": intentID, "eventType": "payment_intent.created", "idempotencyKey": "webhook-key-2", "signingKey": "client-supplied-secret"}, http.StatusBadRequest, nil)

	var events map[string]any
	doPayJSON(t, http.MethodGet, server.URL+"/pay/events?intentId="+intentID, nil, http.StatusOK, &events)
	if len(events["events"].([]any)) < 3 {
		t.Fatalf("expected persistent Pay events, got %v", events)
	}

	metrics, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metricsBody, _ := io.ReadAll(metrics.Body)
	_ = metrics.Body.Close()
	if !bytes.Contains(metricsBody, []byte("ynx_pay_gateway_requests_total")) || !bytes.Contains(metricsBody, []byte(`native_symbol="YNXT"`)) {
		t.Fatalf("missing metrics: %s", metricsBody)
	}

	audit, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{testAPIKey, testUpstreamKey, testWebhookKey, "client-supplied-secret", "merchant.example/callback"} {
		if bytes.Contains(audit, []byte(secret)) {
			t.Fatalf("audit contains sensitive value %q: %s", secret, audit)
		}
	}
	if !bytes.Contains(audit, []byte(`"outcome":"unauthorized"`)) || !bytes.Contains(audit, []byte(`"outcome":"accepted"`)) || !bytes.Contains(audit, []byte(`"outcome":"proxied"`)) {
		t.Fatalf("audit outcomes missing: %s", audit)
	}
}

func TestGatewayRateLimitAndBodyLimit(t *testing.T) {
	chainServer := newChainServer(t)
	service := newTestService(t, chainServer.URL, t.TempDir()+"/audit.jsonl", 1)
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()

	for i, expected := range []int{http.StatusOK, http.StatusTooManyRequests} {
		req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/pay/events?attempt=%d", server.URL, i), nil)
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
	req, _ := http.NewRequest(http.MethodPost, server2.URL+"/pay/intents", strings.NewReader(`{"idempotencyKey":"large","padding":"`+strings.Repeat("x", MaxBodyBytes)+`"}`))
	req.Header.Set("X-YNX-Pay-Key", testAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", resp.StatusCode)
	}
}

func TestBFTPaySerializesNonceAndReturnsZeroFeeIdempotentReplay(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 101))
	address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	merchant := "merchant_bft_gateway"
	var mu sync.Mutex
	var nonce uint64
	broadcasts := 0
	idem := map[string]consensus.BFTPayIdempotency{}
	objects := map[string]consensus.BFTPayIntent{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/accounts/"+address:
			mu.Lock()
			n := nonce
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: address, Balance: 100, Nonce: n})
		case r.Method == http.MethodGet && r.URL.Path == "/pay/idempotency":
			mu.Lock()
			v, ok := idem[r.URL.Query().Get("key")]
			mu.Unlock()
			if !ok {
				http.Error(w, "missing", http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(v)
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/pay/intents/"):
			mu.Lock()
			v, ok := objects[strings.TrimPrefix(r.URL.Path, "/pay/intents/")]
			mu.Unlock()
			if !ok {
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(v)
		case r.Method == http.MethodPost && r.URL.Path == "/pay/intents":
			raw, _ := io.ReadAll(r.Body)
			var tx consensus.SignedApplicationAction
			if json.Unmarshal(raw, &tx) != nil || tx.Verify(6423) != nil {
				http.Error(w, "bad tx", 400)
				return
			}
			var p consensus.PayIntentPayload
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
			id := consensus.ApplicationActionRecordID("pay-intent", hash)
			record := consensus.BFTPayIntent{ID: id, Signer: address, Merchant: merchant, Amount: p.Amount, Currency: "YNXT", Status: "created", CreatedAt: time.Now().UTC(), IdempotencyKey: p.IdempotencyKey, RequestHash: p.RequestHash, BlockHeight: 1, TxHash: hash, AuditHash: strings.Repeat("a", 64)}
			objects[id] = record
			idem[p.IdempotencyKey] = consensus.BFTPayIdempotency{ID: consensus.PayIdempotencyID(merchant, p.IdempotencyKey), Signer: address, Merchant: merchant, IdempotencyKey: p.IdempotencyKey, Action: consensus.ActionPayIntentCreate, RequestHash: p.RequestHash, ObjectType: "intent", ObjectID: id, TxHash: hash}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(record)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	service, err := New(Config{ChainURL: upstream.URL, MerchantID: merchant, APIKey: testAPIKey, WebhookSigningKey: testWebhookKey, AuditLog: t.TempDir() + "/audit.jsonl", UpstreamMode: UpstreamBFT, SignerKey: fmt.Sprintf("%064x", 101), SignerAddress: address, ChainID: 6423})
	if err != nil {
		t.Fatal(err)
	}
	body, err := service.PrepareBody("/pay/intents", []byte(`{"amount":50,"idempotencyKey":"same-key"}`))
	if err != nil {
		t.Fatal(err)
	}
	const count = 12
	var wg sync.WaitGroup
	errs := make(chan error, count)
	ids := make(chan string, count)
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resp, err := service.Proxy(context.Background(), http.MethodPost, "/pay/intents", "", body, fmt.Sprintf("request-%d", i))
			if err != nil {
				errs <- err
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusCreated {
				errs <- fmt.Errorf("status %d", resp.StatusCode)
				return
			}
			var record consensus.BFTPayIntent
			if json.NewDecoder(resp.Body).Decode(&record) != nil {
				errs <- errors.New("decode replay")
				return
			}
			ids <- record.ID
		}(i)
	}
	wg.Wait()
	close(errs)
	close(ids)
	for err := range errs {
		t.Error(err)
	}
	first := ""
	for id := range ids {
		if first == "" {
			first = id
		} else if id != first {
			t.Fatalf("idempotent replay IDs differ")
		}
	}
	mu.Lock()
	gotNonce, gotBroadcasts := nonce, broadcasts
	mu.Unlock()
	if gotNonce != 1 || gotBroadcasts != 1 {
		t.Fatalf("idempotent replay consumed nonce/fee: nonce=%d broadcasts=%d", gotNonce, gotBroadcasts)
	}
	changed, _ := service.PrepareBody("/pay/intents", []byte(`{"amount":51,"idempotencyKey":"same-key"}`))
	resp, err := service.Proxy(context.Background(), http.MethodPost, "/pay/intents", "", changed, "changed")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("changed-input idempotency expected 409 got %d", resp.StatusCode)
	}
	if nonce != 1 || broadcasts != 1 {
		t.Fatal("changed-input conflict consumed nonce")
	}

	webhookBody, _ := service.PrepareBody("/pay/webhook-signatures", []byte(`{"intentId":"`+first+`","eventType":"payment_intent.created","idempotencyKey":"webhook-key"}`))
	action, payload, _, _, err := service.bftPayPayload("/pay/webhook-signatures", webhookBody)
	if err != nil || action != consensus.ActionPayWebhookRecord {
		t.Fatal(err)
	}
	webhook := payload.(consensus.PayWebhookPayload)
	_, _, material := consensus.PayWebhookMaterial(merchant, first, webhook.EventType, webhook.IdempotencyKey, webhook.SignedAt)
	mac := hmac.New(sha256.New, []byte(testWebhookKey))
	_, _ = mac.Write(material)
	if webhook.Signature != hex.EncodeToString(mac.Sum(nil)) {
		t.Fatal("webhook was not signed process-locally")
	}
	encoded, _ := json.Marshal(webhook)
	if bytes.Contains(encoded, []byte(testWebhookKey)) {
		t.Fatal("webhook key entered chain payload")
	}
}

func TestBFTPayRejectsInconsistentCommittedResponse(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 102))
	address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	merchant := "merchant_bft_mismatch"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/pay/idempotency" {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: address, Balance: 10})
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var tx consensus.SignedApplicationAction
		_ = json.Unmarshal(raw, &tx)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(consensus.BFTPayIntent{ID: strings.Repeat("0", 24), Signer: address, Merchant: merchant, Status: "created", TxHash: "0x" + strings.Repeat("0", 64)})
	}))
	defer upstream.Close()
	service, err := New(Config{ChainURL: upstream.URL, MerchantID: merchant, APIKey: testAPIKey, WebhookSigningKey: testWebhookKey, UpstreamMode: UpstreamBFT, SignerKey: fmt.Sprintf("%064x", 102), SignerAddress: address})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := service.PrepareBody("/pay/intents", []byte(`{"amount":1,"idempotencyKey":"mismatch"}`))
	if _, err := service.Proxy(context.Background(), http.MethodPost, "/pay/intents", "", body, "mismatch"); err == nil {
		t.Fatal("inconsistent committed Pay response accepted")
	}
}

func newChainServer(t *testing.T) *httptest.Server {
	t.Helper()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(api.NewServerWithConfig(devnet, api.ServerConfig{PayGatewayUpstreamKey: testUpstreamKey}))
	direct, err := http.Post(server.URL+"/pay/intents", "application/json", strings.NewReader(`{"merchant":"bypass","amount":1,"idempotencyKey":"bypass"}`))
	if err != nil {
		t.Fatal(err)
	}
	_ = direct.Body.Close()
	if direct.StatusCode != http.StatusUnauthorized {
		t.Fatalf("configured chain Pay route allowed direct bypass: %d", direct.StatusCode)
	}
	t.Cleanup(server.Close)
	return server
}

func newTestService(t *testing.T, chainURL, auditPath string, maxRequests int) *Service {
	t.Helper()
	service, err := New(Config{ChainURL: chainURL, MerchantID: testMerchantID, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, WebhookSigningKey: testWebhookKey, AuditLog: auditPath, Window: time.Minute, MaxRequests: maxRequests})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func doPayJSON(t *testing.T, method, target string, body any, expected int, out any) {
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
	req.Header.Set("X-YNX-Pay-Key", testAPIKey)
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
