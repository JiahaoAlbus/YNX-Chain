// Package datafabricnats provides the durable NATS JetStream transport for
// canonical Data Fabric events. The authoritative event/outbox transaction
// remains in datafabric.Store; this package supplies acknowledged publication,
// broker-side de-duplication, durable pull consumption, and double acks.
package datafabricnats

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const (
	DefaultStream  = "YNX_EVENTS"
	DefaultSubject = "ynx.events.>"
)

type Config struct {
	URL             string
	Stream          string
	CredentialsFile string
	TLSCAFile       string
	TLSCertFile     string
	TLSKeyFile      string
	ConnectTimeout  time.Duration
	PublishTimeout  time.Duration
	DuplicateWindow time.Duration
	MaxAge          time.Duration
	MaxBytes        int64
	Replicas        int
}

type Broker struct {
	connection     *nats.Conn
	jetStream      jetstream.JetStream
	stream         jetstream.Stream
	streamName     string
	publishTimeout time.Duration
}

func Connect(ctx context.Context, cfg Config) (*Broker, error) {
	if strings.TrimSpace(cfg.URL) == "" {
		return nil, errors.New("NATS URL is required")
	}
	if cfg.Stream == "" {
		cfg.Stream = DefaultStream
	}
	if cfg.ConnectTimeout <= 0 {
		cfg.ConnectTimeout = 5 * time.Second
	}
	if cfg.PublishTimeout <= 0 {
		cfg.PublishTimeout = 5 * time.Second
	}
	if cfg.DuplicateWindow <= 0 {
		cfg.DuplicateWindow = 10 * time.Minute
	}
	if cfg.MaxAge <= 0 {
		cfg.MaxAge = 30 * 24 * time.Hour
	}
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = 100 << 30
	}
	if cfg.Replicas <= 0 {
		cfg.Replicas = 1
	}
	options := []nats.Option{
		nats.Name("ynx-data-fabric"),
		nats.Timeout(cfg.ConnectTimeout),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(250 * time.Millisecond),
		nats.ReconnectJitter(100*time.Millisecond, 250*time.Millisecond),
	}
	if cfg.CredentialsFile != "" {
		if !filepath.IsAbs(cfg.CredentialsFile) {
			return nil, errors.New("NATS credentials file path must be absolute")
		}
		options = append(options, nats.UserCredentials(cfg.CredentialsFile))
	}
	if cfg.TLSCAFile != "" {
		if !filepath.IsAbs(cfg.TLSCAFile) {
			return nil, errors.New("NATS TLS CA file path must be absolute")
		}
		options = append(options, nats.RootCAs(cfg.TLSCAFile))
	}
	if (cfg.TLSCertFile == "") != (cfg.TLSKeyFile == "") {
		return nil, errors.New("NATS TLS client certificate and key must be configured together")
	}
	if cfg.TLSCertFile != "" {
		if !filepath.IsAbs(cfg.TLSCertFile) || !filepath.IsAbs(cfg.TLSKeyFile) {
			return nil, errors.New("NATS TLS client certificate and key paths must be absolute")
		}
		options = append(options, nats.ClientCert(cfg.TLSCertFile, cfg.TLSKeyFile))
	}
	connection, err := nats.Connect(cfg.URL, options...)
	if err != nil {
		return nil, fmt.Errorf("connect to NATS: %w", err)
	}
	js, err := jetstream.New(connection)
	if err != nil {
		connection.Close()
		return nil, fmt.Errorf("initialize JetStream: %w", err)
	}
	stream, err := js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:        cfg.Stream,
		Description: "YNX canonical cross-product events",
		Subjects:    []string{DefaultSubject},
		Retention:   jetstream.LimitsPolicy,
		// Fail publication when capacity is exhausted so the transactional
		// Outbox retains the event; never evict unseen history silently.
		Discard:    jetstream.DiscardNew,
		MaxBytes:   cfg.MaxBytes,
		MaxAge:     cfg.MaxAge,
		MaxMsgSize: 300 * 1024,
		Storage:    jetstream.FileStorage,
		Replicas:   cfg.Replicas,
		Duplicates: cfg.DuplicateWindow,
		DenyDelete: true,
		DenyPurge:  true,
	})
	if err != nil {
		connection.Close()
		return nil, fmt.Errorf("ensure JetStream stream: %w", err)
	}
	return &Broker{connection: connection, jetStream: js, stream: stream, streamName: cfg.Stream, publishTimeout: cfg.PublishTimeout}, nil
}

func (b *Broker) Close() {
	if b != nil && b.connection != nil {
		b.connection.Drain() //nolint:errcheck // Close below is the final bounded cleanup.
		b.connection.Close()
	}
}

