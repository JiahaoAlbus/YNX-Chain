package cardproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	BackupSchemaVersion = "ynx.card.backup.v1"
	BackupDomain        = "YNX_CARD_BACKUP_V1"
	LegacyStateVersion  = 0
	MaxBackupBytes      = 64 << 20
)

type BackupManifest struct {
	SchemaVersion         string    `json:"schemaVersion"`
	SourceStateVersion    int       `json:"sourceStateVersion"`
	EffectiveStateVersion int       `json:"effectiveStateVersion"`
	CreatedAt             time.Time `json:"createdAt"`
	SnapshotSHA256        string    `json:"snapshotSha256"`
	Bytes                 int64     `json:"bytes"`
}

type RestoreResult struct {
	Source                     BackupManifest  `json:"source"`
	Rollback                   *BackupManifest `json:"rollback,omitempty"`
	Migrated                   bool            `json:"migrated"`
	LiveStateExisted           bool            `json:"liveStateExisted"`
	RollbackQuarantined        bool            `json:"rollbackQuarantined"`
	QuarantinedLiveStateSHA256 string          `json:"quarantinedLiveStateSha256,omitempty"`
	RestoredSnapshotSHA256     string          `json:"restoredSnapshotSha256"`
}

type backupUnsigned struct {
	SchemaVersion string          `json:"schemaVersion"`
	StateVersion  int             `json:"stateVersion"`
	CreatedAt     time.Time       `json:"createdAt"`
	Payload       json.RawMessage `json:"payload"`
	PayloadSHA256 string          `json:"payloadSha256"`
}

type backupEnvelope struct {
	SchemaVersion string          `json:"schemaVersion"`
	StateVersion  int             `json:"stateVersion"`
	CreatedAt     time.Time       `json:"createdAt"`
	Payload       json.RawMessage `json:"payload"`
	PayloadSHA256 string          `json:"payloadSha256"`
	HMAC          string          `json:"hmac"`
}

type verifiedBackup struct {
	manifest BackupManifest
	snapshot Snapshot
}

// snapshotV0 is a deliberately bounded compatibility fixture for backup
// migration. It models a v0 shape without notifications and does not claim
// that this schema was previously deployed in production.
type snapshotV0 struct {
	Version      int                          `json:"version"`
	Eligibility  map[string]Eligibility       `json:"eligibility"`
	Applications map[string]Application       `json:"applications"`
	Cards        map[string]Card              `json:"cards"`
	Events       map[string]CardEvent         `json:"events"`
	Disputes     map[string]Dispute           `json:"disputes"`
	AIRuns       map[string]AIRun             `json:"aiRuns"`
	Idempotency  map[string]IdempotencyRecord `json:"idempotency"`
	ProviderSeen map[string]time.Time         `json:"providerSeen"`
	GatewaySeen  map[string]time.Time         `json:"gatewaySeen"`
	Audit        []AuditEvent                 `json:"audit"`
}

func (s *Service) ExportBackup(path string) (BackupManifest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store.ExportBackup(path, s.now().UTC())
}

// RestoreBackup is an operator-only maintenance primitive. It always writes a
// verified rollback backup before replacing the live state.
func (s *Service) RestoreBackup(backupPath, rollbackPath string) (RestoreResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store.RestoreBackup(backupPath, rollbackPath, s.now().UTC())
}

func VerifyBackup(path string, integrityKey []byte) (BackupManifest, error) {
	cleanPath, err := validateOperatorPath(path)
	if err != nil {
		return BackupManifest{}, err
	}
	verified, err := verifyBackupFile(cleanPath, integrityKey)
	if err != nil {
		return BackupManifest{}, err
	}
	return verified.manifest, nil
}

func ExportStoreBackup(statePath, backupPath string, integrityKey []byte, at time.Time) (BackupManifest, error) {
	store, err := OpenStore(statePath, integrityKey)
	if err != nil {
		return BackupManifest{}, err
	}
	return store.ExportBackup(backupPath, at)
}

