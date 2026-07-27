package trustproduct

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	backupSchemaVersion = "ynx-trust-backup/v1"
	maxBackupBytes      = 64 << 20
)

// BackupManifest binds one immutable operator backup to its exact state bytes.
// Backups contain sensitive Trust records and token hashes, so they must remain
// access-controlled even though plaintext session tokens are never persisted.
type BackupManifest struct {
	SchemaVersion      string `json:"schemaVersion"`
	Product            string `json:"product"`
	CreatedAt          string `json:"createdAt"`
	StateFormatVersion int    `json:"stateFormatVersion"`
	StateSHA256        string `json:"stateSha256"`
	StateBytes         int64  `json:"stateBytes"`
	CaseCount          int    `json:"caseCount"`
	AIRecordCount      int    `json:"aiRecordCount"`
	AuditCount         int    `json:"auditCount"`
	Sequence           uint64 `json:"sequence"`
}

type backupEnvelope struct {
	Manifest  BackupManifest `json:"manifest"`
	State     []byte         `json:"state"`
	Integrity string         `json:"integrity"`
}

// CreateBackup writes an immutable, self-verifying backup without altering the
// live state file. The destination must not already exist.
func (s *Service) CreateBackup(path string) (BackupManifest, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return BackupManifest{}, errors.New("Trust backup path is required")
	}
	if samePath(path, s.cfg.StorePath) {
		return BackupManifest{}, errors.New("Trust backup path must differ from the live store path")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state := s.data
	state.Version = currentSnapshotVersion
	state.Integrity = ""
	integrity, err := snapshotIntegrity(state)
	if err != nil {
		return BackupManifest{}, err
	}
	state.Integrity = integrity
	stateRaw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return BackupManifest{}, fmt.Errorf("encode Trust backup state: %w", err)
	}
	if err := verifySnapshotIntegrity(state); err != nil {
		return BackupManifest{}, fmt.Errorf("verify Trust backup state: %w", err)
	}

	manifest := BackupManifest{
		SchemaVersion:      backupSchemaVersion,
		Product:            "ynx-trust-center",
		CreatedAt:          s.cfg.Now().UTC().Format(time.RFC3339Nano),
		StateFormatVersion: currentSnapshotVersion,
		StateSHA256:        sha256String(stateRaw),
		StateBytes:         int64(len(stateRaw)),
		CaseCount:          len(state.Cases),
		AIRecordCount:      len(state.AI),
		AuditCount:         len(state.Audit) + len(state.AuthorityAudit),
		Sequence:           state.Sequence,
	}
	envelope := backupEnvelope{Manifest: manifest, State: stateRaw}
	envelope.Integrity, err = backupEnvelopeIntegrity(envelope)
	if err != nil {
		return BackupManifest{}, err
	}
	raw, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return BackupManifest{}, fmt.Errorf("encode Trust backup envelope: %w", err)
	}
	if int64(len(raw)) > maxBackupBytes {
		return BackupManifest{}, fmt.Errorf("Trust backup exceeds %d bytes", maxBackupBytes)
	}
	if err := writeImmutableFile(path, raw); err != nil {
		return BackupManifest{}, fmt.Errorf("write Trust backup: %w", err)
	}
	return manifest, nil
}

// RestoreBackup verifies both the backup envelope and the embedded version-2
// state seal before creating a new store. It never overwrites an existing file.
func RestoreBackup(backupPath, targetStorePath string) (BackupManifest, error) {
	backupPath = strings.TrimSpace(backupPath)
	targetStorePath = strings.TrimSpace(targetStorePath)
	if backupPath == "" || targetStorePath == "" {
		return BackupManifest{}, errors.New("Trust backup and target store paths are required")
	}
	if samePath(backupPath, targetStorePath) {
		return BackupManifest{}, errors.New("Trust backup and target store paths must differ")
	}

	raw, err := readBoundedFile(backupPath, maxBackupBytes)
	if err != nil {
		return BackupManifest{}, fmt.Errorf("read Trust backup: %w", err)
	}
	var envelope backupEnvelope
	if err := decodeStrictJSON(raw, &envelope); err != nil {
		return BackupManifest{}, fmt.Errorf("decode Trust backup: %w", err)
	}
	if err := validateBackupEnvelope(envelope); err != nil {
		return BackupManifest{}, err
	}

	var state snapshot
	if err := decodeStrictJSON(envelope.State, &state); err != nil {
		return BackupManifest{}, fmt.Errorf("decode Trust backup state: %w", err)
	}
	if state.Version != currentSnapshotVersion || envelope.Manifest.StateFormatVersion != currentSnapshotVersion {
		return BackupManifest{}, fmt.Errorf("unsupported Trust backup state version %d", state.Version)
	}
	if err := verifySnapshotIntegrity(state); err != nil {
		return BackupManifest{}, fmt.Errorf("verify Trust backup state: %w", err)
	}
	if err := validatePersistedCentralSessions(state.Sessions, "Trust backup"); err != nil {
		return BackupManifest{}, err
	}
	if envelope.Manifest.CaseCount != len(state.Cases) || envelope.Manifest.AIRecordCount != len(state.AI) || envelope.Manifest.AuditCount != len(state.Audit)+len(state.AuthorityAudit) || envelope.Manifest.Sequence != state.Sequence {
		return BackupManifest{}, errors.New("Trust backup manifest counts do not match embedded state")
	}

	if err := writeImmutableFile(targetStorePath, envelope.State); err != nil {
		return BackupManifest{}, fmt.Errorf("restore Trust backup: %w", err)
	}
	return envelope.Manifest, nil
}

