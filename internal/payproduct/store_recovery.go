package payproduct

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const storeRecoveryReceiptVersion = 1

type StoreBackupReceipt struct {
	Version         int       `json:"version"`
	SnapshotVersion int       `json:"snapshotVersion"`
	Artifact        string    `json:"artifact"`
	SHA256          string    `json:"sha256"`
	Bytes           int64     `json:"bytes"`
	RecordCount     int       `json:"recordCount"`
	StartedAt       time.Time `json:"startedAt"`
	CompletedAt     time.Time `json:"completedAt"`
	DurationNanos   int64     `json:"durationNanos"`
	Verified        bool      `json:"verified"`
	Path            string    `json:"-"`
}

type StoreRestoreReceipt struct {
	Version            int       `json:"version"`
	SnapshotVersion    int       `json:"snapshotVersion"`
	SourceArtifact     string    `json:"sourceArtifact"`
	SourceSHA256       string    `json:"sourceSha256"`
	RestoredSHA256     string    `json:"restoredSha256"`
	RestoredBytes      int64     `json:"restoredBytes"`
	RecordCount        int       `json:"recordCount"`
	Migrations         []string  `json:"migrations"`
	RollbackArtifact   string    `json:"rollbackArtifact,omitempty"`
	RollbackSHA256     string    `json:"rollbackSha256,omitempty"`
	RollbackVerified   bool      `json:"rollbackVerified"`
	QuarantineArtifact string    `json:"quarantineArtifact,omitempty"`
	QuarantineSHA256   string    `json:"quarantineSha256,omitempty"`
	StartedAt          time.Time `json:"startedAt"`
	CompletedAt        time.Time `json:"completedAt"`
	DurationNanos      int64     `json:"durationNanos"`
	Verified           bool      `json:"verified"`
	DestinationPath    string    `json:"-"`
	RollbackPath       string    `json:"-"`
	QuarantinePath     string    `json:"-"`
}

type StoreBackupVerification struct {
	SnapshotVersion int      `json:"snapshotVersion"`
	SHA256          string   `json:"sha256"`
	Bytes           int64    `json:"bytes"`
	RecordCount     int      `json:"recordCount"`
	Migrations      []string `json:"migrations"`
	Verified        bool     `json:"verified"`
}

