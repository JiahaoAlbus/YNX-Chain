package aiproduct

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const testGatewayKey = "test-ai-gateway-key-material"

type testIdentity struct {
	account       string
	accountKey    *secp256k1.PrivateKey
	deviceID      string
	devicePublic  ed25519.PublicKey
	devicePrivate ed25519.PrivateKey
}

func newTestIdentity(t *testing.T) testIdentity {
	t.Helper()
	accountKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 83))
	canonical, err := consensus.NativeAddress(accountKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	account, err := accountaddress.Encode(canonical)
	if err != nil {
		t.Fatal(err)
	}
	devicePublic, devicePrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return testIdentity{account: account, accountKey: accountKey, deviceID: "browser-device-01", devicePublic: devicePublic, devicePrivate: devicePrivate}
}

func newGatewayFixture(t *testing.T, available bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/health" && r.Header.Get("X-YNX-AI-Key") != testGatewayKey {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == "/health":
			if !available {
				w.WriteHeader(http.StatusBadGateway)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": available, "model": "ynx-test-model", "providerConfigured": available, "truthfulStatus": "provider-backed"})
		case r.URL.Path == "/ai/stream":
			if !available {
				http.Error(w, "provider unavailable", http.StatusBadGateway)
				return
			}
			if r.Method != http.MethodPost || r.URL.RawQuery != "" {
				t.Errorf("sensitive prompt stream must use POST body without query, method=%s query=%q", r.Method, r.URL.RawQuery)
			}
			var streamRequest map[string]any
			if err := json.NewDecoder(r.Body).Decode(&streamRequest); err != nil || streamRequest["prompt"] == "" || streamRequest["outputLanguage"] == "" {
				t.Errorf("invalid POST stream body: %+v err=%v", streamRequest, err)
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "event: metadata\ndata: {\"requestId\":\"gateway-request-1\"}\n\nevent: token\ndata: {\"text\":\"real provider \"}\n\nevent: token\ndata: {\"text\":\"answer\"}\n\nevent: done\ndata: {}\n\n")
		case r.URL.Path == "/ai/permissions":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "gateway-permission-1", "status": "active"})
		case r.URL.Path == "/ai/actions":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "gateway-action-1", "status": "pending", "executable": false})
		case strings.HasSuffix(r.URL.Path, "/approve"):
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "gateway-action-1", "status": "approved", "executable": true})
		case strings.HasSuffix(r.URL.Path, "/reject"):
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "gateway-action-1", "status": "rejected", "executable": false})
		default:
			http.NotFound(w, r)
		}
	}))
}

func testProduct(t *testing.T, gateway string) (*Store, *httptest.Server) {
	t.Helper()
	key := bytes.Repeat([]byte{9}, 32)
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Config{GatewayURL: gateway, GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback, TrustURL: "https://trust.example/appeals", ProviderName: "fixture provider", GenerationTimeout: 2 * time.Second, AllowLocalFixtureAuth: true}, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	return store, httptest.NewServer(server.Handler())
}

func authenticate(t *testing.T, productURL string, store *Store, identity testIdentity) SessionOutput {
	t.Helper()
	out, err := store.CreateWalletChallenge(ChallengeInput{Account: identity.account, DeviceID: identity.deviceID, DeviceSigningPublicKey: nativewallet.EncodePublicKey(identity.devicePublic), Callback: "ynx-ai://com.ynxweb4.ai/auth/callback", Scopes: []string{"ai:conversations", "ai:generate", "ai:permissions", "ai:data-control"}}, "ynx-ai://com.ynxweb4.ai/auth/callback")
	if err != nil {
		t.Fatal(err)
	}
	signBytes, _ := base64.RawStdEncoding.DecodeString(out.SignBytes)
	digest := sha256.Sum256(signBytes)
	accountSignature := ecdsa.Sign(identity.accountKey, digest[:]).Serialize()
	session, err := store.VerifyWalletChallenge(out.ChallengeID, VerifyInput{AccountPublicKey: hex.EncodeToString(identity.accountKey.PubKey().SerializeCompressed()), AccountSignature: hex.EncodeToString(accountSignature), DeviceSignature: nativewallet.Sign(identity.devicePrivate, signBytes)})
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func authedJSON(t *testing.T, method, rawURL string, body any, session SessionOutput, want int) []byte {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, rawURL, reader)
	req.Header.Set("Authorization", "Bearer "+session.Token)
	req.Header.Set("X-YNX-Device-ID", session.DeviceID)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != want {
		t.Fatalf("%s %s status=%d want=%d body=%s", method, rawURL, resp.StatusCode, want, raw)
	}
	return raw
}

