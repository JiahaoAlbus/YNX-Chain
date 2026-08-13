package calendar

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
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

type backupEnvelope struct {
	SchemaVersion      int             `json:"schemaVersion"`
	ProductID          string          `json:"productId"`
	StateSchemaVersion int             `json:"stateSchemaVersion"`
	CreatedAt          time.Time       `json:"createdAt"`
	StateSHA256        string          `json:"stateSha256"`
	State              json.RawMessage `json:"state"`
	HMAC               string          `json:"hmac"`
}

type RestoreResult struct {
	ProductID          string    `json:"productId"`
	StateSchemaVersion int       `json:"stateSchemaVersion"`
	StateSHA256        string    `json:"stateSha256"`
	Target             string    `json:"target"`
	RestoredAt         time.Time `json:"restoredAt"`
	Users              int       `json:"users"`
	Events             int       `json:"events"`
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
	if s.data.SchemaVersion < 0 || s.data.SchemaVersion > StateSchemaVersion {
		return nil, fmt.Errorf("unsupported Calendar state schema version %d", s.data.SchemaVersion)
	}
	s.normalize()
	return s, nil
}
func emptyState() State {
	return State{SchemaVersion: StateSchemaVersion, Users: map[string]User{}, Challenges: map[string]Challenge{}, Sessions: map[string]Session{}, WalletRequests: map[string]bool{}, Events: map[string]Event{}, SharedCalendars: map[string]SharedCalendar{}, ReminderDeliveries: map[string]ReminderDelivery{}, Changes: map[string]ChangePreview{}, Mutations: map[string]string{}, AIJobs: map[string]AIJob{}}
}
func (s *Store) normalize() {
	normalizeState(&s.data)
}
func normalizeState(state *State) {
	if state.SchemaVersion == 0 {
		state.SchemaVersion = StateSchemaVersion
	}
	if state.Users == nil {
		state.Users = map[string]User{}
	}
	if state.Challenges == nil {
		state.Challenges = map[string]Challenge{}
	}
	if state.Sessions == nil {
		state.Sessions = map[string]Session{}
	}
	if state.WalletRequests == nil {
		state.WalletRequests = map[string]bool{}
	}
	if state.Events == nil {
		state.Events = map[string]Event{}
	}
	if state.SharedCalendars == nil {
		state.SharedCalendars = map[string]SharedCalendar{}
	}
	if state.ReminderDeliveries == nil {
		state.ReminderDeliveries = map[string]ReminderDelivery{}
	}
	if state.Changes == nil {
		state.Changes = map[string]ChangePreview{}
	}
	if state.Mutations == nil {
		state.Mutations = map[string]string{}
	}
	if state.AIJobs == nil {
		state.AIJobs = map[string]AIJob{}
	}
	normalizeEvent := func(event Event) Event {
		if event.SeriesID == "" {
			event.SeriesID = event.ID
		}
		if event.Recurrence.Frequency != "" && event.Recurrence.SchemaVersion == 0 {
			event.Recurrence.SchemaVersion = 1
		}
		return event
	}
	for id, event := range state.Events {
		state.Events[id] = normalizeEvent(event)
	}
	for id, change := range state.Changes {
		change.After = normalizeEvent(change.After)
		if change.Before != nil {
			before := normalizeEvent(*change.Before)
			change.Before = &before
		}
		for i := range change.RelatedBefore {
			change.RelatedBefore[i] = normalizeEvent(change.RelatedBefore[i])
		}
		for i := range change.RelatedAfter {
			change.RelatedAfter[i] = normalizeEvent(change.RelatedAfter[i])
		}
		state.Changes[id] = change
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
	normalizeState(&next)
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

func (s *Store) CreateBackupAt(createdAt time.Time) ([]byte, error) {
	if s.path == "" || len(s.key) != 32 {
		return nil, errors.New("Calendar backup requires a persistent authenticated store")
	}
	if createdAt.IsZero() {
		return nil, errors.New("Calendar backup timestamp is required")
	}
	createdAt = createdAt.UTC().Truncate(time.Second)
	s.mu.Lock()
	defer s.mu.Unlock()
	stateBytes, err := json.Marshal(s.data)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(stateBytes)
	envelope := backupEnvelope{
		SchemaVersion:      1,
		ProductID:          ProductID,
		StateSchemaVersion: StateSchemaVersion,
		CreatedAt:          createdAt,
		StateSHA256:        hex.EncodeToString(digest[:]),
		State:              stateBytes,
	}
	macBody, err := backupMACBody(envelope)
	if err != nil {
		return nil, err
	}
	envelope.HMAC = base64.RawURLEncoding.EncodeToString(hmacSHA256(s.key, macBody))
	return json.MarshalIndent(envelope, "", "  ")
}

func (s *Store) RestoreBackupTo(restoreRoot, relativeTarget string, body []byte, now time.Time, maxAge time.Duration) (RestoreResult, error) {
	if s.path == "" || len(s.key) != 32 {
		return RestoreResult{}, errors.New("Calendar restore requires a persistent authenticated source store")
	}
	if now.IsZero() {
		return RestoreResult{}, errors.New("Calendar restore timestamp is required")
	}
	var envelope backupEnvelope
	if err := decodeStrict(body, &envelope); err != nil {
		return RestoreResult{}, fmt.Errorf("decode Calendar backup: %w", err)
	}
	if envelope.SchemaVersion != 1 {
		return RestoreResult{}, fmt.Errorf("unsupported Calendar backup schema version %d", envelope.SchemaVersion)
	}
	if envelope.ProductID != ProductID {
		return RestoreResult{}, fmt.Errorf("Calendar backup belongs to product %q", envelope.ProductID)
	}
	if envelope.StateSchemaVersion != StateSchemaVersion {
		return RestoreResult{}, fmt.Errorf("unsupported Calendar backup state schema version %d", envelope.StateSchemaVersion)
	}
	if envelope.CreatedAt.IsZero() {
		return RestoreResult{}, errors.New("Calendar backup timestamp is missing")
	}
	now = now.UTC()
	createdAt := envelope.CreatedAt.UTC()
	if createdAt.After(now.Add(5 * time.Minute)) {
		return RestoreResult{}, errors.New("Calendar backup timestamp is in the future")
	}
	if maxAge > 0 && now.Sub(createdAt) > maxAge {
		return RestoreResult{}, errors.New("Calendar backup is stale")
	}
	macBody, err := backupMACBody(envelope)
	if err != nil {
		return RestoreResult{}, err
	}
	gotMAC, err := base64.RawURLEncoding.DecodeString(envelope.HMAC)
	if err != nil || !hmac.Equal(gotMAC, hmacSHA256(s.key, macBody)) {
		return RestoreResult{}, errors.New("Calendar backup HMAC mismatch")
	}
	var canonicalState bytes.Buffer
	if err := json.Compact(&canonicalState, envelope.State); err != nil {
		return RestoreResult{}, errors.New("invalid Calendar backup state JSON")
	}
	digest := sha256.Sum256(canonicalState.Bytes())
	actualDigest := hex.EncodeToString(digest[:])
	if !strings.EqualFold(envelope.StateSHA256, actualDigest) {
		return RestoreResult{}, errors.New("Calendar backup state digest mismatch")
	}
	var state State
	if err := decodeStrict(envelope.State, &state); err != nil {
		return RestoreResult{}, fmt.Errorf("decode Calendar backup state: %w", err)
	}
	if state.SchemaVersion != StateSchemaVersion {
		return RestoreResult{}, fmt.Errorf("unsupported Calendar state schema version %d", state.SchemaVersion)
	}
	normalizeState(&state)
	target, err := resolveRestoreTarget(restoreRoot, relativeTarget)
	if err != nil {
		return RestoreResult{}, err
	}
	sourceAbs, err := filepath.Abs(s.path)
	if err != nil {
		return RestoreResult{}, err
	}
	if target == sourceAbs {
		return RestoreResult{}, errors.New("Calendar restore target must be isolated from the live store")
	}
	if _, err := os.Lstat(target); err == nil {
		return RestoreResult{}, errors.New("Calendar restore target already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return RestoreResult{}, err
	}
	if _, err := os.Lstat(target + ".hmac-key"); err == nil {
		return RestoreResult{}, errors.New("Calendar restore target key already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return RestoreResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return RestoreResult{}, err
	}
	targetKey := make([]byte, 32)
	if _, err := rand.Read(targetKey); err != nil {
		return RestoreResult{}, err
	}
	keyFile, err := os.OpenFile(target+".hmac-key", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return RestoreResult{}, err
	}
	if _, err = keyFile.Write(targetKey); err == nil {
		err = keyFile.Sync()
	}
	if closeErr := keyFile.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(target + ".hmac-key")
		return RestoreResult{}, err
	}
	cleanup := func() {
		_ = os.Remove(target)
		_ = os.Remove(target + ".hmac-key")
	}
	if err = writeAuthenticatedState(target, targetKey, state); err != nil {
		cleanup()
		return RestoreResult{}, err
	}
	restored, err := NewStore(target)
	if err != nil {
		cleanup()
		return RestoreResult{}, fmt.Errorf("verify restored Calendar state: %w", err)
	}
	restoredDigest, err := restored.stateDigest()
	if err != nil {
		cleanup()
		return RestoreResult{}, err
	}
	if !strings.EqualFold(restoredDigest, envelope.StateSHA256) {
		cleanup()
		return RestoreResult{}, errors.New("restored Calendar state digest mismatch")
	}
	return RestoreResult{
		ProductID:          ProductID,
		StateSchemaVersion: StateSchemaVersion,
		StateSHA256:        restoredDigest,
		Target:             filepath.Clean(relativeTarget),
		RestoredAt:         now,
		Users:              len(state.Users),
		Events:             len(state.Events),
	}, nil
}

func backupMACBody(envelope backupEnvelope) ([]byte, error) {
	envelope.HMAC = ""
	return json.Marshal(envelope)
}

func resolveRestoreTarget(root, relativeTarget string) (string, error) {
	if strings.TrimSpace(root) == "" || strings.TrimSpace(relativeTarget) == "" {
		return "", errors.New("Calendar restore root and relative target are required")
	}
	if filepath.IsAbs(relativeTarget) {
		return "", errors.New("Calendar restore target must be relative")
	}
	cleanTarget := filepath.Clean(relativeTarget)
	if cleanTarget == "." || cleanTarget == ".." || strings.HasPrefix(cleanTarget, ".."+string(filepath.Separator)) {
		return "", errors.New("Calendar restore target escapes the restore root")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	rootReal, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", fmt.Errorf("resolve Calendar restore root: %w", err)
	}
	rootInfo, err := os.Stat(rootReal)
	if err != nil {
		return "", err
	}
	if !rootInfo.IsDir() {
		return "", errors.New("Calendar restore root must be a directory")
	}
	targetAbs, err := filepath.Abs(filepath.Join(rootReal, cleanTarget))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(rootReal, targetAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("Calendar restore target escapes the restore root")
	}
	current := rootReal
	for _, part := range strings.Split(filepath.Dir(cleanTarget), string(filepath.Separator)) {
		if part == "." || part == "" {
			continue
		}
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if errors.Is(statErr, os.ErrNotExist) {
			break
		}
		if statErr != nil {
			return "", statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("Calendar restore target traverses a symbolic link")
		}
		if !info.IsDir() {
			return "", errors.New("Calendar restore target parent is not a directory")
		}
	}
	return targetAbs, nil
}

func writeAuthenticatedState(path string, key []byte, state State) error {
	stateBytes, err := json.Marshal(state)
	if err != nil {
		return err
	}
	envelope := diskEnvelope{SchemaVersion: 1, State: stateBytes, HMAC: base64.RawURLEncoding.EncodeToString(hmacSHA256(key, stateBytes))}
	body, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err = file.Write(body); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return err
	}
	return nil
}

func (s *Store) stateDigest() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.Marshal(s.data)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:]), nil
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