// CreateBackup captures one lock-consistent, integrity-protected snapshot. The
// artifact is written with mode 0600 and atomically renamed only after fsync.
func (s *Store) CreateBackup(destination string) (StoreBackupReceipt, error) {
	started := time.Now().UTC()
	if strings.TrimSpace(destination) == "" {
		return StoreBackupReceipt{}, errors.New("pay product backup destination is required")
	}
	if sameStorePath(s.path, destination) {
		return StoreBackupReceipt{}, errors.New("pay product backup destination must differ from the live store")
	}
	if _, err := os.Lstat(destination); err == nil {
		return StoreBackupReceipt{}, errors.New("pay product backup destination already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return StoreBackupReceipt{}, fmt.Errorf("inspect pay product backup destination: %w", err)
	}
	var snapshot Snapshot
	if err := s.View(func(data Snapshot) error {
		snapshot = data
		return nil
	}); err != nil {
		return StoreBackupReceipt{}, err
	}
	raw, err := encodeStoreSnapshot(snapshot, s.integrityKey)
	if err != nil {
		return StoreBackupReceipt{}, fmt.Errorf("encode pay product backup: %w", err)
	}
	if err := atomicWritePrivateFile(destination, raw); err != nil {
		return StoreBackupReceipt{}, fmt.Errorf("write pay product backup: %w", err)
	}
	verification, err := VerifyStoreBackup(destination, s.integrityKey)
	if err != nil {
		return StoreBackupReceipt{}, fmt.Errorf("verify pay product backup: %w", err)
	}
	completed := time.Now().UTC()
	return StoreBackupReceipt{
		Version:         storeRecoveryReceiptVersion,
		SnapshotVersion: verification.SnapshotVersion,
		Artifact:        filepath.Base(destination),
		SHA256:          verification.SHA256,
		Bytes:           verification.Bytes,
		RecordCount:     verification.RecordCount,
		StartedAt:       started,
		CompletedAt:     completed,
		DurationNanos:   completed.Sub(started).Nanoseconds(),
		Verified:        verification.Verified,
		Path:            destination,
	}, nil
}

// VerifyStoreBackup performs strict JSON, envelope-version, HMAC, snapshot-
// version and migration compatibility checks without mutating any store.
func VerifyStoreBackup(path string, integrityKey []byte) (StoreBackupVerification, error) {
	if len(integrityKey) < 32 {
		return StoreBackupVerification{}, errors.New("pay product integrity key must contain at least 32 bytes")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return StoreBackupVerification{}, fmt.Errorf("read pay product backup: %w", err)
	}
	verification, _, err := verifyStoreBytes(path, raw, integrityKey)
	return verification, err
}

func verifyStoreBytes(path string, raw, integrityKey []byte) (StoreBackupVerification, *Store, error) {
	store, err := decodeStoreBytes(path, raw, integrityKey)
	if err != nil {
		return StoreBackupVerification{}, nil, err
	}
	var snapshot Snapshot
	if err := store.View(func(data Snapshot) error {
		snapshot = data
		return nil
	}); err != nil {
		return StoreBackupVerification{}, nil, err
	}
	return StoreBackupVerification{
		SnapshotVersion: snapshot.Version,
		SHA256:          sha256Hex(raw),
		Bytes:           int64(len(raw)),
		RecordCount:     snapshotRecordCount(snapshot),
		Migrations:      detectStoreMigrations(raw),
		Verified:        true,
	}, store, nil
}

// RestoreStoreFromBackup is an offline operation. It validates the source
// before touching the destination, writes a hash-addressed rollback artifact
// for any valid current store, migrates only additive legacy fields, and then
// re-opens the destination to verify the completed restore.
func RestoreStoreFromBackup(backupPath, destinationPath string, integrityKey []byte) (StoreRestoreReceipt, error) {
	started := time.Now().UTC()
	if strings.TrimSpace(backupPath) == "" || strings.TrimSpace(destinationPath) == "" {
		return StoreRestoreReceipt{}, errors.New("pay product backup and destination paths are required")
	}
	if sameStorePath(backupPath, destinationPath) {
		return StoreRestoreReceipt{}, errors.New("pay product backup and destination paths must differ")
	}
	sourceRaw, err := os.ReadFile(backupPath)
	if err != nil {
		return StoreRestoreReceipt{}, fmt.Errorf("read pay product restore source: %w", err)
	}
	verification, backupStore, err := verifyStoreBytes(backupPath, sourceRaw, integrityKey)
	if err != nil {
		return StoreRestoreReceipt{}, fmt.Errorf("validate pay product restore source: %w", err)
	}
	var restoredSnapshot Snapshot
	if err := backupStore.View(func(data Snapshot) error {
		restoredSnapshot = data
		return nil
	}); err != nil {
		return StoreRestoreReceipt{}, err
	}
	restoredRaw, err := encodeStoreSnapshot(restoredSnapshot, integrityKey)
	if err != nil {
		return StoreRestoreReceipt{}, fmt.Errorf("encode migrated pay product restore: %w", err)
	}

	rollbackPath, rollbackHash, quarantinePath, quarantineHash := "", "", "", ""
	rollbackVerified := false
	currentRaw, readErr := os.ReadFile(destinationPath)
	if readErr == nil {
		currentHash := sha256Hex(currentRaw)
		if _, _, err := verifyStoreBytes(destinationPath, currentRaw, integrityKey); err == nil {
			rollbackVerified = true
			rollbackHash = currentHash
			rollbackPath = destinationPath + ".rollback-" + currentHash[:12]
			if sameStorePath(rollbackPath, backupPath) {
				return StoreRestoreReceipt{}, errors.New("pay product rollback artifact collides with restore source")
			}
			if err := preserveStoreArtifact(rollbackPath, currentRaw); err != nil {
				return StoreRestoreReceipt{}, fmt.Errorf("write pay product rollback artifact: %w", err)
			}
		} else {
			quarantineHash = currentHash
			quarantinePath = destinationPath + ".quarantine-" + currentHash[:12]
			if sameStorePath(quarantinePath, backupPath) {
				return StoreRestoreReceipt{}, errors.New("pay product quarantine artifact collides with restore source")
			}
			if err := preserveStoreArtifact(quarantinePath, currentRaw); err != nil {
				return StoreRestoreReceipt{}, fmt.Errorf("write pay product quarantine artifact: %w", err)
			}
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return StoreRestoreReceipt{}, fmt.Errorf("read pay product restore destination: %w", readErr)
	}

	if err := atomicWritePrivateFile(destinationPath, restoredRaw); err != nil {
		return StoreRestoreReceipt{}, fmt.Errorf("restore pay product store: %w", err)
	}
	completedVerification, err := VerifyStoreBackup(destinationPath, integrityKey)
	if err != nil {
		return StoreRestoreReceipt{}, fmt.Errorf("verify restored pay product store: %w", err)
	}
	completed := time.Now().UTC()
	return StoreRestoreReceipt{
		Version:            storeRecoveryReceiptVersion,
		SnapshotVersion:    completedVerification.SnapshotVersion,
		SourceArtifact:     filepath.Base(backupPath),
		SourceSHA256:       verification.SHA256,
		RestoredSHA256:     completedVerification.SHA256,
		RestoredBytes:      completedVerification.Bytes,
		RecordCount:        completedVerification.RecordCount,
		Migrations:         verification.Migrations,
		RollbackArtifact:   recoveryArtifactName(rollbackPath),
		RollbackSHA256:     rollbackHash,
		RollbackVerified:   rollbackVerified,
		QuarantineArtifact: recoveryArtifactName(quarantinePath),
		QuarantineSHA256:   quarantineHash,
		StartedAt:          started,
		CompletedAt:        completed,
		DurationNanos:      completed.Sub(started).Nanoseconds(),
		Verified:           completedVerification.Verified,
		DestinationPath:    destinationPath,
		RollbackPath:       rollbackPath,
		QuarantinePath:     quarantinePath,
	}, nil
}

func encodeStoreSnapshot(snapshot Snapshot, integrityKey []byte) ([]byte, error) {
	if len(integrityKey) < 32 {
		return nil, errors.New("pay product integrity key must contain at least 32 bytes")
	}
	if snapshot.Version != 1 {
		return nil, fmt.Errorf("unsupported pay product snapshot version %d", snapshot.Version)
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	store := &Store{integrityKey: integrityKey}
	env := diskEnvelope{Version: 1, Payload: payload, MAC: store.mac(payload)}
	return json.MarshalIndent(env, "", "  ")
}

func atomicWritePrivateFile(path string, raw []byte) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		if err != nil {
			_ = os.Remove(tmpPath)
		}
	}()
	if err = tmp.Chmod(0o600); err != nil {
		return err
	}
	if _, err = tmp.Write(raw); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmpPath, path); err != nil {
		return err
	}
	if err = os.Chmod(path, 0o600); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		dirHandle, openErr := os.Open(dir)
		if openErr != nil {
			return openErr
		}
		syncErr := dirHandle.Sync()
		closeErr := dirHandle.Close()
		if syncErr != nil {
			return syncErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func sameStorePath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(filepath.Clean(left))
	rightAbs, rightErr := filepath.Abs(filepath.Clean(right))
	if leftErr == nil && rightErr == nil && leftAbs == rightAbs {
		return true
	}
	leftInfo, leftStatErr := os.Stat(left)
	rightInfo, rightStatErr := os.Stat(right)
	return leftStatErr == nil && rightStatErr == nil && os.SameFile(leftInfo, rightInfo)
}

func recoveryArtifactName(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	return filepath.Base(path)
}

func preserveStoreArtifact(path string, raw []byte) error {
	expectedHash := sha256Hex(raw)
	if existing, err := os.ReadFile(path); err == nil {
		if sha256Hex(existing) != expectedHash {
			return errors.New("existing recovery artifact contains different bytes")
		}
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return atomicWritePrivateFile(path, raw)
}

func detectStoreMigrations(raw []byte) []string {
	var env diskEnvelope
	if strictJSON(raw, &env) != nil {
		return nil
	}
	var fields map[string]json.RawMessage
	if strictJSON(env.Payload, &fields) != nil {
		return nil
	}
	migrations := make([]string, 0, 6)
	for _, legacy := range []string{"walletChallenges", "walletSessions"} {
		if _, exists := fields[legacy]; exists {
			migrations = append(migrations, "drop-legacy-"+legacy)
		}
	}
	for _, additive := range []string{"recurringDrafts", "splitPayments", "quantBills"} {
		if _, exists := fields[additive]; !exists {
			migrations = append(migrations, "initialize-"+additive)
		}
	}
	if deliveriesRaw, exists := fields["deliveries"]; exists {
		var deliveries map[string]WebhookDelivery
		if json.Unmarshal(deliveriesRaw, &deliveries) == nil {
			for _, delivery := range deliveries {
				if delivery.Status == "failed" {
					migrations = append(migrations, "normalize-failed-webhook-to-dead-letter")
					break
				}
			}
		}
	}
	sort.Strings(migrations)
	return migrations
}

func snapshotRecordCount(snapshot Snapshot) int {
	return len(snapshot.Merchants) + len(snapshot.MerchantMembers) + len(snapshot.ConsoleSessions) + len(snapshot.GatewaySeen) + len(snapshot.Catalog) + len(snapshot.Invoices) + len(snapshot.Refunds) + len(snapshot.Disputes) + len(snapshot.Deliveries) + len(snapshot.AIRuns) + len(snapshot.Idempotency) + len(snapshot.Nonces) + len(snapshot.Sponsorships) + len(snapshot.BridgeTransfers) + len(snapshot.RouteQuotes) + len(snapshot.RecurringDrafts) + len(snapshot.SplitPayments) + len(snapshot.QuantBills) + len(snapshot.Audit)
}

func sha256Hex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