// Publish implements datafabric.Publisher. A server PubAck is required before
// the outbox can be marked published, and eventId is the de-duplication key.
func (b *Broker) Publish(ctx context.Context, topic, partitionKey string, payload []byte) error {
	if b == nil || b.connection == nil || b.connection.IsClosed() {
		return errors.New("NATS broker is closed")
	}
	event, err := datafabric.DecodeEnvelopeStrict(bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("refuse non-canonical event: %w", err)
	}
	if topic != "ynx.events."+event.EventType {
		return errors.New("event topic does not match canonical eventType")
	}
	if partitionKey != event.PartitionKey() {
		return errors.New("partition key does not match canonical aggregate")
	}
	message := nats.NewMsg(topic)
	message.Data = payload
	message.Header.Set("YNX-Event-Id", event.EventID)
	message.Header.Set("YNX-Partition-Key", partitionKey)
	message.Header.Set("YNX-Correlation-Id", event.CorrelationID)
	message.Header.Set("YNX-Integrity-Digest", event.Integrity.Digest)
	publishCtx, cancel := context.WithTimeout(ctx, b.publishTimeout)
	defer cancel()
	ack, err := b.jetStream.PublishMsg(publishCtx, message, jetstream.WithMsgID(event.EventID), jetstream.WithExpectStream(b.streamName))
	if err != nil {
		return fmt.Errorf("JetStream publish acknowledgement: %w", err)
	}
	if ack == nil || ack.Stream != b.streamName {
		return errors.New("JetStream returned an invalid publication acknowledgement")
	}
	return nil
}

type ProjectionFunc func(datafabric.EventEnvelope, map[string]string) (string, error)

// ConsumeProjectionOnce processes at most one event. The projection effect and
// local Inbox marker commit atomically before a server-confirmed double ack.
// If the process dies in between, redelivery is harmless because the Inbox key
// is consumer:eventId.
func (b *Broker) ConsumeProjectionOnce(ctx context.Context, durable string, store *datafabric.Store, apply ProjectionFunc) (bool, error) {
	if b == nil || store == nil || apply == nil || strings.TrimSpace(durable) == "" {
		return false, errors.New("broker, durable consumer, store, and projection are required")
	}
	consumer, err := b.stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
		Name:          durable,
		Durable:       durable,
		Description:   "YNX Data Fabric idempotent projection consumer",
		DeliverPolicy: jetstream.DeliverAllPolicy,
		AckPolicy:     jetstream.AckExplicitPolicy,
		AckWait:       2 * time.Second,
		MaxDeliver:    8,
		BackOff:       []time.Duration{time.Second, 2 * time.Second, 5 * time.Second, 15 * time.Second},
		FilterSubject: DefaultSubject,
		ReplayPolicy:  jetstream.ReplayInstantPolicy,
	})
	if err != nil {
		return false, fmt.Errorf("ensure JetStream consumer: %w", err)
	}
	batch, err := consumer.Fetch(1, jetstream.FetchMaxWait(500*time.Millisecond))
	if err != nil {
		return false, fmt.Errorf("fetch JetStream event: %w", err)
	}
	var message jetstream.Msg
	for candidate := range batch.Messages() {
		message = candidate
		break
	}
	if message == nil {
		if err := batch.Error(); err != nil {
			return false, fmt.Errorf("fetch JetStream event: %w", err)
		}
		return false, nil
	}
	event, err := datafabric.DecodeEnvelopeStrict(bytes.NewReader(message.Data()))
	if err != nil {
		_ = message.TermWithReason("invalid canonical YNX event")
		return false, fmt.Errorf("decode JetStream event: %w", err)
	}
	if event.EventID != message.Headers().Get("YNX-Event-Id") || event.Integrity.Digest != message.Headers().Get("YNX-Integrity-Digest") {
		_ = message.TermWithReason("event header mismatch")
		return false, errors.New("JetStream event headers do not match signed envelope")
	}
	applied, err := store.ApplyProjection(durable, event.EventID, apply)
	if err != nil {
		_ = message.NakWithDelay(time.Second)
		return false, fmt.Errorf("commit projection and Inbox marker: %w", err)
	}
	if err := message.DoubleAck(ctx); err != nil {
		return applied, fmt.Errorf("confirm JetStream acknowledgement: %w", err)
	}
	return applied, nil
}

func (b *Broker) StreamInfo(ctx context.Context) (*jetstream.StreamInfo, error) {
	if b == nil || b.stream == nil {
		return nil, errors.New("broker is not initialized")
	}
	return b.stream.Info(ctx)
}
