package finance

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDrainRejectsNewBusinessAndAllowsAdmittedRequestToFinish(t *testing.T) {
	now := time.Date(2026, 9, 20, 11, 0, 0, 0, time.UTC)
	server := &Server{now: func() time.Time { return now }}
	const concurrent = 8
	started := make(chan struct{}, concurrent)
	release := make(chan struct{})
	handler := server.drainAdmission(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		started <- struct{}{}
		<-release
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}))
	ts := httptest.NewServer(handler)
	defer ts.Close()

	results := make(chan int, concurrent)
	for index := 0; index < concurrent; index++ {
		go func() {
			response, err := http.Get(ts.URL + "/api/portfolio")
			if err != nil {
				results <- 0
				return
			}
			response.Body.Close()
			results <- response.StatusCode
		}()
	}
	for index := 0; index < concurrent; index++ {
		<-started
	}
	if snapshot := server.DrainSnapshot(); snapshot.Draining || snapshot.ActiveRequests != concurrent {
		t.Fatalf("unexpected pre-drain snapshot: %+v", snapshot)
	}
	startedSnapshot := server.BeginDrain()
	if !startedSnapshot.Draining || startedSnapshot.ActiveRequests != concurrent || startedSnapshot.StartedAt == nil {
		t.Fatalf("drain did not preserve admitted request: %+v", startedSnapshot)
	}
	response, err := http.Get(ts.URL + "/api/broker/status")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable || response.Header.Get("Retry-After") != "5" {
		t.Fatalf("new request was admitted while draining: status=%d headers=%v", response.StatusCode, response.Header)
	}
	if snapshot := server.DrainSnapshot(); snapshot.ActiveRequests != concurrent {
		t.Fatalf("rejected request changed active count: %+v", snapshot)
	}
	close(release)
	for index := 0; index < concurrent; index++ {
		if status := <-results; status != http.StatusOK {
			t.Fatalf("admitted request did not finish: status=%d", status)
		}
	}
	if snapshot := server.DrainSnapshot(); !snapshot.Draining || snapshot.ActiveRequests != 0 {
		t.Fatalf("active request did not drain to zero: %+v", snapshot)
	}
}

func TestDrainReadinessControlMetricsAndStatePersistence(t *testing.T) {
	now := time.Date(2026, 9, 20, 11, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", now); err != nil {
		t.Fatal(err)
	}
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:drain-test", Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyAndConsumeBrokerOrder(account, signFinanceApprovalForTest(t, challenge.Unsigned), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "unused", http.StatusServiceUnavailable) }))
	defer explorer.Close()
	upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.example/disputes")
	if err != nil {
		t.Fatal(err)
	}
	auth, _ := testAuthenticator(t, "drain-test-session")
	server, err := NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}, auth, ServerConfig{CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	ready, err := http.Get(ts.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	if ready.StatusCode != http.StatusOK {
		t.Fatalf("pre-drain ready status=%v", ready.StatusCode)
	}
	ready.Body.Close()
	drainRequest, _ := http.NewRequest(http.MethodPost, ts.URL+"/internal/drain", nil)
	drainRequest.Header.Set(operationsKeyHeader, testOperationsKey)
	drainResponse, err := http.DefaultClient.Do(drainRequest)
	if err != nil {
		t.Fatal(err)
	}
	if drainResponse.StatusCode != http.StatusAccepted {
		t.Fatalf("drain control status=%v", drainResponse.StatusCode)
	}
	drainResponse.Body.Close()

	ready, err = http.Get(ts.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	var readiness map[string]any
	if err := json.NewDecoder(ready.Body).Decode(&readiness); err != nil {
		t.Fatal(err)
	}
	ready.Body.Close()
	if ready.StatusCode != http.StatusServiceUnavailable || readiness["error"] != "service draining" {
		t.Fatalf("draining readiness=%+v status=%d", readiness, ready.StatusCode)
	}
	business, err := http.Get(ts.URL + "/api/broker/status")
	if err != nil {
		t.Fatal(err)
	}
	business.Body.Close()
	if business.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("business route status=%d", business.StatusCode)
	}
	metricsRequest, _ := http.NewRequest(http.MethodGet, ts.URL+"/metrics", nil)
	metricsRequest.Header.Set(operationsKeyHeader, testOperationsKey)
	metricsResponse, err := http.DefaultClient.Do(metricsRequest)
	if err != nil {
		t.Fatal(err)
	}
	var metrics metricsSnapshot
	if err := json.NewDecoder(metricsResponse.Body).Decode(&metrics); err != nil {
		t.Fatal(err)
	}
	metricsResponse.Body.Close()
	if metricsResponse.StatusCode != http.StatusOK || !metrics.Drain.Draining || metrics.Drain.ActiveRequests != 0 {
		t.Fatalf("drain metrics=%+v status=%d", metrics.Drain, metricsResponse.StatusCode)
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	mapping := reopened.Account(account).Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
	workspace := reopened.BrokerWorkspace(account, now.Add(2*time.Minute))
	if mapping.Account != account || mapping.WalletPublicKey == "" || len(workspace.Orders) != 1 || len(workspace.Outbox) != 1 || workspace.Orders[0].ApprovalState != "consumed" || workspace.Outbox[0].Status != "pending_unwired" {
		t.Fatalf("drain changed persisted mapping/order/outbox: mapping=%+v workspace=%+v", mapping, workspace)
	}
}

func TestDrainControlRequiresLoopbackAndOperationsKey(t *testing.T) {
	server := &Server{now: time.Now, cfg: ServerConfig{OperationsKey: testOperationsKey}}
	for name, testCase := range map[string]struct {
		remote string
		key    string
		want   int
	}{
		"remote":       {remote: "203.0.113.5:1234", key: testOperationsKey, want: http.StatusForbidden},
		"missing key":  {remote: "127.0.0.1:1234", want: http.StatusUnauthorized},
		"wrong key":    {remote: "127.0.0.1:1234", key: strings.Repeat("x", 32), want: http.StatusUnauthorized},
		"loopback key": {remote: "127.0.0.1:1234", key: testOperationsKey, want: http.StatusAccepted},
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/internal/drain", nil)
			request.RemoteAddr = testCase.remote
			request.Header.Set(operationsKeyHeader, testCase.key)
			response := httptest.NewRecorder()
			server.beginDrainEndpoint(response, request)
			if response.Code != testCase.want {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
