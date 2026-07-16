package video

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Store struct {
	mu              sync.RWMutex
	root, statePath string
	integrityKey    []byte
	state           State
}

func OpenStore(root string, integrityKey []byte) (*Store, error) {
	if root == "" {
		return nil, errors.New("video store root is required")
	}
	if err := os.MkdirAll(filepath.Join(root, "objects"), 0700); err != nil {
		return nil, err
	}
	if len(integrityKey) < 32 {
		return nil, errors.New("video store integrity key must be at least 32 bytes")
	}
	s := &Store{root: root, statePath: filepath.Join(root, "state.json"), integrityKey: append([]byte(nil), integrityKey...), state: emptyState()}
	b, err := os.ReadFile(s.statePath)
	if err == nil {
		if err = json.Unmarshal(b, &s.state); err != nil {
			return nil, err
		}
		normalize(&s.state)
		if err = s.verifyIntegrity(); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func emptyState() State { s := State{}; normalize(&s); return s }
func normalize(s *State) {
	if s.Videos == nil {
		s.Videos = map[string]*Video{}
	}
	if s.Channels == nil {
		s.Channels = map[string]*Channel{}
	}
	if s.Subscriptions == nil {
		s.Subscriptions = map[string]Subscription{}
	}
	if s.Playlists == nil {
		s.Playlists = map[string]*Playlist{}
	}
	if s.Comments == nil {
		s.Comments = map[string]*Comment{}
	}
	if s.WatchEvents == nil {
		s.WatchEvents = map[string]WatchEvent{}
	}
	if s.Reports == nil {
		s.Reports = map[string]*Report{}
	}
	if s.Appeals == nil {
		s.Appeals = map[string]*Appeal{}
	}
	if s.Monetization == nil {
		s.Monetization = map[string]*Monetization{}
	}
	if s.PayoutIntents == nil {
		s.PayoutIntents = map[string]*PayoutIntent{}
	}
	if s.Revenue == nil {
		s.Revenue = map[string]*RevenueRecord{}
	}
	if s.Disputes == nil {
		s.Disputes = map[string]*Dispute{}
	}
	if s.AIJobs == nil {
		s.AIJobs = map[string]*AIJob{}
	}
	if s.GatewayNonces == nil {
		s.GatewayNonces = map[string]GatewayNonce{}
	}
}
func (s *Store) read(fn func(State) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return fn(s.state)
}
func (s *Store) update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := fn(&s.state); err != nil {
		return err
	}
	if err := validateAuditChain(s.state.Audit); err != nil {
		return err
	}
	s.state.Integrity = ""
	canonical, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, s.integrityKey)
	_, _ = mac.Write(canonical)
	s.state.Integrity = hex.EncodeToString(mac.Sum(nil))
	b, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.statePath + ".tmp"
	if err = os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	f, err := os.OpenFile(tmp, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	f.Close()
	return os.Rename(tmp, s.statePath)
}

func (s *Store) verifyIntegrity() error {
	provided := s.state.Integrity
	if len(provided) != sha256.Size*2 {
		return errors.New("video state integrity tag is missing or invalid")
	}
	s.state.Integrity = ""
	canonical, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, s.integrityKey)
	_, _ = mac.Write(canonical)
	expected := mac.Sum(nil)
	actual, err := hex.DecodeString(provided)
	if err != nil || !hmac.Equal(actual, expected) {
		return errors.New("video state integrity verification failed")
	}
	s.state.Integrity = provided
	return validateAuditChain(s.state.Audit)
}

func validateAuditChain(events []AuditEvent) error {
	previous := ""
	for i, event := range events {
		if event.Sequence != uint64(i+1) || event.PreviousHash != previous || event.Hash != auditEventHash(event) {
			return errors.New("video audit hash chain is invalid")
		}
		previous = event.Hash
	}
	return nil
}

func auditEventHash(event AuditEvent) string {
	material := []byte(fmt.Sprintf("%d\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s", event.Sequence, event.ID, event.Actor, event.Action, event.ObjectType, event.ObjectID, event.Detail, event.At.UTC().Format(time.RFC3339Nano), event.PayloadHash+"\n"+event.PreviousHash))
	sum := sha256.Sum256(material)
	return hex.EncodeToString(sum[:])
}
