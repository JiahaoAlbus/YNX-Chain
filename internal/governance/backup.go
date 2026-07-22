package governance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

type BackupRecord struct {
	SchemaVersion string    `json:"schemaVersion"`
	Artifact      string    `json:"artifact"`
	SHA256        string    `json:"sha256"`
	Bytes         int64     `json:"bytes"`
	CreatedAt     time.Time `json:"createdAt"`
	StateVersion  string    `json:"stateVersion"`
}

func Backup(statePath, backupDir string, now time.Time) (BackupRecord, error) {
	if !filepath.IsAbs(statePath) || !filepath.IsAbs(backupDir) {
		return BackupRecord{}, ErrInvalid
	}
	if _, err := Load(statePath); err != nil {
		return BackupRecord{}, err
	}
	data, err := os.ReadFile(statePath)
	if err != nil {
		return BackupRecord{}, err
	}
	if err = os.MkdirAll(backupDir, 0o700); err != nil {
		return BackupRecord{}, err
	}
	name := "governance-state-" + now.UTC().Format("20060102T150405Z") + ".json"
	artifact := filepath.Join(backupDir, name)
	if err = atomicWrite(artifact, data); err != nil {
		return BackupRecord{}, err
	}
	sum := sha256.Sum256(data)
	record := BackupRecord{SchemaVersion: "ynx-governance-backup/v1", Artifact: name, SHA256: hex.EncodeToString(sum[:]), Bytes: int64(len(data)), CreatedAt: now.UTC(), StateVersion: snapshotVersion}
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return BackupRecord{}, err
	}
	if err = atomicWrite(artifact+".record.json", append(encoded, '\n')); err != nil {
		return BackupRecord{}, err
	}
	return record, nil
}

func Restore(backupPath, recordPath, destination string, expected Policy, now time.Time) (string, error) {
	if !filepath.IsAbs(backupPath) || !filepath.IsAbs(recordPath) || !filepath.IsAbs(destination) {
		return "", ErrInvalid
	}
	recordData, err := os.ReadFile(recordPath)
	if err != nil {
		return "", err
	}
	var record BackupRecord
	if err = json.Unmarshal(recordData, &record); err != nil || record.SchemaVersion != "ynx-governance-backup/v1" || record.StateVersion != snapshotVersion || record.Artifact != filepath.Base(backupPath) || !validHash(record.SHA256) {
		return "", fmt.Errorf("%w: invalid backup record", ErrForbidden)
	}
	data, err := os.ReadFile(backupPath)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	if !strings.EqualFold(record.SHA256, hex.EncodeToString(sum[:])) || record.Bytes != int64(len(data)) {
		return "", fmt.Errorf("%w: backup artifact integrity mismatch", ErrForbidden)
	}
	service, err := Load(backupPath)
	if err != nil {
		return "", err
	}
	if !reflect.DeepEqual(service.policy, expected) {
		return "", fmt.Errorf("%w: backup policy mismatch", ErrForbidden)
	}
	preserved := ""
	if existing, statErr := os.ReadFile(destination); statErr == nil {
		if _, err = Load(destination); err != nil {
			return "", fmt.Errorf("%w: refusing to replace invalid current state", ErrForbidden)
		}
		preserved = destination + ".pre-restore-" + now.UTC().Format("20060102T150405Z")
		if err = atomicWrite(preserved, existing); err != nil {
			return "", err
		}
	} else if !os.IsNotExist(statErr) {
		return "", statErr
	}
	if err = atomicWrite(destination, data); err != nil {
		return "", err
	}
	return preserved, nil
}

func atomicWrite(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".governance-artifact-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(0o600); err == nil {
		_, err = tmp.Write(data)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, path)
}
