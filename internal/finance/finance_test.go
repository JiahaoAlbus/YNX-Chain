package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const testAccount = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
const testCursorKey = "finance-test-cursor-signing-key-000000000001"
const testOperationsKey = "finance-test-operations-key-000000000001"

type fakeAI struct{ result map[string]any }

func (f fakeAI) Status(context.Context) (string, string, bool, error) {
	return "test-provider", "test-model", true, nil
}

type capturingAI struct {
	request AIRequest
	result  map[string]any
}

func (f *capturingAI) Status(context.Context) (string, string, bool, error) {
	return "loopback-gateway", "fixture-model", true, nil
}
func (f *capturingAI) Estimate(context.Context, AIRequest) (string, error) { return "unverified", nil }
func (f *capturingAI) Stream(_ context.Context, request AIRequest, emit func(string)) (map[string]any, error) {
	f.request = request
	emit("structured draft")
	return f.result, nil
}
func (f fakeAI) Estimate(context.Context, AIRequest) (string, error) { return "2 AI credits", nil }
func (f fakeAI) Stream(_ context.Context, _ AIRequest, emit func(string)) (map[string]any, error) {
	emit("Draft ready")
	return f.result, nil
}

func TestCentralSessionFailsClosedOnProductTamper(t *testing.T) {
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{"active": true, "session": testCentralSession(map[string]any{"bundleId": "evil.bundle"})}})
	}))
	defer central.Close()
	auth, err := NewAuthenticator(central.URL, strings.Repeat("i", 32), "ynx-finance-v1", "com.ynxweb4.finance")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := auth.Verify("central-product-proof", "finance.portfolio.read"); err == nil || !strings.Contains(err.Error(), "binding") {
		t.Fatalf("expected product binding rejection, got %v", err)
	}
}

