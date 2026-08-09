package music

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const backupManifestSchemaVersion = 1

type BackupObject struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}

type BackupManifest struct {
	SchemaVersion      int            `json:"schemaVersion"`
	CreatedAt          time.Time      `json:"createdAt"`
	StateSchemaVersion int            `json:"stateSchemaVersion"`
	StateIntegrityHash string         `json:"stateIntegrityHash"`
	StateSHA256        string         `json:"stateSha256"`
	StateBytes         int64          `json:"stateBytes"`
	Media              []BackupObject `json:"media"`
}

func (s *Service) CreateBackup(destination string) (BackupManifest, error) {
	if !filepath.IsAbs(destination) {
		return BackupManifest{}, fmt.Errorf("%w: absolute backup destination required", ErrInvalid)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return createBackup(s.cfg.StatePath, s.cfg.MediaDir, destination, s.cfg.Now().UTC())
}

func RestoreBackup(backupDir, statePath, mediaDir string) error {
	if !filepath.IsAbs(backupDir) || !filepath.IsAbs(statePath) || !filepath.IsAbs(mediaDir) {
		return fmt.Errorf("%w: absolute backup, state, and media paths required", ErrInvalid)
	}
	if filepath.Clean(filepath.Dir(statePath)) != filepath.Clean(filepath.Dir(mediaDir)) {
		return fmt.Errorf("%w: state and media destinations must share one data directory", ErrInvalid)
	}
	if err := requireAbsent(statePath, "state destination"); err != nil {
		return err
	}
	if err := requireAbsent(mediaDir, "media destination"); err != nil {
		return err
	}

	manifest, state, err := verifyBackup(backupDir)
	if err != nil {
		return err
	}
	parent := filepath.Dir(statePath)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	tmpRoot, err := os.MkdirTemp(parent, ".music-restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpRoot)
	if err := os.Chmod(tmpRoot, 0o700); err != nil {
		return err
	}
	tmpState := filepath.Join(tmpRoot, "state.json")
	tmpMedia := filepath.Join(tmpRoot, "media")
	if err := os.Mkdir(tmpMedia, 0o700); err != nil {
		return err
	}
	if _, _, err := copyVerifiedFile(filepath.Join(backupDir, "state.json"), tmpState, manifest.StateSHA256); err != nil {
		return fmt.Errorf("restore music state: %w", err)
	}
	for _, object := range manifest.Media {
		if _, _, err := copyVerifiedFile(filepath.Join(backupDir, "media", object.Name), filepath.Join(tmpMedia, object.Name), object.SHA256); err != nil {
			return fmt.Errorf("restore music media %s: %w", object.Name, err)
		}
	}
	if _, exists, err := loadState(tmpState, tmpMedia); err != nil || !exists {
		if err == nil {
			err = errors.New("restored music state is missing")
		}
		return fmt.Errorf("verify restored music backup: %w", err)
	}
	if state.SchemaVersion != manifest.StateSchemaVersion || state.IntegrityHash != manifest.StateIntegrityHash {
		return errors.New("restored music backup state metadata mismatch")
	}
	if err := os.Rename(tmpMedia, mediaDir); err != nil {
		return err
	}
	if err := os.Rename(tmpState, statePath); err != nil {
		_ = os.RemoveAll(mediaDir)
		return err
	}
	if err := os.Chmod(mediaDir, 0o700); err != nil {
		return err
	}
	return os.Chmod(statePath, 0o600)
}

func createBackup(statePath, mediaDir, destination string, createdAt time.Time) (BackupManifest, error) {
	if err := requireAbsent(destination, "backup destination"); err != nil {
		return BackupManifest{}, err
	}
	state, exists, err := loadState(statePath, mediaDir)
	if err != nil {
		return BackupManifest{}, err
	}
	if !exists {
		return BackupManifest{}, errors.New("music state does not exist")
	}
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return BackupManifest{}, err
	}
	tmpRoot, err := os.MkdirTemp(parent, ".music-backup-*")
	if err != nil {
		return BackupManifest{}, err
	}
	defer os.RemoveAll(tmpRoot)
	if err := os.Chmod(tmpRoot, 0o700); err != nil {
		return BackupManifest{}, err
	}
	backupMedia := filepath.Join(tmpRoot, "media")
	if err := os.Mkdir(backupMedia, 0o700); err != nil {
		return BackupManifest{}, err
	}

	stateHash, stateBytes, err := copyVerifiedFile(statePath, filepath.Join(tmpRoot, "state.json"), "")
	if err != nil {
		return BackupManifest{}, fmt.Errorf("backup music state: %w", err)
	}
	manifest := BackupManifest{
		SchemaVersion:      backupManifestSchemaVersion,
		CreatedAt:          createdAt,
		StateSchemaVersion: state.SchemaVersion,
		StateIntegrityHash: state.IntegrityHash,
		StateSHA256:        stateHash,
		StateBytes:         stateBytes,
		Media:              []BackupObject{},
	}
	for _, name := range referencedMediaNames(state) {
		expected := expectedMediaHash(state, name)
		hash, size, err := copyVerifiedFile(filepath.Join(mediaDir, name), filepath.Join(backupMedia, name), expected)
		if err != nil {
			return BackupManifest{}, fmt.Errorf("backup music media %s: %w", name, err)
		}
		manifest.Media = append(manifest.Media, BackupObject{Name: name, SHA256: hash, Bytes: size})
	}
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return BackupManifest{}, err
	}
	if err := writePrivateFile(filepath.Join(tmpRoot, "manifest.json"), append(manifestData, '\n')); err != nil {
		return BackupManifest{}, err
	}
	if err := os.Rename(tmpRoot, destination); err != nil {
		return BackupManifest{}, err
	}
	return manifest, nil
}

