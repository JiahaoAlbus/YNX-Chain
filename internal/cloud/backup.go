package cloud

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	backupSchemaVersion = 1
	backupManifestFile  = "manifest.json"
	backupManifestHash  = "manifest.sha256"
	backupStateFile     = "state.json"
)

type BackupObject struct {
	Hash         string `json:"hash"`
	Bytes        int64  `json:"bytes"`
	RelativePath string `json:"relativePath"`
}

type BackupManifest struct {
	SchemaVersion             int            `json:"schemaVersion"`
	BackupID                  string         `json:"backupId"`
	CreatedAt                 time.Time      `json:"createdAt"`
	StateSchemaVersion        int            `json:"stateSchemaVersion"`
	StateFile                 string         `json:"stateFile"`
	StateSHA256               string         `json:"stateSha256"`
	StateIntegrityHash        string         `json:"stateIntegrityHash"`
	RootSHA256                string         `json:"rootSha256"`
	ObjectStoreBoundary       string         `json:"objectStoreBoundary"`
	Objects                   []BackupObject `json:"objects"`
	ObjectBytes               int64          `json:"objectBytes"`
	SessionsExcluded          bool           `json:"sessionsExcluded"`
	NoncesExcluded            bool           `json:"noncesExcluded"`
	PresenceExcluded          bool           `json:"presenceExcluded"`
	InterruptedAIJobsFailed   bool           `json:"interruptedAiJobsFailed"`
	EncryptionClass           string         `json:"encryptionClass"`
	SigningClass              string         `json:"signingClass"`
	ProductionDurabilityClaim bool           `json:"productionDurabilityClaim"`
}

type RestoreReport struct {
	BackupID               string `json:"backupId"`
	ObjectsVerified        int    `json:"objectsVerified"`
	BytesVerified          int64  `json:"bytesVerified"`
	SourceStateIntegrity   string `json:"sourceStateIntegrity"`
	RestoredStateIntegrity string `json:"restoredStateIntegrity"`
	SessionsRestored       int    `json:"sessionsRestored"`
	PresenceRestored       int    `json:"presenceRestored"`
	ObjectStoreBoundary    string `json:"objectStoreBoundary"`
	Ready                  bool   `json:"ready"`
}

func CreateOfflineBackup(ctx context.Context, cfg Config, destination string) (BackupManifest, error) {
	normalized, err := normalizeConfig(cfg)
	if err != nil {
		return BackupManifest{}, err
	}
	stateInfo, err := os.Lstat(normalized.StatePath)
	if err != nil {
		return BackupManifest{}, fmt.Errorf("inspect backup source state: %w", err)
	}
	if !stateInfo.Mode().IsRegular() || stateInfo.Mode()&os.ModeSymlink != 0 {
		return BackupManifest{}, errors.New("backup source state must be a regular file")
	}
	if stateInfo.Mode().Perm()&0o077 != 0 {
		return BackupManifest{}, errors.New("backup source state permissions are too broad")
	}
	state, err := loadStateReadOnly(normalized.StatePath)
	if err != nil {
		return BackupManifest{}, err
	}
	return newService(normalized, state).CreateBackup(ctx, destination)
}