func TestWebWalletGatewayProxyAllowsOnlyBoundedCompletionAndRevocation(t *testing.T) {
	var paths []string
	var revokeProof string
	gateway := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.Path == "/v1/wallet/sessions/revoke" {
			revokeProof = r.Header.Get("X-YNX-Product-Session-Proof")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"result":{"accepted":true}}`))
	}))
	defer gateway.Close()
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
	}))
	defer explorer.Close()
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.example/disputes")
	if err != nil {
		t.Fatal(err)
	}
	auth, _ := testAuthenticator(t, "gateway-proxy-auth-proof")
	service := &Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}
	server, err := NewServer(service, auth, ServerConfig{CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, WalletGatewayURL: gateway.URL, WalletGatewayClient: gateway.Client()})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	completion, _ := http.NewRequest(http.MethodPost, ts.URL+"/wallet-gateway/v1/wallet/sessions/complete", strings.NewReader(`{"request":"bounded"}`))
	completion.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(completion)
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("completion proxy: status=%v err=%v", response.StatusCode, err)
	}
	response.Body.Close()
	revoke, _ := http.NewRequest(http.MethodPost, ts.URL+"/wallet-gateway/v1/wallet/sessions/revoke", strings.NewReader(`{}`))
	revoke.Header.Set("Content-Type", "application/json")
	revoke.Header.Set("X-YNX-Product-Session-Proof", "path-bound-revocation-proof")
	response, err = http.DefaultClient.Do(revoke)
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("revocation proxy: status=%v err=%v", response.StatusCode, err)
	}
	response.Body.Close()
	if strings.Join(paths, ",") != "/v1/wallet/sessions/complete,/v1/wallet/sessions/revoke" || revokeProof != "path-bound-revocation-proof" {
		t.Fatalf("unexpected gateway forwarding: paths=%v proof=%q", paths, revokeProof)
	}
	missing, _ := http.Post(ts.URL+"/wallet-gateway/v1/wallet/sessions/revoke", "application/json", strings.NewReader(`{}`))
	if missing.StatusCode != http.StatusUnauthorized {
		t.Fatalf("proofless revocation returned %d", missing.StatusCode)
	}
	missing.Body.Close()
}

func TestOverviewPersistenceExportAndAIReview(t *testing.T) {
	txTime := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/health":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "rpcHeight": 120, "indexedHeight": 118, "syncLagBlocks": 2, "nativeSymbol": "YNXT", "truthfulStatus": "indexed-with-reported-lag", "lastCheckedAt": txTime, "build": map[string]any{"commit": "finance-explorer-fixture", "release": "ynx-explorer-test-v1"}})
		case strings.HasPrefix(r.URL.Path, "/api/accounts/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"account": map[string]any{"address": testAccount, "balance": 420, "staked": 20, "nonce": 2, "resourceUsage": map[string]any{}, "lots": map[string]any{}}})
		case r.URL.Path == "/api/txs":
			_ = json.NewEncoder(w).Encode(map[string]any{"transactions": []map[string]any{{"hash": "tx-owned", "type": "transfer", "from": testAccount, "to": "ynx1recipient", "amount": 40, "fee": 1, "blockNumber": 9, "timestamp": txTime}, {"hash": "tx-owned-2", "type": "transfer", "from": "ynx1sender", "to": testAccount, "amount": 15, "fee": 0, "blockNumber": 8, "timestamp": txTime.Add(-time.Hour)}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer explorer.Close()
	pay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-YNX-Pay-Key") != "pay-secret" {
			http.Error(w, "unauthorized", 401)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"events": []map[string]any{{"id": "receipt-owned", "status": "settled", "payer": testAccount, "merchant": "ynx1merchant", "amountYnxt": 12, "transactionHash": "tx-owned", "createdAt": time.Now().UTC().Format(time.RFC3339)}, {"id": "receipt-other", "payer": "ynx1other", "amountYnxt": 99}}})
	}))
	defer pay.Close()
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	upstreams, _ := NewUpstreams(explorer.URL, pay.URL, "pay-secret", "https://support.example/disputes")
	service := &Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}
	auth, session := testAuthenticator(t, "central-token-main")
	if _, err := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{"https://finance.example"}, CursorSigningKey: "too-short", OperationsKey: testOperationsKey}); err == nil || !strings.Contains(err.Error(), "cursor signing key") {
		t.Fatalf("short cursor key was not rejected: %v", err)
	}
	server, err := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{"https://finance.example"}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, WebDir: filepath.Join("..", "..", "apps", "finance", "web"), Build: buildinfo.Info{Commit: strings.Repeat("a", 40), Release: "ynx-finance-test", BuildTime: "2026-08-11T09:00:00.000Z"}})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()
	for _, path := range []string{"/health", "/version"} {
		response, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "ynx-finance-test") || !strings.Contains(string(body), strings.Repeat("a", 40)) {
			t.Fatalf("Finance release identity missing from %s: %d %s", path, response.StatusCode, body)
		}
	}

	assetResponse, err := http.Get(ts.URL + "/read-sources.js")
	if err != nil {
		t.Fatal(err)
	}
	assetRaw, readErr := io.ReadAll(assetResponse.Body)
	assetResponse.Body.Close()
	if readErr != nil || assetResponse.StatusCode != http.StatusOK || !strings.Contains(string(assetRaw), "owner-contract-pending") {
		t.Fatalf("Web read-source renderer is unavailable: status=%d readErr=%v", assetResponse.StatusCode, readErr)
	}

	identityRoot := t.TempDir()
	identityBody := `{"sourceCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","release":"ynx-finance-test","buildTime":"2026-08-11T09:00:00.000Z","frontendSourceCommit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`
	if err := os.WriteFile(filepath.Join(identityRoot, "build-identity.json"), []byte(identityBody), 0o644); err != nil {
		t.Fatal(err)
	}
	identityServer, err := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{"https://finance.example"}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, WebDir: identityRoot, Build: buildinfo.Info{Commit: strings.Repeat("a", 40), Release: "ynx-finance-test", BuildTime: "2026-08-11T09:00:00.000Z"}})
	if err != nil {
		t.Fatal(err)
	}
	identityHTTP := httptest.NewServer(identityServer.Handler())
	defer identityHTTP.Close()
	identityResponse, err := http.Get(identityHTTP.URL + "/build-identity.json")
	if err != nil {
		t.Fatal(err)
	}
	identityRaw, identityReadErr := io.ReadAll(identityResponse.Body)
	identityResponse.Body.Close()
	if identityReadErr != nil || identityResponse.StatusCode != http.StatusOK || string(identityRaw) != identityBody {
		t.Fatalf("source-bound build identity is not served byte-exact: status=%d readErr=%v body=%q", identityResponse.StatusCode, identityReadErr, identityRaw)
	}

	var overview map[string]any
	requestJSON(t, ts.URL+"/api/overview", http.MethodGet, nil, session.Token, "", 200, &overview)
	p := overview["portfolio"].(map[string]any)
	if p["balanceYnxt"].(float64) != 420 || len(p["activity"].([]any)) != 2 || len(p["payReceipts"].([]any)) != 1 || p["readOnly"] != true {
		t.Fatalf("unexpected real-data overview: %#v", p)
	}
	explorerStatus := p["explorerStatus"].(map[string]any)
	if explorerStatus["version"] != "ynx-explorer-test-v1" || explorerStatus["syncStatus"] != "indexed-with-reported-lag" || explorerStatus["syncLagBlocks"].(float64) != 2 || explorerStatus["asOf"] == "" {
		t.Fatalf("Explorer provenance and sync evidence are incomplete: %#v", explorerStatus)
	}
	payStatus := p["payStatus"].(map[string]any)
	if payStatus["version"] != "finance-pay-events-v1" || payStatus["syncStatus"] != "authorized-response" || payStatus["asOf"] == "" {
		t.Fatalf("Pay provenance and sync evidence are incomplete: %#v", payStatus)
	}
	readSources := p["readSources"].(map[string]any)
	if len(readSources) != 4 {
		t.Fatalf("cross-product source registry is incomplete: %#v", readSources)
	}
	for _, id := range []string{"exchange", "dex", "quant", "economics"} {
		source := readSources[id].(map[string]any)
		status := source["status"].(map[string]any)
		action := source["action"].(map[string]any)
		wantAccepted := id == "exchange" || id == "dex" || id == "quant"
		wantStatus := "owner-contract-pending"
		if wantAccepted {
			wantStatus = "integration-unconfigured"
		}
		if source["ownerContractAccepted"] != wantAccepted || source["readOnly"] != true || status["available"] != false || status["syncStatus"] != wantStatus || action["configured"] != false {
			t.Fatalf("source %s did not remain fail-closed: %#v", id, source)
		}
	}
	var sourceRegistry map[string]any
	requestJSON(t, ts.URL+"/api/sources", http.MethodGet, nil, session.Token, "", 200, &sourceRegistry)
	if sourceRegistry["consumerEnvelopeVersion"] != ReadSourceEnvelopeVersion || sourceRegistry["readOnly"] != true || sourceRegistry["integrationState"] != "accepted=exchange,dex,quant;live=none;pending=economics" {
		t.Fatalf("source registry endpoint is not truthful: %#v", sourceRegistry)
	}
	var category Category
	requestJSON(t, ts.URL+"/api/categories", http.MethodPost, map[string]any{"name": "Essentials", "color": "#002FA7", "idempotencyKey": "category-test-key-0001"}, session.Token, "https://finance.example", 201, &category)
	var replay Category
	requestJSON(t, ts.URL+"/api/categories", http.MethodPost, map[string]any{"name": "Essentials", "color": "#002FA7", "idempotencyKey": "category-test-key-0001"}, session.Token, "https://finance.example", 201, &replay)
	if replay.ID != category.ID {
		t.Fatal("idempotent category replay created a new object")
	}
	requestJSON(t, ts.URL+"/api/budgets", http.MethodPost, map[string]any{"name": "Monthly essentials", "categoryId": category.ID, "limitYnxt": 100, "period": "monthly", "startsAt": time.Now().UTC(), "idempotencyKey": "budget-test-key-000001"}, session.Token, "https://finance.example", 201, &map[string]any{})
	requestJSON(t, ts.URL+"/api/activity/tx-owned/category", http.MethodPut, map[string]any{"categoryId": category.ID, "idempotencyKey": "classification-key-0001"}, session.Token, "https://finance.example", 200, &map[string]any{})
	var note Note
	requestJSON(t, ts.URL+"/api/notes", http.MethodPost, map[string]any{"recordId": "tx-owned", "body": "Reviewed settlement evidence", "idempotencyKey": "note-test-key-0000001"}, session.Token, "https://finance.example", 201, &note)
	if note.RecordID != "tx-owned" || note.Source != "user" {
		t.Fatalf("note provenance is incomplete: %+v", note)
	}
	var page map[string]any
	requestJSON(t, ts.URL+"/api/activity?limit=1", http.MethodGet, nil, session.Token, "", 200, &page)
	cursor, _ := page["nextCursor"].(string)
	if page["completeHistory"] != false || page["coverage"] == "" || len(page["items"].([]any)) != 1 || cursor == "" {
		t.Fatalf("activity page lacks truthful signed-cursor coverage: %#v", page)
	}
	var nextPage map[string]any
	requestJSON(t, ts.URL+"/api/activity?limit=1&cursor="+cursor, http.MethodGet, nil, session.Token, "", 200, &nextPage)
	if len(nextPage["items"].([]any)) != 1 || nextPage["nextCursor"] != "" {
		t.Fatalf("signed cursor did not return the next bounded page: %#v", nextPage)
	}
	tamperedSuffix := "A"
	if strings.HasSuffix(cursor, tamperedSuffix) {
		tamperedSuffix = "B"
	}
	tampered := cursor[:len(cursor)-1] + tamperedSuffix
	requestJSON(t, ts.URL+"/api/activity?limit=1&cursor="+tampered, http.MethodGet, nil, session.Token, "", 400, &map[string]any{})
	var monthly map[string]any
	requestJSON(t, ts.URL+"/api/monthly-review", http.MethodGet, nil, session.Token, "", 200, &monthly)
	if monthly["symbol"] != "YNXT" || monthly["legal"] == "" {
		t.Fatalf("monthly review lacks amount/legal semantics: %#v", monthly)
	}
	if monthly["coverageComplete"] != false || monthly["calculationStatus"] != "partial" || monthly["totals"].(map[string]any)["outgoingYnxt"] != nil || monthly["observedTotals"] == nil {
		t.Fatalf("monthly HTTP response promoted bounded data to complete totals: %#v", monthly)
	}
	var statement map[string]any
	requestJSON(t, ts.URL+"/api/statements?from=2026-07-01T00:00:00Z&to=2026-08-01T00:00:00Z", http.MethodGet, nil, session.Token, "", 200, &statement)
	observed, ok := statement["observedTotals"].(map[string]any)
	if !ok || statement["schemaVersion"] != "finance-statement-v2" || statement["coverageComplete"] != false || statement["calculationStatus"] != "partial" || statement["totals"].(map[string]any)["incomingYnxt"] != nil || statement["totals"].(map[string]any)["outgoingYnxt"] != nil || statement["totals"].(map[string]any)["feesYnxt"] != nil || observed["incomingYnxt"] != float64(15) || observed["outgoingYnxt"] != float64(40) || observed["feesYnxt"] != float64(1) {
		t.Fatalf("statement promoted bounded records to full-period totals: %#v", statement)
	}
	requestJSON(t, ts.URL+"/api/activity/tx-owned/category", http.MethodPut, map[string]any{"categoryId": category.ID, "idempotencyKey": "classification-key-0001"}, session.Token, "https://finance.example", 200, &map[string]any{})
	requestJSON(t, ts.URL+"/api/privacy", http.MethodPut, map[string]any{"includePayInStatements": true, "allowAiActivityContext": true, "alertsEnabled": true}, session.Token, "https://finance.example", 200, &map[string]any{})
	var job AIJob
	requestJSON(t, ts.URL+"/api/ai/jobs", http.MethodPost, map[string]any{"kind": "detect_anomalies", "recordIds": []string{"tx-owned"}, "contextClasses": []string{"owned_activity"}, "consent": true, "outputLocale": "ar"}, session.Token, "https://finance.example", 202, &job)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		requestJSON(t, ts.URL+"/api/ai/jobs/"+job.ID, http.MethodGet, nil, session.Token, "", 200, &job)
		if job.Status == "ready" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if job.Status != "ready" || job.Provider != "test-provider" || job.Progress == "" || job.OutputLocale != "ar" {
		t.Fatalf("AI draft not reviewable: %+v", job)
	}
	requestJSON(t, ts.URL+"/api/ai/jobs/"+job.ID+"/decision", http.MethodPost, map[string]any{"decision": "reject"}, session.Token, "https://finance.example", 200, &job)
	if job.Status != "rejected" {
		t.Fatalf("AI rejection not audited: %+v", job)
	}
	resp, _ := authorizedRequest(ts.URL+"/api/export?format=csv", http.MethodGet, nil, session.Token, "")
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "text/csv") {
		t.Fatalf("CSV export failed: %d", resp.StatusCode)
	}
	resp.Body.Close()
	reopened, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.Account(testAccount).Budgets) != 1 || len(reopened.Account(testAccount).AIJobs) != 1 || len(reopened.Account(testAccount).Notes) != 1 {
		t.Fatal("account state did not survive restart")
	}
}