func verifyBackup(backupDir string) (BackupManifest, persistentState, error) {
	manifestPath := filepath.Join(backupDir, "manifest.json")
	manifestData, err := readPrivateRegularFile(manifestPath)
	if err != nil {
		return BackupManifest{}, persistentState{}, fmt.Errorf("read music backup manifest: %w", err)
	}
	var manifest BackupManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return BackupManifest{}, persistentState{}, errors.New("music backup manifest is invalid")
	}
	if manifest.SchemaVersion != backupManifestSchemaVersion || manifest.CreatedAt.IsZero() || manifest.StateSchemaVersion <= 0 || !validSHA256Hex(manifest.StateIntegrityHash) || !validSHA256Hex(manifest.StateSHA256) || manifest.StateBytes <= 0 || manifest.Media == nil {
		return BackupManifest{}, persistentState{}, errors.New("music backup manifest fields are invalid")
	}
	statePath := filepath.Join(backupDir, "state.json")
	stateHash, stateBytes, err := hashPrivateRegularFile(statePath)
	if err != nil {
		return BackupManifest{}, persistentState{}, fmt.Errorf("verify music backup state: %w", err)
	}
	if stateHash != manifest.StateSHA256 || stateBytes != manifest.StateBytes {
		return BackupManifest{}, persistentState{}, errors.New("music backup state digest mismatch")
	}
	state, exists, err := loadState(statePath, filepath.Join(backupDir, "media"))
	if err != nil || !exists {
		if err == nil {
			err = errors.New("music backup state is missing")
		}
		return BackupManifest{}, persistentState{}, fmt.Errorf("verify music backup state: %w", err)
	}
	if state.SchemaVersion != manifest.StateSchemaVersion || state.IntegrityHash != manifest.StateIntegrityHash {
		return BackupManifest{}, persistentState{}, errors.New("music backup state metadata mismatch")
	}
	expectedNames := referencedMediaNames(state)
	if len(expectedNames) != len(manifest.Media) {
		return BackupManifest{}, persistentState{}, errors.New("music backup media inventory mismatch")
	}
	seen := make(map[string]bool, len(manifest.Media))
	for i, object := range manifest.Media {
		if object.Name != filepath.Base(object.Name) || object.Name == "." || object.Name == "" || !validSHA256Hex(object.SHA256) || object.Bytes <= 0 || seen[object.Name] {
			return BackupManifest{}, persistentState{}, fmt.Errorf("music backup media object %d is invalid", i)
		}
		seen[object.Name] = true
		if object.Name != expectedNames[i] || object.SHA256 != expectedMediaHash(state, object.Name) {
			return BackupManifest{}, persistentState{}, errors.New("music backup media manifest is not canonical")
		}
		hash, size, err := hashPrivateRegularFile(filepath.Join(backupDir, "media", object.Name))
		if err != nil {
			return BackupManifest{}, persistentState{}, fmt.Errorf("verify music backup media %s: %w", object.Name, err)
		}
		if hash != object.SHA256 || size != object.Bytes {
			return BackupManifest{}, persistentState{}, fmt.Errorf("music backup media digest mismatch for %s", object.Name)
		}
	}
	return manifest, state, nil
}

func referencedMediaNames(state persistentState) []string {
	names := make([]string, 0, len(state.Tracks)*2)
	for id, track := range state.Tracks {
		names = append(names, id+".wav")
		if track.ArtworkSHA256 != "" {
			names = append(names, id+".art")
		}
	}
	sort.Strings(names)
	return names
}

func expectedMediaHash(state persistentState, name string) string {
	ext := filepath.Ext(name)
	id := name[:len(name)-len(ext)]
	track, ok := state.Tracks[id]
	if !ok {
		return ""
	}
	if ext == ".wav" {
		return track.AudioSHA256
	}
	if ext == ".art" {
		return track.ArtworkSHA256
	}
	return ""
}

func requireAbsent(path, label string) error {
	_, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("%s must not already exist", label)
}

func readPrivateRegularFile(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("file is not a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("file permissions are too broad: %04o", info.Mode().Perm())
	}
	return os.ReadFile(path)
}

func hashPrivateRegularFile(path string) (string, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() {
		return "", 0, errors.New("file is not a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return "", 0, fmt.Errorf("file permissions are too broad: %04o", info.Mode().Perm())
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	h := sha256.New()
	size, err := io.Copy(h, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), size, nil
}

func copyVerifiedFile(source, destination, expectedHash string) (string, int64, error) {
	actualHash, size, err := hashPrivateRegularFile(source)
	if err != nil {
		return "", 0, err
	}
	if expectedHash != "" && actualHash != expectedHash {
		return "", 0, errors.New("source SHA-256 mismatch")
	}
	input, err := os.Open(source)
	if err != nil {
		return "", 0, err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", 0, err
	}
	copied, copyErr := io.Copy(output, input)
	if copyErr == nil && copied != size {
		copyErr = errors.New("copied byte count mismatch")
	}
	if copyErr == nil {
		copyErr = output.Sync()
	}
	if closeErr := output.Close(); copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		_ = os.Remove(destination)
		return "", 0, copyErr
	}
	copiedHash, copiedSize, err := hashPrivateRegularFile(destination)
	if err != nil || copiedHash != actualHash || copiedSize != size {
		_ = os.Remove(destination)
		if err == nil {
			err = errors.New("copied file verification failed")
		}
		return "", 0, err
	}
	return copiedHash, copiedSize, nil
}

func writePrivateFile(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
	}
	return err
}
