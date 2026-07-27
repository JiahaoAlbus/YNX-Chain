package cardproduct

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
	"path/filepath"
	"sync"
)

type stateEnvelope struct {
	Version int             `json:"version"`
	Payload json.RawMessage `json:"payload"`
	HMAC    string          `json:"hmac"`
}

type Store struct {
	path string
	key  []byte
	mu   sync.RWMutex
	data Snapshot
}

func OpenStore(path string, integrityKey []byte) (*Store, error) {
	if filepath.Clean(path) == "." || !filepath.IsAbs(path) {
		return nil, errors.New("card state path must be absolute")
	}
	if len(integrityKey) < 32 {
		return nil, errors.New("card integrity key must contain at least 32 bytes")
	}
	s := &Store{path: path, key: append([]byte(nil), integrityKey...), data: emptySnapshot()}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, err
		}
		if err := s.persistLocked(); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var env stateEnvelope
	if err := decodeStrict(raw, &env); err != nil {
		return nil, fmt.Errorf("card state integrity verification failed: %w", err)
	}
	var canonical bytes.Buffer
	if err := json.Compact(&canonical, env.Payload); err != nil {
		return nil, fmt.Errorf("card state integrity verification failed: %w", err)
	}
	if env.Version != StateVersion || !hmac.Equal([]byte(env.HMAC), []byte(hmacHex(integrityKey, canonical.Bytes()))) {
		return nil, errors.New("card state integrity verification failed")
	}
	if err := decodeStrict(canonical.Bytes(), &s.data); err != nil {
		return nil, fmt.Errorf("decode card state payload: %w", err)
	}
	if s.data.Version != StateVersion {
		return nil, errors.New("unsupported card state version")
	}
	if s.data.Notifications == nil {
		s.data.Notifications = map[string]Notification{}
	}
	return s, nil
}

func (s *Store) View(fn func(Snapshot) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	copy, err := cloneSnapshot(s.data)
	if err != nil {
		return err
	}
	return fn(copy)
}

func (s *Store) Update(fn func(*Snapshot) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	before, err := cloneSnapshot(s.data)
	if err != nil {
		return err
	}
	if err := fn(&s.data); err != nil {
		s.data = before
		return err
	}
	if err := s.persistLocked(); err != nil {
		s.data = before
		return err
	}
	return nil
}

func (s *Store) persistLocked() error {
	payload, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	env := stateEnvelope{Version: StateVersion, Payload: payload, HMAC: hmacHex(s.key, payload)}
	raw, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func cloneSnapshot(value Snapshot) (Snapshot, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return Snapshot{}, err
	}
	var out Snapshot
	if err := decodeStrict(raw, &out); err != nil {
		return Snapshot{}, err
	}
	return out, nil
}

func decodeStrict(raw []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return errors.New("multiple JSON values")
	}
	return nil
}

func hmacHex(key, body []byte) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
