package mail

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCanonicalMailOutboxIsTransactionalPrivatePersistentAndAcknowledged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mail.json")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_, signer, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := NewServiceWithOptions(store, testVerifier{}, testAI{}, signer, ServiceOptions{SourceCommit: "source-commit-data-fabric-test"})
	if err != nil {
		t.Fatal(err)
	}
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice-private")
	signIn(t, svc, "@bob", "ynx1bob-private")
	attachment := validAttachment()
	attachment.Name = "confidential-plan.txt"
	draft, err := svc.SaveDraft(alice, Draft{
		To:          []string{"@bob", "private-recipient@example.net"},
		Subject:     "confidential subject",
		Body:        "secret body that must never enter canonical events",
		Attachments: []Attachment{attachment},
	})
	if err != nil {
		t.Fatal(err)
	}
	message, err := svc.SendDraft(alice, draft.ID)
	if err != nil {
		t.Fatal(err)
	}

	adapter, err := NewDataFabricAdapter(store)
	if err != nil {
		t.Fatal(err)
	}
	batch, err := adapter.ReadBatch(100)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Events) != 3 {
		t.Fatalf("expected send, native delivery and failed internet delivery events, got %+v", batch.Events)
	}
	wantTypes := []string{EventMailSendApproved, EventMailNativeDelivered, EventMailInternetFailed}
	for i, event := range batch.Events {
		if event.Sequence != uint64(i+1) || event.Type != wantTypes[i] {
			t.Fatalf("unexpected canonical sequence/type at %d: %+v", i, event)
		}
		if event.Product != ProductID || event.Owner != CanonicalMailEventOwner || event.SourceCommit != "source-commit-data-fabric-test" || event.PrivacyClass != "operational_metadata" || event.UserReadClaimed {
			t.Fatalf("canonical binding or truth fields missing: %+v", event)
		}
	}
	if batch.Events[0].RecipientCount != 2 || batch.Events[0].NativeRecipientCount != 1 || batch.Events[0].InternetRecipientCount != 1 {
		t.Fatalf("send envelope coverage is wrong: %+v", batch.Events[0])
	}
	if batch.Events[1].RecipientHash == "" || batch.Events[1].RecipientHash == "@bob" || batch.Events[2].RecipientHash == "" || batch.Events[2].ReasonCode != "internet_provider_not_configured" {
		t.Fatalf("recipient minimization or failure truth is wrong: %+v", batch.Events)
	}

	encoded, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"@bob",
		"private-recipient@example.net",
		"confidential subject",
		"secret body that must never enter canonical events",
		"confidential-plan.txt",
		attachment.ContentBase64,
		"ynx1alice-private",
		"ynx1bob-private",
	} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("canonical event leaked private Mail content %q: %s", forbidden, encoded)
		}
	}

	if err = adapter.Acknowledge(batch.Through); err != nil {
		t.Fatal(err)
	}
	if err = adapter.Acknowledge(batch.Through - 1); err == nil {
		t.Fatal("outbox acknowledgement moved backwards")
	}
	if err = adapter.Acknowledge(batch.Through + 100); err == nil {
		t.Fatal("outbox acknowledged a sequence that was never emitted")
	}

	restartedStore, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	restartedAdapter, _ := NewDataFabricAdapter(restartedStore)
	empty, err := restartedAdapter.ReadBatch(100)
	if err != nil || len(empty.Events) != 0 || empty.Acknowledged != batch.Through {
		t.Fatalf("acknowledged outbox did not persist across restart: %v %+v", err, empty)
	}
	restartedService, err := NewServiceWithOptions(restartedStore, testVerifier{}, testAI{}, signer, ServiceOptions{SourceCommit: "source-commit-data-fabric-test"})
	if err != nil {
		t.Fatal(err)
	}
	nextDraft, err := restartedService.SaveDraft(alice, Draft{To: []string{"@bob"}, Subject: "next", Body: "next"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restartedService.SendDraft(alice, nextDraft.ID); err != nil {
		t.Fatal(err)
	}
	next, err := restartedAdapter.ReadBatch(1)
	if err != nil || len(next.Events) != 1 || next.Events[0].Sequence != batch.Through+1 || next.PendingAfter != 1 || next.Events[0].MessageID == message.ID {
		t.Fatalf("outbox sequence/replay contract is wrong after restart: %v %+v", err, next)
	}
}

func TestCanonicalProviderEventsPreserveDeliveryTruthWithoutWebhookLeakage(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"provider-message-data-fabric"}`))
	}))
	defer provider.Close()

	now := time.Now().UTC().Truncate(time.Second)
	webhookReference := testWebhookSecret()
	providerReference := "unit" + "-test" + "-provider-reference"
	store, err := NewStore(filepath.Join(t.TempDir(), "mail.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, signer, _ := ed25519.GenerateKey(rand.Reader)
	bridge := ResendBridge{
		BaseURL:       provider.URL,
		APIKey:        providerReference,
		From:          "mail@ynxweb4.com",
		WebhookSecret: webhookReference,
		Client:        provider.Client(),
	}
	svc, err := NewServiceWithOptions(store, testVerifier{}, testAI{}, signer, ServiceOptions{InternetBridge: bridge, SourceCommit: "provider-source-commit"})
	if err != nil {
		t.Fatal(err)
	}
	svc.now = func() time.Time { return now }
	token, _, _ := signIn(t, svc, "@provider", "ynx1provider")
	draft, _ := svc.SaveDraft(token, Draft{To: []string{"recipient@example.net"}, Subject: "provider private subject", Body: "provider private body"})
	if _, err = svc.SendDraftContext(context.Background(), token, draft.ID); err != nil {
		t.Fatal(err)
	}
	adapter, _ := NewDataFabricAdapter(store)
	beforeWebhook, err := adapter.ReadBatch(100)
	if err != nil || len(beforeWebhook.Events) != 2 || beforeWebhook.Events[1].Type != EventMailInternetProviderAccepted || beforeWebhook.Events[1].MailServerDelivered || beforeWebhook.Events[1].UserReadClaimed {
		t.Fatalf("provider acceptance was overstated: %v %+v", err, beforeWebhook)
	}

	deliveredBody := []byte(`{"type":"email.delivered","created_at":"` + now.Add(time.Second).Format(time.RFC3339Nano) + `","data":{"email_id":"provider-message-data-fabric","to":["recipient@example.net"]}}`)
	delivered := httptest.NewRecorder()
	NewHandler(svc).ServeHTTP(delivered, signedWebhookRequest(t, webhookReference, "private-provider-event-id", now, deliveredBody))
	if delivered.Code != http.StatusOK {
		t.Fatalf("verified delivered webhook failed: %d %s", delivered.Code, delivered.Body.String())
	}

	openedBody := []byte(`{"type":"email.opened","created_at":"` + now.Add(2*time.Second).Format(time.RFC3339Nano) + `","data":{"email_id":"provider-message-data-fabric"}}`)
	opened := httptest.NewRecorder()
	NewHandler(svc).ServeHTTP(opened, signedWebhookRequest(t, webhookReference, "private-open-event-id", now, openedBody))
	if opened.Code != http.StatusOK {
		t.Fatalf("verified engagement webhook failed: %d %s", opened.Code, opened.Body.String())
	}
	duplicate := httptest.NewRecorder()
	NewHandler(svc).ServeHTTP(duplicate, signedWebhookRequest(t, webhookReference, "private-open-event-id", now, openedBody))
	if duplicate.Code != http.StatusOK || !strings.Contains(duplicate.Body.String(), `"duplicate":true`) {
		t.Fatalf("duplicate provider event was not idempotent: %d %s", duplicate.Code, duplicate.Body.String())
	}

	batch, err := adapter.ReadBatch(100)
	if err != nil || len(batch.Events) != 4 {
		t.Fatalf("unexpected provider canonical event count: %v %+v", err, batch)
	}
	deliveryEvent := batch.Events[2]
	if deliveryEvent.Type != EventMailInternetDelivered || !deliveryEvent.Applied || !deliveryEvent.MailServerDelivered || deliveryEvent.UserReadClaimed || deliveryEvent.Authority != "verified_provider_event" {
		t.Fatalf("verified delivery truth is wrong: %+v", deliveryEvent)
	}
	ignoredEvent := batch.Events[3]
	if ignoredEvent.Type != EventMailInternetProviderEventIgnored || ignoredEvent.Applied || ignoredEvent.UserReadClaimed || ignoredEvent.ProviderEventIDHash == "" || ignoredEvent.ProviderEventIDHash == "private-open-event-id" {
		t.Fatalf("engagement event was not minimized and ignored: %+v", ignoredEvent)
	}
	encoded, _ := json.Marshal(batch)
	for _, forbidden := range []string{"recipient@example.net", "provider private subject", "provider private body", "private-provider-event-id", "private-open-event-id", string(deliveredBody), string(openedBody), providerReference, webhookReference} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("provider canonical event leaked webhook or credential data %q: %s", forbidden, encoded)
		}
	}
}