func (s *Service) CreateBackup(ctx context.Context, destination string) (BackupManifest, error) {
	destination = filepath.Clean(strings.TrimSpace(destination))
	if destination == "." || destination == "" {
		return BackupManifest{}, errors.New("backup destination is required")
	}
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return BackupManifest{}, fmt.Errorf("create backup parent: %w", err)
	}
	if err := ensureAbsent(destination, "backup destination"); err != nil {
		return BackupManifest{}, err
	}

	s.mu.Lock()
	snapshot, err := cloneState(s.state)
	store := s.cfg.ObjectStore
	now := s.cfg.Now()
	s.mu.Unlock()
	if err != nil {
		return BackupManifest{}, err
	}
	if store == nil {
		return BackupManifest{}, errors.New("object store is unavailable")
	}

	sanitizeBackupState(&snapshot)
	refs, sizes, err := backupObjectIndex(snapshot)
	if err != nil {
		return BackupManifest{}, err
	}

	tempDir, err := os.MkdirTemp(parent, "."+filepath.Base(destination)+".tmp-")
	if err != nil {
		return BackupManifest{}, fmt.Errorf("create backup staging directory: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(tempDir)
		}
	}()
	if err := os.Chmod(tempDir, 0o700); err != nil {
		return BackupManifest{}, err
	}
	objectsDir := filepath.Join(tempDir, "objects")
	if err := os.Mkdir(objectsDir, 0o700); err != nil {
		return BackupManifest{}, fmt.Errorf("create backup object directory: %w", err)
	}

	hashes := make([]string, 0, len(refs))
	for hash := range refs {
		hashes = append(hashes, hash)
	}
	sort.Strings(hashes)
	entries := make([]BackupObject, 0, len(hashes))
	var objectBytes int64
	for _, hash := range hashes {
		if err := ctx.Err(); err != nil {
			return BackupManifest{}, err
		}
		body, err := store.Get(ctx, refs[hash], hash)
		if err != nil {
			return BackupManifest{}, fmt.Errorf("read object %s for backup: %w", hash, err)
		}
		if int64(len(body)) != sizes[hash] {
			return BackupManifest{}, fmt.Errorf("object %s size mismatch: got %d want %d", hash, len(body), sizes[hash])
		}
		relative := filepath.ToSlash(filepath.Join("objects", hash))
		if err := writeExclusive(filepath.Join(tempDir, filepath.FromSlash(relative)), body, 0o600); err != nil {
			return BackupManifest{}, fmt.Errorf("write backup object %s: %w", hash, err)
		}
		entries = append(entries, BackupObject{Hash: hash, Bytes: int64(len(body)), RelativePath: relative})
		objectBytes += int64(len(body))
	}
	for objectID, versions := range snapshot.Versions {
		for index := range versions {
			versions[index].BlobPath = filepath.ToSlash(filepath.Join("objects", versions[index].Hash))
		}
		snapshot.Versions[objectID] = versions
	}

	statePath := filepath.Join(tempDir, backupStateFile)
	if err := saveState(statePath, &snapshot); err != nil {
		return BackupManifest{}, fmt.Errorf("write backup state: %w", err)
	}
	stateBytes, err := os.ReadFile(statePath)
	if err != nil {
		return BackupManifest{}, err
	}
	stateHash := hashBytes(stateBytes)
	manifest := BackupManifest{
		SchemaVersion:             backupSchemaVersion,
		BackupID:                  newID("backup"),
		CreatedAt:                 now,
		StateSchemaVersion:        snapshot.SchemaVersion,
		StateFile:                 backupStateFile,
		StateSHA256:               stateHash,
		StateIntegrityHash:        snapshot.IntegrityHash,
		ObjectStoreBoundary:       store.Boundary(),
		Objects:                   entries,
		ObjectBytes:               objectBytes,
		SessionsExcluded:          true,
		NoncesExcluded:            true,
		PresenceExcluded:          true,
		InterruptedAIJobsFailed:   true,
		EncryptionClass:           "none-local-operator-only",
		SigningClass:              "none-local-integrity-only",
		ProductionDurabilityClaim: false,
	}
	manifest.RootSHA256 = backupRootHash(manifest.StateSHA256, manifest.Objects)
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return BackupManifest{}, err
	}
	manifestBytes = append(manifestBytes, '\n')
	if err := writeExclusive(filepath.Join(tempDir, backupManifestFile), manifestBytes, 0o600); err != nil {
		return BackupManifest{}, fmt.Errorf("write backup manifest: %w", err)
	}
	manifestHash := hashBytes(manifestBytes)
	if err := writeExclusive(filepath.Join(tempDir, backupManifestHash), []byte(manifestHash+"  "+backupManifestFile+"\n"), 0o600); err != nil {
		return BackupManifest{}, fmt.Errorf("write backup manifest hash: %w", err)
	}
	if err := syncDirectory(objectsDir); err != nil {
		return BackupManifest{}, fmt.Errorf("sync backup objects: %w", err)
	}
	if err := syncDirectory(tempDir); err != nil {
		return BackupManifest{}, fmt.Errorf("sync backup staging directory: %w", err)
	}
	if err := os.Rename(tempDir, destination); err != nil {
		return BackupManifest{}, fmt.Errorf("commit backup: %w", err)
	}
	committed = true
	if err := syncDirectory(parent); err != nil {
		return BackupManifest{}, fmt.Errorf("sync backup parent: %w", err)
	}
	return manifest, nil
}

