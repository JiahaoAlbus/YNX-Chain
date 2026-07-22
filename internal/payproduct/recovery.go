package payproduct

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const backupFormatVersion = 1

var sourceCommitRE = regexp.MustCompile(`^[0-9a-f]{40}$`)

type BackupManifest struct {
	FormatVersion   int            `json:"formatVersion"`
	BackupID        string         `json:"backupId"`
	CreatedAt       time.Time      `json:"createdAt"`
	SourceCommit    string         `json:"sourceCommit"`
	SourceSHA256    string         `json:"sourceSha256"`
	SourceBytes     int64          `json:"sourceBytes"`
	SnapshotVersion int            `json:"snapshotVersion"`
	RecordCounts    map[string]int `json:"recordCounts"`
	Integrity       string         `json:"integrity"`
}

type backupArchive struct {
	Manifest BackupManifest `json:"manifest"`
	State    []byte         `json:"state"`
	MAC      string         `json:"mac"`
}

type backupUnsigned struct {
	Manifest BackupManifest `json:"manifest"`
	State    []byte         `json:"state"`
}

type RestoreEvidence struct {
	FormatVersion    int       `json:"formatVersion"`
	BackupID         string    `json:"backupId"`
	SourceCommit     string    `json:"sourceCommit"`
	RestoredAt       time.Time `json:"restoredAt"`
	BeforeSHA256     string    `json:"beforeSha256"`
	AfterSHA256      string    `json:"afterSha256"`
	RestoredBytes    int64     `json:"restoredBytes"`
	SnapshotVersion  int       `json:"snapshotVersion"`
	RollbackFileName string    `json:"rollbackFileName,omitempty"`
	Verified         bool      `json:"verified"`
}

type StoreOperationLock struct {
	path string
	file *os.File
	hash string
}

func AcquireStoreOperationLock(storePath, purpose string, now time.Time) (*StoreOperationLock, error) {
	if purpose != "service" && purpose != "restore" {
		return nil, errors.New("store lock purpose must be service or restore")
	}
	lockPath := storePath + ".operation.lock"
	if err := rejectSymlink(lockPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, errors.New("state store is locked by another service or recovery operation")
		}
		return nil, err
	}
	record, err := json.Marshal(map[string]any{"version": 1, "purpose": purpose, "pid": os.Getpid(), "createdAt": now.UTC()})
	if err != nil {
		_ = file.Close()
		_ = os.Remove(lockPath)
		return nil, err
	}
	if _, err := file.Write(record); err != nil {
		_ = file.Close()
		_ = os.Remove(lockPath)
		return nil, err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(lockPath)
		return nil, err
	}
	return &StoreOperationLock{path: lockPath, file: file, hash: sha256Hex(record)}, nil
}

func (lock *StoreOperationLock) Release() error {
	if lock == nil || lock.file == nil {
		return nil
	}
	closeErr := lock.file.Close()
	lock.file = nil
	raw, readErr := os.ReadFile(lock.path)
	if readErr != nil {
		return errors.Join(closeErr, readErr)
	}
	if sha256Hex(raw) != lock.hash {
		return errors.Join(closeErr, errors.New("store lock changed ownership and was not removed"))
	}
	return errors.Join(closeErr, os.Remove(lock.path), syncDirectory(filepath.Dir(lock.path)))
}

