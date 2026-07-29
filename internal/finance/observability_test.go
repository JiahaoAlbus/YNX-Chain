package finance

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestObservabilityCorrelatesRequestsAndProtectsMetrics(t *testing.T) {
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "offline", http.StatusServiceUnavailable)
	}))
	defer explorer.Close()

	store, err := OpenStore("")
	if err != nil {
		t.Fatal(err)
	}
	upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.example/disputes")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{
		Store:     store,
		Upstreams: upstreams,
		AI:        fakeAI{},
		Support: SupportLinks{
			HelpURL:    "https://support.example/help",
			PrivacyURL: "https://support.example/privacy",
			DisputeURL: "https://support.example/disputes",
		},
	}
	auth, session := testAuthenticator(t, "central-token-observability")
	var logs bytes.Buffer
	server, err := NewServer(service, auth, ServerConfig{
		AllowedOrigins:   []string{"https://finance.example"},
		CursorSigningKey: testCursorKey,
		OperationsKey:    testOperationsKey,
		LogWriter:        &logs,
	})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	clientRequestID := "finance-client-request-0001"
	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/portfolio?ignored=private", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+session.Token)
	req.Header.Set(requestIDHeader, clientRequestID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get(requestIDHeader) != clientRequestID {
		t.Fatalf("request ID was not propagated: status=%d requestId=%q", resp.StatusCode, resp.Header.Get(requestIDHeader))
	}

	unauthorized, err := http.NewRequest(http.MethodGet, ts.URL+"/api/portfolio", nil)
	if err != nil {
		t.Fatal(err)
	}
	unauthorized.Header.Set(requestIDHeader, "bad")
	unauthorizedResponse, err := http.DefaultClient.Do(unauthorized)
	if err != nil {
		t.Fatal(err)
	}
	defer unauthorizedResponse.Body.Close()
	var errorPayload map[string]string
	if err := json.NewDecoder(unauthorizedResponse.Body).Decode(&errorPayload); err != nil {
		t.Fatal(err)
	}
	generatedRequestID := unauthorizedResponse.Header.Get(requestIDHeader)
	if unauthorizedResponse.StatusCode != http.StatusUnauthorized || !strings.HasPrefix(generatedRequestID, "fin_") {
		t.Fatalf("invalid request ID did not fail over safely: status=%d requestId=%q", unauthorizedResponse.StatusCode, generatedRequestID)
	}
	if errorPayload["requestId"] != generatedRequestID || errorPayload["errorId"] != "YNX-FIN-SESSION-REJECTED" || unauthorizedResponse.Header.Get(errorIDHeader) != errorPayload["errorId"] {
		t.Fatalf("error correlation is incomplete: headers=%v payload=%v", unauthorizedResponse.Header, errorPayload)
	}

	metricsWithoutKey, err := http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metricsWithoutKey.Body.Close()
	if metricsWithoutKey.StatusCode != http.StatusUnauthorized || metricsWithoutKey.Header.Get(errorIDHeader) != "YNX-FIN-OPERATIONS-AUTH-REJECTED" {
		t.Fatalf("metrics endpoint did not fail closed: status=%d errorId=%q", metricsWithoutKey.StatusCode, metricsWithoutKey.Header.Get(errorIDHeader))
	}

	metricsRequest, err := http.NewRequest(http.MethodGet, ts.URL+"/metrics", nil)
	if err != nil {
		t.Fatal(err)
	}
	metricsRequest.Header.Set(operationsKeyHeader, testOperationsKey)
	metricsResponse, err := http.DefaultClient.Do(metricsRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer metricsResponse.Body.Close()
	var snapshot metricsSnapshot
	if err := json.NewDecoder(metricsResponse.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if metricsResponse.StatusCode != http.StatusOK || snapshot.SchemaVersion != metricsPayloadVersion || snapshot.ObservabilityVersion != observabilityVersion {
		t.Fatalf("metrics contract is invalid: status=%d snapshot=%+v", metricsResponse.StatusCode, snapshot)
	}
	route := snapshot.Routes["GET /api/portfolio"]
	if route.Requests != 2 || route.Errors != 1 || snapshot.TotalRequests < 3 {
		t.Fatalf("request metrics are incomplete: route=%+v total=%d", route, snapshot.TotalRequests)
	}
	if snapshot.Sources["explorer"].Unavailable == 0 || snapshot.Sources["exchange"].Unavailable == 0 {
		t.Fatalf("source outcomes were not counted: %+v", snapshot.Sources)
	}
	if snapshot.PrivacyBoundary == "" || snapshot.ProcessInstanceID == "" || snapshot.ProcessScope == "" {
		t.Fatalf("metrics lifecycle or privacy boundary is incomplete: %+v", snapshot)
	}

	logText := logs.String()
	for _, forbidden := range []string{session.Token, testAccount, "ignored=private", "Authorization"} {
		if strings.Contains(logText, forbidden) {
			t.Fatalf("structured logs leaked forbidden value %q: %s", forbidden, logText)
		}
	}
	if !strings.Contains(logText, `"route":"GET /api/portfolio"`) || !strings.Contains(logText, `"errorId":"YNX-FIN-SESSION-REJECTED"`) {
		t.Fatalf("structured access/error logs are incomplete: %s", logText)
	}

	restarted, err := NewServer(service, auth, ServerConfig{
		AllowedOrigins:   []string{"https://finance.example"},
		CursorSigningKey: testCursorKey,
		OperationsKey:    testOperationsKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	restartedSnapshot := restarted.metrics.snapshot(restarted.now())
	if restartedSnapshot.ProcessInstanceID == snapshot.ProcessInstanceID || restartedSnapshot.TotalRequests != 0 {
		t.Fatalf("restart boundary was not explicit: previous=%q restarted=%+v", snapshot.ProcessInstanceID, restartedSnapshot)
	}
}

func TestServerRejectsWeakOperationsKey(t *testing.T) {
	store, _ := OpenStore("")
	upstreams, _ := NewUpstreams("https://explorer.example", "", "", "https://support.example/disputes")
	service := &Service{
		Store:     store,
		Upstreams: upstreams,
		AI:        fakeAI{},
		Support: SupportLinks{
			HelpURL:    "https://support.example/help",
			PrivacyURL: "https://support.example/privacy",
			DisputeURL: "https://support.example/disputes",
		},
	}
	auth, _ := testAuthenticator(t, "central-token-weak-operations-key")
	if _, err := NewServer(service, auth, ServerConfig{CursorSigningKey: testCursorKey, OperationsKey: "too-short"}); err == nil || !strings.Contains(err.Error(), "operations key") {
		t.Fatalf("weak operations key was not rejected: %v", err)
	}
}
