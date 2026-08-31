package finance

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
	"strings"
	"sync"
	"time"
)

const (
	currentStateVersion = 1
	backupSchemaVersion = 1
	backupFormat        = "ynx-finance-backup-v1"
	backupAuthAlgorithm = "HMAC-SHA-256"
	minBackupKeyBytes   = 32
	maxBackupBytes      = 64 << 20
)

type Store struct {
	mu         sync.RWMutex
	path       string
	state      persistedState
	stateHash  string
	repository financeStateRepository
	rateMu     sync.Mutex
	rate       map[string][]time.Time
}

type BackupManifest struct {
	SchemaVersion   int       `json:"schemaVersion"`
	StateVersion    int       `json:"stateVersion"`
	CreatedAt       time.Time `json:"createdAt"`
	SHA256          string    `json:"sha256"`
	Bytes           int       `json:"bytes"`
	AccountCount    int       `json:"accountCount"`
	AuditEventCount int       `json:"auditEventCount"`
	UsedNonceCount  int       `json:"usedNonceCount"`
}

type RestoreReceipt struct {
	SchemaVersion       int            `json:"schemaVersion"`
	RestoredAt          time.Time      `json:"restoredAt"`
	StatePath           string         `json:"statePath"`
	BackupPath          string         `json:"backupPath"`
	PreviousStatePath   string         `json:"previousStatePath,omitempty"`
	PreviousStateSHA256 string         `json:"previousStateSha256,omitempty"`
	PreviousStateBytes  int            `json:"previousStateBytes,omitempty"`
	ReceiptPath         string         `json:"receiptPath"`
	Manifest            BackupManifest `json:"manifest"`
	RestoredSHA256      string         `json:"restoredSha256"`
}

type BackupAuthentication struct {
	Algorithm string `json:"algorithm"`
	Tag       string `json:"tag"`
}

type backupEnvelope struct {
	Format         string               `json:"format"`
	Manifest       BackupManifest       `json:"manifest"`
	State          json.RawMessage      `json:"state"`
	Authentication BackupAuthentication `json:"authentication"`
}

func OpenStore(path string) (*Store, error) {
	return OpenStoreWithDatabase(path, "")
}

func OpenStoreWithDatabase(path, databaseURL string) (*Store, error) {
	state := persistedState{Version: currentStateVersion, Accounts: map[string]AccountState{}, Nonces: map[string]time.Time{}}
	repository, err := openFinanceStateRepository(path, databaseURL)
	if err != nil {
		return nil, err
	}
	store := &Store{path: path, state: state, repository: repository, rate: map[string][]time.Time{}}
	if repository == nil {
		return store, nil
	}
	loaded, hash, exists, err := repository.Load()
	if err != nil {
		return nil, err
	}
	if exists {
		store.state, store.stateHash = loaded, hash
	}
	return store, nil
}

func (s *Store) Account(account string) AccountState {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.refreshLocked()
	return cloneAccountState(s.accountLocked(account))
}

func (s *Store) Update(account, action, objectID string, fn func(*AccountState) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return err
	}
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
	if err := s.refreshLocked(); err != nil {
		return err
	}
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
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.refreshLocked()
	out := make([]AuditEvent, 0)
	for _, event := range s.state.Audit {
		if event.Account == account {
			out = append(out, event)
		}
	}
	return out
}

// DeleteAccount removes private planning state while retaining a minimal,
// non-content-bearing deletion audit record for security accountability.
func (s *Store) DeleteAccount(account string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return err
	}
	delete(s.state.Accounts, account)
	kept := s.state.Audit[:0]
	for _, event := range s.state.Audit {
		if event.Account != account {
			kept = append(kept, event)
		}
	}
	s.state.Audit = append(kept, AuditEvent{ID: newID("audit"), Account: account, Action: "account.deleted", CreatedAt: time.Now().UTC()})
	return s.saveLocked()
}

