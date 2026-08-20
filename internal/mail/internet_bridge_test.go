package mail

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestResendBridgeSubmissionWebhookReplayAndTruthStates(t *testing.T) {
	apiKey := "unit" + "-test" + "-credential-reference"
	var requestMu sync.Mutex
	var submitted map[string]any
	var idempotencyKey string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/emails" {
			t.Errorf("unexpected provider request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+apiKey {
			t.Error("provider authorization header missing")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		requestMu.Lock()
		defer requestMu.Unlock()
		idempotencyKey = r.Header.Get("Idempotency-Key")
		if err := json.NewDecoder(r.Body).Decode(&submitted); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"provider-message-1"}`))
	}))
	defer provider.Close()

	now := time.Now().UTC().Truncate(time.Second)
	secret := testWebhookSecret()
	path := filepath.Join(t.TempDir(), "mail.json")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_, signer, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	bridge := ResendBridge{
		BaseURL:       provider.URL,
		APIKey:        apiKey,
		From:          "YNX Mail <mail@ynxweb4.com>",
		WebhookSecret: secret,
		Client:        provider.Client(),
	}
	svc, err := NewServiceWithInternetBridge(store, testVerifier{}, testAI{}, bridge, signer)
	if err != nil {
		t.Fatal(err)
	}
	svc.now = func() time.Time { return now }
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	draft, err := svc.SaveDraft(token, Draft{
		To:          []string{"person@example.net"},
		Subject:     "Provider truth",
		Body:        "A provider acceptance is not a read receipt.",
		Attachments: []Attachment{validAttachment()},
	})
	if err != nil {
		t.Fatal(err)
	}
	message, err := svc.SendDraftContext(context.Background(), token, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(message.Deliveries) != 1 {
		t.Fatalf("unexpected deliveries: %+v", message.Deliveries)
	}
	delivery := message.Deliveries[0]
	if delivery.Channel != "internet_provider" || delivery.Provider != resendProviderName || delivery.ProviderMessageID != "provider-message-1" || delivery.State != DeliveryProviderAccepted || delivery.Attempt != 1 {
		t.Fatalf("provider acceptance truth mismatch: %+v", delivery)
	}
	requestMu.Lock()
	if idempotencyKey == "" || !strings.HasSuffix(idempotencyKey, "/1") {
		t.Fatalf("missing stable first-attempt idempotency key: %q", idempotencyKey)
	}
	to, _ := submitted["to"].([]any)
	if len(to) != 1 || to[0] != "person@example.net" || submitted["from"] != "YNX Mail <mail@ynxweb4.com>" {
		t.Fatalf("unexpected provider payload: %+v", submitted)
	}
	requestMu.Unlock()

	handler := NewHandler(svc)
	deliveredAt := now.Add(2 * time.Second)
	deliveredBody := []byte(`{"type":"email.delivered","created_at":"` + deliveredAt.Format(time.RFC3339Nano) + `","data":{"email_id":"provider-message-1","to":["person@example.net"]}}`)
	deliveredReq := signedWebhookRequest(t, secret, "event-delivered-1", now, deliveredBody)
	deliveredRec := httptest.NewRecorder()
	handler.ServeHTTP(deliveredRec, deliveredReq)
	if deliveredRec.Code != http.StatusOK || !strings.Contains(deliveredRec.Body.String(), `"matched":true`) {
		t.Fatalf("delivery webhook failed: %d %s", deliveredRec.Code, deliveredRec.Body.String())
	}
	message = sentMessage(t, svc, token)
	delivery = message.Deliveries[0]
	if delivery.State != DeliveryDelivered || delivery.LastProviderEvent != "email.delivered" {
		t.Fatalf("mail-server delivery was not applied: %+v", delivery)
	}

	openedBody := []byte(`{"type":"email.opened","created_at":"` + now.Add(3*time.Second).Format(time.RFC3339Nano) + `","data":{"email_id":"provider-message-1"}}`)
	openedRec := httptest.NewRecorder()
	handler.ServeHTTP(openedRec, signedWebhookRequest(t, secret, "event-opened-1", now, openedBody))
	if openedRec.Code != http.StatusOK {
		t.Fatalf("opened webhook rejected: %d %s", openedRec.Code, openedRec.Body.String())
	}
	if got := sentMessage(t, svc, token).Deliveries[0]; got.State != DeliveryDelivered || got.LastProviderEvent != "email.delivered" {
		t.Fatalf("engagement signal mutated authoritative delivery/read state: %+v", got)
	}

	sentBody := []byte(`{"type":"email.sent","created_at":"` + now.Add(time.Second).Format(time.RFC3339Nano) + `","data":{"email_id":"provider-message-1"}}`)
	sentRec := httptest.NewRecorder()
	handler.ServeHTTP(sentRec, signedWebhookRequest(t, secret, "event-sent-late-arrival", now, sentBody))
	if got := sentMessage(t, svc, token).Deliveries[0]; got.State != DeliveryDelivered {
		t.Fatalf("out-of-order webhook downgraded state: %+v", got)
	}

	bounceBody := []byte(`{"type":"email.bounced","created_at":"` + now.Add(4*time.Second).Format(time.RFC3339Nano) + `","data":{"email_id":"provider-message-1","bounce":{"message":"smtp; 550 mailbox unavailable"}}}`)
	bounceRec := httptest.NewRecorder()
	handler.ServeHTTP(bounceRec, signedWebhookRequest(t, secret, "event-bounced-1", now, bounceBody))
	if got := sentMessage(t, svc, token).Deliveries[0]; got.State != DeliveryBounced || !strings.Contains(got.Reason, "550") {
		t.Fatalf("bounce truth was not applied: %+v", got)
	}

	restartedStore, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := NewServiceWithInternetBridge(restartedStore, testVerifier{}, testAI{}, bridge, signer)
	if err != nil {
		t.Fatal(err)
	}
	restarted.now = func() time.Time { return now }
	replayRec := httptest.NewRecorder()
	NewHandler(restarted).ServeHTTP(replayRec, signedWebhookRequest(t, secret, "event-bounced-1", now, bounceBody))
	if replayRec.Code != http.StatusOK || !strings.Contains(replayRec.Body.String(), `"duplicate":true`) {
		t.Fatalf("persistent webhook replay gate failed: %d %s", replayRec.Code, replayRec.Body.String())
	}

	invalid := signedWebhookRequest(t, secret, "event-invalid", now, deliveredBody)
	invalid.Header.Set("Svix-Signature", "v1,"+base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0}, sha256.Size)))
	invalidRec := httptest.NewRecorder()
	NewHandler(restarted).ServeHTTP(invalidRec, invalid)
	if invalidRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid webhook signature accepted: %d %s", invalidRec.Code, invalidRec.Body.String())
	}
}

func TestResendProviderFailureAndRetryUseDistinctIdempotencyAttempts(t *testing.T) {
	apiKey := "unit" + "-test" + "-credential-reference"
	var mu sync.Mutex
	var keys []string
	attempt := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		attempt++
		keys = append(keys, r.Header.Get("Idempotency-Key"))
		if attempt == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"message":"rate limited"}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"provider-message-retry"}`))
	}))
	defer provider.Close()

	store, _ := NewStore("")
	_, signer, _ := ed25519.GenerateKey(rand.Reader)
	bridge := ResendBridge{BaseURL: provider.URL, APIKey: apiKey, From: "mail@ynxweb4.com", WebhookSecret: testWebhookSecret(), Client: provider.Client()}
	svc, _ := NewServiceWithInternetBridge(store, testVerifier{}, testAI{}, bridge, signer)
	token, _, _ := signIn(t, svc, "@retry", "ynx1retry")
	draft, _ := svc.SaveDraft(token, Draft{To: []string{"retry@example.net"}, Subject: "Retry", Body: "Provider retry"})
	message, err := svc.SendDraft(token, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if message.Deliveries[0].State != DeliveryFailed || message.Deliveries[0].Reason != "provider_rate_limited" || message.Deliveries[0].Attempt != 1 {
		t.Fatalf("provider failure was hidden: %+v", message.Deliveries[0])
	}
	if health := svc.InternetBridgeHealth(); health.State != "rate_limited" || health.OpenDeadLetters != 1 || health.ConsecutiveFailures != 1 {
		t.Fatalf("provider health did not expose failure truth: %+v", health)
	}
	letters, err := svc.DeadLetters(token)
	if err != nil || len(letters) != 1 || letters[0].State != "open" || letters[0].Reason != "provider_rate_limited" {
		t.Fatalf("dead letter not recorded: %v %+v", err, letters)
	}
	message, err = svc.RetryDelivery(token, message.ID, "retry@example.net")
	if err != nil {
		t.Fatal(err)
	}
	if message.Deliveries[0].State != DeliveryProviderAccepted || message.Deliveries[0].Attempt != 2 || message.Deliveries[0].ProviderMessageID != "provider-message-retry" {
		t.Fatalf("provider retry failed: %+v", message.Deliveries[0])
	}
	if health := svc.InternetBridgeHealth(); health.State != "submission_accepted_local_evidence" || health.OpenDeadLetters != 0 || health.ConsecutiveFailures != 0 {
		t.Fatalf("provider health did not recover after acceptance: %+v", health)
	}
	letters, err = svc.DeadLetters(token)
	if err != nil || len(letters) != 1 || letters[0].State != "resolved" {
		t.Fatalf("dead letter was not resolved: %v %+v", err, letters)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(keys) != 2 || keys[0] == keys[1] || !strings.HasSuffix(keys[0], "/1") || !strings.HasSuffix(keys[1], "/2") {
		t.Fatalf("retry idempotency attempts are unsafe: %+v", keys)
	}
}

func TestComplaintSuppressesFutureSubmissionAndQueuesRecovery(t *testing.T) {
	apiKey := "unit" + "-test" + "-credential-reference"
	var mu sync.Mutex
	providerCalls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		providerCalls++
		call := providerCalls
		mu.Unlock()
		_, _ = w.Write([]byte(`{"id":"provider-complaint-` + strconv.Itoa(call) + `"}`))
	}))
	defer provider.Close()

	now := time.Now().UTC().Truncate(time.Second)
	store, _ := NewStore("")
	_, signer, _ := ed25519.GenerateKey(rand.Reader)
	bridge := ResendBridge{BaseURL: provider.URL, APIKey: apiKey, From: "mail@ynxweb4.com", WebhookSecret: testWebhookSecret(), Client: provider.Client()}
	svc, _ := NewServiceWithInternetBridge(store, testVerifier{}, testAI{}, bridge, signer)
	svc.now = func() time.Time { return now }
	token, _, _ := signIn(t, svc, "@suppression", "ynx1suppression")

	firstDraft, _ := svc.SaveDraft(token, Draft{To: []string{"complaint@example.net"}, Subject: "First", Body: "First send"})
	first, err := svc.SendDraft(token, firstDraft.ID)
	if err != nil || first.Deliveries[0].State != DeliveryProviderAccepted {
		t.Fatalf("initial provider submission failed: %v %+v", err, first.Deliveries)
	}
	complaintBody := []byte(`{"type":"email.complained","created_at":"` + now.Add(time.Second).Format(time.RFC3339Nano) + `","data":{"email_id":"provider-complaint-1"}}`)
	complaintRec := httptest.NewRecorder()
	NewHandler(svc).ServeHTTP(complaintRec, signedWebhookRequest(t, bridge.WebhookSecret, "event-complaint-1", now, complaintBody))
	if complaintRec.Code != http.StatusOK {
		t.Fatalf("complaint webhook failed: %d %s", complaintRec.Code, complaintRec.Body.String())
	}
	if health := svc.InternetBridgeHealth(); health.ActiveSuppressions != 1 || health.OpenDeadLetters != 1 || health.LastVerifiedWebhookAt.IsZero() {
		t.Fatalf("suppression health evidence missing: %+v", health)
	}

	secondDraft, _ := svc.SaveDraft(token, Draft{To: []string{"complaint@example.net"}, Subject: "Blocked", Body: "Must not submit"})
	second, err := svc.SendDraft(token, secondDraft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if second.Deliveries[0].State != DeliveryFailed || second.Deliveries[0].Reason != "recipient_suppressed" {
		t.Fatalf("suppressed recipient was not blocked: %+v", second.Deliveries[0])
	}
	mu.Lock()
	calls := providerCalls
	mu.Unlock()
	if calls != 1 {
		t.Fatalf("suppressed recipient reached provider: %d calls", calls)
	}
	letters, err := svc.DeadLetters(token)
	if err != nil || len(letters) != 2 {
		t.Fatalf("recovery queue mismatch: %v %+v", err, letters)
	}
	for _, letter := range letters {
		if letter.RecipientHash == "" || letter.State == "resolved" {
			t.Fatalf("unsafe or incorrectly resolved dead letter: %+v", letter)
		}
	}
}