func TestWalletChallengeIsExactSingleUseAndRevocable(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	identity := newTestIdentity(t)
	if _, err := store.CreateWalletChallenge(ChallengeInput{Account: identity.account, DeviceID: identity.deviceID, DeviceSigningPublicKey: nativewallet.EncodePublicKey(identity.devicePublic), Callback: "ynx-ai://attacker/callback", Scopes: []string{"ai:conversations"}}, "ynx-ai://com.ynxweb4.ai/auth/callback"); err == nil {
		t.Fatal("callback substitution was accepted")
	}
	out, err := store.CreateWalletChallenge(ChallengeInput{Account: identity.account, DeviceID: identity.deviceID, DeviceSigningPublicKey: nativewallet.EncodePublicKey(identity.devicePublic), Callback: "ynx-ai://com.ynxweb4.ai/auth/callback", Scopes: []string{"ai:conversations"}}, "ynx-ai://com.ynxweb4.ai/auth/callback")
	if err != nil {
		t.Fatal(err)
	}
	signBytes, _ := base64.RawStdEncoding.DecodeString(out.SignBytes)
	digest := sha256.Sum256(signBytes)
	sig := ecdsa.Sign(identity.accountKey, digest[:]).Serialize()
	verify := VerifyInput{AccountPublicKey: hex.EncodeToString(identity.accountKey.PubKey().SerializeCompressed()), AccountSignature: hex.EncodeToString(sig), DeviceSignature: nativewallet.Sign(identity.devicePrivate, signBytes)}
	session, err := store.VerifyWalletChallenge(out.ChallengeID, verify)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyWalletChallenge(out.ChallengeID, verify); err == nil {
		t.Fatal("challenge replay was accepted")
	}
	authedJSON(t, http.MethodGet, product.URL+"/api/provider", nil, session, http.StatusForbidden)
	if err := store.RevokeSession("Bearer "+session.Token, session.DeviceID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(session.Token, session.DeviceID); err == nil {
		t.Fatal("revoked session remained active")
	}
}

func TestProductionModeFailsClosedWithoutCanonicalAuth(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{4}, 32))
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Config{GatewayURL: gateway.URL, GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback}, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	product := httptest.NewServer(server.Handler())
	defer product.Close()
	for _, path := range []string{"/api/auth/challenges", "/api/auth/wallet/requests", "/api/auth/wallet/approvals", "/api/auth/wallet/sessions"} {
		response, err := http.Post(product.URL+path, "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusMethodNotAllowed && response.StatusCode != http.StatusNotFound {
			t.Fatalf("local fixture auth route %s was exposed in production mode: %d", path, response.StatusCode)
		}
	}
	meta, err := http.Get(product.URL + "/api/meta")
	if err != nil {
		t.Fatal(err)
	}
	defer meta.Body.Close()
	raw, _ := io.ReadAll(meta.Body)
	if !bytes.Contains(raw, []byte(`"localFixtureAuthEnabled":false`)) || !bytes.Contains(raw, []byte(`"integratedCentral":false`)) {
		t.Fatalf("meta did not disclose fail-closed auth boundary: %s", raw)
	}
}