func (s *Store) Backup(path string, authenticationKey []byte) (BackupManifest, error) {
	if path == "" {
		return BackupManifest{}, errors.New("finance backup path is required")
	}
	if err := validateBackupKey(authenticationKey); err != nil {
		return BackupManifest{}, err
	}
	if s.path != "" && sameFilePath(path, s.path) {
		return BackupManifest{}, errors.New("finance backup path must differ from the live state path")
	}

	s.mu.Lock()
	if err := s.refreshLocked(); err != nil {
		s.mu.Unlock()
		return BackupManifest{}, fmt.Errorf("refresh finance backup state: %w", err)
	}
	raw, err := json.Marshal(s.state)
	s.mu.Unlock()
	if err != nil {
		return BackupManifest{}, fmt.Errorf("encode finance backup state: %w", err)
	}
	var state persistedState
	if err := decodeStrictJSON(raw, &state); err != nil {
		return BackupManifest{}, fmt.Errorf("decode finance backup snapshot: %w", err)
	}
	if err := validatePersistedState(state); err != nil {
		return BackupManifest{}, err
	}
	normalizePersistedState(&state)
	raw, err = json.Marshal(state)
	if err != nil {
		return BackupManifest{}, fmt.Errorf("canonicalize finance backup state: %w", err)
	}

	manifest := manifestForState(raw, state, time.Now().UTC())
	authentication, err := authenticateBackup(authenticationKey, backupFormat, manifest, raw)
	if err != nil {
		return BackupManifest{}, err
	}
	envelope := backupEnvelope{Format: backupFormat, Manifest: manifest, State: json.RawMessage(raw), Authentication: authentication}
	envelopeRaw, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return BackupManifest{}, fmt.Errorf("encode finance backup envelope: %w", err)
	}
	if err := atomicWritePrivateFile(path, envelopeRaw); err != nil {
		return BackupManifest{}, fmt.Errorf("write finance backup: %w", err)
	}
	return manifest, nil
}

func VerifyBackup(path string, authenticationKey []byte) (BackupManifest, error) {
	manifest, _, err := readVerifiedBackup(path, authenticationKey)
	return manifest, err
}

func RestoreStore(statePath, backupPath string, authenticationKey []byte) (RestoreReceipt, error) {
	if statePath == "" {
		return RestoreReceipt{}, errors.New("finance state path is required")
	}
	if backupPath == "" {
		return RestoreReceipt{}, errors.New("finance backup path is required")
	}
	if sameFilePath(statePath, backupPath) {
		return RestoreReceipt{}, errors.New("finance backup path must differ from the live state path")
	}

	manifest, stateRaw, err := readVerifiedBackup(backupPath, authenticationKey)
	if err != nil {
		return RestoreReceipt{}, err
	}

	previousPath := ""
	previousSHA256 := ""
	previousBytes := 0
	currentRaw, readErr := os.ReadFile(statePath)
	if readErr == nil {
		previousPath = statePath + ".pre-restore." + time.Now().UTC().Format("20060102T150405.000000000Z")
		if err := atomicWritePrivateFile(previousPath, currentRaw); err != nil {
			return RestoreReceipt{}, fmt.Errorf("preserve pre-restore finance state: %w", err)
		}
		previousDigest := sha256.Sum256(currentRaw)
		previousSHA256 = hex.EncodeToString(previousDigest[:])
		previousBytes = len(currentRaw)
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return RestoreReceipt{}, fmt.Errorf("read pre-restore finance state: %w", readErr)
	}

	rollback := func() {
		if previousPath == "" {
			_ = os.Remove(statePath)
			return
		}
		previousRaw, err := os.ReadFile(previousPath)
		if err == nil {
			_ = atomicWritePrivateFile(statePath, previousRaw)
		}
	}

	if err := atomicWritePrivateFile(statePath, stateRaw); err != nil {
		return RestoreReceipt{}, fmt.Errorf("restore finance state: %w", err)
	}
	if _, err := OpenStore(statePath); err != nil {
		rollback()
		return RestoreReceipt{}, fmt.Errorf("verify restored finance state: %w", err)
	}

	restoredHash := sha256.Sum256(stateRaw)
	receiptPath := statePath + ".restore-receipt.json"
	receipt := RestoreReceipt{
		SchemaVersion:       1,
		RestoredAt:          time.Now().UTC(),
		StatePath:           statePath,
		BackupPath:          backupPath,
		PreviousStatePath:   previousPath,
		PreviousStateSHA256: previousSHA256,
		PreviousStateBytes:  previousBytes,
		ReceiptPath:         receiptPath,
		Manifest:            manifest,
		RestoredSHA256:      hex.EncodeToString(restoredHash[:]),
	}
	receiptRaw, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		rollback()
		return RestoreReceipt{}, fmt.Errorf("encode finance restore receipt: %w", err)
	}
	if err := atomicWritePrivateFile(receiptPath, receiptRaw); err != nil {
		rollback()
		return RestoreReceipt{}, fmt.Errorf("write finance restore receipt: %w", err)
	}
	return receipt, nil
}