func TestDeleteAccountRemovesPrivateStateAndRetainsMinimalAudit(t *testing.T) {
	store, _ := OpenStore("")
	service := &Service{Store: store}
	if _, err := service.AddCategory(testAccount, "Private", "#002FA7", "delete-category-key-01"); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteAccount(testAccount); err != nil {
		t.Fatal(err)
	}
	state := store.Account(testAccount)
	if len(state.Categories) != 0 || len(state.Notes) != 0 || len(state.Budgets) != 0 {
		t.Fatalf("private state survived deletion: %+v", state)
	}
	audit := store.Audit(testAccount)
	if len(audit) != 1 || audit[0].Action != "account.deleted" || audit[0].ObjectID != "" || audit[0].Details != nil {
		t.Fatalf("deletion audit contains unexpected data: %+v", audit)
	}
}

func TestUnavailableSourcesStayUnavailableAndOriginFailsClosed(t *testing.T) {
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "offline", 503) }))
	defer explorer.Close()
	store, _ := OpenStore("")
	up, _ := NewUpstreams(explorer.URL, "", "", "")
	service := &Service{Store: store, Upstreams: up, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}
	auth, session := testAuthenticator(t, "central-token-unavailable")
	server, _ := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{"https://finance.example"}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey})
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()
	var p Portfolio
	requestJSON(t, ts.URL+"/api/portfolio", http.MethodGet, nil, session.Token, "", 200, &p)
	if p.ExplorerStatus.Available || p.BalanceYNXT != 0 || len(p.Activity) != 0 {
		t.Fatalf("unavailable source became fake state: %+v", p)
	}
	resp, _ := authorizedRequest(ts.URL+"/api/categories", http.MethodPost, map[string]any{"name": "x", "color": "#002FA7", "idempotencyKey": "category-evil-key-0001"}, session.Token, "https://evil.example")
	if resp.StatusCode != 403 {
		t.Fatalf("cross-origin mutation returned %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestDomainPortfolioEndpointReturnsStableSchema(t *testing.T) {
	store, _ := OpenStore("")
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/accounts/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"account": map[string]any{"address": testAccount, "balance": 777, "staked": 99, "nonce": 0, "resourceUsage": map[string]any{}, "lots": map[string]any{}}})
		case r.URL.Path == "/health":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "rpcHeight": 120, "indexedHeight": 120, "syncLagBlocks": 0, "nativeSymbol": "YNXT", "truthfulStatus": "indexed-with-reported-lag", "lastCheckedAt": time.Now().UTC(), "build": map[string]any{"release": "ynx-explorer-suite-test"}})
		case r.URL.Path == "/api/txs":
			_ = json.NewEncoder(w).Encode(map[string]any{"transactions": []any{}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer explorer.Close()
	upstreams, _ := NewUpstreams(explorer.URL, "", "", "")
	service := &Service{
		Store:     store,
		Upstreams: upstreams,
		AI:        fakeAI{},
		Support:   SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"},
	}
	auth, session := testAuthenticator(t, "domain-portfolio-proof")
	server, err := NewServer(service, auth, ServerConfig{
		AllowedOrigins:   []string{"https://finance.example"},
		CursorSigningKey: testCursorKey,
		OperationsKey:    testOperationsKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	var portfolio DomainPortfolio
	requestJSON(t, ts.URL+"/v1/domain/portfolio", http.MethodGet, nil, session.Token, "", 200, &portfolio)
	if portfolio.SchemaVersion != FinanceDomainVersion {
		t.Fatalf("unexpected domain schema version: %q", portfolio.SchemaVersion)
	}
	if portfolio.Source.System != "ynx-finance" || portfolio.Source.Owner != "finance-consumer" || portfolio.Source.AsOf == "" {
		t.Fatalf("unexpected source payload: %+v", portfolio.Source)
	}
	if portfolio.PortfolioID != "finance:"+ChainID+":"+testAccount {
		t.Fatalf("unexpected portfolio id: %q", portfolio.PortfolioID)
	}
	if portfolio.AccountID != testAccount {
		t.Fatalf("unexpected account id: %q", portfolio.AccountID)
	}
	if portfolio.ValuationAssetID != "YNXT" {
		t.Fatalf("unexpected valuation asset: %q", portfolio.ValuationAssetID)
	}
	if portfolio.ValuationStatus != "observed" || portfolio.ValuationReason != "" || portfolio.TotalValue != "876" {
		t.Fatalf("unexpected valuation truth: %+v", portfolio)
	}
	if len(portfolio.Holdings) != 1 {
		t.Fatalf("unexpected holding length: %d", len(portfolio.Holdings))
	}
	if portfolio.Holdings[0].AssetID != "YNXT" || portfolio.Holdings[0].Available != "777" || portfolio.Holdings[0].Staked != "99" || portfolio.Holdings[0].Total != "876" {
		t.Fatalf("unexpected holding shape: %#v", portfolio.Holdings[0])
	}
	if portfolio.Source.Status != "partial" {
		t.Fatalf("expected partial status for current upstream setup, got %q", portfolio.Source.Status)
	}
}

func TestDomainPortfolioDoesNotInventZeroWhenExplorerUnavailable(t *testing.T) {
	service := &Service{}
	portfolio := service.DomainPortfolio(testAccount, Portfolio{
		Account:     testAccount,
		Network:     ChainID,
		BalanceYNXT: 0,
		StakedYNXT:  0,
		ExplorerStatus: SourceStatus{
			Available:  false,
			SyncStatus: "owner-endpoint-unavailable",
			Error:      "Explorer account evidence is unavailable",
		},
	}, "finance-test-build")
	if portfolio.ValuationStatus != "unavailable" || portfolio.ValuationReason != "explorer_account_evidence_unavailable" {
		t.Fatalf("unavailable valuation was not explicit: %+v", portfolio)
	}
	if portfolio.TotalValue != "" {
		t.Fatalf("unavailable valuation invented a numeric total: %q", portfolio.TotalValue)
	}
	if portfolio.Holdings == nil || len(portfolio.Holdings) != 0 {
		t.Fatalf("unavailable valuation must return an explicit empty holdings list: %#v", portfolio.Holdings)
	}
}

func TestDomainPortfolioPreservesObservedZero(t *testing.T) {
	service := &Service{}
	portfolio := service.DomainPortfolio(testAccount, Portfolio{
		Account:     testAccount,
		Network:     ChainID,
		BalanceYNXT: 0,
		StakedYNXT:  0,
		ExplorerStatus: SourceStatus{
			Available:  true,
			SyncStatus: "authorized-response",
		},
	}, "finance-test-build")
	if portfolio.ValuationStatus != "observed" || portfolio.TotalValue != "0" || portfolio.ValuationReason != "" {
		t.Fatalf("observed zero was not preserved: %+v", portfolio)
	}
	if len(portfolio.Holdings) != 1 || portfolio.Holdings[0].Total != "0" {
		t.Fatalf("observed zero holding is ambiguous: %#v", portfolio.Holdings)
	}
}

func TestDomainPortfolioUsesAccountEvidenceWhenActivityIsUnavailable(t *testing.T) {
	service := &Service{}
	portfolio := service.DomainPortfolio(testAccount, Portfolio{
		BalanceYNXT: 40,
		StakedYNXT:  2,
		ExplorerStatus: SourceStatus{
			Available:  false,
			SyncStatus: "partial-account-only",
			Error:      "account loaded but activity unavailable",
		},
	}, "finance-test-build")
	if portfolio.ValuationStatus != "observed" || portfolio.TotalValue != "42" || len(portfolio.Holdings) != 1 {
		t.Fatalf("account evidence was discarded with the unavailable activity feed: %+v", portfolio)
	}
}

func TestDomainPortfolioRejectsInvalidOrOverflowingAccountAmounts(t *testing.T) {
	service := &Service{}
	for _, test := range []struct {
		name    string
		balance int64
		staked  int64
	}{
		{name: "negative balance", balance: -1},
		{name: "negative stake", staked: -1},
		{name: "overflow", balance: math.MaxInt64, staked: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			portfolio := service.DomainPortfolio(testAccount, Portfolio{
				BalanceYNXT: test.balance,
				StakedYNXT:  test.staked,
				ExplorerStatus: SourceStatus{
					Available:  true,
					SyncStatus: "authorized-response",
				},
			}, "finance-test-build")
			if portfolio.ValuationStatus != "unavailable" || portfolio.ValuationReason != "explorer_account_amount_invalid" || portfolio.TotalValue != "" || len(portfolio.Holdings) != 0 {
				t.Fatalf("invalid account amount escaped as a valuation: %+v", portfolio)
			}
		})
	}
}

func TestAIBudgetDraftOnlyAppliesAfterReview(t *testing.T) {
	store, _ := OpenStore("")
	categoryService := &Service{Store: store}
	category, err := categoryService.AddCategory(testAccount, "Operations", "#002FA7", "ai-category-key-000001")
	if err != nil {
		t.Fatal(err)
	}
	if err := categoryService.SetPrivacy(testAccount, Privacy{AllowAIActivityContext: true}); err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: store, AI: fakeAI{result: map[string]any{
		"budgets": []any{map[string]any{"name": "AI draft", "categoryId": category.ID, "limitYnxt": float64(75), "period": "monthly"}},
	}}}
	portfolio := Portfolio{Activity: []Activity{{ID: "owned-record", Source: "indexed"}}, ExplorerStatus: SourceStatus{Available: true}}
	job, err := service.StartAI(context.Background(), testAccount, "draft_budget", []string{"owned-record"}, []string{"owned_activity"}, true, portfolio)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		job, _ = service.aiJob(testAccount, job.ID)
		if job.Status == "ready" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if len(store.Account(testAccount).Budgets) != 0 {
		t.Fatal("AI budget executed before review")
	}
	if err := service.DecideAI(testAccount, job.ID, "apply"); err != nil {
		t.Fatal(err)
	}
	budgets := store.Account(testAccount).Budgets
	if len(budgets) != 1 || budgets[0].LimitYNXT != 75 || budgets[0].Name != "AI draft" {
		t.Fatalf("reviewed AI budget not applied: %+v", budgets)
	}
	if err := service.DeleteAI(testAccount, job.ID); err != nil {
		t.Fatal(err)
	}
	if len(store.Account(testAccount).AIJobs) != 0 {
		t.Fatal("AI draft data was not deleted")
	}
	audit := store.Audit(testAccount)
	if len(audit) == 0 || audit[len(audit)-1].Action != "ai.deleted" {
		t.Fatal("minimal AI deletion audit event is missing")
	}
}

func TestAIBrokerOrderIntentProducesStrictDraftOnlyJob(t *testing.T) {
	store, _ := OpenStore("")
	if err := store.Update(testAccount, "privacy", "ai", func(state *AccountState) error {
		state.Privacy.AllowAIActivityContext = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	provider := &capturingAI{result: map[string]any{
		"schemaVersion": "finance.ai.broker-order-draft.v1",
		"draftOnly":     true,
		"orderDraft":    map[string]any{"symbol": "ACME", "side": "buy", "qty": "2", "limitPrice": "10.25", "timeInForce": "day", "warnings": []any{"Sandbox only; review provider-backed asset and Wallet approval."}},
	}}
	service := &Service{Store: store, AI: provider}
	portfolio := Portfolio{Activity: []Activity{{ID: "owned-record", Source: "indexed"}}, ExplorerStatus: SourceStatus{Available: true}}
	intent := &AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "10.25"}
	job, err := service.StartAIWithIntent(context.Background(), testAccount, "draft_broker_order", []string{"owned-record"}, []string{"owned_activity"}, true, portfolio, "en", intent)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		job, _ = service.aiJob(testAccount, job.ID)
		if job.Status != "running" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	contextIntent, ok := provider.request.Context["securitiesOrderIntent"].(AISecuritiesOrderIntent)
	if job.Status != "ready" || !ok || contextIntent != *intent || job.Result["draftOnly"] != true {
		t.Fatalf("job=%+v request=%+v", job, provider.request)
	}
	if len(store.Account(testAccount).Brokerage.Orders) != 0 {
		t.Fatal("AI draft created an order")
	}
}

func TestAIBrokerOrderIntentAllowsExplicitEmptyChainContextWhenExplorerUnavailable(t *testing.T) {
	store, _ := OpenStore("")
	if err := store.Update(testAccount, "privacy", "ai", func(state *AccountState) error {
		state.Privacy.AllowAIActivityContext = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	provider := &capturingAI{result: map[string]any{
		"schemaVersion": "finance.ai.broker-order-draft.v1",
		"draftOnly":     true,
		"orderDraft":    map[string]any{"symbol": "ACME", "side": "buy", "qty": "1", "limitPrice": "10", "timeInForce": "day", "warnings": []any{"Chain activity unavailable; review only."}},
	}}
	service := &Service{Store: store, AI: provider}
	portfolio := Portfolio{ExplorerStatus: SourceStatus{Available: false, Error: "indexer unavailable"}}
	job, err := service.StartAIWithIntent(context.Background(), testAccount, "draft_broker_order", nil, nil, true, portfolio, "en", &AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "1", LimitPrice: "10"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		job, _ = service.aiJob(testAccount, job.ID)
		if job.Status != "running" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	chain, ok := provider.request.Context["chainActivityContext"].(map[string]any)
	if job.Status != "ready" || !ok || chain["available"] != false || chain["reason"] != "explorer_unavailable" || chain["activityCount"] != 0 || len(provider.request.RecordIDs) != 0 || len(provider.request.ContextClasses) != 0 {
		t.Fatalf("job=%+v request=%+v", job, provider.request)
	}
	if activity, ok := provider.request.Context["activity"].([]Activity); !ok || len(activity) != 0 {
		t.Fatalf("fabricated activity context: %#v", provider.request.Context["activity"])
	}
}

func TestAIBrokerOrderHTTPGatewayRunsForNewUserWhileExplorerIsDegraded(t *testing.T) {
	var streamedInput string
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "model": "empty-chain-context-fixture"})
		case "/ai/stream":
			streamedInput = r.URL.Query().Get("q")
			w.Header().Set("Content-Type", "text/event-stream")
			event, _ := json.Marshal(map[string]any{"text": `{"schemaVersion":"finance.ai.broker-order-draft.v1","draftOnly":true,"orderDraft":{"symbol":"ACME","side":"buy","qty":"1","limitPrice":"10","timeInForce":"day","warnings":["Chain activity unavailable; review only."]}}`})
			_, _ = fmt.Fprintf(w, "data: %s\n\n", event)
		default:
			http.NotFound(w, r)
		}
	}))
	defer gateway.Close()
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "degraded", http.StatusServiceUnavailable) }))
	defer explorer.Close()
	store, _ := OpenStore("")
	_ = store.Update(testAccount, "privacy", "ai", func(state *AccountState) error { state.Privacy.AllowAIActivityContext = true; return nil })
	upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.example/disputes")
	if err != nil {
		t.Fatal(err)
	}
	auth, session := testAuthenticator(t, "empty-chain-context-gateway")
	service := &Service{Store: store, Upstreams: upstreams, AI: &HTTPAIProvider{URL: gateway.URL, Client: gateway.Client()}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}
	server, err := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{"https://finance.example"}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey})
	if err != nil {
		t.Fatal(err)
	}
	product := httptest.NewServer(server.Handler())
	defer product.Close()
	body := map[string]any{"kind": "draft_broker_order", "recordIds": []string{}, "contextClasses": []string{}, "consent": true, "outputLocale": "en", "securitiesOrderIntent": map[string]any{"symbol": "ACME", "side": "buy", "qty": "1", "limitPrice": "10"}}
	var job AIJob
	requestJSON(t, product.URL+"/api/ai/jobs", http.MethodPost, body, session.Token, "https://finance.example", http.StatusAccepted, &job)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		requestJSON(t, product.URL+"/api/ai/jobs/"+job.ID, http.MethodGet, nil, session.Token, "", http.StatusOK, &job)
		if job.Status != "running" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if job.Status != "ready" || !strings.Contains(streamedInput, `"reason":"explorer_unavailable"`) || !strings.Contains(streamedInput, `"activity":[]`) || strings.Contains(streamedInput, "owned-ai-record") {
		t.Fatalf("job=%+v streamedInput=%s", job, streamedInput)
	}
	if len(store.Account(testAccount).Brokerage.Orders) != 0 {
		t.Fatal("AI Gateway draft created a Broker order")
	}
}

