package finance

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func signOpaqueBrokerTestProof(t *testing.T, node, script, action, ticket, nonce string, challenge FinanceOrderApprovalUnsignedV1, at time.Time) json.RawMessage {
	t.Helper()
	input, _ := json.Marshal(map[string]any{"action": action, "ticket": ticket, "nonce": nonce, "challenge": challenge, "at": evmReadTime(at)})
	command := exec.Command(node, script)
	command.Stdin = bytes.NewReader(input)
	output, err := command.Output()
	if err != nil || !json.Valid(output) {
		t.Fatalf("public test-key Wallet proof failed: %v", err)
	}
	return json.RawMessage(output)
}

func TestOpaqueBrokerHTTPClaimCompleteAndLegacyBoundary(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node runtime unavailable")
	}
	authorityPath, _ := filepath.Abs(filepath.Join("..", "..", "apps", "finance", "scripts", "finance-order-opaque-authority.bundle.mjs"))
	signerPath, _ := filepath.Abs(filepath.Join("..", "..", "apps", "finance", "tests", "fixtures", "finance-order-opaque-sign.mjs"))
	authority, err := NewNodeEVMReadAuthority(node, authorityPath, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	const account = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	const publicKey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", publicKey, now); err != nil {
		t.Fatal(err)
	}
	clock := now
	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{BrokerMaxFeeUSD: "1.25", BrokerFeeBoundSource: "operator_policy", BrokerFeeEvidenceRef: "operator-policy:opaque-v2", BrokerOpaqueAuthority: authority}, now: func() time.Time { return clock }, rate: map[string][]time.Time{}}
	draft := brokerChallengeInput{Draft: BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "125.34"}}
	body, _ := json.Marshal(draft)
	request := httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/issue", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.brokerOpaqueIssue(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("opaque issue status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var issued struct {
		Version    string                         `json:"version"`
		Ticket     string                         `json:"ticket"`
		TicketHash string                         `json:"ticketHash"`
		Challenge  FinanceOrderApprovalUnsignedV1 `json:"challenge"`
	}
	if json.Unmarshal(recorder.Body.Bytes(), &issued) != nil || issued.Version != "2" || !brokerHandoffToken.MatchString(issued.Ticket) || !brokerHandoffHex.MatchString(issued.TicketHash) || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("opaque issue response invalid: %s", recorder.Body.String())
	}
	if strings.Contains(issued.Ticket, issued.Challenge.Order.Symbol) || len(store.BrokerWorkspace(account, now).Outbox) != 0 {
		t.Fatal("opaque ticket disclosed the order or issued a provider outbox")
	}
	clock = now.Add(time.Second)
	claimProof := signOpaqueBrokerTestProof(t, node, signerPath, "claim", issued.Ticket, "claim_nonce_0123456789abcdefghijkl", issued.Challenge, clock)
	body, _ = json.Marshal(map[string]any{"ticket": issued.Ticket, "claim": claimProof})
	request = httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/claim", bytes.NewReader(body))
	recorder = httptest.NewRecorder()
	server.brokerOpaqueClaim(recorder, request)
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(issued.Challenge.RequestID)) {
		t.Fatalf("signed claim status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	server.brokerOpaqueClaim(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/claim", bytes.NewReader(body)))
	if recorder.Code == http.StatusOK {
		t.Fatal("replayed claim nonce returned the confidential order")
	}
	clock = now.Add(2 * time.Second)
	approval := signOpaqueBrokerTestProof(t, node, signerPath, "approved", issued.Ticket, "", issued.Challenge, clock)
	var legacyApproval FinanceOrderApprovalV1
	if err := json.Unmarshal(approval, &legacyApproval); err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyAndConsumeBrokerOrder(account, legacyApproval, clock); err == nil {
		t.Fatal("legacy store callback consumed an opaque order without its one-time code")
	}
	legacyCallback := mustFinanceCanonical(map[string]any{"approval": legacyApproval,
		"callbackStateHash": legacyApproval.CallbackStateHash, "kind": "finance_order_approval_result",
		"requestId": legacyApproval.RequestID, "status": "approved", "version": "1"})
	recorder = httptest.NewRecorder()
	server.brokerCallback(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/callback", bytes.NewReader(legacyCallback)), Session{Account: account})
	if recorder.Code != http.StatusConflict || !bytes.Contains(recorder.Body.Bytes(), []byte("opaque_callback_requires_exchange")) {
		t.Fatalf("legacy route failed to fence opaque approval: %d %s", recorder.Code, recorder.Body.String())
	}
	body, _ = json.Marshal(map[string]any{"ticket": issued.Ticket, "status": "approved", "proof": approval})
	recorder = httptest.NewRecorder()
	server.brokerOpaqueComplete(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/complete", bytes.NewReader(body)))
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("signed completion status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var completed struct {
		Code   string `json:"code"`
		State  string `json:"state"`
		Status string `json:"status"`
	}
	if json.Unmarshal(recorder.Body.Bytes(), &completed) != nil || completed.Status != "stored" || !brokerHandoffToken.MatchString(completed.Code) {
		t.Fatalf("opaque completion invalid: %s", recorder.Body.String())
	}
	digest := sha256.Sum256([]byte(completed.State))
	if hex.EncodeToString(digest[:]) != issued.Challenge.CallbackStateHash || len(store.BrokerWorkspace(account, clock).Outbox) != 0 {
		t.Fatal("callback state did not match fresh SHA256 binding or completion submitted to Broker")
	}
	recorder = httptest.NewRecorder()
	server.brokerOpaqueRecoverLegacy(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/recover-legacy", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatal("unreviewed legacy recovery became reachable")
	}
	recorder = httptest.NewRecorder()
	server.brokerOpaqueExchange(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/exchange", nil), Session{Account: account})
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatal("uncommitted code exchange became reachable")
	}
}
