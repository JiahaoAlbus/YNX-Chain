package mail

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const backupFormat = "ynx-mail-backup-v1"

type BackupFile struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
	Mode   string `json:"mode"`
}

type BackupManifest struct {
	Format             string       `json:"format"`
	SchemaVersion      int          `json:"schema_version"`
	StateSchemaVersion int          `json:"state_schema_version"`
	CreatedAt          time.Time    `json:"created_at"`
	Files              []BackupFile `json:"files"`
}

type validatedBackup struct {
	Manifest BackupManifest
	State    []byte
	HMACKey  []byte
	Sender   []byte
}

// Backup writes a self-contained operator backup into a new mode-0700
// directory. The package contains the authenticated state and its independent
// HMAC key, so the directory is sensitive and must remain inside an approved
// encrypted backup boundary.
func (s *Store) Backup(backupDir string, senderKey ed25519.PrivateKey) (BackupManifest, error) {
	if s == nil || s.path == "" || len(s.key) != 32 {
		return BackupManifest{}, errors.New("persistent Mail store is required for backup")
	}
	if !validEd25519PrivateKey(senderKey) {
		return BackupManifest{}, errors.New("valid Mail sender identity key is required for backup")
	}
	backupDir = filepath.Clean(strings.TrimSpace(backupDir))
	if backupDir == "." || backupDir == "" {
		return BackupManifest{}, errors.New("backup directory is required")
	}
	if _, err := os.Lstat(backupDir); err == nil {
		return BackupManifest{}, errors.New("backup destination already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return BackupManifest{}, err
	}
	parent := filepath.Dir(backupDir)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return BackupManifest{}, err
	}

	s.mu.Lock()
	stateBytes, err := json.Marshal(s.data)
	if err != nil {
		s.mu.Unlock()
		return BackupManifest{}, err
	}
	envelope := diskEnvelope{
		SchemaVersion: 1,
		State:         stateBytes,
		HMAC:          encodeRawURL(hmacSHA256(s.key, stateBytes)),
	}
	envelopeBytes, err := json.MarshalIndent(envelope, "", "  ")
	keyBytes := append([]byte(nil), s.key...)
	s.mu.Unlock()
	if err != nil {
		return BackupManifest{}, err
	}

	stage, err := os.MkdirTemp(parent, ".ynx-mail-backup-")
	if err != nil {
		return BackupManifest{}, err
	}
	removeStage := true
	defer func() {
		if removeStage {
			_ = os.RemoveAll(stage)
		}
	}()
	if err := os.Chmod(stage, 0o700); err != nil {
		return BackupManifest{}, err
	}
	if err := writeFileSync(filepath.Join(stage, "state.json"), envelopeBytes, 0o600); err != nil {
		return BackupManifest{}, err
	}
	if err := writeFileSync(filepath.Join(stage, "state.hmac-key"), keyBytes, 0o600); err != nil {
		return BackupManifest{}, err
	}
	if err := writeFileSync(filepath.Join(stage, "sender.ed25519"), []byte(base64.RawStdEncoding.EncodeToString(senderKey)), 0o600); err != nil {
		return BackupManifest{}, err
	}
	manifest := BackupManifest{
		Format:             backupFormat,
		SchemaVersion:      1,
		StateSchemaVersion: 1,
		CreatedAt:          time.Now().UTC(),
	}
	for _, name := range []string{"sender.ed25519", "state.hmac-key", "state.json"} {
		entry, err := backupFileEntry(filepath.Join(stage, name), name)
		if err != nil {
			return BackupManifest{}, err
		}
		manifest.Files = append(manifest.Files, entry)
	}
	sort.Slice(manifest.Files, func(i, j int) bool { return manifest.Files[i].Name < manifest.Files[j].Name })
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return BackupManifest{}, err
	}
	if err := writeFileSync(filepath.Join(stage, "manifest.json"), manifestBytes, 0o600); err != nil {
		return BackupManifest{}, err
	}
	if _, err := validateBackup(stage); err != nil {
		return BackupManifest{}, fmt.Errorf("validate created Mail backup: %w", err)
	}
	if err := installStagedDirectoryNoReplace(stage, backupDir, []string{"state.hmac-key", "sender.ed25519", "state.json", "manifest.json"}); err != nil {
		return BackupManifest{}, fmt.Errorf("install Mail backup: %w", err)
	}
	removeStage = false
	if _, err := validateBackup(backupDir); err != nil {
		_ = os.RemoveAll(backupDir)
		return BackupManifest{}, fmt.Errorf("verify installed Mail backup: %w", err)
	}
	return manifest, nil
}

