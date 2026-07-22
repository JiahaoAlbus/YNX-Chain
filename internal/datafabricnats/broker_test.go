package datafabricnats

import (
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go/jetstream"
)

var integrationKey = []byte("0123456789abcdef0123456789abcdef")

func TestJetStreamAcknowledgedDeduplicationAndInboxRedelivery(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	serverOptions := testServerOptions(t.TempDir(), -1)
	natsServer := startServer(t, serverOptions)
	defer natsServer.Shutdown()

	broker, err := Connect(ctx, Config{URL: natsServer.ClientURL(), MaxBytes: 32 << 20, PublishTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer broker.Close()
	store, err := datafabric.OpenStore(filepath.Join(t.TempDir(), "fabric.json"))
	if err != nil {
		t.Fatal(err)
	}
	event := testEvent(t, 1)
	if err := store.Append(event, integrationKey); err != nil {
		t.Fatal(err)
	}
	dispatcher := datafabric.Dispatcher{Store: store, Publisher: broker, BatchSize: 10, MaxAttempts: 4}
	report, err := dispatcher.DispatchOnce(ctx)
	if err != nil || report.Published != 1 {
		t.Fatalf("acknowledged dispatch failed: report=%+v err=%v", report, err)
	}
	encoded, _ := json.Marshal(event)
	if err := broker.Publish(ctx, "ynx.events."+event.EventType, event.PartitionKey(), encoded); err != nil {
		t.Fatalf("duplicate publication was not accepted idempotently: %v", err)
	}
	info, err := broker.StreamInfo(ctx)
	if err != nil || info.State.Msgs != 1 {
		t.Fatalf("message id de-duplication failed: info=%+v err=%v", info, err)
	}

	durable := "billing-ledger-test"
	consumer, err := broker.stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{Name: durable, Durable: durable, AckPolicy: jetstream.AckExplicitPolicy, AckWait: time.Second, FilterSubject: DefaultSubject})
	if err != nil {
		t.Fatal(err)
	}
	batch, err := consumer.Fetch(1, jetstream.FetchMaxWait(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	message := <-batch.Messages()
	apply := func(event datafabric.EventEnvelope, projection map[string]string) (string, error) {
		projection[event.AggregateID] = event.EventType
		return event.Integrity.Digest, nil
	}
	applied, err := store.ApplyProjection(durable, event.EventID, apply)
	if err != nil || !applied {
		t.Fatalf("projection commit before simulated crash failed: applied=%t err=%v", applied, err)
	}
	// Simulate loss after the local transaction and before the broker ack.
	if err := message.NakWithDelay(10 * time.Millisecond); err != nil {
		t.Fatal(err)
	}
	time.Sleep(25 * time.Millisecond)
	applied, err = broker.ConsumeProjectionOnce(ctx, durable, store, apply)
	if err != nil || applied {
		t.Fatalf("redelivery was not absorbed by Inbox idempotency: applied=%t err=%v", applied, err)
	}
}

func TestJetStreamNetworkOutageRetainsOutboxAndRecovers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	storeDir := t.TempDir()
	options := testServerOptions(storeDir, -1)
	natsServer := startServer(t, options)
	port := natsServer.Addr().(*net.TCPAddr).Port
	url := natsServer.ClientURL()
	broker, err := Connect(ctx, Config{URL: url, MaxBytes: 32 << 20, PublishTimeout: 250 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer broker.Close()
	store, err := datafabric.OpenStore(filepath.Join(t.TempDir(), "fabric.json"))
	if err != nil {
		t.Fatal(err)
	}
	event := testEvent(t, 1)
	if err := store.Append(event, integrationKey); err != nil {
		t.Fatal(err)
	}

	natsServer.Shutdown()
	natsServer.WaitForShutdown()
	dispatcher := datafabric.Dispatcher{Store: store, Publisher: broker, BatchSize: 10, MaxAttempts: 4, Now: func() time.Time { return time.Now().UTC() }}
	report, err := dispatcher.DispatchOnce(ctx)
	if err != nil || report.Failed != 1 || report.Published != 0 {
		t.Fatalf("network outage was not recorded as retryable: report=%+v err=%v", report, err)
	}
	if pending := store.PendingOutbox(time.Now().UTC().Add(10*time.Second), 10); len(pending) != 1 || pending[0].Attempt != 1 {
		t.Fatalf("outbox was not retained after broker outage: %+v", pending)
	}

	restarted := startServer(t, testServerOptions(storeDir, port))
	defer restarted.Shutdown()
	deadline := time.Now().Add(5 * time.Second)
	for !broker.connection.IsConnected() && time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
	}
	if !broker.connection.IsConnected() {
		t.Fatal("NATS client did not reconnect after broker recovery")
	}
	dispatcher.Now = func() time.Time { return time.Now().UTC().Add(10 * time.Second) }
	report, err = dispatcher.DispatchOnce(ctx)
	if err != nil || report.Published != 1 {
		t.Fatalf("retained outbox did not publish after broker recovery: report=%+v err=%v", report, err)
	}
}

func testServerOptions(storeDir string, port int) *server.Options {
	return &server.Options{Host: "127.0.0.1", Port: port, NoLog: true, NoSigs: true, JetStream: true, StoreDir: storeDir, SyncAlways: true}
}

func startServer(t *testing.T, options *server.Options) *server.Server {
	t.Helper()
	s, err := server.NewServer(options)
	if err != nil {
		t.Fatal(err)
	}
	s.Start()
	if !s.ReadyForConnections(5 * time.Second) {
		s.Shutdown()
		t.Fatal("embedded NATS server did not become ready")
	}
	return s
}

func testEvent(t *testing.T, sequence uint64) datafabric.EventEnvelope {
	t.Helper()
	now := time.Now().UTC()
	event := datafabric.EventEnvelope{
		EventID: "event.pay.invoice.created.0001", EventType: "pay.invoice.created", SchemaVersion: datafabric.EnvelopeSchemaVersion,
		Product: "pay", Service: "invoice", AggregateID: "invoice.authority.0001", Actor: datafabric.Actor{ActorID: "actor.test.0001", AccountID: "account.test.0001"},
		CorrelationID: "correlation.test.0001", Sequence: sequence, Timestamp: now, EffectiveAt: now, SourceCommit: "719e101", SourceRelease: "data-fabric-test",
		PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit.test.0001",
		Source: datafabric.SourceMetadata{Source: "data-fabric-test", AsOf: now, Version: "1", Status: "authoritative"}, Payload: json.RawMessage(`{"invoiceId":"invoice.authority.0001"}`),
	}
	if err := event.Sign("key.datafabric.0001", integrationKey); err != nil {
		t.Fatal(err)
	}
	return event
}
