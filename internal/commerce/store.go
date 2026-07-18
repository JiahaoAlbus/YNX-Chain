package commerce

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrConflict     = errors.New("conflict")
	ErrUnavailable  = errors.New("unavailable")
	ErrInvalidState = errors.New("invalid state transition")
	ErrInventory    = errors.New("insufficient inventory")
)

type Store struct {
	mu           sync.Mutex
	path         string
	integrityKey []byte
	now          func() time.Time
	s            Snapshot
}

func Open(path string) (*Store, error) {
	return open(path, nil)
}

func OpenWithIntegrity(path string, key []byte) (*Store, error) {
	if len(key) < 32 {
		return nil, errors.New("commerce state integrity key must be at least 32 bytes")
	}
	return open(path, append([]byte(nil), key...))
}

type persistedEnvelope struct {
	Version  int             `json:"version"`
	Snapshot json.RawMessage `json:"snapshot"`
	HMAC     string          `json:"hmac"`
}

func open(path string, integrityKey []byte) (*Store, error) {
	st := &Store{path: path, integrityKey: integrityKey, now: func() time.Time { return time.Now().UTC() }}
	st.s = emptySnapshot()
	if path == "" {
		return st, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return st, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read commerce state: %w", err)
	}
	if err := decodePersisted(data, integrityKey, &st.s); err != nil {
		return nil, fmt.Errorf("decode commerce state: %w", err)
	}
	migrated := st.normalize()
	if migrated {
		st.mu.Lock()
		err = st.persistLocked()
		st.mu.Unlock()
		if err != nil {
			return nil, fmt.Errorf("migrate commerce state: %w", err)
		}
	}
	return st, nil
}

func decodePersisted(data, key []byte, out *Snapshot) error {
	if len(key) == 0 {
		return json.Unmarshal(data, out)
	}
	var envelope persistedEnvelope
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("single integrity envelope required")
	}
	if envelope.Version != 1 || len(envelope.Snapshot) == 0 || len(envelope.HMAC) != 64 {
		return errors.New("invalid commerce state integrity envelope")
	}
	want, err := hex.DecodeString(envelope.HMAC)
	if err != nil {
		return errors.New("invalid commerce state HMAC encoding")
	}
	mac := hmac.New(sha256.New, key)
	var canonical bytes.Buffer
	if err := json.Compact(&canonical, envelope.Snapshot); err != nil {
		return errors.New("invalid commerce state snapshot")
	}
	_, _ = mac.Write(canonical.Bytes())
	if !hmac.Equal(want, mac.Sum(nil)) {
		return errors.New("commerce state HMAC mismatch")
	}
	return json.Unmarshal(envelope.Snapshot, out)
}

func emptySnapshot() Snapshot {
	return Snapshot{Version: 2, Stores: map[string]StoreProfile{}, Products: map[string]Product{}, Orders: map[string]Order{}, Idempotency: map[string]IdempotencyRecord{}, AIJobs: map[string]AIJob{}, BuyerProfiles: map[string]BuyerProfile{}, Carts: map[string]Cart{}, SellerRoles: map[string]map[string]string{}, RequestWindow: map[string][]time.Time{}}
}

func (s *Store) normalize() bool {
	migrated := s.s.Version < 2
	s.s.Version = 2
	if s.s.Stores == nil {
		s.s.Stores = map[string]StoreProfile{}
	}
	if s.s.Products == nil {
		s.s.Products = map[string]Product{}
	}
	if s.s.Orders == nil {
		s.s.Orders = map[string]Order{}
	}
	if s.s.Idempotency == nil {
		s.s.Idempotency = map[string]IdempotencyRecord{}
	}
	if s.s.AIJobs == nil {
		s.s.AIJobs = map[string]AIJob{}
	}
	if s.s.BuyerProfiles == nil {
		s.s.BuyerProfiles = map[string]BuyerProfile{}
	}
	if s.s.Carts == nil {
		s.s.Carts = map[string]Cart{}
	}
	if s.s.SellerRoles == nil {
		s.s.SellerRoles = map[string]map[string]string{}
	}
	if s.s.RequestWindow == nil {
		s.s.RequestWindow = map[string][]time.Time{}
	}
	return migrated
}

