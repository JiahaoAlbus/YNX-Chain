package finance

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFinanceCallbackDocumentIsNeverCached(t *testing.T) {
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<html>Finance</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{cfg: ServerConfig{WebDir: webDir}}
	for _, path := range []string{"/wallet-auth/callback?financeOrderCode=secret&state=secret", "/auth/callback?code=secret"} {
		response := httptest.NewRecorder()
		securityHeaders(http.HandlerFunc(server.web)).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Pragma") != "no-cache" || response.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("callback document may be cached or referred: %s status=%d headers=%v", path, response.Code, response.Header())
		}
	}
}

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
	storePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(storePath)
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
	server.brokerOpaqueIssue(recorder, request, Session{Account: account, SessionBinding: "test-finance-session-A"})
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
	stored, _, err := store.BrokerOrderHandoffAuthoritySnapshot(issued.TicketHash)
	issuerDigest := sha256.Sum256([]byte("test-finance-session-A"))
	if err != nil || stored.SessionBindingHash != hex.EncodeToString(issuerDigest[:]) || strings.Contains(string(mustFinanceCanonical(stored)), "test-finance-session-A") {
		t.Fatal("fresh handoff did not bind only a hash of the issuer Product Session")
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
	if _, err := store.ApproveBrokerOrder(account, legacyApproval, clock); err == nil {
		t.Fatal("legacy approval mutated an opaque order without its one-time code")
	}
	if _, err := store.RejectBrokerOrder(account, legacyApproval.RequestID, legacyApproval.CallbackStateHash, clock); err == nil {
		t.Fatal("legacy rejection mutated an opaque order without its one-time code")
	}
	if _, err := store.ConsumeBrokerOrder(account, legacyApproval.RequestID, strings.Repeat("a", 64), clock); err == nil {
		t.Fatal("direct legacy consume accepted an opaque order")
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
	restarted, err := OpenStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	server.service.Store, store = restarted, restarted
	wrongBody, _ := json.Marshal(map[string]string{"code": completed.Code, "state": "changed_state_0123456789abcdefghijkl"})
	recorder = httptest.NewRecorder()
	server.brokerOpaqueExchange(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/exchange", bytes.NewReader(wrongBody)), Session{Account: account, SessionBinding: "test-finance-session-A"})
	if recorder.Code == http.StatusOK || len(store.BrokerWorkspace(account, clock).Outbox) != 0 {
		t.Fatal("wrong callback state exchanged an opaque order")
	}
	exchangeBody, _ := json.Marshal(map[string]string{"code": completed.Code, "state": completed.State})
	recorder = httptest.NewRecorder()
	server.brokerOpaqueExchange(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/exchange", bytes.NewReader(exchangeBody)), Session{Account: "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"})
	if recorder.Code == http.StatusOK {
		t.Fatal("another account exchanged the callback")
	}
	recorder = httptest.NewRecorder()
	server.brokerOpaqueExchange(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/exchange", bytes.NewReader(exchangeBody)), Session{Account: account, SessionBinding: "test-finance-session-B"})
	if recorder.Code == http.StatusOK || len(store.BrokerWorkspace(account, clock).Outbox) != 0 {
		t.Fatal("a new same-account Product Session consumed the issuer-bound fresh callback")
	}
	if _, err := store.ExchangeBrokerOrderHandoff(account, issued.Challenge.RequestID, completed.Code, completed.State, "test-finance-session-B", clock); err == nil {
		t.Fatal("direct store CAS accepted a different same-account Product Session")
	}
	recorder = httptest.NewRecorder()
	server.brokerOpaqueExchange(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/exchange", bytes.NewReader(exchangeBody)), Session{Account: account, SessionBinding: "test-finance-session-A"})
	if recorder.Code != http.StatusOK || len(store.BrokerWorkspace(account, clock).Outbox) != 1 {
		t.Fatalf("approved callback did not atomically create one Sandbox outbox: %d %s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	server.brokerOpaqueExchange(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/exchange", bytes.NewReader(exchangeBody)), Session{Account: account, SessionBinding: "test-finance-session-A"})
	if recorder.Code == http.StatusOK || len(store.BrokerWorkspace(account, clock).Outbox) != 1 {
		t.Fatal("one-time callback code replayed")
	}
}

func TestOpaqueBrokerLegacyRecoveryRequiresSignedPreCutoverChallenge(t *testing.T) {
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
	request := BrokerChallengeRequest{AccountPublicKey: publicKey, FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:legacy-boundary",
		Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"}}
	challenge, err := store.CreateBrokerOrderChallenge(account, request, now)
	if err != nil {
		t.Fatal(err)
	}
	clock := now.Add(time.Minute)
	cutover := now.Add(30 * time.Second)
	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{BrokerOpaqueAuthority: authority, BrokerOpaqueLegacyCutoverAt: cutover}, now: func() time.Time { return clock }, rate: map[string][]time.Time{}}
	proof := signOpaqueBrokerTestProof(t, node, signerPath, "legacy", "", "legacy_nonce_0123456789abcdefghijk", challenge.Unsigned, clock)
	body, _ := json.Marshal(map[string]any{"requestId": challenge.Unsigned.RequestID, "claim": proof})
	mismatchedBody, _ := json.Marshal(map[string]any{"requestId": "request_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "claim": proof})
	mismatched := httptest.NewRecorder()
	server.brokerOpaqueRecoverLegacy(mismatched, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/recover-legacy", bytes.NewReader(mismatchedBody)))
	if mismatched.Code == http.StatusCreated {
		t.Fatal("outer recovery requestId differed from signed claim")
	}
	server.cfg.BrokerOpaqueLegacyCutoverAt = now
	postCutover := httptest.NewRecorder()
	server.brokerOpaqueRecoverLegacy(postCutover, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/recover-legacy", bytes.NewReader(body)))
	if postCutover.Code == http.StatusCreated {
		t.Fatal("post-cutover legacy challenge minted a ticket")
	}
	server.cfg.BrokerOpaqueLegacyCutoverAt = cutover
	recorder := httptest.NewRecorder()
	server.brokerOpaqueRecoverLegacy(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/recover-legacy", bytes.NewReader(body)))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("signed pre-cutover recovery failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var recovered struct {
		Ticket     string `json:"ticket"`
		TicketHash string `json:"ticketHash"`
	}
	if json.Unmarshal(recorder.Body.Bytes(), &recovered) != nil || !brokerHandoffToken.MatchString(recovered.Ticket) {
		t.Fatal("recovery ticket invalid")
	}
	record, _, err := store.BrokerOrderHandoffAuthoritySnapshot(recovered.TicketHash)
	if err != nil || record.CallbackStateBinding != "raw-v1-random32" || record.CallbackState != challenge.Unsigned.CallbackStateHash || record.SessionBindingHash != "" {
		t.Fatalf("legacy random32 state was changed: %v", err)
	}
	clock = clock.Add(time.Second)
	claim := signOpaqueBrokerTestProof(t, node, signerPath, "claim", recovered.Ticket, "legacy_claim_nonce_0123456789abcdef", challenge.Unsigned, clock)
	claimBody, _ := json.Marshal(map[string]any{"ticket": recovered.Ticket, "claim": claim})
	recorder = httptest.NewRecorder()
	server.brokerOpaqueClaim(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/claim", bytes.NewReader(claimBody)))
	if recorder.Code != http.StatusOK {
		t.Fatalf("recovered ticket claim failed: %d %s", recorder.Code, recorder.Body.String())
	}
	clock = clock.Add(time.Second)
	approval := signOpaqueBrokerTestProof(t, node, signerPath, "approved", recovered.Ticket, "", challenge.Unsigned, clock)
	completionBody, _ := json.Marshal(map[string]any{"ticket": recovered.Ticket, "status": "approved", "proof": approval})
	recorder = httptest.NewRecorder()
	server.brokerOpaqueComplete(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/complete", bytes.NewReader(completionBody)))
	if recorder.Code != http.StatusOK {
		t.Fatalf("recovered approval failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var completed struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if json.Unmarshal(recorder.Body.Bytes(), &completed) != nil || completed.State != challenge.Unsigned.CallbackStateHash {
		t.Fatal("raw legacy callback state changed")
	}
	exchangeBody, _ := json.Marshal(map[string]string{"code": completed.Code, "state": completed.State})
	recorder = httptest.NewRecorder()
	server.brokerOpaqueExchange(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/exchange", bytes.NewReader(exchangeBody)), Session{Account: account, SessionBinding: "test-finance-session-legacy-current"})
	if recorder.Code != http.StatusOK || len(store.BrokerWorkspace(account, clock).Outbox) != 1 {
		t.Fatalf("raw legacy callback did not atomically exchange: %d %s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	server.brokerOpaqueRecoverLegacy(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/order-handoff/recover-legacy", bytes.NewReader(body)))
	if recorder.Code == http.StatusCreated {
		t.Fatal("legacy signed recovery replay minted another ticket")
	}
	if len(store.BrokerWorkspace(account, clock).Outbox) != 1 {
		t.Fatal("legacy recovery replay created a second outbox")
	}
}