func TestProviderBackedConversationPersistsEncryptedAndExports(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	raw := authedJSON(t, http.MethodPost, product.URL+"/api/conversations", map[string]any{"title": "Chain state"}, session, http.StatusCreated)
	var conversation Conversation
	_ = json.Unmarshal(raw, &conversation)
	raw = authedJSON(t, http.MethodPost, product.URL+"/api/conversations/"+conversation.ID+"/generate", map[string]any{"generationId": "generation-1", "prompt": "Explain the selected block", "model": "ynx-test-model", "includedContext": []string{"conversation"}, "excludedContext": []string{"selected_files"}}, session, http.StatusOK)
	if !bytes.Contains(raw, []byte("real provider")) || !bytes.Contains(raw, []byte("event: done")) {
		t.Fatalf("missing provider stream: %s", raw)
	}
	_, messages, err := store.Conversation(session.Account, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[1].Content != "real provider answer" || messages[1].RequestID != "gateway-request-1" || messages[1].Cost.ActualUsageReported {
		t.Fatalf("unexpected messages: %+v", messages)
	}
	stateRaw, _ := os.ReadFile(store.path)
	if bytes.Contains(stateRaw, []byte("Explain the selected block")) || bytes.Contains(stateRaw, []byte("real provider answer")) {
		t.Fatalf("state leaked plaintext: %s", stateRaw)
	}
	export := authedJSON(t, http.MethodGet, product.URL+"/api/conversations/"+conversation.ID+"/export", nil, session, http.StatusOK)
	if !bytes.Contains(export, []byte("real provider answer")) {
		t.Fatalf("export missing decrypted user-selected content: %s", export)
	}
}

func TestUnavailableProviderNeverCreatesCannedAnswer(t *testing.T) {
	gateway := newGatewayFixture(t, false)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	raw := authedJSON(t, http.MethodPost, product.URL+"/api/conversations", map[string]any{"title": "Unavailable"}, session, http.StatusCreated)
	var conversation Conversation
	_ = json.Unmarshal(raw, &conversation)
	raw = authedJSON(t, http.MethodPost, product.URL+"/api/conversations/"+conversation.ID+"/generate", map[string]any{"generationId": "generation-fail", "prompt": "Answer me", "includedContext": []string{"conversation"}}, session, http.StatusBadGateway)
	if !bytes.Contains(raw, []byte("no substitute answer")) {
		t.Fatalf("failure boundary is not explicit: %s", raw)
	}
	_, messages, err := store.Conversation(session.Account, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 0 {
		t.Fatalf("unavailable provider persisted synthetic messages: %+v", messages)
	}
}

func TestProviderQuotaFailurePreserves429AndCreatesNoMessages(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"ok":false,"error":"provider quota exhausted"}`)
	}))
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	provider := authedJSON(t, http.MethodGet, product.URL+"/api/provider", nil, session, http.StatusTooManyRequests)
	if !bytes.Contains(provider, []byte("rate_limited")) || !bytes.Contains(provider, []byte("429")) {
		t.Fatalf("provider quota status is not truthful: %s", provider)
	}
	raw := authedJSON(t, http.MethodPost, product.URL+"/api/conversations", map[string]any{"title": "Quota"}, session, http.StatusCreated)
	var conversation Conversation
	_ = json.Unmarshal(raw, &conversation)
	failure := authedJSON(t, http.MethodPost, product.URL+"/api/conversations/"+conversation.ID+"/generate", map[string]any{"generationId": "generation-quota", "prompt": "Answer me", "includedContext": []string{"conversation"}}, session, http.StatusTooManyRequests)
	if !bytes.Contains(failure, []byte("quota reached (429)")) || !bytes.Contains(failure, []byte("no substitute answer")) {
		t.Fatalf("quota failure boundary is not explicit: %s", failure)
	}
	_, messages, err := store.Conversation(session.Account, conversation.ID)
	if err != nil || len(messages) != 0 {
		t.Fatalf("quota failure persisted synthetic messages: %+v err=%v", messages, err)
	}
}

func TestActionApprovalRecordsReviewButNeverExecution(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	permissionRaw := authedJSON(t, http.MethodPost, product.URL+"/api/permissions", map[string]any{"conversationId": "conv-review", "scope": "chain:transfer-draft", "purpose": "review exact transfer draft", "expiryHours": 1}, session, http.StatusCreated)
	var permission PermissionRecord
	_ = json.Unmarshal(permissionRaw, &permission)
	actionRaw := authedJSON(t, http.MethodPost, product.URL+"/api/actions", map[string]any{"conversationId": "conv-review", "kind": "chain_action", "scope": "chain:transfer-draft", "description": "Transfer 1 YNXT to selected account", "payloadPreview": "to=ynx1recipient amount=1 YNXT", "target": "ynx1recipient", "risk": "high", "evidence": []string{"conversation:conv-review", "user-entered:exact-payload"}, "provider": "YNX AI Gateway"}, session, http.StatusCreated)
	var action ActionRecord
	_ = json.Unmarshal(actionRaw, &action)
	review := authedJSON(t, http.MethodPost, product.URL+"/api/actions/"+action.ID+"/review", map[string]any{"decision": "approve", "permissionGatewayId": permission.GatewayID}, session, http.StatusOK)
	if !bytes.Contains(review, []byte("approved_not_executed")) || !bytes.Contains(review, []byte("open YNX Wallet")) {
		t.Fatalf("approval blurred execution boundary: %s", review)
	}
	record, ok := store.Action(session.Account, action.ID)
	if !ok || record.Status != "approved_not_executed" || !record.WalletStillNeeded || record.Target != "ynx1recipient" || record.Risk != "high" || len(record.Evidence) != 2 {
		t.Fatalf("unexpected action record: %+v", record)
	}
}

func TestActionApprovalRejectsMismatchedOrExpiredPermission(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	permissionRaw := authedJSON(t, http.MethodPost, product.URL+"/api/permissions", map[string]any{"conversationId": "conv-other", "scope": "read:selected", "purpose": "read another conversation", "expiryHours": 1}, session, http.StatusCreated)
	var permission PermissionRecord
	_ = json.Unmarshal(permissionRaw, &permission)
	actionRaw := authedJSON(t, http.MethodPost, product.URL+"/api/actions", map[string]any{"conversationId": "conv-review", "kind": "tool", "scope": "read:selected", "description": "Read selected item", "payloadPreview": "id=1", "target": "record:1", "risk": "low", "provider": "YNX AI Gateway"}, session, http.StatusCreated)
	var action ActionRecord
	_ = json.Unmarshal(actionRaw, &action)
	authedJSON(t, http.MethodPost, product.URL+"/api/actions/"+action.ID+"/review", map[string]any{"decision": "approve", "permissionGatewayId": permission.GatewayID}, session, http.StatusForbidden)

	permission.SessionID = "conv-review"
	permission.ExpiresAt = time.Now().Add(-time.Minute)
	if err := store.SavePermission(permission); err != nil {
		t.Fatal(err)
	}
	authedJSON(t, http.MethodPost, product.URL+"/api/actions/"+action.ID+"/review", map[string]any{"decision": "approve", "permissionGatewayId": permission.GatewayID}, session, http.StatusForbidden)
}

func TestAttachmentsRequireExplicitSelectedFilesContext(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	conversationRaw := authedJSON(t, http.MethodPost, product.URL+"/api/conversations", map[string]any{"title": "Files"}, session, http.StatusCreated)
	var conversation Conversation
	_ = json.Unmarshal(conversationRaw, &conversation)
	if _, err := store.SetPolicy(session.Account, DataPolicy{RetentionDays: 30, SaveEncryptedBody: true, AllowedContextTypes: []string{"conversation", "selected_files"}}); err != nil {
		t.Fatal(err)
	}
	attachment, err := store.AddAttachment(session.Account, conversation.ID, "evidence.txt", "text/plain", []byte("selected evidence"))
	if err != nil {
		t.Fatal(err)
	}
	authedJSON(t, http.MethodPost, product.URL+"/api/conversations/"+conversation.ID+"/generate", map[string]any{"generationId": "files-without-context", "prompt": "Summarize", "includedContext": []string{"conversation"}, "attachmentIds": []string{attachment.ID}}, session, http.StatusBadRequest)
	_, messages, err := store.Conversation(session.Account, conversation.ID)
	if err != nil || len(messages) != 0 {
		t.Fatalf("rejected attachment context persisted messages: %+v err=%v", messages, err)
	}
}

func TestConversationSearchAndEncryptedBranch(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	raw := authedJSON(t, http.MethodPost, product.URL+"/api/conversations", map[string]any{"title": "Alpha research"}, session, http.StatusCreated)
	var conversation Conversation
	_ = json.Unmarshal(raw, &conversation)
	first, err := store.AddMessage(session.Account, conversation.ID, Message{Role: "user", Content: "private beta evidence", Status: "complete"})
	if err != nil {
		t.Fatal(err)
	}
	if got := authedJSON(t, http.MethodGet, product.URL+"/api/conversations?q=beta", nil, session, http.StatusOK); !bytes.Contains(got, []byte(conversation.ID)) {
		t.Fatalf("message search did not find encrypted content: %s", got)
	}
	branchRaw := authedJSON(t, http.MethodPost, product.URL+"/api/conversations/"+conversation.ID+"/branch", map[string]any{"throughMessageId": first.ID, "title": "Beta branch"}, session, http.StatusCreated)
	var branch Conversation
	_ = json.Unmarshal(branchRaw, &branch)
	if branch.ID == conversation.ID || branch.MessageCount != 1 {
		t.Fatalf("unexpected branch: %+v", branch)
	}
	_, messages, err := store.Conversation(session.Account, branch.ID)
	if err != nil || len(messages) != 1 || messages[0].Content != "private beta evidence" || messages[0].ID == first.ID {
		t.Fatalf("branched messages are not independent: %+v err=%v", messages, err)
	}
	state, _ := os.ReadFile(store.path)
	if bytes.Contains(state, []byte("private beta evidence")) {
		t.Fatal("branch leaked plaintext into persistent state")
	}
}

func TestActionPreviewRequiresRiskTargetEvidenceBounds(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	base := map[string]any{"conversationId": "conv-review", "kind": "tool", "scope": "read:selected", "description": "Read selected item", "payloadPreview": "id=1", "target": "record:1", "risk": "invalid", "provider": "YNX AI Gateway"}
	authedJSON(t, http.MethodPost, product.URL+"/api/actions", base, session, http.StatusBadRequest)
	base["risk"] = "low"
	base["target"] = ""
	authedJSON(t, http.MethodPost, product.URL+"/api/actions", base, session, http.StatusBadRequest)
	base["target"] = "record:1"
	base["provider"] = ""
	authedJSON(t, http.MethodPost, product.URL+"/api/actions", base, session, http.StatusBadRequest)
}

func TestContextPolicyDeletionAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	key := bytes.Repeat([]byte{5}, 32)
	store, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	identity := newTestIdentity(t)
	conversation, err := store.CreateConversation(identity.account, "Retention")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetPolicy(identity.account, DataPolicy{RetentionDays: 7, SaveEncryptedBody: true, AllowedContextTypes: []string{"conversation"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(identity.account, conversation.ID, Message{Role: "user", Content: "restart secret", Status: "complete"}); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	_, messages, err := restarted.Conversation(identity.account, conversation.ID)
	if err != nil || len(messages) != 1 || messages[0].Content != "restart secret" {
		t.Fatalf("restart mismatch messages=%+v err=%v", messages, err)
	}
	if err := restarted.DeleteAccount(identity.account); err != nil {
		t.Fatal(err)
	}
	if _, _, err := restarted.Conversation(identity.account, conversation.ID); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("account deletion left conversation: %v", err)
	}
}

func TestCancelEndpointCancelsRegisteredGeneration(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	// Unknown or already-finished generation IDs fail closed instead of claiming cancellation.
	authedJSON(t, http.MethodPost, product.URL+"/api/generations/not-active/cancel", nil, session, http.StatusNotFound)
	ctx, cancel := context.WithCancel(context.Background())
	service := &Server{generations: map[string]context.CancelFunc{"active-generation": cancel}}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/generations/active-generation/cancel", nil)
	req.SetPathValue("id", "active-generation")
	service.handleCancel(recorder, req, ProductSession{Account: session.Account})
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("active cancel status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("cancel endpoint did not cancel the active generation context")
	}
}