func (s *Store) persistLocked() error {
	if s.path == "" {
		return nil
	}
	snapshot, err := json.Marshal(s.s)
	if err != nil {
		return err
	}
	data := snapshot
	if len(s.integrityKey) > 0 {
		mac := hmac.New(sha256.New, s.integrityKey)
		_, _ = mac.Write(snapshot)
		data, err = json.MarshalIndent(persistedEnvelope{Version: 1, Snapshot: snapshot, HMAC: hex.EncodeToString(mac.Sum(nil))}, "", "  ")
		if err != nil {
			return err
		}
	} else {
		data, err = json.MarshalIndent(s.s, "", "  ")
		if err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	if current, readErr := os.ReadFile(s.path); readErr == nil {
		if err := atomicWrite(s.path+".bak", current); err != nil {
			return fmt.Errorf("write commerce backup: %w", err)
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return readErr
	}
	return atomicWrite(s.path, data)
}

func atomicWrite(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	f, err := os.OpenFile(tmp, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func RestoreCommerceBackup(path string, key []byte) error {
	backup, err := os.ReadFile(path + ".bak")
	if err != nil {
		return fmt.Errorf("read commerce backup: %w", err)
	}
	var snapshot Snapshot
	if err := decodePersisted(backup, key, &snapshot); err != nil {
		return fmt.Errorf("verify commerce backup: %w", err)
	}
	return atomicWrite(path, bytes.TrimSpace(backup))
}

func newID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}
func requestHash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func idemMapKey(actor, route, key string) string { return actor + "\x00" + route + "\x00" + key }

func (s *Store) idempotencyLocked(actor, route, key string, input any) (string, bool, error) {
	if len(key) < 8 || len(key) > 128 {
		return "", false, errors.New("idempotency key must contain 8 to 128 characters")
	}
	h := requestHash(input)
	rec, ok := s.s.Idempotency[idemMapKey(actor, route, key)]
	if !ok {
		return h, false, nil
	}
	if rec.RequestHash != h {
		return "", false, fmt.Errorf("%w: idempotency key reused with different request", ErrConflict)
	}
	return rec.ObjectID, true, nil
}

func (s *Store) recordIdempotencyLocked(actor, route, key, hash, objectID string) {
	s.s.Idempotency[idemMapKey(actor, route, key)] = IdempotencyRecord{Actor: actor, Route: route, Key: key, RequestHash: hash, ObjectID: objectID, CreatedAt: s.now()}
}
func (s *Store) auditLocked(actor, role, action, typ, id, outcome, detail string) {
	s.s.Audits = append(s.s.Audits, AuditEvent{ID: newID("audit"), Actor: actor, Role: role, Action: action, ObjectType: typ, ObjectID: id, Outcome: outcome, Detail: detail, At: s.now()})
}

func (s *Store) orderEventLocked(order *Order, actor, role, action, status, detail string) {
	order.Timeline = append(order.Timeline, OrderEvent{ID: newID("event"), Actor: actor, Role: role, Action: action, Status: status, Detail: detail, At: s.now()})
}

func (s *Store) Allow(subject, action string, limit int, window time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	key := subject + "\x00" + action
	cutoff := now.Add(-window)
	recent := s.s.RequestWindow[key][:0]
	for _, at := range s.s.RequestWindow[key] {
		if at.After(cutoff) {
			recent = append(recent, at)
		}
	}
	if len(recent) >= limit {
		s.s.RequestWindow[key] = recent
		_ = s.persistLocked()
		return false
	}
	s.s.RequestWindow[key] = append(recent, now)
	_ = s.persistLocked()
	return true
}

func (s *Store) AuditFor(actor string) []AuditEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []AuditEvent{}
	for _, e := range s.s.Audits {
		if actor == "" || e.Actor == actor {
			out = append(out, e)
		}
	}
	return out
}

func (s *Store) Products(query, category string) []Product {
	s.mu.Lock()
	defer s.mu.Unlock()
	query = strings.ToLower(strings.TrimSpace(query))
	out := []Product{}
	for _, p := range s.s.Products {
		if !p.Published {
			continue
		}
		if category != "" && p.Category != category {
			continue
		}
		hay := strings.ToLower(p.Title + " " + p.Description)
		if query != "" && !strings.Contains(hay, query) {
			continue
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

func (s *Store) Product(id string) (Product, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.s.Products[id]
	if !ok {
		return Product{}, ErrNotFound
	}
	return p, nil
}

func (s *Store) recoverExpiredLocked() bool {
	changed := false
	now := s.now()
	for id, o := range s.s.Orders {
		if o.Status != "payment_pending" || o.ReservationExpiresAt.After(now) {
			continue
		}
		for _, line := range o.Lines {
			p := s.s.Products[line.ProductID]
			for i := range p.Variants {
				if p.Variants[i].ID == line.VariantID {
					p.Variants[i].Reserved -= line.Quantity
					if p.Variants[i].Reserved < 0 {
						p.Variants[i].Reserved = 0
					}
				}
			}
			s.s.Products[p.ID] = p
		}
		o.Status = "expired"
		o.UpdatedAt = now
		s.orderEventLocked(&o, "reservation-recovery", "system", "reservation_expired", "expired", "unpaid inventory reservation released")
		s.s.Orders[id] = o
		s.auditLocked(o.Buyer, "buyer", "reservation_expired", "order", id, "released", "unpaid inventory reservation released")
		changed = true
	}
	return changed
}

func (s *Store) Recover() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recoverExpiredLocked() {
		return s.persistLocked()
	}
	return nil
}
