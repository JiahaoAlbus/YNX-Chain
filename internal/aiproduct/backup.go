package aiproduct

import (
	"bytes"
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
	"time"
)

const (
	currentStateVersion = 1
	backupSchemaVersion = "ynx.ai.state-backup.v1"
	backupCipher        = "AES-256-GCM"
	maxBackupFileBytes  = 128 << 20
)

// BackupManifest contains only bounded operational metadata. The complete
// persistent state, including otherwise-plaintext metadata, is encrypted in the
// backup payload.
type BackupManifest struct {
	SchemaVersion string    `json:"schemaVersion"`
	ProductID     string    `json:"productId"`
	BackupID      string    `json:"backupId"`
	StateVersion  int       `json:"stateVersion"`
	CreatedAt     time.Time `json:"createdAt"`
	StateSHA256   string    `json:"stateSha256"`
	PayloadBytes  int64     `json:"payloadBytes"`
	AuditSequence uint64    `json:"auditSequence"`
	Cipher        string    `json:"cipher"`
}

type backupEnvelope struct {
	Manifest   BackupManifest `json:"manifest"`
	Nonce      string         `json:"nonce"`
	Ciphertext string         `json:"ciphertext"`
}

func normalizePersistentState(state *persistentState) error {
	if state.Version != currentStateVersion || state.Conversations == nil || state.Messages == nil || state.Policies == nil || state.Permissions == nil || state.Actions == nil || state.Appeals == nil || state.Challenges == nil || state.Sessions == nil {
		return errors.New("AI product state schema is invalid")
	}
	if state.Attachments == nil {
		state.Attachments = map[string][]storedAttachment{}
	}
	if state.FormalRequests == nil {
		state.FormalRequests = map[string]FormalWalletRequestRecord{}
	}
	if state.FormalChallenges == nil {
		state.FormalChallenges = map[string]FormalGatewayChallengeRecord{}
	}
	if state.AppliedBackups == nil {
		state.AppliedBackups = map[string]time.Time{}
	}
	if state.Audits == nil {
		state.Audits = []AuditRecord{}
	}
	return validateAuditChain(*state)
}

func validateAuditChain(state persistentState) error {
	if len(state.Audits) == 0 {
		if state.AuditSequence != 0 {
			return errors.New("AI product audit sequence exists without audit records")
		}
		return nil
	}
	for index, event := range state.Audits {
		if event.Sequence == 0 {
			return errors.New("AI product audit sequence must be positive")
		}
		if index == 0 {
			if event.Sequence != 1 || event.PreviousHash != "" {
				return errors.New("AI product audit chain must begin at sequence one")
			}
		} else {
			previous := state.Audits[index-1]
			if event.Sequence != previous.Sequence+1 || event.PreviousHash != previous.Hash {
				return errors.New("AI product audit chain continuity check failed")
			}
		}
		copy := event
		copy.Hash = ""
		raw, err := json.Marshal(copy)
		if err != nil {
			return fmt.Errorf("encode AI product audit record: %w", err)
		}
		sum := sha256.Sum256(raw)
		if !strings.EqualFold(event.Hash, hex.EncodeToString(sum[:])) {
			return errors.New("AI product audit record authentication failed")
		}
	}
	if state.AuditSequence != state.Audits[len(state.Audits)-1].Sequence {
		return errors.New("AI product audit sequence does not match the final audit record")
	}
	return nil
}