func (s *Store) accountLocked(account string) AccountState {
	state, ok := s.state.Accounts[account]
	if !ok {
		state = AccountState{Categories: []Category{}, Budgets: []Budget{}, Reminders: []Reminder{}, Notes: []Note{}, Classifications: map[string]Classification{}, AIJobs: []AIJob{}, Idempotency: map[string]string{}, Privacy: Privacy{IncludePayInStatements: true, AlertsEnabled: true}}
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
	if s.repository == nil {
		return nil
	}
	hash, err := s.repository.Save(s.stateHash, s.state)
	if err == nil {
		s.stateHash = hash
		return nil
	}
	if authoritative, authoritativeHash, exists, loadErr := s.repository.Load(); loadErr == nil && exists {
		s.state, s.stateHash = authoritative, authoritativeHash
	}
	return err
}

func (s *Store) refreshLocked() error {
	if s.repository == nil {
		return nil
	}
	state, hash, exists, err := s.repository.Load()
	if err != nil {
		return err
	}
	if exists && hash != s.stateHash {
		s.state, s.stateHash = state, hash
	}
	return nil
}

func (s *Store) StateStoreMode() string {
	if s.repository == nil {
		return "memory-single-process"
	}
	return s.repository.Mode()
}

func (s *Store) StateStoreReady() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.refreshLocked()
}

func (s *Store) RateLimitMode() string {
	if repository, ok := s.repository.(financeRateLimitRepository); ok {
		return repository.RateLimitMode()
	}
	return "memory-sliding-window-single-process"
}

func (s *Store) MultiInstanceReady() bool {
	return s.StateStoreMode() == "postgres-cas-multi-instance" && s.RateLimitMode() == "postgres-token-bucket-multi-instance"
}

