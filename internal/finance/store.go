package finance

import (
	"crypto/rand"
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
	mu    sync.RWMutex
	path  string
	state persistedState
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path, state: persistedState{Version: 1, Accounts: map[string]AccountState{}, Nonces: map[string]time.Time{}}}
	if path == "" {
		return s, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read finance state: %w", err)
	}
	if err := json.Unmarshal(raw, &s.state); err != nil {
		return nil, fmt.Errorf("decode finance state: %w", err)
	}
	if s.state.Version != 1 || s.state.Accounts == nil || s.state.Nonces == nil {
		return nil, errors.New("unsupported or incomplete finance state")
	}
	return s, nil
}

func (s *Store) Account(account string) AccountState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneAccountState(s.accountLocked(account))
}

func (s *Store) Update(account, action, objectID string, fn func(*AccountState) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.accountLocked(account)
	if err := fn(&state); err != nil {
		return err
	}
	s.state.Accounts[account] = state
	s.state.Audit = append(s.state.Audit, AuditEvent{ID: newID("audit"), Account: account, Action: action, ObjectID: objectID, CreatedAt: time.Now().UTC()})
	if len(s.state.Audit) > 2000 {
		s.state.Audit = append([]AuditEvent(nil), s.state.Audit[len(s.state.Audit)-2000:]...)
	}
	return s.saveLocked()
}

func (s *Store) UseNonce(nonce string, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	for key, expiry := range s.state.Nonces {
		if !expiry.After(now) {
			delete(s.state.Nonces, key)
		}
	}
	if _, exists := s.state.Nonces[nonce]; exists {
		return errors.New("wallet assertion nonce has already been used")
	}
	s.state.Nonces[nonce] = expiresAt
	return s.saveLocked()
}

func (s *Store) Audit(account string) []AuditEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]AuditEvent, 0)
	for _, event := range s.state.Audit {
		if event.Account == account {
			out = append(out, event)
		}
	}
	return out
}

func (s *Store) accountLocked(account string) AccountState {
	state, ok := s.state.Accounts[account]
	if !ok {
		state = AccountState{Categories: []Category{}, Budgets: []Budget{}, Reminders: []Reminder{}, Classifications: map[string]Classification{}, AIJobs: []AIJob{}, Idempotency: map[string]string{}, Privacy: Privacy{IncludePayInStatements: true, AlertsEnabled: true}}
	}
	if state.Classifications == nil {
		state.Classifications = map[string]Classification{}
	}
	if state.Idempotency == nil {
		state.Idempotency = map[string]string{}
	}
	return state
}

func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}
	raw, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func cloneAccountState(state AccountState) AccountState {
	raw, _ := json.Marshal(state)
	var out AccountState
	_ = json.Unmarshal(raw, &out)
	return out
}

func newID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}