// RestoreStoreBackup verifies a backup and installs it into a newly reserved
// destination directory. It never overwrites an existing directory or file.
func RestoreStoreBackup(backupDir, destinationDir string) (string, BackupManifest, error) {
	validated, err := loadValidatedBackup(backupDir)
	if err != nil {
		return "", BackupManifest{}, err
	}
	manifest := validated.Manifest
	destinationDir = filepath.Clean(strings.TrimSpace(destinationDir))
	if destinationDir == "." || destinationDir == "" {
		return "", BackupManifest{}, errors.New("restore destination directory is required")
	}
	if _, err := os.Lstat(destinationDir); err == nil {
		return "", BackupManifest{}, errors.New("restore destination already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", BackupManifest{}, err
	}
	parent := filepath.Dir(destinationDir)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return "", BackupManifest{}, err
	}
	stage, err := os.MkdirTemp(parent, ".ynx-mail-restore-")
	if err != nil {
		return "", BackupManifest{}, err
	}
	removeStage := true
	defer func() {
		if removeStage {
			_ = os.RemoveAll(stage)
		}
	}()
	if err := os.Chmod(stage, 0o700); err != nil {
		return "", BackupManifest{}, err
	}
	stateBytes := validated.State
	keyBytes := validated.HMACKey
	senderBytes := validated.Sender
	statePath := filepath.Join(stage, "state.json")
	if err := writeFileSync(statePath, stateBytes, 0o600); err != nil {
		return "", BackupManifest{}, err
	}
	if err := writeFileSync(statePath+".hmac-key", keyBytes, 0o600); err != nil {
		return "", BackupManifest{}, err
	}
	if err := writeFileSync(filepath.Join(stage, "sender.ed25519"), senderBytes, 0o600); err != nil {
		return "", BackupManifest{}, err
	}
	if _, err := NewStore(statePath); err != nil {
		return "", BackupManifest{}, fmt.Errorf("verify restored Mail store: %w", err)
	}
	if err := installStagedDirectoryNoReplace(stage, destinationDir, []string{"state.json.hmac-key", "sender.ed25519", "state.json"}); err != nil {
		return "", BackupManifest{}, fmt.Errorf("install restored Mail store: %w", err)
	}
	removeStage = false
	restoredStatePath := filepath.Join(destinationDir, "state.json")
	if _, err := NewStore(restoredStatePath); err != nil {
		_ = os.RemoveAll(destinationDir)
		return "", BackupManifest{}, fmt.Errorf("verify installed Mail store: %w", err)
	}
	return restoredStatePath, manifest, nil
}

func validateBackup(backupDir string) (BackupManifest, error) {
	validated, err := loadValidatedBackup(backupDir)
	if err != nil {
		return BackupManifest{}, err
	}
	return validated.Manifest, nil
}

func loadValidatedBackup(backupDir string) (validatedBackup, error) {
	backupDir = filepath.Clean(strings.TrimSpace(backupDir))
	info, err := os.Lstat(backupDir)
	if err != nil {
		return validatedBackup{}, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return validatedBackup{}, errors.New("Mail backup path must be a regular directory")
	}
	if info.Mode().Perm() != 0o700 {
		return validatedBackup{}, errors.New("Mail backup directory permissions must be 0700")
	}
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return validatedBackup{}, err
	}
	expectedEntries := map[string]bool{"manifest.json": true, "sender.ed25519": true, "state.hmac-key": true, "state.json": true}
	if len(entries) != len(expectedEntries) {
		return validatedBackup{}, errors.New("Mail backup contains unexpected files")
	}
	for _, entry := range entries {
		if !expectedEntries[entry.Name()] {
			return validatedBackup{}, errors.New("Mail backup contains unexpected files")
		}
	}
	manifestPath := filepath.Join(backupDir, "manifest.json")
	manifestBytes, manifestInfo, err := readRegularBoundedWithInfo(manifestPath, 1<<20)
	if err != nil {
		return validatedBackup{}, err
	}
	if manifestInfo.Mode().Perm() != 0o600 {
		return validatedBackup{}, errors.New("Mail backup manifest permissions or type are invalid")
	}
	var manifest BackupManifest
	if err := decodeStrict(manifestBytes, &manifest); err != nil {
		return validatedBackup{}, fmt.Errorf("decode Mail backup manifest: %w", err)
	}
	if manifest.Format != backupFormat || manifest.SchemaVersion != 1 || manifest.StateSchemaVersion != 1 || manifest.CreatedAt.IsZero() || len(manifest.Files) != 3 {
		return validatedBackup{}, errors.New("Mail backup manifest is invalid")
	}
	expectedNames := map[string]bool{"sender.ed25519": true, "state.hmac-key": true, "state.json": true}
	seen := map[string]bool{}
	loaded := map[string][]byte{}
	for _, entry := range manifest.Files {
		if !expectedNames[entry.Name] || seen[entry.Name] || entry.Bytes <= 0 || entry.SHA256 == "" || entry.Mode != "0600" {
			return validatedBackup{}, errors.New("Mail backup file manifest is invalid")
		}
		seen[entry.Name] = true
		limit := int64(4096)
		if entry.Name == "state.json" {
			limit = 128 << 20
		}
		body, fileInfo, err := readRegularBoundedWithInfo(filepath.Join(backupDir, entry.Name), limit)
		if err != nil {
			return validatedBackup{}, err
		}
		actual := backupFileEntryFromBytes(body, fileInfo, entry.Name)
		if actual.SHA256 != entry.SHA256 || actual.Bytes != entry.Bytes || actual.Mode != entry.Mode {
			return validatedBackup{}, errors.New("Mail backup file integrity mismatch")
		}
		loaded[entry.Name] = body
	}
	key := loaded["state.hmac-key"]
	if len(key) != 32 {
		return validatedBackup{}, errors.New("Mail backup HMAC key is invalid")
	}
	senderText := loaded["sender.ed25519"]
	senderKey, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(string(senderText)))
	if err != nil || !validEd25519PrivateKey(senderKey) {
		return validatedBackup{}, errors.New("Mail backup sender key is invalid")
	}
	stateBytes := loaded["state.json"]
	var envelope diskEnvelope
	if err := decodeStrict(stateBytes, &envelope); err != nil || envelope.SchemaVersion != 1 {
		return validatedBackup{}, errors.New("Mail backup state envelope is invalid")
	}
	if !secureEnvelopeHMAC(key, envelope) {
		return validatedBackup{}, errors.New("Mail backup state HMAC mismatch")
	}
	var state State
	if err := decodeStrict(envelope.State, &state); err != nil {
		return validatedBackup{}, errors.New("Mail backup state payload is invalid")
	}
	return validatedBackup{Manifest: manifest, State: stateBytes, HMACKey: key, Sender: senderText}, nil
}

