package mail

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type testVerifier struct{}

func (testVerifier) Verify(_ context.Context, p WalletProof) error {
	if p.Account == "" || p.Signature == "" {
		return errors.New("invalid wallet assertion")
	}
	return nil
}

type testAI struct{ unavailable bool }

func (a testAI) Status(context.Context) (string, string, string, error) {
	if a.unavailable {
		return "", "", "", errors.New("quota exhausted")
	}
	return "test-provider", "mail-safe-model", "0.002 YNXT", nil
}
func (testAI) Generate(_ context.Context, kind string, m []Message) (string, error) {
	return kind + ": " + m[0].Subject, nil
}

type blockingAI struct{ started chan struct{} }

func (blockingAI) Status(context.Context) (string, string, string, error) {
	return "test-provider", "streaming-model", "0.001 YNXT", nil
}
func (a blockingAI) Generate(ctx context.Context, _ string, _ []Message) (string, error) {
	close(a.started)
	<-ctx.Done()
	return "", ctx.Err()
}

func newTestService(t *testing.T, path string) (*Service, ed25519.PrivateKey) {
	t.Helper()
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := NewService(store, testVerifier{}, testAI{}, key)
	if err != nil {
		t.Fatal(err)
	}
	return svc, key
}
func signIn(t *testing.T, s *Service, handle, account string) (string, User, WalletProof) {
	t.Helper()
	c, err := s.NewChallenge()
	if err != nil {
		t.Fatal(err)
	}
	p := WalletProof{Account: account, Handle: handle, Product: ProductID, Scopes: []string{RequiredScope}, Challenge: c.ID, DeviceKey: "device-binding-12345", ExpiresAt: s.now().Add(time.Minute).Unix(), Signature: "verified-by-wallet"}
	token, user, err := s.SignIn(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	return token, user, p
}
func validAttachment() Attachment {
	body := []byte("bounded attachment")
	return Attachment{Name: "notes.txt", MediaType: "text/plain", Size: len(body), SHA256: digestBytes(body), ContentBase64: base64.StdEncoding.EncodeToString(body)}
}

func TestCentralWalletRequestReplayPersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mail.json")
	svc, key := newTestService(t, path)
	c, _ := svc.NewChallenge()
	central := &CentralWalletProof{AuthorizationRequest: json.RawMessage(`{"version":"1","nonce":"same"}`)}
	proof := WalletProof{Account: "ynx1central", Handle: "@central", Product: ProductID, Scopes: []string{RequiredScope}, Challenge: c.ID, DeviceKey: "device-binding-12345", ExpiresAt: svc.now().Add(time.Minute).Unix(), Signature: "verified", Central: central}
	if _, _, err := svc.SignIn(context.Background(), proof); err != nil {
		t.Fatal(err)
	}
	store, _ := NewStore(path)
	restarted, err := NewService(store, testVerifier{}, testAI{}, key)
	if err != nil {
		t.Fatal(err)
	}
	next, _ := restarted.NewChallenge()
	proof.Challenge = next.ID
	if _, _, err = restarted.SignIn(context.Background(), proof); err == nil || !strings.Contains(err.Error(), "replayed") {
		t.Fatalf("central request replay survived restart: %v", err)
	}
}

