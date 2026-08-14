package payproduct

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

type diskEnvelope struct {
	Version int             `json:"version"`
	Payload json.RawMessage `json:"payload"`
	MAC     string          `json:"mac"`
}

type Store struct {
	mu           sync.RWMutex
	path         string
	integrityKey []byte
	data         Snapshot
}

func OpenStore(path string, integrityKey []byte) (*Store, error) {
	if len(integrityKey) < 32 {
		return nil, errors.New("pay product integrity key must contain at least 32 bytes")
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return &Store{path: path, integrityKey: append([]byte(nil), integrityKey...), data: emptySnapshot()}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read pay product store: %w", err)
	}
	return decodeStoreBytes(path, raw, integrityKey)
}

func decodeStoreBytes(path string, raw, integrityKey []byte) (*Store, error) {
	if len(integrityKey) < 32 {
		return nil, errors.New("pay product integrity key must contain at least 32 bytes")
	}
	s := &Store{path: path, integrityKey: append([]byte(nil), integrityKey...), data: emptySnapshot()}
	var env diskEnvelope
	if err := strictJSON(raw, &env); err != nil {
		return nil, fmt.Errorf("decode pay product store: %w", err)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, env.Payload); err != nil || env.Version != 1 || !hmac.Equal([]byte(env.MAC), []byte(s.mac(compact.Bytes()))) {
		return nil, errors.New("pay product store integrity check failed")
	}
	var fields map[string]json.RawMessage
	if err := strictJSON(env.Payload, &fields); err != nil {
		return nil, fmt.Errorf("decode pay product snapshot fields: %w", err)
	}
	// Sessions produced by the removed product-local Wallet verifier are never
	// migrated. Central Gateway assertions are short-lived and reconstructed.
	delete(fields, "walletChallenges")
	delete(fields, "walletSessions")
	migrated, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	if err := strictJSON(migrated, &s.data); err != nil {
		return nil, fmt.Errorf("decode pay product snapshot: %w", err)
	}
	if s.data.Version != 1 {
		return nil, fmt.Errorf("unsupported pay product snapshot version %d", s.data.Version)
	}
	s.normalize()
	return s, nil
}

func emptySnapshot() Snapshot {
	return Snapshot{Version: 1, Merchants: map[string]Merchant{}, MerchantMembers: map[string]MerchantMember{}, ConsoleSessions: map[string]MerchantConsoleSession{}, GatewaySeen: map[string]time.Time{}, Catalog: map[string]CatalogItem{}, Invoices: map[string]Invoice{}, Refunds: map[string]RefundRequest{}, Disputes: map[string]Dispute{}, Deliveries: map[string]WebhookDelivery{}, AIRuns: map[string]AIRun{}, Idempotency: map[string]IdempotencyRecord{}, Nonces: map[string]NonceRecord{}, Sponsorships: map[string]SponsorshipQuote{}, BridgeTransfers: map[string]BridgeTransfer{}, RouteQuotes: map[string]PaymentRouteQuote{}, RecurringDrafts: map[string]RecurringDraft{}, SplitPayments: map[string]SplitPayment{}, QuantBills: map[string]QuantBill{}, Audit: []AuditEntry{}}
}
func (s *Store) normalize() {
	e := emptySnapshot()
	if s.data.Merchants == nil {
		s.data.Merchants = e.Merchants
	}
	if s.data.MerchantMembers == nil {
		s.data.MerchantMembers = e.MerchantMembers
	}
	if s.data.ConsoleSessions == nil {
		s.data.ConsoleSessions = e.ConsoleSessions
	}
	if s.data.GatewaySeen == nil {
		s.data.GatewaySeen = e.GatewaySeen
	}
	if s.data.Catalog == nil {
		s.data.Catalog = e.Catalog
	}
	if s.data.Invoices == nil {
		s.data.Invoices = e.Invoices
	}
	if s.data.Refunds == nil {
		s.data.Refunds = e.Refunds
	}
	if s.data.Disputes == nil {
		s.data.Disputes = e.Disputes
	}
	if s.data.Deliveries == nil {
		s.data.Deliveries = e.Deliveries
	}
	for id, delivery := range s.data.Deliveries {
		if delivery.Status == "failed" {
			at := delivery.UpdatedAt.UTC()
			delivery.Status = "dead_letter"
			delivery.DeadLetteredAt = &at
			delivery.NextAttemptAt = time.Time{}
			s.data.Deliveries[id] = delivery
		}
	}
	if s.data.AIRuns == nil {
		s.data.AIRuns = e.AIRuns
	}
	if s.data.Idempotency == nil {
		s.data.Idempotency = e.Idempotency
	}
	if s.data.Nonces == nil {
		s.data.Nonces = e.Nonces
	}
	if s.data.Sponsorships == nil {
		s.data.Sponsorships = e.Sponsorships
	}
	if s.data.BridgeTransfers == nil {
		s.data.BridgeTransfers = e.BridgeTransfers
	}
	if s.data.RouteQuotes == nil {
		s.data.RouteQuotes = e.RouteQuotes
	}
	if s.data.RecurringDrafts == nil {
		s.data.RecurringDrafts = e.RecurringDrafts
	}
	if s.data.SplitPayments == nil {
		s.data.SplitPayments = e.SplitPayments
	}
	if s.data.QuantBills == nil {
		s.data.QuantBills = e.QuantBills
	}
}

func (s *Store) View(fn func(Snapshot) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return fn(cloneSnapshot(s.data))
}
func (s *Store) Update(fn func(*Snapshot) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneSnapshot(s.data)
	if err := fn(&next); err != nil {
		return err
	}
	if err := s.persist(next); err != nil {
		return err
	}
	s.data = next
	return nil
}
func (s *Store) persist(data Snapshot) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	env := diskEnvelope{Version: 1, Payload: payload, MAC: s.mac(payload)}
	raw, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return err
	}
	return atomicWritePrivateFile(s.path, raw)
}
func (s *Store) mac(payload []byte) string {
	h := hmac.New(sha256.New, s.integrityKey)
	_, _ = h.Write(payload)
	return hex.EncodeToString(h.Sum(nil))
}
func cloneSnapshot(in Snapshot) Snapshot {
	raw, _ := json.Marshal(in)
	var out Snapshot
	_ = json.Unmarshal(raw, &out)
	return out
}
func strictJSON(raw []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
