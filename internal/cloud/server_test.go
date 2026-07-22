package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestServerAuthorizationScopeAndStrictJSON(t *testing.T) {
	now := time.Now().UTC()
	s := testService(t, func(c *Config) { c.Now = func() time.Time { return now } })
	handler := NewServer(s).Handler()
	challengeReq := httptest.NewRequest(http.MethodPost, "/api/v1/session/challenge", strings.NewReader(`{}`))
	challengeRR := httptest.NewRecorder()
	handler.ServeHTTP(challengeRR, challengeReq)
	if challengeRR.Code == http.StatusLocked {
		t.Fatalf("exit mode blocked canonical authentication: %d %s", challengeRR.Code, challengeRR.Body.String())
	}
	envelope := testWalletEnvelope(t, s, "cloud", "n", []string{"files.read"})
	token, _, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/objects", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects", bytes.NewBufferString(`{"kind":"folder","name":"x","unknown":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("scope must fail before parse: %d %s", rr.Code, rr.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/objects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("read: %d %s", rr.Code, rr.Body.String())
	}
	var page ObjectPage
	if err := json.NewDecoder(rr.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if rr.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("missing CSP")
	}
	envelope = testWalletEnvelope(t, s, "cloud", "n2", []string{"files.read", "files.write"})
	token, _, err = s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects", bytes.NewBufferString(`{"kind":"folder","name":"x","unknown":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("strict JSON want 400 got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestServerRangeDownload(t *testing.T) {
	s := testService(t, nil)
	obj, err := s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "range.txt", MIME: "text/plain", Content: []byte("0123456789")})
	if err != nil {
		t.Fatal(err)
	}
	envelope := testWalletEnvelope(t, s, "cloud", "range", []string{"files.read"})
	token, _, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/objects/"+obj.ID+"/content", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Range", "bytes=2-5")
	rr := httptest.NewRecorder()
	NewServer(s).Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusPartialContent || rr.Body.String() != "2345" || rr.Header().Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("range: %d %q %q", rr.Code, rr.Body.String(), rr.Header().Get("Content-Range"))
	}
	usage, err := s.Usage(owner, "cloud")
	if err != nil || usage.Counters.EgressBytes != 4 || usage.Counters.IngressBytes != 10 || usage.Counters.ScanBytes != 10 {
		t.Fatalf("range usage: %#v %v", usage, err)
	}
	if usage.PricingStatus != "not-configured-no-charge" || usage.UserChargeMinor != 0 || usage.ProviderCostMinor != 0 {
		t.Fatalf("unconfigured pricing charged user: %#v", usage)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/usage", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	NewServer(s).Handler().ServeHTTP(rr, req)
	var report UsageReport
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &report) != nil || report.SchemaVersion != 2 || report.Counters.StorageCoverageStarts.IsZero() {
		t.Fatalf("usage endpoint: %d %s", rr.Code, rr.Body.String())
	}
}

