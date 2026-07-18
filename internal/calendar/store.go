package calendar

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

type Store struct {
	mu   sync.Mutex
	path string
	key  []byte
	data State
}

type diskEnvelope struct {
	SchemaVersion int             `json:"schemaVersion"`
	State         json.RawMessage `json:"state"`
	HMAC          string          `json:"hmac"`
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, data: emptyState()}
	if path == "" {
		return s, nil
	}
	key, err := loadOrCreateStoreKey(path+".hmac-key", path)
	if err != nil {
		return nil, err
	}
	s.key = key
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var envelope diskEnvelope
	if err = decodeStrict(b, &envelope); err != nil {
		return nil, fmt.Errorf("decode authenticated Calendar state: %w", err)
	}
	if envelope.SchemaVersion != 1 || len(envelope.State) == 0 || envelope.HMAC == "" {
		return nil, errors.New("invalid authenticated Calendar state envelope")
	}
	var canonicalState bytes.Buffer
	if err := json.Compact(&canonicalState, envelope.State); err != nil {
		return nil, errors.New("invalid Calendar state payload JSON")
	}
	want := hmacSHA256(key, canonicalState.Bytes())
	got, err := base64.RawURLEncoding.DecodeString(envelope.HMAC)
	if err != nil || !hmac.Equal(got, want) {
		return nil, errors.New("Calendar state HMAC mismatch")
	}
	if err = decodeStrict(envelope.State, &s.data); err != nil {
		return nil, fmt.Errorf("decode Calendar state payload: %w", err)
	}
	s.normalize()
	return s, nil
}
func emptyState() State {
	return State{Users: map[string]User{}, Challenges: map[string]Challenge{}, Sessions: map[string]Session{}, WalletRequests: map[string]bool{}, Events: map[string]Event{}, ReminderDeliveries: map[string]ReminderDelivery{}, Changes: map[string]ChangePreview{}, Mutations: map[string]string{}, AIJobs: map[string]AIJob{}}
}
func (s *Store) normalize() {
	if s.data.Users == nil {
		s.data.Users = map[string]User{}
	}
	if s.data.Challenges == nil {
		s.data.Challenges = map[string]Challenge{}
	}
	if s.data.Sessions == nil {
		s.data.Sessions = map[string]Session{}
	}
	if s.data.WalletRequests == nil {
		s.data.WalletRequests = map[string]bool{}
	}
	if s.data.Events == nil {
		s.data.Events = map[string]Event{}
	}
	if s.data.ReminderDeliveries == nil {
		s.data.ReminderDeliveries = map[string]ReminderDelivery{}
	}
	if s.data.Changes == nil {
		s.data.Changes = map[string]ChangePreview{}
	}
	if s.data.Mutations == nil {
		s.data.Mutations = map[string]string{}
	}
	if s.data.AIJobs == nil {
		s.data.AIJobs = map[string]AIJob{}
	}
}
func (s *Store) update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(s.data)
	var next State
	_ = json.Unmarshal(b, &next)
	if err := fn(&next); err != nil {
		return err
	}
	if s.path != "" {
		if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
			return err
		}
		stateBytes, err := json.Marshal(next)
		if err != nil {
			return err
		}
		envelope := diskEnvelope{SchemaVersion: 1, State: stateBytes, HMAC: base64.RawURLEncoding.EncodeToString(hmacSHA256(s.key, stateBytes))}
		body, err := json.MarshalIndent(envelope, "", "  ")
		if err != nil {
			return err
		}
		tmp := s.path + ".tmp"
		if err = os.WriteFile(tmp, body, 0o600); err != nil {
			return err
		}
		if current, err := os.ReadFile(s.path); err == nil {
			if err := os.WriteFile(s.path+".bak", current, 0o600); err != nil {
				return err
			}
		}
		if err = os.Rename(tmp, s.path); err != nil {
			return err
		}
	}
	s.data = next
	return nil
}

func loadOrCreateStoreKey(keyPath, statePath string) ([]byte, error) {
	if raw, err := os.ReadFile(keyPath); err == nil {
		if len(raw) != 32 {
			return nil, errors.New("Calendar state HMAC key must be exactly 32 bytes")
		}
		return raw, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if _, err := os.Stat(statePath); err == nil {
		return nil, errors.New("Calendar state HMAC key is missing; refusing unauthenticated recovery")
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(keyPath), 0o700); err != nil {
		return nil, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func decodeStrict(body []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("state must contain one JSON value")
	}
	return nil
}

func hmacSHA256(key, body []byte) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(body)
	return mac.Sum(nil)
}
func (s *Store) view(fn func(State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(s.data)
	var snap State
	_ = json.Unmarshal(b, &snap)
	return fn(snap)
}