func TestAIBrokerOrderDraftFailsClosedOnSchemaOrIntent(t *testing.T) {
	store, _ := OpenStore("")
	_ = store.Update(testAccount, "privacy", "ai", func(state *AccountState) error { state.Privacy.AllowAIActivityContext = true; return nil })
	portfolio := Portfolio{Activity: []Activity{{ID: "owned-record", Source: "indexed"}}, ExplorerStatus: SourceStatus{Available: true}}
	provider := &capturingAI{result: map[string]any{"orderDraft": map[string]any{"symbol": "ACME"}}}
	service := &Service{Store: store, AI: provider}
	if _, err := service.StartAIWithIntent(context.Background(), testAccount, "draft_broker_order", []string{"owned-record"}, []string{"owned_activity"}, true, portfolio, "en", &AISecuritiesOrderIntent{Symbol: "../BAD", Side: "buy", Qty: "1", LimitPrice: "10"}); err == nil {
		t.Fatal("invalid advisory intent was accepted")
	}
	job, err := service.StartAIWithIntent(context.Background(), testAccount, "draft_broker_order", []string{"owned-record"}, []string{"owned_activity"}, true, portfolio, "en", &AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "1", LimitPrice: "10"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		job, _ = service.aiJob(testAccount, job.ID)
		if job.Status != "running" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if job.Status != "failed" || job.Error != "AI_ORDER_DRAFT_SCHEMA_INVALID" {
		t.Fatalf("invalid provider result did not fail closed: %+v", job)
	}
}

func TestAIBrokerOrderIntentUsesCanonicalBackendDecimalBounds(t *testing.T) {
	base := AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "1", LimitPrice: "1"}
	tests := []struct {
		name  string
		qty   string
		price string
		valid bool
	}{
		{name: "minimum", qty: "1", price: "0.0001", valid: true},
		{name: "maximum", qty: "1000000", price: "999999999.9999", valid: true},
		{name: "rational quantity", qty: "2/1", price: "1"},
		{name: "exponent quantity", qty: "1e2", price: "1"},
		{name: "signed quantity", qty: "+2", price: "1"},
		{name: "quantity whitespace", qty: " 2", price: "1"},
		{name: "fractional quantity", qty: "2.5", price: "1"},
		{name: "leading zero quantity", qty: "02", price: "1"},
		{name: "quantity above maximum", qty: "1000001", price: "1"},
		{name: "rational price", qty: "2", price: "2/1"},
		{name: "exponent price", qty: "2", price: "1e2"},
		{name: "signed price", qty: "2", price: "+1"},
		{name: "negative price", qty: "2", price: "-1"},
		{name: "price whitespace", qty: "2", price: "1 ", valid: false},
		{name: "leading zero price", qty: "2", price: "01", valid: false},
		{name: "silent trailing zero", qty: "2", price: "10.250", valid: false},
		{name: "silent fifth decimal", qty: "2", price: "1.00001", valid: false},
		{name: "price above maximum", qty: "2", price: "1000000000", valid: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			intent := base
			intent.Qty = tc.qty
			intent.LimitPrice = tc.price
			if got := validAIOrderIntent(intent); got != tc.valid {
				t.Fatalf("validAIOrderIntent(%+v)=%t; want %t", intent, got, tc.valid)
			}
		})
	}
}

