package datafabricapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

type accountAuthorizer struct {
	accounts map[string]string
}

func (a accountAuthorizer) Authorize(_ context.Context, credential Credential, scope string) (Principal, error) {
	accountID, exists := a.accounts[credential.SessionID]
	if !exists || credential.SessionToken != "opaque-session-token" || credential.RequestSignature != "device-signature" {
		return Principal{}, fmt.Errorf("canonical account session denied")
	}
	return Principal{
		SessionID: credential.SessionID, AccountID: accountID, DeviceID: credential.DeviceID,
		Product: credential.Product, BundleID: credential.BundleID, Scopes: []string{scope},
		ExpiresAt: time.Now().UTC().Add(time.Minute), Active: true, RequestBound: true,
	}, nil
}

func TestSameProductAccountReadsAndMutationsFailClosed(t *testing.T) {
	accounts := map[string]string{
		"session.wallet.account-a": "account.wallet.account-a",
		"session.wallet.account-b": "account.wallet.account-b",
	}
	server, store := newAccountTestServer(t, accountAuthorizer{accounts: accounts})
	eventA := accountEvent(t, 1, accounts["session.wallet.account-a"], "session.wallet.account-a")
	eventB := accountEvent(t, 2, accounts["session.wallet.account-b"], "session.wallet.account-b")
	for _, event := range []datafabric.EventEnvelope{eventA, eventB} {
		if err := store.Append(event, apiTestKey); err != nil {
			t.Fatal(err)
		}
	}

	response := serveAccountRequest(server, http.MethodGet, "/v1/events", nil, "session.wallet.account-a")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), eventA.EventID) || strings.Contains(response.Body.String(), eventB.EventID) {
		t.Fatalf("same-product cross-account event read leaked: %d %s", response.Code, response.Body.String())
	}

	journalA := accountJournal(eventA, 1)
	journalB := accountJournal(eventB, 2)
	for _, entry := range []datafabric.JournalEntry{journalA, journalB} {
		if err := store.PostJournal(entry); err != nil {
			t.Fatal(err)
		}
	}
	response = serveAccountRequest(server, http.MethodGet, "/v1/ledger/journal", nil, "session.wallet.account-a")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), journalA.EntryID) || strings.Contains(response.Body.String(), journalB.EntryID) {
		t.Fatalf("same-product cross-account journal read leaked: %d %s", response.Code, response.Body.String())
	}

	unauthorizedJournal := accountJournal(eventB, 3)
	unauthorizedJournal.EntryID = "journal.pay.account-b.cross-account"
	body, _ := json.Marshal(unauthorizedJournal)
	response = serveAccountRequest(server, http.MethodPost, "/v1/ledger/journal", body, "session.wallet.account-a")
	if response.Code != http.StatusForbidden || len(store.Journal()) != 2 {
		t.Fatalf("same-product cross-account journal mutation was accepted: %d %s", response.Code, response.Body.String())
	}

	billingRequest := datafabric.BillingSettlementRequest{UsageEventID: eventB.EventID}
	body, _ = json.Marshal(billingRequest)
	response = serveAccountRequest(server, http.MethodPost, "/v1/billing/settlements", body, "session.wallet.account-a")
	if response.Code != http.StatusForbidden || len(store.BillingSettlements()) != 0 {
		t.Fatalf("same-product cross-account billing mutation was accepted: %d %s", response.Code, response.Body.String())
	}

	deadline := time.Now().UTC().Add(time.Minute)
	sagaRequest := map[string]any{
		"sagaId": "saga.pay.account-b.0001", "kind": datafabric.SagaPay,
		"aggregateId": eventB.AggregateID, "correlationId": eventB.CorrelationID,
		"auditId": "audit.saga.account-b.0001", "deadline": deadline,
	}
	body, _ = json.Marshal(sagaRequest)
	response = serveAccountRequest(server, http.MethodPost, "/v1/sagas", body, "session.wallet.account-a")
	if response.Code != http.StatusForbidden || len(store.Sagas()) != 0 {
		t.Fatalf("same-product cross-account saga start was accepted: %d %s", response.Code, response.Body.String())
	}
	response = serveAccountRequest(server, http.MethodPost, "/v1/sagas", body, "session.wallet.account-b")
	if response.Code != http.StatusCreated || len(store.Sagas()) != 1 {
		t.Fatalf("account-owned saga start failed: %d %s", response.Code, response.Body.String())
	}
	response = serveAccountRequest(server, http.MethodGet, "/v1/sagas/saga.pay.account-b.0001", nil, "session.wallet.account-a")
	if response.Code != http.StatusForbidden {
		t.Fatalf("same-product cross-account saga read was accepted: %d %s", response.Code, response.Body.String())
	}

	reconcileRequest := map[string]any{
		"runId": "reconciliation.pay.cross-account.0001", "journalEntryId": journalB.EntryID,
		"auditId": "audit.reconciliation.cross-account.0001", "requiredSources": []string{"pay"},
	}
	body, _ = json.Marshal(reconcileRequest)
	response = serveAccountRequest(server, http.MethodPost, "/v1/reconciliations", body, "session.wallet.account-a")
	if response.Code != http.StatusForbidden || len(store.Reconciliations()) != 0 {
		t.Fatalf("same-product cross-account reconciliation was accepted: %d %s", response.Code, response.Body.String())
	}

	// fabric.audit.export is an explicit privileged product-wide scope, unlike
	// user-facing event, ledger, billing, Saga, and reconciliation APIs.
	response = serveAccountRequest(server, http.MethodGet, "/v1/audit/export", nil, "session.wallet.account-a")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), eventA.EventID) || !strings.Contains(response.Body.String(), eventB.EventID) {
		t.Fatalf("privileged product-wide audit export was unexpectedly narrowed: %d %s", response.Code, response.Body.String())
	}
}