func RestoreBackup(ctx context.Context, backupDir string, cfg Config) (*Service, RestoreReport, error) {
	backupDir = filepath.Clean(strings.TrimSpace(backupDir))
	if backupDir == "." || backupDir == "" {
		return nil, RestoreReport{}, errors.New("backup directory is required")
	}
	if strings.TrimSpace(cfg.StatePath) == "" {
		return nil, RestoreReport{}, errors.New("restore state path is required")
	}
	if err := ensureSecureBackupLayout(backupDir); err != nil {
		return nil, RestoreReport{}, err
	}
	if err := ensureAbsent(cfg.StatePath, "restore state path"); err != nil {
		return nil, RestoreReport{}, err
	}

	manifestBytes, err := os.ReadFile(filepath.Join(backupDir, backupManifestFile))
	if err != nil {
		return nil, RestoreReport{}, fmt.Errorf("read backup manifest: %w", err)
	}
	hashFile, err := os.ReadFile(filepath.Join(backupDir, backupManifestHash))
	if err != nil {
		return nil, RestoreReport{}, fmt.Errorf("read backup manifest hash: %w", err)
	}
	expectedManifestHash := strings.Fields(string(hashFile))
	if len(expectedManifestHash) != 2 || expectedManifestHash[1] != backupManifestFile || expectedManifestHash[0] != hashBytes(manifestBytes) {
		return nil, RestoreReport{}, errors.New("backup manifest integrity verification failed")
	}
	var manifest BackupManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, RestoreReport{}, fmt.Errorf("decode backup manifest: %w", err)
	}
	if err := validateBackupManifest(manifest); err != nil {
		return nil, RestoreReport{}, err
	}

	statePath := filepath.Join(backupDir, manifest.StateFile)
	stateBytes, err := os.ReadFile(statePath)
	if err != nil {
		return nil, RestoreReport{}, fmt.Errorf("read backup state: %w", err)
	}
	if hashBytes(stateBytes) != manifest.StateSHA256 {
		return nil, RestoreReport{}, errors.New("backup state file integrity verification failed")
	}
	var state persistentState
	if err := json.Unmarshal(stateBytes, &state); err != nil {
		return nil, RestoreReport{}, fmt.Errorf("decode backup state: %w", err)
	}
	if state.SchemaVersion != manifest.StateSchemaVersion || state.IntegrityHash != manifest.StateIntegrityHash {
		return nil, RestoreReport{}, errors.New("backup state metadata mismatch")
	}
	wantIntegrity, err := stateIntegrity(state)
	if err != nil || wantIntegrity != state.IntegrityHash {
		return nil, RestoreReport{}, errors.New("backup state integrity verification failed")
	}
	normalize(&state)
	if len(state.Sessions) != 0 || len(state.Nonces) != 0 || len(state.Presence) != 0 {
		return nil, RestoreReport{}, errors.New("backup contains restorable ephemeral credentials or presence")
	}

	objectIndex := make(map[string]BackupObject, len(manifest.Objects))
	var verifiedBytes int64
	for _, entry := range manifest.Objects {
		if err := ctx.Err(); err != nil {
			return nil, RestoreReport{}, err
		}
		if _, exists := objectIndex[entry.Hash]; exists {
			return nil, RestoreReport{}, fmt.Errorf("duplicate backup object %s", entry.Hash)
		}
		if entry.RelativePath != filepath.ToSlash(filepath.Join("objects", entry.Hash)) {
			return nil, RestoreReport{}, fmt.Errorf("unsafe backup object path for %s", entry.Hash)
		}
		body, err := readRegularBackupFile(backupDir, entry.RelativePath)
		if err != nil {
			return nil, RestoreReport{}, err
		}
		if int64(len(body)) != entry.Bytes || hashBytes(body) != entry.Hash {
			return nil, RestoreReport{}, fmt.Errorf("backup object %s integrity verification failed", entry.Hash)
		}
		objectIndex[entry.Hash] = entry
		verifiedBytes += int64(len(body))
	}
	if verifiedBytes != manifest.ObjectBytes || backupRootHash(manifest.StateSHA256, manifest.Objects) != manifest.RootSHA256 {
		return nil, RestoreReport{}, errors.New("backup root integrity verification failed")
	}
	for _, versions := range state.Versions {
		for _, version := range versions {
			entry, ok := objectIndex[version.Hash]
			if !ok || version.BlobPath != entry.RelativePath || version.Size != entry.Bytes {
				return nil, RestoreReport{}, fmt.Errorf("backup version reference mismatch for %s", version.Hash)
			}
		}
	}

	if cfg.ObjectDir == "" {
		cfg.ObjectDir = filepath.Join(filepath.Dir(cfg.StatePath), "objects")
	}
	if cfg.ObjectStore == nil {
		if err := ensureAbsent(cfg.ObjectDir, "restore object directory"); err != nil {
			return nil, RestoreReport{}, err
		}
		cfg.ObjectStore = LocalObjectStore{Root: cfg.ObjectDir}
	}
	refs := make(map[string]string, len(manifest.Objects))
	for _, entry := range manifest.Objects {
		if err := ctx.Err(); err != nil {
			return nil, RestoreReport{}, err
		}
		body, err := readRegularBackupFile(backupDir, entry.RelativePath)
		if err != nil {
			return nil, RestoreReport{}, err
		}
		ref, err := cfg.ObjectStore.Put(ctx, entry.Hash, body)
		if err != nil {
			return nil, RestoreReport{}, fmt.Errorf("restore object %s: %w", entry.Hash, err)
		}
		if strings.TrimSpace(ref) == "" {
			return nil, RestoreReport{}, fmt.Errorf("restore object %s returned empty reference", entry.Hash)
		}
		refs[entry.Hash] = ref
	}
	for objectID, versions := range state.Versions {
		for index := range versions {
			versions[index].BlobPath = refs[versions[index].Hash]
		}
		state.Versions[objectID] = versions
	}
	sanitizeBackupState(&state)
	if err := saveState(cfg.StatePath, &state); err != nil {
		return nil, RestoreReport{}, fmt.Errorf("write restored state: %w", err)
	}
	service, err := New(cfg)
	if err != nil {
		return nil, RestoreReport{}, fmt.Errorf("open restored service: %w", err)
	}
	report := RestoreReport{
		BackupID:               manifest.BackupID,
		ObjectsVerified:        len(manifest.Objects),
		BytesVerified:          verifiedBytes,
		SourceStateIntegrity:   manifest.StateIntegrityHash,
		RestoredStateIntegrity: service.state.IntegrityHash,
		SessionsRestored:       len(service.state.Sessions),
		PresenceRestored:       len(service.state.Presence),
		ObjectStoreBoundary:    service.cfg.ObjectStore.Boundary(),
		Ready:                  true,
	}
	return service, report, nil
}