// RestoreStoreFileFromBackup is an offline disaster-recovery primitive. It can
// restore a missing or corrupt primary state file. A valid primary state is
// exported as a rollback backup; invalid bytes are preserved as a 0600
// quarantine file and identified by SHA-256 before replacement.
func RestoreStoreFileFromBackup(statePath, backupPath, rollbackPath string, integrityKey []byte, at time.Time) (RestoreResult, error) {
	cleanState, err := validateOperatorPath(statePath)
	if err != nil {
		return RestoreResult{}, err
	}
	cleanBackup, err := validateOperatorPath(backupPath)
	if err != nil {
		return RestoreResult{}, err
	}
	cleanRollback, err := validateOperatorPath(rollbackPath)
	if err != nil {
		return RestoreResult{}, err
	}
	if cleanState == cleanBackup || cleanState == cleanRollback || cleanBackup == cleanRollback {
		return RestoreResult{}, errors.New("backup, rollback and live state paths must be distinct")
	}
	if at.IsZero() {
		return RestoreResult{}, errors.New("restore timestamp is required")
	}
	verified, err := verifyBackupFile(cleanBackup, integrityKey)
	if err != nil {
		return RestoreResult{}, err
	}

	result := RestoreResult{
		Source:                 verified.manifest,
		Migrated:               verified.manifest.SourceStateVersion != verified.manifest.EffectiveStateVersion,
		RestoredSnapshotSHA256: hashJSON(verified.snapshot),
	}
	originalRaw, readErr := os.ReadFile(cleanState)
	switch {
	case readErr == nil:
		result.LiveStateExisted = true
		current, decodeErr := decodeStateDocument(originalRaw, integrityKey)
		if decodeErr == nil {
			rollback, backupErr := writeBackupSnapshot(cleanRollback, current, StateVersion, at.UTC(), integrityKey, false)
			if backupErr != nil {
				return RestoreResult{}, fmt.Errorf("create offline rollback backup: %w", backupErr)
			}
			result.Rollback = &rollback
		} else {
			if quarantineErr := atomicWriteFile(cleanRollback, originalRaw, false); quarantineErr != nil {
				return RestoreResult{}, fmt.Errorf("preserve corrupt live state before restore: %w", quarantineErr)
			}
			result.RollbackQuarantined = true
			result.QuarantinedLiveStateSHA256 = hashBytes(originalRaw)
		}
	case errors.Is(readErr, os.ErrNotExist):
		result.LiveStateExisted = false
	default:
		return RestoreResult{}, fmt.Errorf("read live card state before offline restore: %w", readErr)
	}

	restoredRaw, err := encodeStateDocument(verified.snapshot, integrityKey)
	if err != nil {
		return RestoreResult{}, err
	}
	if err := atomicWriteFile(cleanState, restoredRaw, true); err != nil {
		return RestoreResult{}, fmt.Errorf("write offline restored card state: %w", err)
	}
	if err := verifyPersistedSnapshot(cleanState, integrityKey, verified.snapshot); err != nil {
		if result.LiveStateExisted {
			if rollbackErr := atomicWriteFile(cleanState, originalRaw, true); rollbackErr != nil {
				return RestoreResult{}, fmt.Errorf("offline restore verification failed: %v; automatic primary rollback failed: %w", err, rollbackErr)
			}
		} else {
			_ = os.Remove(cleanState)
		}
		return RestoreResult{}, fmt.Errorf("offline restore verification failed and primary state was rolled back: %w", err)
	}
	return result, nil
}

