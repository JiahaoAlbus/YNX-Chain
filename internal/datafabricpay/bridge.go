package datafabricpay

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	sdk "github.com/JiahaoAlbus/YNX-Chain/sdk/datafabric"
)

const (
	maxSourceResponseBytes = 8 << 20
	maxSourceEvents        = 10000
)

var canonicalID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)
var sourceCommitPattern = regexp.MustCompile(`^[0-9a-f]{7,64}$`)

type EventSender interface {
	Send(context.Context, datafabric.EventEnvelope) (sdk.ProducerReceipt, error)
}

type Config struct {
	SourceURL     string
	UpstreamKey   string
	KeyID         string
	SigningKey    []byte
	SourceCommit  string
	SourceRelease string
	ChainID       int64
	Producer      EventSender
	HTTPClient    *http.Client
}

type Bridge struct {
	cfg Config
}

type SyncReport struct {
	SourceEvents         int `json:"sourceEvents"`
	MappedSourceEvents   int `json:"mappedSourceEvents"`
	UnmappedSourceEvents int `json:"unmappedSourceEvents"`
	CanonicalEvents      int `json:"canonicalEvents"`
	Committed            int `json:"committed"`
	AlreadyCommitted     int `json:"alreadyCommitted"`
}

func New(cfg Config) (*Bridge, error) {
	cfg.SourceURL = strings.TrimRight(strings.TrimSpace(cfg.SourceURL), "/")
	if err := validateSourceURL(cfg.SourceURL); err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(cfg.UpstreamKey)) < 32 {
		return nil, errors.New("Pay authority upstream key must contain at least 32 bytes")
	}
	if cfg.Producer == nil {
		return nil, errors.New("Data Fabric producer client is required")
	}
	if len(cfg.SigningKey) < 32 {
		return nil, errors.New("Pay event signing key must contain at least 32 bytes")
	}
	if !canonicalID.MatchString(cfg.KeyID) || !sourceCommitPattern.MatchString(cfg.SourceCommit) || strings.TrimSpace(cfg.SourceRelease) == "" {
		return nil, errors.New("Pay key ID, source commit, and source release are required")
	}
	if cfg.ChainID != 6423 {
		return nil, errors.New("Pay authority source chain ID must equal 6423")
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 15 * time.Second}
	}
	cfg.SigningKey = append([]byte(nil), cfg.SigningKey...)
	return &Bridge{cfg: cfg}, nil
}

func validateSourceURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("Pay authority source must be an absolute origin URL")
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	loopback := host == "localhost" || ip != nil && ip.IsLoopback()
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return errors.New("Pay authority source must use HTTPS except on loopback")
	}
	return nil
}

func (b *Bridge) SyncOnce(ctx context.Context) (SyncReport, error) {
	sourceEvents, err := b.fetch(ctx)
	if err != nil {
		return SyncReport{}, err
	}
	envelopes, err := b.build(sourceEvents)
	if err != nil {
		return SyncReport{}, err
	}
	mappedSources := 0
	for _, source := range sourceEvents {
		if len(canonicalEventTypes(source)) > 0 {
			mappedSources++
		}
	}
	report := SyncReport{
		SourceEvents: len(sourceEvents), MappedSourceEvents: mappedSources,
		UnmappedSourceEvents: len(sourceEvents) - mappedSources, CanonicalEvents: len(envelopes),
	}
	for _, envelope := range envelopes {
		receipt, err := b.cfg.Producer.Send(ctx, envelope)
		if err != nil {
			return report, fmt.Errorf("deliver Pay event %s: %w", envelope.EventID, err)
		}
		switch receipt.Status {
		case "committed-to-outbox":
			report.Committed++
		case "already-committed":
			report.AlreadyCommitted++
		default:
			return report, errors.New("Data Fabric returned an unknown producer receipt status")
		}
	}
	return report, nil
}