func secureEnvelopeHMAC(key []byte, envelope diskEnvelope) bool {
	got, err := decodeRawURL(envelope.HMAC)
	if err != nil {
		return false
	}
	var canonicalState bytes.Buffer
	if err := json.Compact(&canonicalState, envelope.State); err != nil {
		return false
	}
	return constantTimeEqual(got, hmacSHA256(key, canonicalState.Bytes()))
}

func backupFileEntry(path, name string) (BackupFile, error) {
	body, info, err := readRegularBoundedWithInfo(path, 128<<20)
	if err != nil {
		return BackupFile{}, err
	}
	return backupFileEntryFromBytes(body, info, name), nil
}

func backupFileEntryFromBytes(body []byte, info os.FileInfo, name string) BackupFile {
	sum := sha256.Sum256(body)
	return BackupFile{Name: name, SHA256: hex.EncodeToString(sum[:]), Bytes: int64(len(body)), Mode: fmt.Sprintf("%04o", info.Mode().Perm())}
}

func readRegularBounded(path string, limit int64) ([]byte, error) {
	body, _, err := readRegularBoundedWithInfo(path, limit)
	return body, err
}

func readRegularBoundedWithInfo(path string, limit int64) ([]byte, os.FileInfo, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	if !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 || before.Size() <= 0 || before.Size() > limit {
		return nil, nil, errors.New("Mail backup file type or size is invalid")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return nil, nil, errors.New("Mail backup file changed while opening")
	}
	body, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(body)) > limit {
		return nil, nil, errors.New("Mail backup file exceeds limit")
	}
	if int64(len(body)) != opened.Size() {
		return nil, nil, errors.New("Mail backup file changed while reading")
	}
	after, err := os.Lstat(path)
	if err != nil || after.Mode()&os.ModeSymlink != 0 || !os.SameFile(before, after) {
		return nil, nil, errors.New("Mail backup file changed while reading")
	}
	return body, opened, nil
}

func installStagedDirectoryNoReplace(stage, destination string, names []string) (err error) {
	if err := os.Mkdir(destination, 0o700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return errors.New("destination already exists")
		}
		return err
	}
	removeDestination := true
	defer func() {
		if removeDestination {
			_ = os.RemoveAll(destination)
		}
	}()
	for _, name := range names {
		if filepath.Base(name) != name || name == "." || name == "" {
			return errors.New("staged Mail file name is invalid")
		}
		body, info, err := readRegularBoundedWithInfo(filepath.Join(stage, name), 128<<20)
		if err != nil {
			return err
		}
		if err := writeFileSync(filepath.Join(destination, name), body, info.Mode().Perm()); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(stage); err != nil {
		return err
	}
	removeDestination = false
	return nil
}

func writeFileSync(path string, body []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	written, writeErr := file.Write(body)
	if writeErr != nil {
		err = writeErr
	} else if written != len(body) {
		err = io.ErrShortWrite
	} else {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err
}

func encodeRawURL(body []byte) string {
	return base64.RawURLEncoding.EncodeToString(body)
}

func decodeRawURL(value string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(value)
}

func validEd25519PrivateKey(key []byte) bool {
	if len(key) != ed25519.PrivateKeySize {
		return false
	}
	derived := ed25519.NewKeyFromSeed(key[:ed25519.SeedSize])
	return constantTimeEqual(derived, key)
}

func constantTimeEqual(a, b []byte) bool {
	return hmac.Equal(a, b)
}