func CreateBackup(storePath, backupPath string, integrityKey []byte, sourceCommit string, now time.Time) (BackupManifest, error) {
	if len(integrityKey) < 32 {
		return BackupManifest{}, errors.New("backup integrity key must contain at least 32 bytes")
	}
	if !sourceCommitRE.MatchString(sourceCommit) {
		return BackupManifest{}, errors.New("exact 40-character source commit is required")
	}
	if samePath(storePath, backupPath) {
		return BackupManifest{}, errors.New("backup destination must differ from the state store")
	}
	if err := rejectSymlink(storePath); err != nil {
		return BackupManifest{}, err
	}
	raw, err := os.ReadFile(storePath)
	if err != nil {
		return BackupManifest{}, fmt.Errorf("read state for backup: %w", err)
	}
	snapshot, err := decodeStoreSnapshot(raw, integrityKey)
	if err != nil {
		return BackupManifest{}, fmt.Errorf("verify state before backup: %w", err)
	}
	sourceHash := sha256Hex(raw)
	createdAt := now.UTC()
	idMaterial := sourceHash + "\n" + createdAt.Format(time.RFC3339Nano) + "\n" + sourceCommit
	manifest := BackupManifest{FormatVersion: backupFormatVersion, BackupID: "bkp_" + sha256Hex([]byte(idMaterial))[:24], CreatedAt: createdAt, SourceCommit: sourceCommit, SourceSHA256: sourceHash, SourceBytes: int64(len(raw)), SnapshotVersion: snapshot.Version, RecordCounts: snapshotRecordCounts(snapshot), Integrity: "HMAC-SHA256 plus nested state-envelope HMAC-SHA256"}
	unsigned := backupUnsigned{Manifest: manifest, State: append([]byte(nil), raw...)}
	material, err := json.Marshal(unsigned)
	if err != nil {
		return BackupManifest{}, err
	}
	archive := backupArchive{Manifest: manifest, State: unsigned.State, MAC: hmacHex(integrityKey, material)}
	encoded, err := json.MarshalIndent(archive, "", "  ")
	if err != nil {
		return BackupManifest{}, err
	}
	if err := writeNewFileAtomic(backupPath, encoded); err != nil {
		return BackupManifest{}, fmt.Errorf("write backup: %w", err)
	}
	verified, _, err := verifyBackupBytes(encoded, integrityKey)
	if err != nil {
		return BackupManifest{}, fmt.Errorf("verify written backup: %w", err)
	}
	if verified.BackupID != manifest.BackupID {
		return BackupManifest{}, errors.New("written backup did not pass independent verification")
	}
	return manifest, nil
}

func VerifyBackup(backupPath string, integrityKey []byte) (BackupManifest, error) {
	if err := rejectSymlink(backupPath); err != nil {
		return BackupManifest{}, err
	}
	raw, err := os.ReadFile(backupPath)
	if err != nil {
		return BackupManifest{}, fmt.Errorf("read backup: %w", err)
	}
	manifest, _, err := verifyBackupBytes(raw, integrityKey)
	return manifest, err
}

func RestoreBackup(backupPath, storePath string, integrityKey []byte, expectedCurrentSHA256 string, now time.Time) (RestoreEvidence, error) {
	if samePath(backupPath, storePath) {
		return RestoreEvidence{}, errors.New("backup and restore destination must differ")
	}
	if err := rejectSymlink(backupPath); err != nil {
		return RestoreEvidence{}, err
	}
	lock, err := AcquireStoreOperationLock(storePath, "restore", now)
	if err != nil {
		return RestoreEvidence{}, err
	}
	released := false
	defer func() {
		if !released {
			_ = lock.Release()
		}
	}()
	backupRaw, err := os.ReadFile(backupPath)
	if err != nil {
		return RestoreEvidence{}, fmt.Errorf("read backup: %w", err)
	}
	manifest, stateRaw, err := verifyBackupBytes(backupRaw, integrityKey)
	if err != nil {
		return RestoreEvidence{}, err
	}
	beforeRaw, beforeHash, exists, err := readExpectedDestination(storePath, expectedCurrentSHA256)
	if err != nil {
		return RestoreEvidence{}, err
	}
	rollbackName := ""
	if exists {
		rollbackName = filepath.Base(storePath) + ".rollback." + now.UTC().Format("20060102T150405.000000000Z") + "." + beforeHash[:12]
		rollbackPath := filepath.Join(filepath.Dir(storePath), rollbackName)
		if err := writeNewFileAtomic(rollbackPath, beforeRaw); err != nil {
			return RestoreEvidence{}, fmt.Errorf("write rollback copy: %w", err)
		}
	}
	if _, err := decodeStoreSnapshot(stateRaw, integrityKey); err != nil {
		return RestoreEvidence{}, fmt.Errorf("verify restore payload: %w", err)
	}
	if err := replaceFileAtomic(storePath, stateRaw, expectedCurrentSHA256); err != nil {
		return RestoreEvidence{}, err
	}
	afterRaw, err := os.ReadFile(storePath)
	if err != nil {
		return RestoreEvidence{}, fmt.Errorf("read restored state: %w", err)
	}
	snapshot, err := decodeStoreSnapshot(afterRaw, integrityKey)
	if err != nil {
		return RestoreEvidence{}, fmt.Errorf("verify restored state: %w", err)
	}
	afterHash := sha256Hex(afterRaw)
	if afterHash != manifest.SourceSHA256 || int64(len(afterRaw)) != manifest.SourceBytes {
		return RestoreEvidence{}, errors.New("restored state does not match verified backup manifest")
	}
	evidence := RestoreEvidence{FormatVersion: backupFormatVersion, BackupID: manifest.BackupID, SourceCommit: manifest.SourceCommit, RestoredAt: now.UTC(), BeforeSHA256: beforeHash, AfterSHA256: afterHash, RestoredBytes: int64(len(afterRaw)), SnapshotVersion: snapshot.Version, RollbackFileName: rollbackName, Verified: true}
	if err := lock.Release(); err != nil {
		return RestoreEvidence{}, fmt.Errorf("release restore lock: %w", err)
	}
	released = true
	return evidence, nil
}