func (s *Store) ExportBackup(path string, at time.Time) (BackupManifest, error) {
	cleanPath, err := validateOperatorPath(path)
	if err != nil {
		return BackupManifest{}, err
	}
	if cleanPath == filepath.Clean(s.path) {
		return BackupManifest{}, errors.New("backup path must differ from live card state path")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	snapshot, err := cloneSnapshot(s.data)
	if err != nil {
		return BackupManifest{}, err
	}
	return writeBackupSnapshot(cleanPath, snapshot, StateVersion, at, s.key, false)
}

func (s *Store) RestoreBackup(backupPath, rollbackPath string, at time.Time) (RestoreResult, error) {
	cleanBackup, err := validateOperatorPath(backupPath)
	if err != nil {
		return RestoreResult{}, err
	}
	cleanRollback, err := validateOperatorPath(rollbackPath)
	if err != nil {
		return RestoreResult{}, err
	}
	livePath := filepath.Clean(s.path)
	if cleanBackup == cleanRollback || cleanBackup == livePath || cleanRollback == livePath {
		return RestoreResult{}, errors.New("backup, rollback and live state paths must be distinct")
	}
	verified, err := verifyBackupFile(cleanBackup, s.key)
	if err != nil {
		return RestoreResult{}, err
	}
	if at.IsZero() {
		return RestoreResult{}, errors.New("restore timestamp is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := cloneSnapshot(s.data)
	if err != nil {
		return RestoreResult{}, err
	}
	originalRaw, err := os.ReadFile(livePath)
	if err != nil {
		return RestoreResult{}, fmt.Errorf("read live card state before restore: %w", err)
	}
	rollback, err := writeBackupSnapshot(cleanRollback, current, StateVersion, at.UTC(), s.key, false)
	if err != nil {
		return RestoreResult{}, fmt.Errorf("create rollback backup: %w", err)
	}

	s.data = verified.snapshot
	if err := s.persistLocked(); err != nil {
		s.data = current
		return RestoreResult{}, fmt.Errorf("persist restored card state: %w", err)
	}
	if err := verifyPersistedSnapshot(livePath, s.key, verified.snapshot); err != nil {
		s.data = current
		if rollbackErr := atomicWriteFile(livePath, originalRaw, true); rollbackErr != nil {
			return RestoreResult{}, fmt.Errorf("restored state verification failed: %v; automatic live-state rollback failed: %w", err, rollbackErr)
		}
		return RestoreResult{}, fmt.Errorf("restored state verification failed and live state was rolled back: %w", err)
	}

	return RestoreResult{
		Source:                 verified.manifest,
		Rollback:               &rollback,
		Migrated:               verified.manifest.SourceStateVersion != verified.manifest.EffectiveStateVersion,
		LiveStateExisted:       true,
		RestoredSnapshotSHA256: hashJSON(verified.snapshot),
	}, nil
}

func writeBackupSnapshot(path string, value any, stateVersion int, at time.Time, key []byte, replace bool) (BackupManifest, error) {
	raw, manifest, err := encodeBackupDocument(value, stateVersion, at, key)
	if err != nil {
		return BackupManifest{}, err
	}
	if err := atomicWriteFile(path, raw, replace); err != nil {
		return BackupManifest{}, err
	}
	manifest.Bytes = int64(len(raw))
	return manifest, nil
}

func encodeBackupDocument(value any, stateVersion int, at time.Time, key []byte) ([]byte, BackupManifest, error) {
	if len(key) < 32 {
		return nil, BackupManifest{}, errors.New("card backup integrity key must contain at least 32 bytes")
	}
	if at.IsZero() {
		return nil, BackupManifest{}, errors.New("backup timestamp is required")
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, BackupManifest{}, err
	}
	createdAt := at.UTC()
	unsigned := backupUnsigned{
		SchemaVersion: BackupSchemaVersion,
		StateVersion:  stateVersion,
		CreatedAt:     createdAt,
		Payload:       payload,
		PayloadSHA256: hashBytes(payload),
	}
	material, err := json.Marshal(unsigned)
	if err != nil {
		return nil, BackupManifest{}, err
	}
	envelope := backupEnvelope{
		SchemaVersion: unsigned.SchemaVersion,
		StateVersion:  unsigned.StateVersion,
		CreatedAt:     unsigned.CreatedAt,
		Payload:       unsigned.Payload,
		PayloadSHA256: unsigned.PayloadSHA256,
		HMAC:          hmacHex(key, append([]byte(BackupDomain+"\n"), material...)),
	}
	raw, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return nil, BackupManifest{}, err
	}
	effective := stateVersion
	if stateVersion == LegacyStateVersion {
		effective = StateVersion
	}
	manifest := BackupManifest{
		SchemaVersion:         BackupSchemaVersion,
		SourceStateVersion:    stateVersion,
		EffectiveStateVersion: effective,
		CreatedAt:             createdAt,
		SnapshotSHA256:        hashBytes(payload),
		Bytes:                 int64(len(raw) + 1),
	}
	return append(raw, '\n'), manifest, nil
}

func verifyBackupFile(path string, key []byte) (verifiedBackup, error) {
	if len(key) < 32 {
		return verifiedBackup{}, errors.New("card backup integrity key must contain at least 32 bytes")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return verifiedBackup{}, err
	}
	if !info.Mode().IsRegular() {
		return verifiedBackup{}, errors.New("card backup must be a regular file")
	}
	if info.Size() <= 0 || info.Size() > MaxBackupBytes {
		return verifiedBackup{}, errors.New("card backup size is outside policy")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return verifiedBackup{}, err
	}
	var envelope backupEnvelope
	if err := decodeStrict(raw, &envelope); err != nil {
		return verifiedBackup{}, fmt.Errorf("decode card backup: %w", err)
	}
	if envelope.SchemaVersion != BackupSchemaVersion || envelope.CreatedAt.IsZero() {
		return verifiedBackup{}, errors.New("unsupported or incomplete card backup envelope")
	}
	var compactPayload bytes.Buffer
	if err := json.Compact(&compactPayload, envelope.Payload); err != nil {
		return verifiedBackup{}, fmt.Errorf("canonicalize card backup payload: %w", err)
	}
	payload := compactPayload.Bytes()
	if envelope.PayloadSHA256 != hashBytes(payload) {
		return verifiedBackup{}, errors.New("card backup payload digest verification failed")
	}
	unsigned := backupUnsigned{
		SchemaVersion: envelope.SchemaVersion,
		StateVersion:  envelope.StateVersion,
		CreatedAt:     envelope.CreatedAt.UTC(),
		Payload:       payload,
		PayloadSHA256: envelope.PayloadSHA256,
	}
	material, err := json.Marshal(unsigned)
	if err != nil {
		return verifiedBackup{}, err
	}
	if !hmacEqual(envelope.HMAC, hmacHex(key, append([]byte(BackupDomain+"\n"), material...))) {
		return verifiedBackup{}, errors.New("card backup integrity verification failed")
	}
	snapshot, err := decodeBackupSnapshot(envelope.StateVersion, envelope.Payload)
	if err != nil {
		return verifiedBackup{}, err
	}
	if err := validateBackupSnapshot(snapshot); err != nil {
		return verifiedBackup{}, err
	}
	return verifiedBackup{
		manifest: BackupManifest{
			SchemaVersion:         envelope.SchemaVersion,
			SourceStateVersion:    envelope.StateVersion,
			EffectiveStateVersion: snapshot.Version,
			CreatedAt:             envelope.CreatedAt.UTC(),
			SnapshotSHA256:        hashJSON(snapshot),
			Bytes:                 info.Size(),
		},
		snapshot: snapshot,
	}, nil
}

func decodeBackupSnapshot(version int, payload []byte) (Snapshot, error) {
	switch version {
	case StateVersion:
		var snapshot Snapshot
		if err := decodeStrict(payload, &snapshot); err != nil {
			return Snapshot{}, fmt.Errorf("decode card backup state v%d: %w", version, err)
		}
		normalizeSnapshot(&snapshot)
		return snapshot, nil
	case LegacyStateVersion:
		var legacy snapshotV0
		if err := decodeStrict(payload, &legacy); err != nil {
			return Snapshot{}, fmt.Errorf("decode card backup state v%d: %w", version, err)
		}
		if legacy.Version != LegacyStateVersion {
			return Snapshot{}, errors.New("legacy card backup payload version mismatch")
		}
		snapshot := Snapshot{
			Version:       StateVersion,
			Eligibility:   legacy.Eligibility,
			Applications:  legacy.Applications,
			Cards:         legacy.Cards,
			Events:        legacy.Events,
			Disputes:      legacy.Disputes,
			Notifications: map[string]Notification{},
			AIRuns:        legacy.AIRuns,
			Idempotency:   legacy.Idempotency,
			ProviderSeen:  legacy.ProviderSeen,
			GatewaySeen:   legacy.GatewaySeen,
			Audit:         legacy.Audit,
		}
		normalizeSnapshot(&snapshot)
		return snapshot, nil
	default:
		return Snapshot{}, fmt.Errorf("unsupported card backup state version %d", version)
	}
}

func normalizeSnapshot(snapshot *Snapshot) {
	if snapshot.Eligibility == nil {
		snapshot.Eligibility = map[string]Eligibility{}
	}
	if snapshot.Applications == nil {
		snapshot.Applications = map[string]Application{}
	}
	if snapshot.Cards == nil {
		snapshot.Cards = map[string]Card{}
	}
	if snapshot.Events == nil {
		snapshot.Events = map[string]CardEvent{}
	}
	if snapshot.Disputes == nil {
		snapshot.Disputes = map[string]Dispute{}
	}
	if snapshot.Notifications == nil {
		snapshot.Notifications = map[string]Notification{}
	}
	if snapshot.AIRuns == nil {
		snapshot.AIRuns = map[string]AIRun{}
	}
	if snapshot.Idempotency == nil {
		snapshot.Idempotency = map[string]IdempotencyRecord{}
	}
	if snapshot.ProviderSeen == nil {
		snapshot.ProviderSeen = map[string]time.Time{}
	}
	if snapshot.GatewaySeen == nil {
		snapshot.GatewaySeen = map[string]time.Time{}
	}
	if snapshot.Audit == nil {
		snapshot.Audit = []AuditEvent{}
	}
}

func validateBackupSnapshot(snapshot Snapshot) error {
	if snapshot.Version != StateVersion {
		return fmt.Errorf("restored card state version %d is unsupported", snapshot.Version)
	}
	for id, value := range snapshot.Applications {
		if id == "" || value.ID != id {
			return errors.New("card backup application index is inconsistent")
		}
	}
	for id, value := range snapshot.Cards {
		if id == "" || value.ID != id {
			return errors.New("card backup card index is inconsistent")
		}
	}
	for id, value := range snapshot.Events {
		if id == "" || value.ID != id {
			return errors.New("card backup event index is inconsistent")
		}
	}
	for id, value := range snapshot.Disputes {
		if id == "" || value.ID != id {
			return errors.New("card backup dispute index is inconsistent")
		}
	}
	for id, value := range snapshot.Notifications {
		if id == "" || value.ID != id {
			return errors.New("card backup notification index is inconsistent")
		}
	}
	for id, value := range snapshot.AIRuns {
		if id == "" || value.ID != id {
			return errors.New("card backup AI-run index is inconsistent")
		}
	}
	for index, entry := range snapshot.Audit {
		if entry.Sequence == 0 || entry.Hash == "" {
			return errors.New("card backup audit entry is incomplete")
		}
		if index > 0 {
			previous := snapshot.Audit[index-1]
			if entry.Sequence != previous.Sequence+1 || entry.PreviousHash != previous.Hash {
				return errors.New("card backup audit chain is discontinuous")
			}
		}
		material := strings.Join([]string{fmt.Sprint(entry.Sequence), entry.Type, entry.ObjectID, entry.Account, entry.At.UTC().Format(time.RFC3339Nano), entry.PreviousHash}, "\n")
		if entry.Hash != hashBytes([]byte(material)) {
			return errors.New("card backup audit hash verification failed")
		}
	}
	return nil
}

func verifyPersistedSnapshot(path string, key []byte, expected Snapshot) error {
	probe, err := OpenStore(path, key)
	if err != nil {
		return err
	}
	var actual Snapshot
	if err := probe.View(func(snapshot Snapshot) error {
		actual = snapshot
		return nil
	}); err != nil {
		return err
	}
	if hashJSON(actual) != hashJSON(expected) {
		return errors.New("persisted restored snapshot does not match verified backup")
	}
	return nil
}

func validateOperatorPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" || !filepath.IsAbs(path) {
		return "", errors.New("card backup path must be absolute")
	}
	clean := filepath.Clean(path)
	if clean == string(filepath.Separator) || filepath.Base(clean) == "." {
		return "", errors.New("card backup path must name a file")
	}
	return clean, nil
}

func atomicWriteFile(path string, raw []byte, replace bool) error {
	path, err := validateOperatorPath(path)
	if err != nil {
		return err
	}
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	if !replace {
		if _, err := os.Lstat(path); err == nil {
			return errors.New("card backup destination already exists")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	tmp, err := os.CreateTemp(parent, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if replace {
		if err := os.Rename(tmpPath, path); err != nil {
			return err
		}
	} else {
		if err := os.Link(tmpPath, path); err != nil {
			if errors.Is(err, os.ErrExist) {
				return errors.New("card backup destination appeared during write")
			}
			return err
		}
		if err := os.Remove(tmpPath); err != nil {
			return err
		}
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return err
	}
	return syncDirectory(parent)
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
