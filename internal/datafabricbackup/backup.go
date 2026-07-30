package datafabricbackup

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

const ManifestSchemaVersion = 1

type FileEvidence struct {
	Name   string `json:"name"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	SchemaVersion int            `json:"schemaVersion"`
	CreatedAt     time.Time      `json:"createdAt"`
	SourceCommit  string         `json:"sourceCommit"`
	SourceRelease string         `json:"sourceRelease"`
	Files         []FileEvidence `json:"files"`
	EventCount    uint64         `json:"eventCount"`
	JournalCount  uint64         `json:"journalCount"`
	EventLogCount uint64         `json:"eventLogCount"`
	Integrity     string         `json:"integrity"`
}

func Create(statePath, eventLogPath, outputDir, sourceCommit, sourceRelease string, keys map[string][]byte, now time.Time) (Manifest, error) {
	if !filepath.IsAbs(statePath) || !filepath.IsAbs(eventLogPath) || !filepath.IsAbs(outputDir) || sourceCommit == "" || sourceRelease == "" || now.IsZero() || now.Location() != time.UTC {
		return Manifest{}, errors.New("backup paths, source provenance, and UTC creation time are required")
	}
	if _, err := os.Stat(outputDir); !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, errors.New("backup output directory already exists or cannot be inspected")
	}
	store, err := datafabric.OpenStore(statePath)
	if err != nil {
		return Manifest{}, err
	}
	if err := store.AuditIntegrity(keys); err != nil {
		return Manifest{}, fmt.Errorf("source integrity audit failed: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return Manifest{}, err
	}
	stateDestination := filepath.Join(outputDir, "state.json")
	eventDestination := filepath.Join(outputDir, "events.jsonl")
	if err := copyFile(statePath, stateDestination); err != nil {
		return Manifest{}, err
	}
	if err := copyFileOrEmpty(eventLogPath, eventDestination); err != nil {
		return Manifest{}, err
	}
	stateEvidence, err := evidence(stateDestination)
	if err != nil {
		return Manifest{}, err
	}
	eventEvidence, err := evidence(eventDestination)
	if err != nil {
		return Manifest{}, err
	}
	logCount, err := verifyEventLog(eventDestination)
	if err != nil {
		return Manifest{}, err
	}
	copyStore, err := datafabric.OpenStore(stateDestination)
	if err != nil {
		return Manifest{}, err
	}
	if err := copyStore.AuditIntegrity(keys); err != nil {
		return Manifest{}, fmt.Errorf("copied state integrity audit failed: %w", err)
	}
	manifest := Manifest{SchemaVersion: ManifestSchemaVersion, CreatedAt: now, SourceCommit: sourceCommit, SourceRelease: sourceRelease, Files: []FileEvidence{stateEvidence, eventEvidence}, EventCount: uint64(len(copyStore.Events())), JournalCount: uint64(len(copyStore.Journal())), EventLogCount: logCount, Integrity: "verified"}
	manifestData, _ := json.MarshalIndent(manifest, "", "  ")
	manifestData = append(manifestData, '\n')
	if err := os.WriteFile(filepath.Join(outputDir, "manifest.json"), manifestData, 0o600); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func Verify(backupDir string, keys map[string][]byte) (Manifest, error) {
	if !filepath.IsAbs(backupDir) {
		return Manifest{}, errors.New("backup directory must be absolute")
	}
	data, err := os.ReadFile(filepath.Join(backupDir, "manifest.json"))
	if err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return Manifest{}, errors.New("backup manifest contains trailing JSON")
	}
	if manifest.SchemaVersion != ManifestSchemaVersion || manifest.Integrity != "verified" || len(manifest.Files) != 2 {
		return Manifest{}, errors.New("backup manifest is unsupported or incomplete")
	}
	for _, expected := range manifest.Files {
		actual, err := evidence(filepath.Join(backupDir, expected.Name))
		if err != nil {
			return Manifest{}, err
		}
		if actual != expected {
			return Manifest{}, fmt.Errorf("backup file %s hash or size mismatch", expected.Name)
		}
	}
	store, err := datafabric.OpenStore(filepath.Join(backupDir, "state.json"))
	if err != nil {
		return Manifest{}, err
	}
	if err := store.AuditIntegrity(keys); err != nil {
		return Manifest{}, err
	}
	logCount, err := verifyEventLog(filepath.Join(backupDir, "events.jsonl"))
	if err != nil {
		return Manifest{}, err
	}
	if uint64(len(store.Events())) != manifest.EventCount || uint64(len(store.Journal())) != manifest.JournalCount || logCount != manifest.EventLogCount {
		return Manifest{}, errors.New("backup record counts do not match the manifest")
	}
	return manifest, nil
}

func Restore(backupDir, targetState, targetEventLog string, keys map[string][]byte) (Manifest, error) {
	if !filepath.IsAbs(targetState) || !filepath.IsAbs(targetEventLog) {
		return Manifest{}, errors.New("restore targets must be absolute")
	}
	if _, err := os.Stat(targetState); !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, errors.New("restore target state already exists or cannot be inspected")
	}
	if _, err := os.Stat(targetEventLog); !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, errors.New("restore target event log already exists or cannot be inspected")
	}
	manifest, err := Verify(backupDir, keys)
	if err != nil {
		return Manifest{}, err
	}
	if err := atomicCopy(filepath.Join(backupDir, "state.json"), targetState); err != nil {
		return Manifest{}, err
	}
	if err := atomicCopy(filepath.Join(backupDir, "events.jsonl"), targetEventLog); err != nil {
		return Manifest{}, err
	}
	restored, err := datafabric.OpenStore(targetState)
	if err != nil {
		return Manifest{}, err
	}
	if err := restored.AuditIntegrity(keys); err != nil {
		return Manifest{}, err
	}
	if _, err := verifyEventLog(targetEventLog); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func verifyEventLog(path string) (uint64, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	buffer := make([]byte, 64*1024)
	scanner.Buffer(buffer, 2*1024*1024)
	var count uint64
	for scanner.Scan() {
		if _, err := datafabric.DecodeEventLogRecord(scanner.Bytes()); err != nil {
			return count, fmt.Errorf("event log record %d: %w", count+1, err)
		}
		count++
	}
	return count, scanner.Err()
}

func VerifyEventLog(path string) (uint64, error) {
	if !filepath.IsAbs(path) {
		return 0, errors.New("event log path must be absolute")
	}
	return verifyEventLog(path)
}

func evidence(path string) (FileEvidence, error) {
	file, err := os.Open(path)
	if err != nil {
		return FileEvidence{}, err
	}
	defer file.Close()
	hash := sha256.New()
	bytes, err := io.Copy(hash, file)
	if err != nil {
		return FileEvidence{}, err
	}
	return FileEvidence{Name: filepath.Base(path), Bytes: bytes, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		return err
	}
	if err := output.Sync(); err != nil {
		_ = output.Close()
		return err
	}
	return output.Close()
}

func copyFileOrEmpty(source, destination string) error {
	if _, err := os.Stat(source); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return err
		}
		return os.WriteFile(destination, nil, 0o600)
	}
	return copyFile(source, destination)
}

func atomicCopy(source, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".restore-*.tmp")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		_ = temporary.Close()
		return err
	}
	_, copyErr := io.Copy(temporary, input)
	closeInputErr := input.Close()
	if copyErr != nil || closeInputErr != nil {
		_ = temporary.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeInputErr
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, destination)
}