func verifyBackupBytes(raw, integrityKey []byte) (BackupManifest, []byte, error) {
	if len(integrityKey) < 32 {
		return BackupManifest{}, nil, errors.New("backup integrity key must contain at least 32 bytes")
	}
	var archive backupArchive
	if err := strictJSON(raw, &archive); err != nil {
		return BackupManifest{}, nil, fmt.Errorf("decode backup archive: %w", err)
	}
	if archive.Manifest.FormatVersion != backupFormatVersion || !strings.HasPrefix(archive.Manifest.BackupID, "bkp_") || !sourceCommitRE.MatchString(archive.Manifest.SourceCommit) || archive.Manifest.Integrity == "" {
		return BackupManifest{}, nil, errors.New("backup manifest is invalid or unsupported")
	}
	material, err := json.Marshal(backupUnsigned{Manifest: archive.Manifest, State: archive.State})
	if err != nil {
		return BackupManifest{}, nil, err
	}
	want := hmacHex(integrityKey, material)
	if !hmac.Equal([]byte(strings.ToLower(archive.MAC)), []byte(want)) {
		return BackupManifest{}, nil, errors.New("backup archive integrity check failed")
	}
	stateRaw := append([]byte(nil), archive.State...)
	if sha256Hex(stateRaw) != archive.Manifest.SourceSHA256 || int64(len(stateRaw)) != archive.Manifest.SourceBytes {
		return BackupManifest{}, nil, errors.New("backup state hash or size does not match manifest")
	}
	snapshot, err := decodeStoreSnapshot(stateRaw, integrityKey)
	if err != nil {
		return BackupManifest{}, nil, fmt.Errorf("backup contains invalid state: %w", err)
	}
	if snapshot.Version != archive.Manifest.SnapshotVersion {
		return BackupManifest{}, nil, errors.New("backup snapshot version does not match manifest")
	}
	return archive.Manifest, stateRaw, nil
}

func readExpectedDestination(path, expected string) ([]byte, string, bool, error) {
	if err := rejectSymlink(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, "", false, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if expected != "absent" {
			return nil, "", false, errors.New("restore destination is absent; explicit expected-current-sha256=absent is required")
		}
		return nil, "absent", false, nil
	}
	if err != nil {
		return nil, "", false, fmt.Errorf("read restore destination: %w", err)
	}
	hash := sha256Hex(raw)
	if expected == "" || !hmac.Equal([]byte(strings.ToLower(expected)), []byte(hash)) {
		return nil, "", false, errors.New("restore destination changed or expected current SHA-256 was not confirmed")
	}
	return raw, hash, true, nil
}

func replaceFileAtomic(path string, raw []byte, expected string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".restore-*")
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
	_, currentHash, exists, err := readExpectedDestination(path, expected)
	if err != nil {
		return err
	}
	if (!exists && expected != "absent") || (exists && currentHash != strings.ToLower(expected)) {
		return errors.New("restore destination changed during restore")
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("atomically replace restore destination: %w", err)
	}
	return syncDirectory(dir)
}

func writeNewFileAtomic(path string, raw []byte) error {
	if err := rejectSymlink(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if _, err := os.Lstat(path); err == nil {
		return os.ErrExist
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".new-*")
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
		return err
	}
	return syncDirectory(dir)
}

func rejectSymlink(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("recovery paths must not be symbolic links")
	}
	return nil
}

func samePath(a, b string) bool {
	aAbs, aErr := filepath.Abs(a)
	bAbs, bErr := filepath.Abs(b)
	return aErr == nil && bErr == nil && filepath.Clean(aAbs) == filepath.Clean(bAbs)
}

func syncDirectory(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func sha256Hex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func snapshotRecordCounts(snapshot Snapshot) map[string]int {
	return map[string]int{"merchants": len(snapshot.Merchants), "members": len(snapshot.MerchantMembers), "catalog": len(snapshot.Catalog), "invoices": len(snapshot.Invoices), "refunds": len(snapshot.Refunds), "disputes": len(snapshot.Disputes), "webhookDeliveries": len(snapshot.Deliveries), "aiRuns": len(snapshot.AIRuns), "providers": len(snapshot.Providers), "auditEntries": len(snapshot.Audit)}
}