func validateBackupEnvelope(envelope backupEnvelope) error {
	manifest := envelope.Manifest
	if manifest.SchemaVersion != backupSchemaVersion || manifest.Product != "ynx-trust-center" {
		return errors.New("Trust backup schema or product identity is invalid")
	}
	if _, err := time.Parse(time.RFC3339Nano, manifest.CreatedAt); err != nil {
		return errors.New("Trust backup creation time is invalid")
	}
	if manifest.StateBytes != int64(len(envelope.State)) || manifest.StateSHA256 != sha256String(envelope.State) {
		return errors.New("Trust backup state hash or byte count mismatch")
	}
	want := strings.TrimSpace(envelope.Integrity)
	if len(want) != len("sha256:")+sha256.Size*2 || !strings.HasPrefix(want, "sha256:") {
		return errors.New("Trust backup envelope integrity seal is missing or malformed")
	}
	if _, err := hex.DecodeString(strings.TrimPrefix(want, "sha256:")); err != nil {
		return errors.New("Trust backup envelope integrity seal is malformed")
	}
	got, err := backupEnvelopeIntegrity(envelope)
	if err != nil {
		return err
	}
	if !constantTimeStringEqual(want, got) {
		return errors.New("Trust backup envelope integrity mismatch")
	}
	return nil
}

func backupEnvelopeIntegrity(envelope backupEnvelope) (string, error) {
	envelope.Integrity = ""
	raw, err := json.Marshal(envelope)
	if err != nil {
		return "", fmt.Errorf("encode Trust backup integrity payload: %w", err)
	}
	return sha256String(raw), nil
}

func validatePersistedCentralSessions(sessions map[string]CentralSession, context string) error {
	for id, session := range sessions {
		if strings.TrimSpace(id) == "" || session.ID != id || strings.TrimSpace(session.Account) == "" || strings.TrimSpace(session.DeviceID) == "" || session.ExpiresAt.IsZero() {
			return fmt.Errorf("%s contains an invalid central Wallet session binding", context)
		}
		if err := validateCentralScopes(session.Scopes); err != nil {
			return fmt.Errorf("%s contains invalid central Wallet session scopes: %w", context, err)
		}
	}
	return nil
}

func readBoundedFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("backup source must be a regular non-symlink file")
	}
	if info.Mode().Perm() != 0o600 {
		return nil, fmt.Errorf("backup source mode must be 0600, got %04o", info.Mode().Perm())
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !os.SameFile(info, openedInfo) || !openedInfo.Mode().IsRegular() || openedInfo.Mode().Perm() != 0o600 {
		return nil, errors.New("backup source changed or became unsafe while opening")
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	return raw, nil
}

func decodeStrictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}

func writeImmutableFile(path string, raw []byte) error {
	path = filepath.Clean(path)
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	parentInfo, err := os.Stat(parent)
	if err != nil {
		return err
	}
	if !parentInfo.IsDir() || parentInfo.Mode().Perm()&0o077 != 0 {
		return errors.New("destination directory must not be accessible by group or other users")
	}
	tmp, err := os.CreateTemp(parent, ".ynx-trust-write-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}
	defer cleanup()
	if err := tmp.Chmod(0o600); err != nil {
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
	if err := os.Link(tmpPath, path); err != nil {
		if errors.Is(err, os.ErrExist) {
			return errors.New("destination already exists")
		}
		return err
	}
	directory, err := os.Open(parent)
	if err != nil {
		_ = os.Remove(path)
		return err
	}
	syncErr := directory.Sync()
	closeErr := directory.Close()
	if syncErr != nil || closeErr != nil {
		_ = os.Remove(path)
		if syncErr != nil {
			return syncErr
		}
		return closeErr
	}
	return nil
}

func samePath(a, b string) bool {
	absA, errA := filepath.Abs(filepath.Clean(a))
	absB, errB := filepath.Abs(filepath.Clean(b))
	return errA == nil && errB == nil && absA == absB
}

func sha256String(raw []byte) string {
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func constantTimeStringEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