func TestHundredConcurrentAccountSessionsOnlyReadOwnEvent(t *testing.T) {
	const sessions = 100
	accounts := make(map[string]string, sessions)
	server, store := newAccountTestServer(t, accountAuthorizer{accounts: accounts})
	eventIDs := make([]string, sessions)
	sessionIDs := make([]string, sessions)
	for index := 0; index < sessions; index++ {
		sessionID := fmt.Sprintf("session.wallet.concurrent.%04d", index)
		accountID := fmt.Sprintf("account.wallet.concurrent.%04d", index)
		accounts[sessionID] = accountID
		event := accountEvent(t, index+1, accountID, sessionID)
		if err := store.Append(event, apiTestKey); err != nil {
			t.Fatal(err)
		}
		eventIDs[index], sessionIDs[index] = event.EventID, sessionID
	}

	var failures atomic.Uint64
	var workers sync.WaitGroup
	workers.Add(sessions)
	started := make(chan struct{})
	for index := 0; index < sessions; index++ {
		go func(index int) {
			defer workers.Done()
			<-started
			response := serveAccountRequest(server, http.MethodGet, "/v1/events", nil, sessionIDs[index])
			var result struct {
				Events []datafabric.EventEnvelope `json:"events"`
			}
			if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Events) != 1 || result.Events[0].EventID != eventIDs[index] {
				failures.Add(1)
			}
		}(index)
	}
	close(started)
	workers.Wait()
	if failures.Load() != 0 {
		t.Fatalf("%d of %d concurrent canonical account sessions crossed isolation or failed", failures.Load(), sessions)
	}
}

func newAccountTestServer(t *testing.T, authorizer Authorizer) (*Server, *datafabric.Store) {
	t.Helper()
	store, err := datafabric.OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{
		Store: store, Authorizer: authorizer,
		EventKeys:        map[string][]byte{"key.datafabric.0001": apiTestKey},
		EventKeyProducts: map[string]string{"key.datafabric.0001": "pay"},
		PrivacyKey:       []byte("abcdef0123456789abcdef0123456789"),
		SourceCommit:     "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0",
	})
	if err != nil {
		t.Fatal(err)
	}
	return server, store
}

var accountRequestSequence atomic.Uint64

func serveAccountRequest(server *Server, method, path string, body []byte, sessionID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("X-YNX-App-Session", "opaque-session-token")
	request.Header.Set("X-YNX-Session-ID", sessionID)
	request.Header.Set("X-YNX-Device-ID", "device."+sessionID)
	request.Header.Set("X-YNX-Product", "pay")
	request.Header.Set("X-YNX-Bundle-ID", "app.ynx.pay")
	sequence := accountRequestSequence.Add(1)
	request.Header.Set("X-YNX-Request-ID", fmt.Sprintf("request.account.%08d", sequence))
	request.Header.Set("X-YNX-Request-Nonce", fmt.Sprintf("nonce.account.%08d", sequence))
	request.Header.Set("X-YNX-Timestamp", time.Now().UTC().Format(time.RFC3339Nano))
	request.Header.Set("X-YNX-Device-Signature", "device-signature")
	request.Header.Set("X-YNX-Content-SHA256", fmt.Sprintf("%x", sha256.Sum256(body)))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}

func accountEvent(t *testing.T, index int, accountID, sessionID string) datafabric.EventEnvelope {
	t.Helper()
	event := apiEvent(t)
	suffix := fmt.Sprintf("%04d", index)
	event.EventID = "event.pay.account-isolation." + suffix
	event.AggregateID = "invoice.account-isolation." + suffix
	event.Actor = datafabric.Actor{ActorID: "actor.wallet." + suffix, AccountID: accountID, SessionID: sessionID}
	event.CorrelationID = "correlation.account-isolation." + suffix
	event.CausationID = "command.account-isolation." + suffix
	event.AuditID = "audit.account-isolation." + suffix
	event.Sequence = 1
	event.Timestamp = event.Timestamp.Add(time.Duration(index) * time.Second)
	event.EffectiveAt = event.Timestamp
	event.Source.AsOf = event.Timestamp
	if err := event.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	return event
}

func accountJournal(event datafabric.EventEnvelope, index int) datafabric.JournalEntry {
	suffix := fmt.Sprintf("%04d", index)
	return datafabric.JournalEntry{
		EntryID: "journal.pay.account-isolation." + suffix, CorrelationID: event.CorrelationID, EventID: event.EventID,
		EffectiveAt: event.EffectiveAt, RecordedAt: event.EffectiveAt, Description: "account isolation entry",
		RevenueBoundary: "payment-settled", SourceCommit: event.SourceCommit, SourceRelease: event.SourceRelease,
		AuditID: "audit.journal.account-isolation." + suffix,
		Postings: []datafabric.Posting{
			{AccountID: event.Actor.AccountID, Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 1, Category: "refund"},
			{AccountID: "account.provider.account-isolation", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 1, Category: "provider-net"},
		},
	}
}
