package aiproduct

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newProductRegistryTestServer(t *testing.T) (*Server, *Store) {
	t.Helper()
	gateway := newGatewayFixture(t, true)
	t.Cleanup(gateway.Close)
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{17}, 32))
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Config{
		GatewayURL: gateway.URL, GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback,
		TrustURL: "https://trust.invalid/appeals", ProviderName: "registry-test-provider",
		GenerationTimeout: 2 * time.Second, AllowLocalFixtureAuth: true,
	}, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	return server, store
}

func TestEmbeddedProductAIRegistryIsCompleteAndDenyByDefault(t *testing.T) {
	registry, err := loadProductAIRegistry()
	if err != nil {
		t.Fatal(err)
	}
	if len(registry.Products) != 24 {
		t.Fatalf("registry products=%d, want=24", len(registry.Products))
	}
	defaults := []string{
		registry.DefaultPolicy.UnknownProduct,
		registry.DefaultPolicy.UnknownContext,
		registry.DefaultPolicy.UnselectedPrivateContext,
		registry.DefaultPolicy.CrossProductContextReuse,
		registry.DefaultPolicy.SecretBearingContext,
		registry.DefaultPolicy.ToolExecution,
	}
	for _, value := range defaults {
		if value != "deny" {
			t.Fatalf("registry default=%q, want deny", value)
		}
	}
	for _, product := range registry.Products {
		if product.Owner == "" || product.MaxContextBytes <= 0 || len(product.Workflows) == 0 || len(product.AllowedContexts) == 0 || len(product.Tools) == 0 {
			t.Fatalf("incomplete registry product: %+v", product)
		}
		for _, tool := range product.Tools {
			if forbiddenExecutableTool(tool) {
				t.Fatalf("registry product %s exposes executable tool %q", product.ID, tool)
			}
		}
	}

	server, _ := newProductRegistryTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/product-ai-registry", nil)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("registry endpoint status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Registry ProductAIRegistry `json:"registry"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Registry.RegistryVersion != "1.0.0" || len(response.Registry.Products) != 24 {
		t.Fatalf("unexpected registry endpoint payload: %+v", response.Registry)
	}
}

func TestProductContextSelectionsFailClosedAndMinimizeReferences(t *testing.T) {
	server, store := newProductRegistryTestServer(t)
	now := time.Now().UTC()
	session := ProductSession{ID: "session-1", Account: "account-1", Scopes: []string{"ai:generate", "ai:conversations"}, Status: "active", ExpiresAt: now.Add(time.Hour)}
	accountHash := hashProductAccount(session.Account, "conversation-1")
	accountDigest, err := hex.DecodeString(accountHash)
	if err != nil || len(accountDigest) != 32 || strings.Contains(accountHash, session.Account) {
		t.Fatalf("account hash is not a minimized SHA-256 identifier: %q err=%v", accountHash, err)
	}
	if accountHash == hashProductAccount(session.Account, "conversation-other") {
		t.Fatal("account hash is linkable across conversation domains")
	}
	if hashProductReference(session.Account, "conversation-1", "mail", "selected_mail_messages", "message-17") == hashProductReference(session.Account, "conversation-other", "mail", "selected_mail_messages", "message-17") {
		t.Fatal("product reference hash is linkable across conversation domains")
	}
	conversationID := "conversation-1"
	included := []string{"conversation", selectedProductContext}
	base := ProductContextSelection{
		ProductID: "mail", ContextType: "selected_mail_messages", DataClass: "communications",
		ReferenceIDs: []string{"message-17"}, SizeBytes: 2048, ExplicitlySelected: true,
		PermissionGatewayID: "gateway-mail-permission", SourceVersion: "mail.v1", AsOf: now.Format(time.RFC3339),
	}
	if err := store.SavePermission(PermissionRecord{
		ID: "permission-local-1", GatewayID: base.PermissionGatewayID, Account: session.Account,
		SessionID: conversationID, Scope: "mail:messages:read", Purpose: "summarize one selected message",
		Status: "active", CreatedAt: now, ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	resolved, err := server.validateProductContextSelections(session, conversationID, included, []ProductContextSelection{base}, now)
	if err != nil {
		t.Fatalf("valid mail selection failed: %v", err)
	}
	if len(resolved) != 1 || len(resolved[0].ReferenceHashes) != 1 || resolved[0].ReferenceIDs[0] != "message-17" {
		t.Fatalf("unexpected resolved product context: %+v", resolved)
	}
	wire, err := json.Marshal(resolved)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(wire, []byte("message-17")) || !bytes.Contains(wire, []byte(resolved[0].ReferenceHashes[0])) {
		t.Fatalf("Gateway payload did not minimize raw references: %s", wire)
	}

	unknown := base
	unknown.ProductID = "unknown-product"
	if _, err := server.validateProductContextSelections(session, conversationID, included, []ProductContextSelection{unknown}, now); err == nil || !strings.Contains(err.Error(), "not registered") {
		t.Fatalf("unknown product did not fail closed: %v", err)
	}
	if _, err := server.validateProductContextSelections(session, conversationID, []string{"conversation"}, []ProductContextSelection{base}, now); err == nil || !strings.Contains(err.Error(), "selected_product_context") {
		t.Fatalf("implicit product context did not fail closed: %v", err)
	}
	unselected := base
	unselected.ExplicitlySelected = false
	if _, err := server.validateProductContextSelections(session, conversationID, included, []ProductContextSelection{unselected}, now); err == nil || !strings.Contains(err.Error(), "not explicitly selected") {
		t.Fatalf("unselected product context did not fail closed: %v", err)
	}
	stale := base
	stale.AsOf = now.Add(-time.Hour).Format(time.RFC3339)
	if _, err := server.validateProductContextSelections(session, conversationID, included, []ProductContextSelection{stale}, now); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("stale product context did not fail closed: %v", err)
	}
	duplicateReference := base
	duplicateReference.ReferenceIDs = []string{"message-17", "message-17"}
	if _, err := server.validateProductContextSelections(session, conversationID, included, []ProductContextSelection{duplicateReference}, now); err == nil || !strings.Contains(err.Error(), "unique referenceIds") {
		t.Fatalf("duplicate references did not fail closed: %v", err)
	}
}

func TestProductContextPermissionIsAccountConversationAndScopeBound(t *testing.T) {
	server, store := newProductRegistryTestServer(t)
	now := time.Now().UTC()
	session := ProductSession{ID: "session-2", Account: "account-2", Scopes: []string{"ai:generate"}, Status: "active", ExpiresAt: now.Add(time.Hour)}
	selection := ProductContextSelection{
		ProductID: "finance", ContextType: "selected_finance_records", DataClass: "financial",
		ReferenceIDs: []string{"finance-record-1"}, SizeBytes: 1024, ExplicitlySelected: true,
		PermissionGatewayID: "gateway-finance-permission", SourceVersion: "finance.v1", AsOf: now.Format(time.RFC3339),
	}
	permission := PermissionRecord{
		ID: "permission-local-2", GatewayID: selection.PermissionGatewayID, Account: session.Account,
		SessionID: "conversation-2", Scope: "finance:records:read", Purpose: "explain selected finance record",
		Status: "active", CreatedAt: now, ExpiresAt: now.Add(time.Hour),
	}
	if err := store.SavePermission(permission); err != nil {
		t.Fatal(err)
	}
	included := []string{"conversation", selectedProductContext}
	if _, err := server.validateProductContextSelections(session, "conversation-2", included, []ProductContextSelection{selection}, now); err != nil {
		t.Fatalf("exact permission binding failed: %v", err)
	}
	if _, err := server.validateProductContextSelections(session, "conversation-other", included, []ProductContextSelection{selection}, now); err == nil || !strings.Contains(err.Error(), "exact scope") {
		t.Fatalf("cross-conversation permission reuse did not fail closed: %v", err)
	}

	wrongScope := selection
	wrongScope.PermissionGatewayID = "gateway-wrong-scope"
	permission.ID = "permission-local-3"
	permission.GatewayID = wrongScope.PermissionGatewayID
	permission.Scope = "finance:records:list"
	if err := store.SavePermission(permission); err != nil {
		t.Fatal(err)
	}
	if _, err := server.validateProductContextSelections(session, "conversation-2", included, []ProductContextSelection{wrongScope}, now); err == nil || !strings.Contains(err.Error(), "exact scope") {
		t.Fatalf("scope widening did not fail closed: %v", err)
	}
}

func TestPublicAndSessionScopedProductContextsUseExactApprovalMode(t *testing.T) {
	server, _ := newProductRegistryTestServer(t)
	now := time.Now().UTC()
	session := ProductSession{ID: "session-3", Account: "account-3", Scopes: []string{"ai:generate", "ai:conversations"}, Status: "active", ExpiresAt: now.Add(time.Hour)}
	included := []string{"conversation", selectedProductContext}

	public := ProductContextSelection{
		ProductID: "explorer", ContextType: "selected_public_chain_records", DataClass: "public",
		ReferenceIDs: []string{"block-17"}, SizeBytes: 512, ExplicitlySelected: true,
		SourceVersion: "chain-state.v1", AsOf: now.Format(time.RFC3339),
	}
	if _, err := server.validateProductContextSelections(session, "conversation-3", included, []ProductContextSelection{public}, now); err != nil {
		t.Fatalf("explicit public context failed: %v", err)
	}
	public.PermissionGatewayID = "unrelated-permission"
	if _, err := server.validateProductContextSelections(session, "conversation-3", included, []ProductContextSelection{public}, now); err == nil || !strings.Contains(err.Error(), "unrelated permission") {
		t.Fatalf("public context accepted unrelated permission: %v", err)
	}

	own := ProductContextSelection{
		ProductID: "ai", ContextType: "conversation", DataClass: "private",
		ReferenceIDs: []string{"conversation-3"}, SizeBytes: 1024, ExplicitlySelected: true,
		SourceVersion: "ynx-ai-conversation.v1", AsOf: now.Format(time.RFC3339),
	}
	if _, err := server.validateProductContextSelections(session, "conversation-3", included, []ProductContextSelection{own}, now); err != nil {
		t.Fatalf("AI session-scoped context failed: %v", err)
	}
	session.Scopes = []string{"ai:generate"}
	if _, err := server.validateProductContextSelections(session, "conversation-3", included, []ProductContextSelection{own}, now); err == nil || !strings.Contains(err.Error(), "session scope") {
		t.Fatalf("AI context accepted missing session scope: %v", err)
	}
}

func TestProductGenerationSendsOnlyAuthorizedHashedContextToGateway(t *testing.T) {
	captured := make(chan map[string]any, 1)
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" && r.Header.Get("X-YNX-AI-Key") != testGatewayKey {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/health":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "model": "ynx-test-model", "providerConfigured": true})
		case "/ai/stream":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("decode Gateway payload: %v", err)
				http.Error(w, "invalid payload", http.StatusBadRequest)
				return
			}
			captured <- payload
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "event: metadata\ndata: {\"requestId\":\"registry-e2e-request\"}\n\nevent: token\ndata: {\"text\":\"authorized context reference\"}\n\nevent: done\ndata: {}\n\n")
		default:
			http.NotFound(w, r)
		}
	}))
	defer gateway.Close()

	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	if _, err := store.SetPolicy(session.Account, DataPolicy{RetentionDays: 30, SaveEncryptedBody: true, AllowedContextTypes: []string{"conversation", selectedProductContext}}); err != nil {
		t.Fatal(err)
	}
	conversationRaw := authedJSON(t, http.MethodPost, product.URL+"/api/conversations", map[string]any{"title": "Mail context"}, session, http.StatusCreated)
	var conversation Conversation
	if err := json.Unmarshal(conversationRaw, &conversation); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	permissionID := "gateway-mail-e2e-permission"
	if err := store.SavePermission(PermissionRecord{
		ID: "permission-mail-e2e", GatewayID: permissionID, Account: session.Account, SessionID: conversation.ID,
		Scope: "mail:messages:read", Purpose: "summarize one selected message", Status: "active",
		CreatedAt: now, ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	referenceID := "mail-message-e2e-17"
	request := map[string]any{
		"generationId": "registry-e2e-generation", "prompt": "Summarize the selected message reference", "outputLanguage": "en",
		"includedContext": []string{"conversation", selectedProductContext}, "excludedContext": []string{"selected_files"},
		"productContexts": []map[string]any{{
			"productId": "mail", "contextType": "selected_mail_messages", "dataClass": "communications",
			"referenceIds": []string{referenceID}, "sizeBytes": 2048, "explicitlySelected": true,
			"permissionGatewayId": permissionID, "sourceVersion": "mail.v1", "asOf": now.Format(time.RFC3339),
		}},
	}
	stream := authedJSON(t, http.MethodPost, product.URL+"/api/conversations/"+conversation.ID+"/generate", request, session, http.StatusOK)
	if !bytes.Contains(stream, []byte("authorized context reference")) {
		t.Fatalf("missing Product-to-Gateway stream: %s", stream)
	}

	var payload map[string]any
	select {
	case payload = <-captured:
	case <-time.After(time.Second):
		t.Fatal("Product did not call the Gateway")
	}
	wire, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(wire, []byte(referenceID)) || bytes.Contains(wire, []byte(session.Account)) {
		t.Fatalf("Product leaked raw cross-product identifiers to Gateway: %s", wire)
	}
	accountHash, ok := payload["accountHash"].(string)
	if !ok || accountHash != hashProductAccount(session.Account, conversation.ID) {
		t.Fatalf("Product sent an invalid account hash: %v", payload["accountHash"])
	}
	contexts, ok := payload["productContexts"].([]any)
	if !ok || len(contexts) != 1 {
		t.Fatalf("Product sent invalid product contexts: %T %v", payload["productContexts"], payload["productContexts"])
	}
	contextPayload, ok := contexts[0].(map[string]any)
	if !ok {
		t.Fatalf("Product context has invalid shape: %T", contexts[0])
	}
	hashes, ok := contextPayload["referenceHashes"].([]any)
	if !ok || len(hashes) != 1 || hashes[0] != hashProductReference(session.Account, conversation.ID, "mail", "selected_mail_messages", referenceID) {
		t.Fatalf("Product sent invalid reference hashes: %v", contextPayload["referenceHashes"])
	}
	if contextPayload["permissionGatewayId"] != permissionID || contextPayload["sourceOwner"] != "mail" || contextPayload["authority"] != "user-selected" {
		t.Fatalf("Product context authority metadata drifted: %v", contextPayload)
	}
}