func (b *Bridge) fetch(ctx context.Context) ([]chain.PayEvent, error) {
	if err := b.verifySourceIdentity(ctx); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, b.cfg.SourceURL+"/pay/events", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-YNX-Pay-Gateway-Upstream-Key", b.cfg.UpstreamKey)
	response, err := b.cfg.HTTPClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read authoritative Pay events: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("authoritative Pay event source returned %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxSourceResponseBytes+1))
	if err != nil || len(payload) > maxSourceResponseBytes {
		return nil, errors.New("authoritative Pay event response exceeds the bounded limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var result struct {
		Events []chain.PayEvent `json:"events"`
	}
	if err := decoder.Decode(&result); err != nil {
		return nil, fmt.Errorf("decode authoritative Pay events: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, errors.New("authoritative Pay event response contains trailing JSON")
	}
	if len(result.Events) > maxSourceEvents {
		return nil, errors.New("authoritative Pay event response exceeds the event count limit")
	}
	return result.Events, nil
}

func (b *Bridge) verifySourceIdentity(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, b.cfg.SourceURL+"/status", nil)
	if err != nil {
		return err
	}
	response, err := b.cfg.HTTPClient.Do(request)
	if err != nil {
		return fmt.Errorf("read Pay authority identity: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Pay authority identity returned %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if err != nil || len(payload) > 1024*1024 {
		return errors.New("Pay authority identity response exceeds the bounded limit")
	}
	var status struct {
		ChainID              int64  `json:"chainId"`
		NativeCurrencySymbol string `json:"nativeCurrencySymbol"`
		Build                struct {
			Commit  string `json:"commit"`
			Release string `json:"release"`
		} `json:"build"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&status); err != nil {
		return errors.New("Pay authority identity response is invalid")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("Pay authority identity response contains trailing JSON")
	}
	if status.ChainID != b.cfg.ChainID || status.NativeCurrencySymbol != "YNXT" || status.Build.Commit != b.cfg.SourceCommit || status.Build.Release != b.cfg.SourceRelease {
		return errors.New("Pay authority identity contradicts configured chain, commit, or release")
	}
	return nil
}

func (b *Bridge) build(sourceEvents []chain.PayEvent) ([]datafabric.EventEnvelope, error) {
	sorted := append([]chain.PayEvent(nil), sourceEvents...)
	sort.Slice(sorted, func(left, right int) bool {
		if sorted[left].CreatedAt.Equal(sorted[right].CreatedAt) {
			return sorted[left].ID < sorted[right].ID
		}
		return sorted[left].CreatedAt.Before(sorted[right].CreatedAt)
	})
	for _, event := range sorted {
		if err := validateSourceEvent(event); err != nil {
			return nil, err
		}
	}
	sequences := map[string]uint64{}
	envelopes := make([]datafabric.EventEnvelope, 0, len(sorted))
	for _, source := range sorted {
		eventTypes := canonicalEventTypes(source)
		aggregateID := source.InvoiceID
		if aggregateID == "" && source.Type == "invoice.issued" {
			aggregateID = source.ObjectID
		}
		for _, eventType := range eventTypes {
			sequences[aggregateID]++
			envelope, err := b.buildEnvelope(source, aggregateID, eventType, sequences[aggregateID])
			if err != nil {
				return nil, err
			}
			envelopes = append(envelopes, envelope)
		}
	}
	return envelopes, nil
}

func validateSourceEvent(event chain.PayEvent) error {
	if event.CreatedAt.Location() != time.UTC || event.CreatedAt.IsZero() || strings.TrimSpace(event.IntentID) == "" || strings.TrimSpace(event.ObjectID) == "" || strings.TrimSpace(event.Merchant) == "" {
		return errors.New("Pay source event identity or timestamp is incomplete")
	}
	switch event.Type {
	case "payment_intent.created", "invoice.issued", "invoice.paid", "refund.recorded", "webhook.signed":
	default:
		return fmt.Errorf("unsupported Pay source event type %q", event.Type)
	}
	if event.ID != paySourceEventID(event) || event.AuditHash != paySourceAuditHash(event) {
		return fmt.Errorf("Pay source event %s failed authoritative audit verification", event.ID)
	}
	if (event.Type == "invoice.issued" || event.Type == "invoice.paid" || event.Type == "refund.recorded") && (event.Amount <= 0 || strings.TrimSpace(event.Currency) == "") {
		return fmt.Errorf("Pay source event %s has invalid financial authority", event.ID)
	}
	if event.Type == "invoice.paid" && (strings.TrimSpace(event.Payer) == "" || strings.TrimSpace(event.TransactionHash) == "") {
		return fmt.Errorf("Pay source settlement %s is incomplete", event.ID)
	}
	return nil
}

func canonicalEventTypes(source chain.PayEvent) []string {
	switch source.Type {
	case "invoice.issued":
		return []string{"pay.invoice.created"}
	case "invoice.paid":
		if source.InvoiceID != "" {
			return []string{"pay.invoice.authorized", "pay.receipt.issued"}
		}
	default:
		return nil
	}
	return nil
}

func (b *Bridge) buildEnvelope(source chain.PayEvent, aggregateID, eventType string, sequence uint64) (datafabric.EventEnvelope, error) {
	kind := strings.TrimPrefix(eventType, "pay.")
	account := source.Payer
	if account == "" {
		account = source.Merchant
	}
	payload, err := json.Marshal(map[string]any{
		"status":            strings.ReplaceAll(kind, ".", "-"),
		"sourceEventId":     source.ID,
		"sourceAuditHash":   source.AuditHash,
		"invoiceId":         aggregateID,
		"objectId":          source.ObjectID,
		"merchant":          source.Merchant,
		"payer":             source.Payer,
		"payoutAddress":     source.PayoutAddress,
		"transactionHash":   source.TransactionHash,
		"amountMinor":       source.Amount,
		"currency":          source.Currency,
		"idempotencyKeyRef": source.IdempotencyKey,
	})
	if err != nil {
		return datafabric.EventEnvelope{}, err
	}
	envelope := datafabric.EventEnvelope{
		EventID: "event." + eventType + "." + source.ID, EventType: eventType,
		SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "pay", Service: "invoice",
		AggregateID: canonicalReference("invoice.pay.", aggregateID),
		Actor: datafabric.Actor{
			ActorID:   canonicalReference("actor.pay.", source.Merchant),
			AccountID: canonicalReference("account.pay.", account),
		},
		CorrelationID: canonicalReference("correlation.pay.", source.IntentID),
		CausationID:   canonicalReference("source.pay.", source.ID),
		Sequence:      sequence, Timestamp: source.CreatedAt.UTC(), EffectiveAt: source.CreatedAt.UTC(),
		SourceCommit: b.cfg.SourceCommit, SourceRelease: b.cfg.SourceRelease,
		PrivacyClassification: "confidential", RetentionClass: "financial-7y",
		AuditID: canonicalReference("audit.pay."+strings.ReplaceAll(kind, ".", "-")+".", source.ID),
		Source: datafabric.SourceMetadata{
			Source: "ynx-chain-pay-events", AsOf: source.CreatedAt.UTC(),
			Version: b.cfg.SourceRelease, Status: "authoritative",
		},
		Payload: payload,
	}
	if err := envelope.Sign(b.cfg.KeyID, b.cfg.SigningKey); err != nil {
		return datafabric.EventEnvelope{}, fmt.Errorf("sign canonical Pay event: %w", err)
	}
	return envelope, nil
}

func canonicalReference(prefix, value string) string {
	if canonicalID.MatchString(value) {
		return value
	}
	digest := sha256.Sum256([]byte(value))
	return prefix + hex.EncodeToString(digest[:12])
}

func paySourceEventID(event chain.PayEvent) string {
	return hashParts("pay-event", event.Type, event.IntentID, event.ObjectID, event.IdempotencyKey, fmt.Sprint(event.CreatedAt.UnixNano()))[:24]
}

func paySourceAuditHash(event chain.PayEvent) string {
	if event.Type == "invoice.paid" {
		if event.InvoiceID != "" {
			return hashParts("pay-event-audit", event.Type, event.IntentID, event.InvoiceID, event.ObjectID, event.Merchant, event.PayoutAddress, event.Payer, event.TransactionHash, fmt.Sprint(event.Amount), event.Currency, event.IdempotencyKey, event.CreatedAt.Format(time.RFC3339Nano))
		}
		return hashParts("pay-event-audit", event.Type, event.IntentID, event.ObjectID, event.Merchant, event.PayoutAddress, event.Payer, event.TransactionHash, fmt.Sprint(event.Amount), event.Currency, event.IdempotencyKey, event.CreatedAt.Format(time.RFC3339Nano))
	}
	if event.InvoiceID != "" {
		return hashParts("pay-event-audit", event.Type, event.IntentID, event.InvoiceID, event.ObjectID, event.Merchant, fmt.Sprint(event.Amount), event.Currency, event.IdempotencyKey, event.CreatedAt.Format(time.RFC3339Nano))
	}
	return hashParts("pay-event-audit", event.Type, event.IntentID, event.ObjectID, event.Merchant, fmt.Sprint(event.Amount), event.Currency, event.IdempotencyKey, event.CreatedAt.Format(time.RFC3339Nano))
}

func hashParts(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = hash.Write([]byte(part))
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}