func TestUserExitModePreservesExportAndDeletionButBlocksNewWrites(t *testing.T) {
	s := testService(t, func(c *Config) { c.ExitMode = true })
	object, err := s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "leave.txt", MIME: "text/plain", Content: []byte("portable")})
	if err != nil {
		t.Fatal(err)
	}
	envelope := testWalletEnvelope(t, s, "cloud", "exit-mode", []string{"files.read", "files.write", "permissions.manage"})
	token, _, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(s).Handler()
	request := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	if rr := request(http.MethodPost, "/api/v1/objects", `{"kind":"file","name":"blocked.txt","content":"eA=="}`); rr.Code != http.StatusLocked || rr.Header().Get("X-YNX-Service-Mode") != "user-exit" {
		t.Fatalf("exit write: %d %s %#v", rr.Code, rr.Body.String(), rr.Header())
	}
	if rr := request(http.MethodGet, "/api/v1/objects/"+object.ID+"/content", ""); rr.Code != http.StatusOK || rr.Body.String() != "portable" {
		t.Fatalf("exit read: %d %q", rr.Code, rr.Body.String())
	}
	if rr := request(http.MethodGet, "/api/v1/export", ""); rr.Code != http.StatusOK || rr.Header().Get("X-Content-SHA256") == "" {
		t.Fatalf("exit export: %d %s", rr.Code, rr.Body.String())
	}
	if rr := request(http.MethodPost, "/api/v1/objects/"+object.ID+"/trash", ""); rr.Code != http.StatusOK {
		t.Fatalf("exit trash: %d %s", rr.Code, rr.Body.String())
	}
	if rr := request(http.MethodDelete, "/api/v1/objects/"+object.ID, `{"confirm":"DELETE"}`); rr.Code != http.StatusNoContent {
		t.Fatalf("exit delete: %d %s", rr.Code, rr.Body.String())
	}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"mode":"user-exit"`) {
		t.Fatalf("exit health: %d %s", rr.Code, rr.Body.String())
	}
	if rr := request(http.MethodDelete, "/api/v1/session", ""); rr.Code != http.StatusNoContent {
		t.Fatalf("exit logout: %d %s", rr.Code, rr.Body.String())
	}
}

func TestServerProductDataErasureRequiresDedicatedScopeAndExactConfirmation(t *testing.T) {
	s := testService(t, nil)
	object, err := s.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "erase.txt", Content: []byte("erase")})
	if err != nil {
		t.Fatal(err)
	}
	readEnvelope := testWalletEnvelope(t, s, "cloud", "erase-read", []string{"files.read"})
	readToken, _, err := s.CreateSession(context.Background(), readEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(s).Handler()
	request := func(token, confirm string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/account-data", strings.NewReader(fmt.Sprintf(`{"confirm":%q}`, confirm)))
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	if rr := request(readToken, "DELETE CLOUD DATA"); rr.Code != http.StatusForbidden {
		t.Fatalf("erasure without dedicated scope: %d %s", rr.Code, rr.Body.String())
	}
	eraseEnvelope := testWalletEnvelope(t, s, "cloud", "erase-dedicated", []string{"data.delete"})
	eraseToken, _, err := s.CreateSession(context.Background(), eraseEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	if rr := request(eraseToken, "DELETE DATA"); rr.Code != http.StatusBadRequest {
		t.Fatalf("inexact confirmation: %d %s", rr.Code, rr.Body.String())
	}
	if _, err := s.Get(owner, object.ID); err != nil {
		t.Fatalf("inexact confirmation mutated data: %v", err)
	}
	rr := request(eraseToken, "DELETE CLOUD DATA")
	if rr.Code != http.StatusOK {
		t.Fatalf("erasure: %d %s", rr.Code, rr.Body.String())
	}
	var receipt DataErasureReceipt
	if err = json.Unmarshal(rr.Body.Bytes(), &receipt); err != nil || receipt.Product != "cloud" || receipt.PendingBlobs != 0 || receipt.OwnerHash == owner {
		t.Fatalf("receipt: %#v %v", receipt, err)
	}
	if _, err := s.Authenticate(eraseToken); !errors.Is(err, ErrDenied) {
		t.Fatalf("erasure session remained valid: %v", err)
	}
	stateAfterErase, _ := json.Marshal(s.state)
	if bytes.Contains(stateAfterErase, []byte(owner)) {
		t.Fatalf("completed erasure retained raw owner before fresh sign-in: %s", stateAfterErase)
	}
	lookupEnvelope := testWalletEnvelope(t, s, "cloud", "erase-lookup", []string{"data.delete"})
	lookupToken, _, err := s.CreateSession(context.Background(), lookupEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/account-data/erasures", nil)
	req.Header.Set("Authorization", "Bearer "+lookupToken)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), receipt.ID) || strings.Contains(rr.Body.String(), owner) {
		t.Fatalf("hashed receipt lookup: %d %s", rr.Code, rr.Body.String())
	}
}

func TestPublicAndRestrictedHealthObservability(t *testing.T) {
	s := testService(t, nil)
	server := NewServer(s)
	handler := server.Handler()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 200 || rr.Header().Get("X-Request-ID") == "" || rr.Header().Get("X-Trace-ID") == "" {
		t.Fatalf("public health: %d %#v", rr.Code, rr.Header())
	}
	var public map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	if _, ok := public["objects"]; ok {
		t.Fatal("public health leaked object count")
	}
	if _, ok := public["durability"]; ok {
		t.Fatal("public health leaked provider boundary")
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 401 || rr.Header().Get("X-Error-ID") == "" || rr.Header().Get("X-Request-ID") == "" {
		t.Fatalf("error IDs: %d %#v", rr.Code, rr.Header())
	}
	envelope := testWalletEnvelope(t, s, "cloud", "metrics", []string{"audit.read"})
	token, _, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/health", "/api/v1/ready", "/api/v1/traces", "/api/v1/metrics"} {
		req = httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rr = httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatalf("%s: %d %s", path, rr.Code, rr.Body.String())
		}
	}
	var metrics map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&metrics); err != nil {
		t.Fatal(err)
	}
	if metrics["source"] != "ynx-cloudd persistent RED telemetry" || metrics["coverage"] == nil {
		t.Fatalf("metrics provenance: %#v", metrics)
	}
	routes, ok := metrics["routes"].(map[string]any)
	if !ok || routes["GET /health"] == nil {
		t.Fatalf("normalized persistent routes: %#v", metrics["routes"])
	}
	restarted := NewServer(s)
	if restarted.telemetry.Routes["GET /health"].Requests == 0 || len(restarted.telemetry.RecentTraces) == 0 {
		t.Fatalf("telemetry did not survive server restart: %#v", restarted.telemetry)
	}
}

func TestReadinessFailsClosedOnCorruptTelemetry(t *testing.T) {
	s := testService(t, nil)
	envelope := testWalletEnvelope(t, s, "cloud", "corrupt-telemetry", []string{"audit.read"})
	token, _, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(s.cfg.TelemetryPath, []byte(`{"schemaVersion":1,"integrityHash":"tampered"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(s).Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ready", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable || !strings.Contains(rr.Body.String(), `"telemetryPersistence":false`) {
		t.Fatalf("corrupt telemetry readiness: %d %s", rr.Code, rr.Body.String())
	}
	body, err := os.ReadFile(s.cfg.TelemetryPath)
	if err != nil || !strings.Contains(string(body), "tampered") {
		t.Fatalf("corrupt telemetry was silently overwritten: %q %v", body, err)
	}
}