func TestPersistentDeliveryThreadSearchAndSignature(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mail.json")
	svc, key := newTestService(t, path)
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	bob, _, _ := signIn(t, svc, "@bob", "ynx1bob")
	draft, err := svc.SaveDraft(alice, Draft{To: []string{"@bob", "person@external.invalid"}, Subject: "Launch notes", Body: "Persistent signed message", Attachments: []Attachment{validAttachment()}})
	if err != nil {
		t.Fatal(err)
	}
	message, err := svc.SendDraft(alice, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(message.Deliveries) != 2 || message.Deliveries[0].State != DeliveryDelivered || message.Deliveries[1].State != DeliveryFailed || message.Deliveries[1].Reason != "internet_mail_delivery_not_supported" {
		t.Fatalf("unexpected delivery states: %+v", message.Deliveries)
	}
	if !svc.VerifySender(message) {
		t.Fatal("sender signature did not verify")
	}
	store2, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc2, err := NewService(store2, testVerifier{}, testAI{}, key)
	if err != nil {
		t.Fatal(err)
	}
	inbox, err := svc2.Inbox(bob, "inbox", "signed")
	if err != nil || len(inbox) != 1 {
		t.Fatalf("restart/search failed: %v %+v", err, inbox)
	}
	thread, err := svc2.Thread(bob, message.ThreadID)
	if err != nil || len(thread) != 1 {
		t.Fatalf("thread failed: %v", err)
	}
	replyDraft, err := svc2.SaveDraft(bob, Draft{ThreadID: message.ThreadID, To: []string{"@alice"}, Subject: "Re: Launch notes", Body: "Received"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc2.SendDraft(bob, replyDraft.ID); err != nil {
		t.Fatal(err)
	}
	thread, err = svc2.Thread(alice, message.ThreadID)
	if err != nil || len(thread) != 2 {
		t.Fatalf("reply thread not persisted: %v %d", err, len(thread))
	}
}

func TestAuthorizationReplayRecoveryAndStrictHTTP(t *testing.T) {
	svc, _ := newTestService(t, "")
	token, _, proof := signIn(t, svc, "@alice", "ynx1alice")
	if _, _, err := svc.SignIn(context.Background(), proof); err == nil || !strings.Contains(err.Error(), "replayed") {
		t.Fatalf("expected replay rejection, got %v", err)
	}
	if _, err := svc.Inbox("invalid", "inbox", ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected authorization failure, got %v", err)
	}
	c, err := svc.NewChallenge()
	if err != nil {
		t.Fatal(err)
	}
	recovery := WalletProof{Account: "ynx1alice", Handle: "@alice", Product: ProductID, Scopes: []string{RecoveryScope}, Challenge: c.ID, DeviceKey: "new-device-binding", ExpiresAt: svc.now().Add(time.Minute).Unix(), Signature: "wallet-recovery"}
	newToken, user, err := svc.Recover(context.Background(), recovery)
	if err != nil || user.RecoveredAt.IsZero() {
		t.Fatalf("recovery failed: %v", err)
	}
	if _, err = svc.Inbox(token, "inbox", ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("recovery did not revoke prior session")
	}
	if _, err = svc.Inbox(newToken, "inbox", ""); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(svc)
	req := httptest.NewRequest(http.MethodPost, "/v1/drafts", strings.NewReader(`{"to":["@alice"],"body":"ok","unexpected":true}`))
	req.Header.Set("Authorization", "Bearer "+newToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown JSON field accepted: %d", rec.Code)
	}
	health := httptest.NewRecorder()
	h.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/v1/health", nil))
	if health.Code != 200 || !strings.Contains(health.Body.String(), `"internet_delivery":false`) {
		t.Fatalf("truth boundary missing: %s", health.Body.String())
	}
}

func TestAttachmentSpamBlockRateReportAndAIApproval(t *testing.T) {
	svc, _ := newTestService(t, "")
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	bob, _, _ := signIn(t, svc, "@bob", "ynx1bob")
	bad := validAttachment()
	bad.Size++
	if _, err := svc.SaveDraft(alice, Draft{To: []string{"@bob"}, Body: "body", Attachments: []Attachment{bad}}); err == nil {
		t.Fatal("attachment tamper accepted")
	}
	tooBig := validAttachment()
	tooBig.Size = MaxAttachmentBytes + 1
	if _, err := svc.SaveDraft(alice, Draft{To: []string{"@bob"}, Body: "body", Attachments: []Attachment{tooBig}}); err == nil {
		t.Fatal("oversize attachment accepted")
	}
	spam, err := svc.SaveDraft(alice, Draft{To: []string{"@bob"}, Subject: "Free money guaranteed return", Body: "urgent transfer of seed phrase"})
	if err != nil {
		t.Fatal(err)
	}
	spamMessage, err := svc.SendDraft(alice, spam.ID)
	if err != nil {
		t.Fatal(err)
	}
	spamBox, err := svc.Inbox(bob, "spam", "")
	if err != nil || len(spamBox) != 1 {
		t.Fatalf("anti-spam routing failed: %v", err)
	}
	report, err := svc.Report(bob, spamMessage.ID, "This message requests credentials")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Appeal(alice, report.ID, "Sender requests a manual review"); err != nil {
		t.Fatal(err)
	}
	if err = svc.Block(bob, "@alice"); err != nil {
		t.Fatal(err)
	}
	blocked, err := svc.SaveDraft(alice, Draft{To: []string{"@bob"}, Body: "blocked delivery"})
	if err != nil {
		t.Fatal(err)
	}
	blockedMessage, err := svc.SendDraft(alice, blocked.ID)
	if err != nil || blockedMessage.Deliveries[0].Reason != "recipient_blocked_sender" {
		t.Fatalf("block not enforced: %v %+v", err, blockedMessage.Deliveries)
	}
	for i := 0; i < 3; i++ {
		d, e := svc.SaveDraft(alice, Draft{To: []string{"@bob"}, Body: "rate test"})
		if e != nil {
			t.Fatal(e)
		}
		_, _ = svc.SendDraft(alice, d.ID)
	}
	d, err := svc.SaveDraft(alice, Draft{To: []string{"@bob"}, Body: "sixth send"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.SendDraft(alice, d.ID); err == nil || !strings.Contains(err.Error(), "rate limit") {
		t.Fatalf("rate limit missing: %v", err)
	}
	job, err := svc.BeginAI(context.Background(), bob, "summarize", []string{spamMessage.ID})
	if err != nil || job.State != "preview" {
		t.Fatalf("AI preview failed: %v", err)
	}
	job, err = svc.ApproveAI(context.Background(), bob, job.ID)
	if err != nil || job.State != "review" {
		t.Fatalf("AI generation failed: %v", err)
	}
	if _, err = svc.ReviewAI(bob, job.ID, "apply"); err != nil {
		t.Fatal(err)
	}
	inbox, _ := svc.Inbox(bob, "inbox", "")
	if len(inbox) != 0 {
		t.Fatal("AI workflow silently sent or moved mail")
	}
	audit, err := svc.Audit(bob)
	if err != nil || len(audit) == 0 {
		t.Fatal("audit trail missing")
	}
}

func TestAIProviderFailureIsHonest(t *testing.T) {
	store, _ := NewStore("")
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	svc, _ := NewService(store, testVerifier{}, testAI{unavailable: true}, key)
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	d, _ := svc.SaveDraft(token, Draft{To: []string{"@alice"}, Body: "owned"})
	m, _ := svc.SendDraft(token, d.ID)
	if _, err := svc.BeginAI(context.Background(), token, "summarize", []string{m.ID}); err == nil || !strings.Contains(err.Error(), "quota exhausted") {
		t.Fatalf("provider failure hidden: %v", err)
	}
}

func TestDeliveryRetryAndAICancelRemainRevocable(t *testing.T) {
	svc, _ := newTestService(t, "")
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	draft, _ := svc.SaveDraft(alice, Draft{To: []string{"@later"}, Subject: "Retry", Body: "wait for recipient"})
	message, err := svc.SendDraft(alice, draft.ID)
	if err != nil || message.Deliveries[0].Reason != "unknown_ynx_recipient" {
		t.Fatal("expected initial delivery failure")
	}
	signIn(t, svc, "@later", "ynx1later")
	message, err = svc.RetryDelivery(alice, message.ID, "@later")
	if err != nil || message.Deliveries[0].State != DeliveryDelivered {
		t.Fatalf("delivery retry failed: %v %+v", err, message.Deliveries)
	}
	store, _ := NewStore("")
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	blocked := blockingAI{started: make(chan struct{})}
	aiSvc, _ := NewService(store, testVerifier{}, blocked, key)
	token, _, _ := signIn(t, aiSvc, "@owner", "ynx1owner")
	d, _ := aiSvc.SaveDraft(token, Draft{To: []string{"@owner"}, Subject: "Cancel", Body: "bounded"})
	m, _ := aiSvc.SendDraft(token, d.ID)
	job, err := aiSvc.BeginAI(context.Background(), token, "summarize", []string{m.ID})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _, _ = aiSvc.ApproveAI(context.Background(), token, job.ID); close(done) }()
	<-blocked.started
	cancelled, err := aiSvc.ReviewAI(token, job.ID, "cancel")
	if err != nil || cancelled.State != "cancelled" {
		t.Fatalf("AI cancel failed: %v %+v", err, cancelled)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("AI provider context was not cancelled")
	}
	final, err := aiSvc.AIJob(token, job.ID)
	if err != nil || final.State != "cancelled" {
		t.Fatalf("late provider result overwrote cancel: %v %+v", err, final)
	}
}