func TestHTTPAIProviderConsumesLoopbackSSEWithoutWrite(t *testing.T) {
	requests := 0
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "model": "fixture-model"})
			return
		}
		requests++
		if r.Method != http.MethodGet || r.URL.Path != "/ai/stream" || !strings.Contains(r.URL.Query().Get("q"), "finance.ai.broker-order-draft.v1") {
			t.Fatalf("unexpected AI gateway request: %s %s", r.Method, r.URL.String())
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"text\":\"{\\\"schemaVersion\\\":\\\"finance.ai.broker-order-draft.v1\\\",\\\"draftOnly\\\":true,\\\"orderDraft\\\":{\\\"symbol\\\":\\\"ACME\\\",\\\"side\\\":\\\"buy\\\",\\\"qty\\\":\\\"1\\\",\\\"limitPrice\\\":\\\"10\\\",\\\"timeInForce\\\":\\\"day\\\",\\\"warnings\\\":[\\\"Review only\\\"]}}\"}\n\n")
	}))
	defer gateway.Close()
	provider := &HTTPAIProvider{URL: gateway.URL, Client: gateway.Client()}
	result, err := provider.Stream(context.Background(), AIRequest{Kind: "draft_broker_order", Account: testAccount, OutputLocale: "en"}, func(string) {})
	if err != nil || requests != 1 || result["schemaVersion"] != "finance.ai.broker-order-draft.v1" {
		t.Fatalf("result=%v requests=%d err=%v", result, requests, err)
	}
}

