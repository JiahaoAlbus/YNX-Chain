package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
	if len(portfolio.Holdings) != 1 {
		t.Fatalf("unexpected holding length: %d", len(portfolio.Holdings))
	}
	if portfolio.Holdings[0].AssetID != "YNXT" || portfolio.Holdings[0].Available != "777" || portfolio.Holdings[0].Staked != "99" || portfolio.Holdings[0].Total != "876" {
		t.Fatalf("unexpected holding shape: %#v", portfolio.Holdings[0])
	}
	if portfolio.Source.Status != "partial" {
		t.Fatalf("expected partial status for current upstream setup, got %q", portfolio.Source.Status)
	}
	if portfolio.Source.Coverage == "" || portfolio.Source.SyncStatus != "aggregated-partial" || portfolio.Source.Error != "pay-unavailable" {
		t.Fatalf("unexpected source evidence summary: %+v", portfolio.Source)
	}
	if strings.Contains(portfolio.Source.Error, "not configured") {
		t.Fatalf("domain source leaked raw upstream error: %q", portfolio.Source.Error)
	}
}

func TestDomainSourceEvidenceAggregatesCoverageWithoutRawError(t *testing.T) {
	portfolio := Portfolio{
		ExplorerStatus: SourceStatus{Available: true, Coverage: "account_balance", SyncStatus: "indexed"},
		PayStatus:      SourceStatus{Available: false, Coverage: "payment-history", SyncStatus: "unavailable", Error: "secret=must-not-leak"},
	}
	source := domainSourceFromUpstreams(portfolio, "test-build")
	if source.Coverage != "explorer:account_balance;pay:payment-history" {
		t.Fatalf("unexpected coverage summary: %q", source.Coverage)
	}
	if source.SyncStatus != "aggregated-partial" || source.Error != "pay-unavailable" {
		t.Fatalf("unexpected safe source status: %+v", source)
	}
	if strings.Contains(source.Error, "secret") {
		t.Fatalf("domain source leaked upstream error: %q", source.Error)
	}
	portfolio.ExplorerStatus.Coverage = "https://untrusted.example/coverage"
	if got := domainSourceFromUpstreams(portfolio, "test-build").Coverage; !strings.Contains(got, "explorer:not-reported") {
		t.Fatalf("unexpected untrusted coverage label: %q", got)
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