func sanitizeBackupState(state *persistentState) {
	state.Sessions = map[string]Session{}
	state.Nonces = map[string]time.Time{}
	state.Presence = map[string]Presence{}
	for id, job := range state.AIJobs {
		if job.Status == "queued" || job.Status == "running" {
			job.Status = "failed"
			job.Error = "AI job was interrupted by backup recovery; retry requires fresh context consent"
			state.AIJobs[id] = job
		}
	}
}

func backupObjectIndex(state persistentState) (map[string]string, map[string]int64, error) {
	refs := map[string]string{}
	sizes := map[string]int64{}
	for objectID, versions := range state.Versions {
		for _, version := range versions {
			if !validSHA256(version.Hash) || strings.TrimSpace(version.BlobPath) == "" || version.Size < 0 {
				return nil, nil, fmt.Errorf("invalid object version reference %s@%d", objectID, version.Number)
			}
			if size, exists := sizes[version.Hash]; exists && size != version.Size {
				return nil, nil, fmt.Errorf("conflicting sizes for object hash %s", version.Hash)
			}
			if _, exists := refs[version.Hash]; !exists {
				refs[version.Hash] = version.BlobPath
			}
			sizes[version.Hash] = version.Size
		}
	}
	return refs, sizes, nil
}

func validateBackupManifest(manifest BackupManifest) error {
	if manifest.SchemaVersion != backupSchemaVersion || manifest.StateFile != backupStateFile || manifest.BackupID == "" {
		return errors.New("unsupported or invalid backup manifest")
	}
	if !validSHA256(manifest.StateSHA256) || !validSHA256(manifest.StateIntegrityHash) || !validSHA256(manifest.RootSHA256) {
		return errors.New("backup manifest hash fields are invalid")
	}
	if !manifest.SessionsExcluded || !manifest.NoncesExcluded || !manifest.PresenceExcluded || !manifest.InterruptedAIJobsFailed {
		return errors.New("backup manifest does not enforce ephemeral-state exclusion")
	}
	if manifest.EncryptionClass != "none-local-operator-only" || manifest.SigningClass != "none-local-integrity-only" || manifest.ProductionDurabilityClaim {
		return errors.New("backup manifest makes an unsupported security or durability claim")
	}
	return nil
}