func TestAIBrokerOrderRouteAndHTTPGatewayEnforceExactDecimalAndObjectSchemas(t *testing.T) {
	validResult := `{"schemaVersion":"finance.ai.broker-order-draft.v1","draftOnly":true,"orderDraft":{"symbol":"ACME","side":"buy","qty":"2","limitPrice":"10.25","timeInForce":"day","warnings":["Review only"]}}`
	tests := []struct {
		name           string
		intent         AISecuritiesOrderIntent
		gatewayResult  string
		wantPostStatus int
		wantJobStatus  string
		wantJobError   string
		wantStreams    int
	}{
		{name: "canonical", intent: AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "10.25"}, gatewayResult: validResult, wantPostStatus: http.StatusAccepted, wantJobStatus: "ready", wantStreams: 1},
		{name: "rational quantity input", intent: AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "2/1", LimitPrice: "10.25"}, gatewayResult: validResult, wantPostStatus: http.StatusServiceUnavailable, wantStreams: 0},
		{name: "exponent price input", intent: AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "1e2"}, gatewayResult: validResult, wantPostStatus: http.StatusServiceUnavailable, wantStreams: 0},
		{name: "rational quantity output", intent: AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "10.25"}, gatewayResult: `{"schemaVersion":"finance.ai.broker-order-draft.v1","draftOnly":true,"orderDraft":{"symbol":"ACME","side":"buy","qty":"2/1","limitPrice":"10.25","timeInForce":"day","warnings":["Review only"]}}`, wantPostStatus: http.StatusAccepted, wantJobStatus: "failed", wantJobError: "AI_ORDER_DRAFT_FIELDS_INVALID", wantStreams: 1},
		{name: "exponent price output", intent: AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "10.25"}, gatewayResult: `{"schemaVersion":"finance.ai.broker-order-draft.v1","draftOnly":true,"orderDraft":{"symbol":"ACME","side":"buy","qty":"2","limitPrice":"1e2","timeInForce":"day","warnings":["Review only"]}}`, wantPostStatus: http.StatusAccepted, wantJobStatus: "failed", wantJobError: "AI_ORDER_DRAFT_FIELDS_INVALID", wantStreams: 1},
		{name: "extra root output", intent: AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "10.25"}, gatewayResult: `{"schemaVersion":"finance.ai.broker-order-draft.v1","draftOnly":true,"execute":true,"orderDraft":{"symbol":"ACME","side":"buy","qty":"2","limitPrice":"10.25","timeInForce":"day","warnings":["Review only"]}}`, wantPostStatus: http.StatusAccepted, wantJobStatus: "failed", wantJobError: "AI_ORDER_DRAFT_SCHEMA_INVALID", wantStreams: 1},
		{name: "extra nested output", intent: AISecuritiesOrderIntent{Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "10.25"}, gatewayResult: `{"schemaVersion":"finance.ai.broker-order-draft.v1","draftOnly":true,"orderDraft":{"symbol":"ACME","side":"buy","qty":"2","limitPrice":"10.25","timeInForce":"day","warnings":["Review only"],"execute":true}}`, wantPostStatus: http.StatusAccepted, wantJobStatus: "failed", wantJobError: "AI_ORDER_DRAFT_SCHEMA_INVALID", wantStreams: 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			streamRequests := 0
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/health":
					_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "model": "strict-schema-fixture"})
				case "/ai/stream":
					streamRequests++
					w.Header().Set("Content-Type", "text/event-stream")
					event, _ := json.Marshal(map[string]any{"text": tc.gatewayResult})
					_, _ = fmt.Fprintf(w, "data: %s\n\n", event)
				default:
					http.NotFound(w, r)
				}
			}))
			defer gateway.Close()
			explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.URL.Path == "/health":
					_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "rpcHeight": 1, "indexedHeight": 1, "nativeSymbol": "YNXT", "truthfulStatus": "indexed", "build": map[string]any{"commit": "strict-schema-explorer", "release": "strict-schema-explorer"}})
				case strings.HasPrefix(r.URL.Path, "/api/accounts/"):
					_ = json.NewEncoder(w).Encode(map[string]any{"account": map[string]any{"address": testAccount, "balance": 1, "staked": 0, "nonce": 1}})
				case r.URL.Path == "/api/txs":
					_ = json.NewEncoder(w).Encode(map[string]any{"transactions": []map[string]any{{"hash": "owned-ai-record", "type": "transfer", "from": testAccount, "to": "ynx1recipient", "amount": 1, "fee": 0, "blockNumber": 1, "timestamp": time.Now().UTC()}}})
				default:
					http.NotFound(w, r)
				}
			}))
			defer explorer.Close()
			store, err := OpenStore("")
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Update(testAccount, "privacy", "ai", func(state *AccountState) error {
				state.Privacy.AllowAIActivityContext = true
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.example/disputes")
			if err != nil {
				t.Fatal(err)
			}
			auth, session := testAuthenticator(t, "strict-ai-schema-"+strings.ReplaceAll(tc.name, " ", "-"))
			service := &Service{
				Store:     store,
				Upstreams: upstreams,
				AI:        &HTTPAIProvider{URL: gateway.URL, Client: gateway.Client()},
				Support:   SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"},
			}
			server, err := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{"https://finance.example"}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey})
			if err != nil {
				t.Fatal(err)
			}
			product := httptest.NewServer(server.Handler())
			defer product.Close()
			body := map[string]any{"kind": "draft_broker_order", "recordIds": []string{"owned-ai-record"}, "contextClasses": []string{"owned_activity"}, "consent": true, "outputLocale": "en", "securitiesOrderIntent": tc.intent}
			var job AIJob
			requestJSON(t, product.URL+"/api/ai/jobs", http.MethodPost, body, session.Token, "https://finance.example", tc.wantPostStatus, &job)
			if tc.wantPostStatus == http.StatusAccepted {
				deadline := time.Now().Add(time.Second)
				for time.Now().Before(deadline) {
					requestJSON(t, product.URL+"/api/ai/jobs/"+job.ID, http.MethodGet, nil, session.Token, "", http.StatusOK, &job)
					if job.Status != "running" {
						break
					}
					time.Sleep(time.Millisecond)
				}
				if job.Status != tc.wantJobStatus || job.Error != tc.wantJobError {
					t.Fatalf("job status=%q error=%q; want status=%q error=%q", job.Status, job.Error, tc.wantJobStatus, tc.wantJobError)
				}
			}
			if streamRequests != tc.wantStreams {
				t.Fatalf("AI Gateway stream requests=%d; want %d", streamRequests, tc.wantStreams)
			}
			if len(store.Account(testAccount).Brokerage.Orders) != 0 {
				t.Fatal("AI schema test created a broker order")
			}
		})
	}
}