func TestDirectUploadCSPIsExactAndOptional(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	for _, tc := range []struct{ origin, want string }{{"", "connect-src 'self';"}, {"https://uploads.ynx.network", "connect-src 'self' https://uploads.ynx.network;"}, {"https://uploads.ynx.network/path", "connect-src 'self';"}} {
		rr := httptest.NewRecorder()
		SecureHandlerWithDirectUploadOrigin(next, tc.origin).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/cloud/", nil))
		if got := rr.Header().Get("Content-Security-Policy"); !strings.Contains(got, tc.want) {
			t.Fatalf("origin %q CSP %q want %q", tc.origin, got, tc.want)
		}
	}
}

func TestRateLimitIgnoresForwardedIdentityAndResets(t *testing.T) {
	now := time.Now().UTC()
	s := testService(t, func(c *Config) { c.Now = func() time.Time { return now } })
	handler := NewServerWithLimits(s, ServerLimits{MaxConcurrent: 2, RequestsPerMinute: 2}).Handler()
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		req.RemoteAddr = "192.0.2.10:4321"
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		want := 200
		if i == 2 {
			want = 429
		}
		if rr.Code != want {
			t.Fatalf("request %d got %d want %d", i, rr.Code, want)
		}
		if i == 2 && (rr.Header().Get("Retry-After") == "" || rr.Header().Get("X-Error-ID") == "") {
			t.Fatalf("rate limit headers: %#v", rr.Header())
		}
	}
	now = now.Add(time.Minute)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.RemoteAddr = "192.0.2.10:9999"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("window did not reset: %d", rr.Code)
	}
}

func TestBackpressureRejectsWithoutQueueing(t *testing.T) {
	s := testService(t, nil)
	server := NewServerWithLimits(s, ServerLimits{MaxConcurrent: 1, RequestsPerMinute: 100})
	entered := make(chan struct{})
	release := make(chan struct{})
	handler := server.observe(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-release; w.WriteHeader(204) }))
	done := make(chan struct{})
	go func() {
		req := httptest.NewRequest(http.MethodGet, "/slow", nil)
		req.RemoteAddr = "192.0.2.1:1"
		handler.ServeHTTP(httptest.NewRecorder(), req)
		close(done)
	}()
	<-entered
	req := httptest.NewRequest(http.MethodGet, "/slow", nil)
	req.RemoteAddr = "192.0.2.2:2"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 503 || rr.Header().Get("Retry-After") != "1" || rr.Header().Get("X-Error-ID") == "" {
		t.Fatalf("backpressure: %d %#v", rr.Code, rr.Header())
	}
	close(release)
	<-done
	server.mu.Lock()
	rejected := server.rejections["backpressure"]
	server.mu.Unlock()
	if rejected != 1 {
		t.Fatalf("backpressure metric %d", rejected)
	}
}

func TestCloudAndDocsObjectBoundariesFailClosed(t *testing.T) {
	s := testService(t, nil)
	ctx := context.Background()
	cloudObject, err := s.Create(ctx, owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "cloud.bin", Content: []byte("cloud")})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := s.Create(ctx, owner, CreateObjectRequest{Product: "docs", Kind: KindDoc, Name: "doc.txt", Content: []byte("docs")})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(s).Handler()
	cloudEnvelope := testWalletEnvelope(t, s, "cloud", "product-cloud", []string{"files.read", "files.write"})
	cloudToken, _, err := s.CreateSession(ctx, cloudEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	docsEnvelope := testWalletEnvelope(t, s, "docs", "product-docs", []string{"documents.read", "documents.write"})
	docsToken, _, err := s.CreateSession(ctx, docsEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ token, id string }{{cloudToken, doc.ID}, {docsToken, cloudObject.ID}} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/objects/"+tc.id, nil)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 403 {
			t.Fatalf("cross-product object %s returned %d %s", tc.id, rr.Code, rr.Body.String())
		}
	}
	for _, tc := range []struct{ token, want string }{{cloudToken, cloudObject.ID}, {docsToken, doc.ID}} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/objects?limit=10", nil)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatalf("list: %d %s", rr.Code, rr.Body.String())
		}
		var page ObjectPage
		if json.NewDecoder(rr.Body).Decode(&page) != nil || len(page.Items) != 1 || page.Items[0].ID != tc.want {
			t.Fatalf("product list: %#v", page)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/objects", bytes.NewBufferString(`{"kind":"doc","name":"forbidden","content":""}`))
	req.Header.Set("Authorization", "Bearer "+cloudToken)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("cloud created Docs object: %d %s", rr.Code, rr.Body.String())
	}
}