func (s *Store) CreateBackup(path string) (BackupManifest, error) {
	path, err := validateBackupPath(s.path, path)
	if err != nil {
		return BackupManifest{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := normalizePersistentState(&s.state); err != nil {
		return BackupManifest{}, err
	}
	stateRaw, err := json.Marshal(s.state)
	if err != nil {
		return BackupManifest{}, fmt.Errorf("encode AI product state backup: %w", err)
	}
	stateSum := sha256.Sum256(stateRaw)
	manifest := BackupManifest{
		SchemaVersion: backupSchemaVersion,
		ProductID:     ProductID,
		BackupID:      randomID("backup"),
		StateVersion:  s.state.Version,
		CreatedAt:     s.now().UTC(),
		StateSHA256:   hex.EncodeToString(stateSum[:]),
		PayloadBytes:  int64(len(stateRaw)),
		AuditSequence: s.state.AuditSequence,
		Cipher:        backupCipher,
	}
	aad, err := json.Marshal(manifest)
	if err != nil {
		return BackupManifest{}, err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return BackupManifest{}, err
	}
	ciphertext := s.aead.Seal(nil, nonce, stateRaw, aad)
	envelopeRaw, err := json.MarshalIndent(backupEnvelope{
		Manifest:   manifest,
		Nonce:      base64.RawStdEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext),
	}, "", "  ")
	if err != nil {
		return BackupManifest{}, fmt.Errorf("encode AI product backup envelope: %w", err)
	}
	if int64(len(envelopeRaw)) > maxBackupFileBytes {
		return BackupManifest{}, errors.New("AI product backup exceeds the maximum file size")
	}
	if err := writeExclusiveAtomic(path, envelopeRaw); err != nil {
		return BackupManifest{}, err
	}
	return manifest, nil
}

func (s *Store) RestoreBackup(path string) (BackupManifest, error) {
	path, err := validateBackupPath(s.path, path)
	if err != nil {
		return BackupManifest{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := normalizePersistentState(&s.state); err != nil {
		return BackupManifest{}, err
	}
	envelopeRaw, err := readBoundedFile(path, maxBackupFileBytes)
	if err != nil {
		return BackupManifest{}, err
	}
	var envelope backupEnvelope
	if err := decodeStrictJSON(envelopeRaw, &envelope); err != nil {
		return BackupManifest{}, fmt.Errorf("decode AI product backup envelope: %w", err)
	}
	if err := validateBackupManifest(envelope.Manifest); err != nil {
		return BackupManifest{}, err
	}
	if _, applied := s.state.AppliedBackups[envelope.Manifest.BackupID]; applied {
		return BackupManifest{}, errors.New("AI product backup replay was rejected")
	}

	nonce, err := base64.RawStdEncoding.DecodeString(envelope.Nonce)
	if err != nil || len(nonce) != s.aead.NonceSize() {
		return BackupManifest{}, errors.New("AI product backup nonce is invalid")
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil || len(ciphertext) < s.aead.Overhead() {
		return BackupManifest{}, errors.New("AI product backup ciphertext is invalid")
	}
	aad, err := json.Marshal(envelope.Manifest)
	if err != nil {
		return BackupManifest{}, err
	}
	stateRaw, err := s.aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return BackupManifest{}, errors.New("AI product backup failed authentication")
	}
	if int64(len(stateRaw)) != envelope.Manifest.PayloadBytes {
		return BackupManifest{}, errors.New("AI product backup payload size does not match the manifest")
	}
	stateSum := sha256.Sum256(stateRaw)
	if !strings.EqualFold(envelope.Manifest.StateSHA256, hex.EncodeToString(stateSum[:])) {
		return BackupManifest{}, errors.New("AI product backup payload checksum does not match the manifest")
	}

	var restored persistentState
	if err := decodeStrictJSON(stateRaw, &restored); err != nil {
		return BackupManifest{}, fmt.Errorf("decode restored AI product state: %w", err)
	}
	if err := normalizePersistentState(&restored); err != nil {
		return BackupManifest{}, err
	}
	if restored.Version != envelope.Manifest.StateVersion || restored.AuditSequence != envelope.Manifest.AuditSequence {
		return BackupManifest{}, errors.New("AI product backup state does not match the manifest")
	}
	if s.state.Version > restored.Version || s.state.AuditSequence > restored.AuditSequence {
		return BackupManifest{}, errors.New("AI product backup would roll back a newer local state")
	}
	if !auditChainIsPrefix(s.state.Audits, restored.Audits) {
		return BackupManifest{}, errors.New("AI product backup conflicts with divergent local state")
	}

	for backupID, appliedAt := range s.state.AppliedBackups {
		restored.AppliedBackups[backupID] = appliedAt
	}
	restored.AppliedBackups[envelope.Manifest.BackupID] = s.now().UTC()
	original := s.state
	s.state = restored
	s.auditLocked("system", "state_restored", envelope.Manifest.BackupID, "authenticated backup restored atomically")
	if err := s.saveLocked(); err != nil {
		s.state = original
		return BackupManifest{}, err
	}
	return envelope.Manifest, nil
}

func auditChainIsPrefix(current, restored []AuditRecord) bool {
	if len(current) > len(restored) {
		return false
	}
	for index := range current {
		if current[index].Sequence != restored[index].Sequence || !strings.EqualFold(current[index].Hash, restored[index].Hash) {
			return false
		}
	}
	return true
}

func validateBackupManifest(manifest BackupManifest) error {
	if manifest.SchemaVersion != backupSchemaVersion || manifest.ProductID != ProductID || manifest.StateVersion != currentStateVersion || manifest.Cipher != backupCipher {
		return errors.New("AI product backup manifest is incompatible")
	}
	if !strings.HasPrefix(manifest.BackupID, "backup_") || len(manifest.BackupID) > 80 || manifest.CreatedAt.IsZero() || manifest.PayloadBytes <= 0 || manifest.PayloadBytes > maxBackupFileBytes {
		return errors.New("AI product backup manifest is invalid")
	}
	checksum, err := hex.DecodeString(manifest.StateSHA256)
	if err != nil || len(checksum) != sha256.Size {
		return errors.New("AI product backup manifest checksum is invalid")
	}
	return nil
}

func validateBackupPath(statePath, backupPath string) (string, error) {
	if !filepath.IsAbs(backupPath) || filepath.Clean(backupPath) == string(filepath.Separator) {
		return "", errors.New("AI product backup path must be an absolute file path")
	}
	clean := filepath.Clean(backupPath)
	if clean == filepath.Clean(statePath) {
		return "", errors.New("AI product backup path must differ from the live state path")
	}
	return clean, nil
}

func readBoundedFile(path string, max int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > max {
		return nil, errors.New("AI product backup file type or size is invalid")
	}
	return io.ReadAll(io.LimitReader(file, max+1))
}

func decodeStrictJSON(raw []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("document must contain exactly one JSON value")
	}
	return nil
}

func writeExclusiveAtomic(path string, raw []byte) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	if _, err := os.Lstat(path); err == nil {
		return errors.New("AI product backup destination already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	tmp, err := os.CreateTemp(directory, ".ai-backup-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
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
	if err := os.Link(tmpName, path); err != nil {
		if errors.Is(err, os.ErrExist) {
			return errors.New("AI product backup destination already exists")
		}
		return err
	}
	if directoryHandle, err := os.Open(directory); err == nil {
		_ = directoryHandle.Sync()
		_ = directoryHandle.Close()
	}
	return nil
}