func TestDeadLetterQueueIsBounded(t *testing.T) {
	st := emptyState()
	base := time.Now().UTC()
	for i := 0; i < maxDeadLetters+5; i++ {
		state := "open"
		if i < 3 {
			state = "resolved"
		}
		st.DeadLetters[strconv.Itoa(i)] = DeadLetter{ID: strconv.Itoa(i), State: state, UpdatedAt: base.Add(time.Duration(i) * time.Second)}
	}
	pruneDeadLetters(&st)
	if len(st.DeadLetters) != maxDeadLetters {
		t.Fatalf("dead-letter queue is unbounded: %d", len(st.DeadLetters))
	}
	if _, exists := st.DeadLetters["0"]; exists {
		t.Fatal("oldest resolved dead letter was not pruned first")
	}
}

func TestResendWebhookRejectsStaleTimestamp(t *testing.T) {
	bridge := ResendBridge{WebhookSecret: testWebhookSecret()}
	now := time.Now().UTC().Truncate(time.Second)
	body := []byte(`{"type":"email.delivered","created_at":"` + now.Format(time.RFC3339Nano) + `","data":{"email_id":"message"}}`)
	req := signedWebhookRequest(t, bridge.WebhookSecret, "stale-event", now.Add(-10*time.Minute), body)
	if _, err := bridge.VerifyWebhook(req.Header, body, now); err == nil || !strings.Contains(err.Error(), "outside tolerance") {
		t.Fatalf("stale webhook accepted: %v", err)
	}
}

func sentMessage(t *testing.T, svc *Service, token string) Message {
	t.Helper()
	messages, err := svc.Inbox(token, "sent", "")
	if err != nil || len(messages) != 1 {
		t.Fatalf("sent message lookup failed: %v %+v", err, messages)
	}
	return messages[0]
}

func testWebhookSecret() string {
	key := bytes.Repeat([]byte{0x42}, sha256.Size)
	return "wh" + "sec_" + base64.RawStdEncoding.EncodeToString(key)
}

func signedWebhookRequest(t *testing.T, secret, eventID string, attemptAt time.Time, body []byte) *http.Request {
	t.Helper()
	key, err := decodeWebhookSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	timestamp := strconv.FormatInt(attemptAt.Unix(), 10)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(eventID + "." + timestamp + "."))
	_, _ = mac.Write(body)
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	req := httptest.NewRequest(http.MethodPost, "/v1/providers/resend/webhook", bytes.NewReader(body))
	req.Header.Set("Svix-Id", eventID)
	req.Header.Set("Svix-Timestamp", timestamp)
	req.Header.Set("Svix-Signature", "v1,"+signature)
	return req
}