func testCentralSession(overrides map[string]any) map[string]any {
	value := map[string]any{"verifierVersion": "wallet-auth-v1", "sessionBinding": strings.Repeat("a", 64), "productClientId": "ynx-finance-v1", "bundleId": "com.ynxweb4.finance", "requestDigest": strings.Repeat("b", 64), "account": testAccount, "scopes": []string{"finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"}, "issuedAt": time.Now().UTC().Add(-time.Minute).Format(time.RFC3339), "expiresAt": time.Now().UTC().Add(time.Hour).Format(time.RFC3339)}
	for key, item := range overrides {
		value[key] = item
	}
	return value
}
func testAuthenticator(t *testing.T, token string) (*Authenticator, Session) {
	t.Helper()
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/wallet/sessions/introspect" || r.Header.Get("X-YNX-Product-Session-Proof") != token {
			http.Error(w, "rejected", http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{"active": true, "session": testCentralSession(nil)}})
	}))
	t.Cleanup(central.Close)
	auth, err := NewAuthenticator(central.URL, strings.Repeat("i", 32), "ynx-finance-v1", "com.ynxweb4.finance")
	if err != nil {
		t.Fatal(err)
	}
	return auth, Session{Token: token, Account: testAccount, Scopes: []string{"finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"}, ExpiresAt: time.Now().Add(time.Hour)}
}
func requestJSON(t *testing.T, endpoint, method string, body any, token, origin string, want int, out any) {
	t.Helper()
	resp, err := authorizedRequest(endpoint, method, body, token, origin)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != want {
		var e map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&e)
		t.Fatalf("%s %s returned %d: %#v", method, endpoint, resp.StatusCode, e)
	}
	if out != nil && resp.StatusCode != 204 {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}
func authorizedRequest(endpoint, method string, body any, token, origin string) (*http.Response, error) {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, _ := http.NewRequest(method, endpoint, bytes.NewReader(raw))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-YNX-Product-Session-Proof", token)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	return http.DefaultClient.Do(req)
}