func (s *Store) AllowRate(key string, limit int, window time.Duration, now time.Time) (bool, error) {
	if strings.TrimSpace(key) == "" || len(key) > 256 || limit <= 0 || window <= 0 {
		return false, errors.New("finance rate limit input is invalid")
	}
	if repository, ok := s.repository.(financeRateLimitRepository); ok {
		return repository.AllowRate(key, limit, window, now)
	}
	cutoff := now.UTC().Add(-window)
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	entries := s.rate[key]
	kept := entries[:0]
	for _, at := range entries {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= limit {
		s.rate[key] = kept
		return false, nil
	}
	s.rate[key] = append(kept, now.UTC())
	return true, nil
}

func manifestForState(raw []byte, state persistedState, createdAt time.Time) BackupManifest {
	digest := sha256.Sum256(raw)
	return BackupManifest{
		SchemaVersion:   backupSchemaVersion,
		StateVersion:    state.Version,
		CreatedAt:       createdAt,
		SHA256:          hex.EncodeToString(digest[:]),
		Bytes:           len(raw),
		AccountCount:    len(state.Accounts),
		AuditEventCount: len(state.Audit),
		UsedNonceCount:  len(state.Nonces),
	}
}

func validateBackupKey(authenticationKey []byte) error {
	if len(authenticationKey) < minBackupKeyBytes {
		return fmt.Errorf("finance backup authentication key must contain at least %d bytes", minBackupKeyBytes)
	}
	return nil
}

func authenticateBackup(authenticationKey []byte, format string, manifest BackupManifest, state []byte) (BackupAuthentication, error) {
	if err := validateBackupKey(authenticationKey); err != nil {
		return BackupAuthentication{}, err
	}
	payload, err := json.Marshal(struct {
		Format   string          `json:"format"`
		Manifest BackupManifest  `json:"manifest"`
		State    json.RawMessage `json:"state"`
	}{Format: format, Manifest: manifest, State: json.RawMessage(state)})
	if err != nil {
		return BackupAuthentication{}, fmt.Errorf("encode finance backup authentication payload: %w", err)
	}
	mac := hmac.New(sha256.New, authenticationKey)
	_, _ = mac.Write(payload)
	return BackupAuthentication{Algorithm: backupAuthAlgorithm, Tag: hex.EncodeToString(mac.Sum(nil))}, nil
}

func verifyBackupAuthentication(authenticationKey []byte, envelope backupEnvelope) error {
	if envelope.Authentication.Algorithm != backupAuthAlgorithm {
		return fmt.Errorf("unsupported finance backup authentication algorithm %q", envelope.Authentication.Algorithm)
	}
	actual, err := hex.DecodeString(envelope.Authentication.Tag)
	if err != nil || len(actual) != sha256.Size {
		return errors.New("finance backup authentication tag is invalid")
	}
	expected, err := authenticateBackup(authenticationKey, envelope.Format, envelope.Manifest, envelope.State)
	if err != nil {
		return err
	}
	expectedRaw, _ := hex.DecodeString(expected.Tag)
	if !hmac.Equal(actual, expectedRaw) {
		return errors.New("finance backup authentication failed")
	}
	return nil
}

func readVerifiedBackup(path string, authenticationKey []byte) (BackupManifest, []byte, error) {
	if path == "" {
		return BackupManifest{}, nil, errors.New("finance backup path is required")
	}
	if err := validateBackupKey(authenticationKey); err != nil {
		return BackupManifest{}, nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return BackupManifest{}, nil, fmt.Errorf("open finance backup: %w", err)
	}
	defer file.Close()

	limited := io.LimitReader(file, maxBackupBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return BackupManifest{}, nil, fmt.Errorf("read finance backup: %w", err)
	}
	if len(raw) > maxBackupBytes {
		return BackupManifest{}, nil, fmt.Errorf("finance backup exceeds %d bytes", maxBackupBytes)
	}

	var envelope backupEnvelope
	if err := decodeStrictJSON(raw, &envelope); err != nil {
		return BackupManifest{}, nil, fmt.Errorf("decode finance backup: %w", err)
	}
	if envelope.Format != backupFormat {
		return BackupManifest{}, nil, fmt.Errorf("unsupported finance backup format %q", envelope.Format)
	}
	if len(envelope.State) == 0 || bytes.Equal(bytes.TrimSpace(envelope.State), []byte("null")) {
		return BackupManifest{}, nil, errors.New("finance backup state is missing")
	}
	if err := verifyBackupAuthentication(authenticationKey, envelope); err != nil {
		return BackupManifest{}, nil, err
	}

	var state persistedState
	if err := decodeStrictJSON(envelope.State, &state); err != nil {
		return BackupManifest{}, nil, fmt.Errorf("decode finance backup state: %w", err)
	}
	if err := validatePersistedState(state); err != nil {
		return BackupManifest{}, nil, err
	}
	normalizePersistedState(&state)
	canonicalState, err := json.Marshal(state)
	if err != nil {
		return BackupManifest{}, nil, fmt.Errorf("canonicalize finance backup state: %w", err)
	}

	manifest := manifestForState(canonicalState, state, envelope.Manifest.CreatedAt)
	if envelope.Manifest.SchemaVersion != backupSchemaVersion {
		return BackupManifest{}, nil, fmt.Errorf("unsupported finance backup schema version %d", envelope.Manifest.SchemaVersion)
	}
	if envelope.Manifest.StateVersion != currentStateVersion {
		return BackupManifest{}, nil, fmt.Errorf("unsupported finance backup state version %d", envelope.Manifest.StateVersion)
	}
	if envelope.Manifest.CreatedAt.IsZero() || envelope.Manifest.CreatedAt.After(time.Now().UTC().Add(5*time.Minute)) {
		return BackupManifest{}, nil, errors.New("finance backup creation time is invalid")
	}
	if envelope.Manifest.SHA256 != manifest.SHA256 || envelope.Manifest.Bytes != manifest.Bytes {
		return BackupManifest{}, nil, errors.New("finance backup integrity check failed")
	}
	if envelope.Manifest.AccountCount != manifest.AccountCount || envelope.Manifest.AuditEventCount != manifest.AuditEventCount || envelope.Manifest.UsedNonceCount != manifest.UsedNonceCount {
		return BackupManifest{}, nil, errors.New("finance backup manifest counts do not match state")
	}
	return envelope.Manifest, canonicalState, nil
}

func validatePersistedState(state persistedState) error {
	if state.Version != currentStateVersion {
		return fmt.Errorf("unsupported finance state version %d", state.Version)
	}
	if state.Accounts == nil || state.Nonces == nil {
		return errors.New("incomplete finance state")
	}
	for account := range state.Accounts {
		if account == "" {
			return errors.New("finance state contains an empty account identity")
		}
	}
	for nonce, expiresAt := range state.Nonces {
		if nonce == "" || expiresAt.IsZero() {
			return errors.New("finance state contains an invalid Wallet nonce record")
		}
	}
	return nil
}

func normalizePersistedState(state *persistedState) {
	if state.Audit == nil {
		state.Audit = []AuditEvent{}
	}
	for account, accountState := range state.Accounts {
		if accountState.Categories == nil {
			accountState.Categories = []Category{}
		}
		if accountState.Budgets == nil {
			accountState.Budgets = []Budget{}
		}
		if accountState.Reminders == nil {
			accountState.Reminders = []Reminder{}
		}
		if accountState.Notes == nil {
			accountState.Notes = []Note{}
		}
		if accountState.AIJobs == nil {
			accountState.AIJobs = []AIJob{}
		}
		if accountState.Classifications == nil {
			accountState.Classifications = map[string]Classification{}
		}
		if accountState.Idempotency == nil {
			accountState.Idempotency = map[string]string{}
		}
		state.Accounts[account] = accountState
	}
}

func decodeStrictJSON(raw []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return errors.New("JSON contains more than one value")
		}
		return err
	}
	return nil
}

func atomicWritePrivateFile(path string, raw []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".ynx-finance-tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	committed := false
	defer func() {
		_ = tmp.Close()
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()

	if err := tmp.Chmod(0600); err != nil {
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	committed = true
	if err := os.Chmod(path, 0600); err != nil {
		return err
	}

	directory, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func sameFilePath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr == nil && rightErr == nil && filepath.Clean(leftAbs) == filepath.Clean(rightAbs) {
		return true
	}
	leftInfo, leftStatErr := os.Stat(left)
	rightInfo, rightStatErr := os.Stat(right)
	return leftStatErr == nil && rightStatErr == nil && os.SameFile(leftInfo, rightInfo)
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
