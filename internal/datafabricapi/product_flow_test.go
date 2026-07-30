package datafabricapi

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func TestAllProductContractsAPIOutboxBusAndConsumerFlow(t *testing.T) {
	products := []struct {
		product, service, eventType string
	}{
		{"wallet", "session", "wallet.session.opened"}, {"pay", "invoice", "pay.invoice.created"},
		{"shop", "order", "shop.order.created"}, {"merchant", "settlement", "merchant.settlement.created"},
		{"exchange", "order", "exchange.order.accepted"}, {"dex", "swap", "dex.swap.submitted"},
		{"quant", "mandate", "quant.mandate.activated"}, {"trust", "case", "trust.case.opened"},
		{"resource", "usage", "resource.usage.recorded"}, {"cloud", "usage", "cloud.usage.recorded"},
		{"ai", "usage", "ai.usage.recorded"}, {"mail", "delivery", "mail.delivery.accepted"},
		{"creator", "revenue", "creator.revenue.recognized"},
	}
	store, err := datafabric.OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	keys := map[string][]byte{}
	keyProducts := map[string]string{}
	for _, contract := range products {
		keyID := "key." + contract.product + ".testnet.0001"
		keys[keyID], keyProducts[keyID] = apiTestKey, contract.product
	}
	server, err := New(Config{Store: store, Authorizer: fakeAuthorizer{}, EventKeys: keys, EventKeyProducts: keyProducts, PrivacyKey: []byte("abcdef0123456789abcdef0123456789"), SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0"})
	if err != nil {
		t.Fatal(err)
	}

	for index, contract := range products {
		event := productEvent(t, contract.product, contract.service, contract.eventType, index+1)
		body, _ := json.Marshal(event)
		request := authorizedRequest(t, http.MethodPost, "/v1/events", body, contract.product)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusAccepted {
			t.Fatalf("%s flow rejected: %d %s", contract.product, response.Code, response.Body.String())
		}
	}

	logPath := t.TempDir() + "/events.jsonl"
	dispatcher := datafabric.Dispatcher{Store: store, Publisher: &datafabric.EventLogPublisher{Path: logPath}, BatchSize: 100, MaxAttempts: 3}
	report, err := dispatcher.DispatchOnce(context.Background())
	if err != nil || report.Published != uint64(len(products)) || len(store.PendingOutbox(time.Now().UTC().Add(time.Hour), 100)) != 0 {
		t.Fatalf("dispatch failed: %+v %v", report, err)
	}

	file, err := os.Open(logPath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	seen := map[string]bool{}
	for scanner.Scan() {
		record, err := datafabric.DecodeEventLogRecord(scanner.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		var event datafabric.EventEnvelope
		if err := json.Unmarshal(record.Payload, &event); err != nil {
			t.Fatal(err)
		}
		seen[event.Product] = true
		applied, err := store.ApplyProjection("contract-consumer.v1", event.EventID, func(event datafabric.EventEnvelope, state map[string]string) (string, error) {
			state["last."+event.Product] = event.EventID
			return event.Integrity.Digest, nil
		})
		if err != nil || !applied {
			t.Fatalf("%s consumer effect failed: %t %v", event.Product, applied, err)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if len(seen) != len(products) {
		t.Fatalf("event bus lost product contracts: got %d want %d", len(seen), len(products))
	}
	if err := store.AuditIntegrity(keys); err != nil {
		t.Fatalf("integrated store failed integrity: %v", err)
	}
}

func productEvent(t *testing.T, product, service, eventType string, index int) datafabric.EventEnvelope {
	t.Helper()
	now := time.Date(2026, 7, 22, 18, index, 0, 0, time.UTC)
	suffix := fmt.Sprintf("%04d", index)
	payload := json.RawMessage(fmt.Sprintf(`{"state":"accepted","contract":%q}`, product))
	event := datafabric.EventEnvelope{
		EventID: "event." + product + ".contract." + suffix, EventType: eventType, SchemaVersion: datafabric.EnvelopeSchemaVersion,
		Product: product, Service: service, AggregateID: "aggregate." + product + "." + suffix,
		Actor:         datafabric.Actor{ActorID: "actor.wallet.0001", AccountID: "account.wallet.0001", SessionID: "session.wallet.0001"},
		CorrelationID: "correlation.contract." + suffix, CausationID: "command.contract." + suffix, Sequence: 1,
		Timestamp: now, EffectiveAt: now, SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: product + "-testnet-v0",
		PrivacyClassification: "confidential", RetentionClass: "operational", AuditID: "audit.contract." + suffix,
		Source: datafabric.SourceMetadata{Source: "ynx-" + product, AsOf: now, Version: "v1", Status: "authoritative"}, Payload: payload,
	}
	if err := event.Sign("key."+product+".testnet.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	return event
}