func backupRootHash(stateHash string, objects []BackupObject) string {
	ordered := append([]BackupObject(nil), objects...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Hash < ordered[j].Hash })
	var builder strings.Builder
	builder.WriteString(backupStateFile)
	builder.WriteByte(':')
	builder.WriteString(stateHash)
	builder.WriteByte('\n')
	for _, object := range ordered {
		fmt.Fprintf(&builder, "%s:%s:%d\n", object.RelativePath, object.Hash, object.Bytes)
	}
	return hashBytes([]byte(builder.String()))
}

func validSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func ensureAbsent(path, label string) error {
	_, err := os.Lstat(path)
	switch {
	case err == nil:
		return fmt.Errorf("%s already exists", label)
	case os.IsNotExist(err):
		return nil
	default:
		return fmt.Errorf("inspect %s: %w", label, err)
	}
}

func ensureSecureBackupLayout(root string) error {
	for _, path := range []string{root, filepath.Join(root, "objects")} {
		info, err := os.Lstat(path)
		if err != nil {
			return fmt.Errorf("inspect backup path %s: %w", path, err)
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("backup path %s must be a real directory", path)
		}
		if info.Mode().Perm()&0o077 != 0 {
			return fmt.Errorf("backup directory %s permissions are too broad", path)
		}
	}
	for _, name := range []string{backupManifestFile, backupManifestHash, backupStateFile} {
		info, err := os.Lstat(filepath.Join(root, name))
		if err != nil {
			return fmt.Errorf("inspect backup file %s: %w", name, err)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("backup file %s must be regular", name)
		}
		if info.Mode().Perm()&0o077 != 0 {
			return fmt.Errorf("backup file %s permissions are too broad", name)
		}
	}
	return nil
}

func readRegularBackupFile(root, relative string) ([]byte, error) {
	clean := filepath.Clean(filepath.FromSlash(relative))
	if filepath.IsAbs(clean) || clean == "." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".." {
		return nil, errors.New("unsafe backup relative path")
	}
	path := filepath.Join(root, clean)
	parentInfo, err := os.Lstat(filepath.Dir(path))
	if err != nil || !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("backup object parent is invalid: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("inspect backup object: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("backup object must be a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("backup object permissions are too broad")
	}
	return os.ReadFile(path)
}

func writeExclusive(path string, body []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(body); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
