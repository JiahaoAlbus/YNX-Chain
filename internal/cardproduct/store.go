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
	"reflect"
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
	snapshot, err := decodeStateDocument(raw, integrityKey)
	if err != nil {
		return nil, err
	}
	s.data = snapshot
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
	if reflect.DeepEqual(s.data, before) {
		return nil
	}
	if err := s.persistLocked(); err != nil {
		s.data = before
		return err
	}
	return nil
}

func (s *Store) persistLocked() error {
	raw, err := encodeStateDocument(s.data, s.key)
	if err != nil {
		return err
	}
	return atomicWriteFile(s.path, raw, true)
}

func encodeStateDocument(snapshot Snapshot, integrityKey []byte) ([]byte, error) {
	if len(integrityKey) < 32 {
		return nil, errors.New("card integrity key must contain at least 32 bytes")
	}
	normalizeSnapshot(&snapshot)
	if err := validateBackupSnapshot(snapshot); err != nil {
		return nil, fmt.Errorf("validate card state before persistence: %w", err)
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	envelope := stateEnvelope{Version: StateVersion, Payload: payload, HMAC: hmacHex(integrityKey, payload)}
	raw, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func decodeStateDocument(raw, integrityKey []byte) (Snapshot, error) {
	if len(integrityKey) < 32 {
		return Snapshot{}, errors.New("card integrity key must contain at least 32 bytes")
	}
	var envelope stateEnvelope
	if err := decodeStrict(raw, &envelope); err != nil {
		return Snapshot{}, fmt.Errorf("card state integrity verification failed: %w", err)
	}
	var canonical bytes.Buffer
	if err := json.Compact(&canonical, envelope.Payload); err != nil {
		return Snapshot{}, fmt.Errorf("card state integrity verification failed: %w", err)
	}
	if envelope.Version != StateVersion || !hmac.Equal([]byte(envelope.HMAC), []byte(hmacHex(integrityKey, canonical.Bytes()))) {
		return Snapshot{}, errors.New("card state integrity verification failed")
	}
	var snapshot Snapshot
	if err := decodeStrict(canonical.Bytes(), &snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("decode card state payload: %w", err)
	}
	normalizeSnapshot(&snapshot)
	if err := validateBackupSnapshot(snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("validate card state payload: %w", err)
	}
	return snapshot, nil
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
