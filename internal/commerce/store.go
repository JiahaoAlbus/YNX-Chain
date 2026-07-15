package commerce

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
	mu   sync.Mutex
	path string
	now  func() time.Time
	s    Snapshot
}

func Open(path string) (*Store, error) {
	st := &Store{path: path, now: func() time.Time { return time.Now().UTC() }}
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
	if err := json.Unmarshal(data, &st.s); err != nil {
		return nil, fmt.Errorf("decode commerce state: %w", err)
	}
	st.normalize()
	return st, nil
}

func emptySnapshot() Snapshot {
	return Snapshot{Version: 1, Stores: map[string]StoreProfile{}, Products: map[string]Product{}, Orders: map[string]Order{}, Sessions: map[string]Session{}, Challenges: map[string]WalletChallenge{}, Idempotency: map[string]IdempotencyRecord{}, AIJobs: map[string]AIJob{}, BuyerProfiles: map[string]BuyerProfile{}, Carts: map[string]Cart{}, SellerRoles: map[string]map[string]string{}, RequestWindow: map[string][]time.Time{}}
}

func (s *Store) normalize() {
	if s.s.Stores == nil {
		s.s.Stores = map[string]StoreProfile{}
	}
	if s.s.Products == nil {
		s.s.Products = map[string]Product{}
	}
	if s.s.Orders == nil {
		s.s.Orders = map[string]Order{}
	}
	if s.s.Sessions == nil {
		s.s.Sessions = map[string]Session{}
	}
	if s.s.Challenges == nil {
		s.s.Challenges = map[string]WalletChallenge{}
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
}

func (s *Store) persistLocked() error {
	if s.path == "" {
		return nil
	}
	data, err := json.MarshalIndent(s.s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
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
	return os.Rename(tmp, s.path)
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
