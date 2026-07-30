package economics

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

const (
	EconomicsSharedTestnetAcceptanceStoreSchemaVersion = 1
	EconomicsSharedTestnetAcceptanceStoreMaxBytes      = 16 << 20
	EconomicsSharedTestnetAcceptanceInputMaxBytes      = 16 << 20
)

const (
	CodeSharedTestnetAcceptanceStoreInvalid  = "YNX_ECONOMICS_SHARED_TESTNET_ACCEPTANCE_STORE_INVALID"
	CodeSharedTestnetAcceptanceStoreConflict = "YNX_ECONOMICS_SHARED_TESTNET_ACCEPTANCE_STORE_CONFLICT"
	CodeSharedTestnetAcceptanceStoreIO       = "YNX_ECONOMICS_SHARED_TESTNET_ACCEPTANCE_STORE_IO"
	CodeSharedTestnetAcceptanceStoreTampered = "YNX_ECONOMICS_SHARED_TESTNET_ACCEPTANCE_STORE_TAMPERED"
)

type EconomicsSharedTestnetAcceptanceRecord struct {
	SchemaVersion int                                     `json:"schemaVersion"`
	ID            string                                  `json:"id"`
	PolicyHash    string                                  `json:"policyHash"`
	EvidenceHash  string                                  `json:"evidenceHash"`
	Summary       EconomicsSharedTestnetAcceptanceSummary `json:"summary"`
	AcceptedAt    time.Time                               `json:"acceptedAt"`
	AuditHash     string                                  `json:"auditHash"`
}

type EconomicsSharedTestnetAcceptanceAuditEvent struct {
	SchemaVersion     int       `json:"schemaVersion"`
	Version           int       `json:"version"`
	ID                string    `json:"id"`
	Type              string    `json:"type"`
	ContractID        string    `json:"contractId"`
	RecordID          string    `json:"recordId"`
	PolicyHash        string    `json:"policyHash"`
	EvidenceHash      string    `json:"evidenceHash"`
	SourceCommit      string    `json:"sourceCommit"`
	TransactionHash   string    `json:"transactionHash"`
	AcceptedAt        time.Time `json:"acceptedAt"`
	OpeningRevision   int64     `json:"openingRevision"`
	ClosingRevision   int64     `json:"closingRevision"`
	PreviousStateHash string    `json:"previousStateHash"`
	AuditHash         string    `json:"auditHash"`
}

type EconomicsSharedTestnetAcceptanceStore struct {
	SchemaVersion int                                          `json:"schemaVersion"`
	ContractID    string                                       `json:"contractId"`
	CreatedAt     time.Time                                    `json:"createdAt"`
	UpdatedAt     time.Time                                    `json:"updatedAt"`
	Revision      int64                                        `json:"revision"`
	Accepted      []EconomicsSharedTestnetAcceptanceRecord     `json:"accepted"`
	AuditEvents   []EconomicsSharedTestnetAcceptanceAuditEvent `json:"auditEvents"`
	StateHash     string                                       `json:"stateHash"`
}

type EconomicsSharedTestnetAcceptanceReceipt struct {
	SchemaVersion  int                                     `json:"schemaVersion"`
	ContractID     string                                  `json:"contractId"`
	Applied        bool                                    `json:"applied"`
	Idempotent     bool                                    `json:"idempotent"`
	Revision       int64                                   `json:"revision"`
	RecordID       string                                  `json:"recordId"`
	PolicyHash     string                                  `json:"policyHash"`
	EvidenceHash   string                                  `json:"evidenceHash"`
	StoreStateHash string                                  `json:"storeStateHash"`
	AcceptedAt     time.Time                               `json:"acceptedAt"`
	Summary        EconomicsSharedTestnetAcceptanceSummary `json:"summary"`
}

func NewEconomicsSharedTestnetAcceptanceStore(createdAt time.Time) (EconomicsSharedTestnetAcceptanceStore, error) {
	if createdAt.IsZero() {
		return EconomicsSharedTestnetAcceptanceStore{}, runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "shared Testnet acceptance store creation time is required")
	}
	createdAt = createdAt.UTC()
	store := EconomicsSharedTestnetAcceptanceStore{
		SchemaVersion: EconomicsSharedTestnetAcceptanceStoreSchemaVersion,
		ContractID:    EconomicsIntegrationContractID,
		CreatedAt:     createdAt,
		UpdatedAt:     createdAt,
		Revision:      1,
		Accepted:      []EconomicsSharedTestnetAcceptanceRecord{},
		AuditEvents:   []EconomicsSharedTestnetAcceptanceAuditEvent{},
	}
	store.StateHash = economicsSharedTestnetAcceptanceStoreHash(store)
	if err := ValidateEconomicsSharedTestnetAcceptanceStore(store); err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, err
	}
	return store, nil
}

func ApplyEconomicsSharedTestnetAcceptance(store EconomicsSharedTestnetAcceptanceStore, policy EconomicsSharedTestnetAcceptancePolicy, evidence EconomicsSharedTestnetEvidence, acceptedAt time.Time) (EconomicsSharedTestnetAcceptanceStore, EconomicsSharedTestnetAcceptanceReceipt, error) {
	if err := ValidateEconomicsSharedTestnetAcceptanceStore(store); err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, err
	}
	if acceptedAt.IsZero() {
		return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "shared Testnet acceptance time is required")
	}
	acceptedAt = acceptedAt.UTC()
	summary, err := ValidateEconomicsSharedTestnetEvidence(policy, evidence, acceptedAt)
	if err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, err
	}
	if acceptedAt.Before(evidence.GeneratedAt.UTC()) || acceptedAt.Before(store.CreatedAt) {
		return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "shared Testnet acceptance time predates evidence or store creation")
	}
	policyHash := economicsSharedTestnetValueHash(policy)
	if !validSharedTestnetSHA256Hash(policyHash) {
		return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "shared Testnet acceptance policy hash is invalid")
	}

	for _, accepted := range store.Accepted {
		if accepted.EvidenceHash == evidence.EvidenceHash {
			if accepted.PolicyHash != policyHash {
				return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, runtimeError(CodeSharedTestnetAcceptanceStoreConflict, "shared Testnet evidence is already bound to a different acceptance policy")
			}
			return store, newEconomicsSharedTestnetAcceptanceReceipt(store, accepted, false, true), nil
		}
		if accepted.PolicyHash == policyHash || accepted.Summary.SourceCommit == summary.SourceCommit || accepted.Summary.TransactionHash == summary.TransactionHash || accepted.Summary.StoreStateHash == summary.StoreStateHash {
			return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, runtimeError(CodeSharedTestnetAcceptanceStoreConflict, "shared Testnet acceptance replay or source rebinding was rejected")
		}
	}
	if len(store.Accepted) > 0 && !acceptedAt.After(store.UpdatedAt) {
		return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "new shared Testnet acceptance must be later than the current store update")
	}

	next := cloneEconomicsSharedTestnetAcceptanceStore(store)
	record := EconomicsSharedTestnetAcceptanceRecord{
		SchemaVersion: EconomicsSharedTestnetAcceptanceStoreSchemaVersion,
		PolicyHash:    policyHash,
		EvidenceHash:  evidence.EvidenceHash,
		Summary:       cloneEconomicsSharedTestnetAcceptanceSummary(summary),
		AcceptedAt:    acceptedAt,
	}
	record.ID = economicsSharedTestnetAcceptanceRecordID(record)
	record.AuditHash = economicsSharedTestnetAcceptanceRecordHash(record)
	next.Accepted = append(next.Accepted, record)

	event := EconomicsSharedTestnetAcceptanceAuditEvent{
		SchemaVersion:     EconomicsSharedTestnetAcceptanceStoreSchemaVersion,
		Version:           1,
		Type:              "ynx.economics.shared_testnet.accepted.v1",
		ContractID:        EconomicsIntegrationContractID,
		RecordID:          record.ID,
		PolicyHash:        record.PolicyHash,
		EvidenceHash:      record.EvidenceHash,
		SourceCommit:      record.Summary.SourceCommit,
		TransactionHash:   record.Summary.TransactionHash,
		AcceptedAt:        acceptedAt,
		OpeningRevision:   store.Revision,
		ClosingRevision:   store.Revision + 1,
		PreviousStateHash: store.StateHash,
	}
	event.ID = economicsSharedTestnetAcceptanceAuditEventID(event)
	event.AuditHash = economicsSharedTestnetAcceptanceAuditEventHash(event)
	next.AuditEvents = append(next.AuditEvents, event)
	next.UpdatedAt = acceptedAt
	next.Revision = store.Revision + 1
	next.StateHash = economicsSharedTestnetAcceptanceStoreHash(next)
	if err := ValidateEconomicsSharedTestnetAcceptanceStore(next); err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, EconomicsSharedTestnetAcceptanceReceipt{}, err
	}
	return next, newEconomicsSharedTestnetAcceptanceReceipt(next, record, true, false), nil
}

func ValidateEconomicsSharedTestnetAcceptanceStore(store EconomicsSharedTestnetAcceptanceStore) error {
	if store.SchemaVersion != EconomicsSharedTestnetAcceptanceStoreSchemaVersion || store.ContractID != EconomicsIntegrationContractID || store.CreatedAt.IsZero() || store.UpdatedAt.Before(store.CreatedAt) || store.Revision != int64(1+len(store.Accepted)) || len(store.Accepted) != len(store.AuditEvents) || store.Accepted == nil || store.AuditEvents == nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "shared Testnet acceptance store metadata or revision is invalid")
	}
	if (len(store.Accepted) == 0 && !store.UpdatedAt.Equal(store.CreatedAt)) || (len(store.Accepted) > 0 && !store.UpdatedAt.Equal(store.Accepted[len(store.Accepted)-1].AcceptedAt)) {
		return runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "shared Testnet acceptance store update time does not match history")
	}

	policyHashes := map[string]bool{}
	evidenceHashes := map[string]bool{}
	sourceCommits := map[string]bool{}
	transactionHashes := map[string]bool{}
	storeStateHashes := map[string]bool{}
	var previousAcceptedAt time.Time
	for index, record := range store.Accepted {
		if err := validateEconomicsSharedTestnetAcceptanceRecord(record); err != nil {
			return err
		}
		if policyHashes[record.PolicyHash] || evidenceHashes[record.EvidenceHash] || sourceCommits[record.Summary.SourceCommit] || transactionHashes[record.Summary.TransactionHash] || storeStateHashes[record.Summary.StoreStateHash] || (!previousAcceptedAt.IsZero() && !record.AcceptedAt.After(previousAcceptedAt)) || record.AcceptedAt.Before(store.CreatedAt) || record.AcceptedAt.After(store.UpdatedAt) {
			return runtimeError(CodeSharedTestnetAcceptanceStoreConflict, "shared Testnet acceptance history contains replay, rebinding or non-monotonic time")
		}
		policyHashes[record.PolicyHash] = true
		evidenceHashes[record.EvidenceHash] = true
		sourceCommits[record.Summary.SourceCommit] = true
		transactionHashes[record.Summary.TransactionHash] = true
		storeStateHashes[record.Summary.StoreStateHash] = true
		previousAcceptedAt = record.AcceptedAt

		event := store.AuditEvents[index]
		if err := validateEconomicsSharedTestnetAcceptanceAuditEvent(event); err != nil {
			return err
		}
		expectedPrevious := economicsSharedTestnetAcceptanceStorePrefixHash(store, index)
		if event.RecordID != record.ID || event.PolicyHash != record.PolicyHash || event.EvidenceHash != record.EvidenceHash || event.SourceCommit != record.Summary.SourceCommit || event.TransactionHash != record.Summary.TransactionHash || !event.AcceptedAt.Equal(record.AcceptedAt) || event.OpeningRevision != int64(index+1) || event.ClosingRevision != int64(index+2) || event.PreviousStateHash != expectedPrevious {
			return runtimeError(CodeSharedTestnetAcceptanceStoreTampered, "shared Testnet acceptance audit history does not reconcile")
		}
	}
	if store.StateHash != economicsSharedTestnetAcceptanceStoreHash(store) {
		return runtimeError(CodeSharedTestnetAcceptanceStoreTampered, "shared Testnet acceptance store state hash mismatch")
	}
	return nil
}

func SaveEconomicsSharedTestnetAcceptanceStore(path string, store EconomicsSharedTestnetAcceptanceStore) error {
	if strings.TrimSpace(path) == "" {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, "shared Testnet acceptance store path is required")
	}
	if err := ValidateEconomicsSharedTestnetAcceptanceStore(store); err != nil {
		return err
	}
	cleanPath := filepath.Clean(path)
	if info, err := os.Lstat(cleanPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, "shared Testnet acceptance store path must not be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	directory := filepath.Dir(cleanPath)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	payload, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(directory, ".ynx-economics-shared-testnet-acceptance-*.tmp")
	if err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	temporaryPath := temporary.Name()
	removeTemporary := true
	defer func() {
		_ = temporary.Close()
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	if _, err := temporary.Write(payload); err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	if err := temporary.Sync(); err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	if err := temporary.Close(); err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	if err := os.Rename(temporaryPath, cleanPath); err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	removeTemporary = false
	if err := os.Chmod(cleanPath, 0o600); err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	if directoryHandle, err := os.Open(directory); err == nil {
		_ = directoryHandle.Sync()
		_ = directoryHandle.Close()
	}
	return nil
}

func LoadEconomicsSharedTestnetAcceptanceStore(path string) (EconomicsSharedTestnetAcceptanceStore, error) {
	var store EconomicsSharedTestnetAcceptanceStore
	if err := loadEconomicsSharedTestnetJSON(path, EconomicsSharedTestnetAcceptanceStoreMaxBytes, true, &store); err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, err
	}
	if err := ValidateEconomicsSharedTestnetAcceptanceStore(store); err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, err
	}
	return store, nil
}

func RestoreEconomicsSharedTestnetAcceptanceStore(sourcePath, destinationPath string) (EconomicsSharedTestnetAcceptanceStore, error) {
	if strings.TrimSpace(sourcePath) == "" || strings.TrimSpace(destinationPath) == "" {
		return EconomicsSharedTestnetAcceptanceStore{}, runtimeError(CodeSharedTestnetAcceptanceStoreIO, "shared Testnet acceptance restore source and destination are required")
	}
	source := filepath.Clean(sourcePath)
	destination := filepath.Clean(destinationPath)
	if source == destination {
		return EconomicsSharedTestnetAcceptanceStore{}, runtimeError(CodeSharedTestnetAcceptanceStoreConflict, "shared Testnet acceptance restore destination must differ from source")
	}
	if _, err := os.Lstat(destination); err == nil {
		return EconomicsSharedTestnetAcceptanceStore{}, runtimeError(CodeSharedTestnetAcceptanceStoreConflict, "shared Testnet acceptance restore destination already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return EconomicsSharedTestnetAcceptanceStore{}, runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	store, err := LoadEconomicsSharedTestnetAcceptanceStore(source)
	if err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, err
	}
	if err := SaveEconomicsSharedTestnetAcceptanceStore(destination, store); err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, err
	}
	restored, err := LoadEconomicsSharedTestnetAcceptanceStore(destination)
	if err != nil {
		return EconomicsSharedTestnetAcceptanceStore{}, err
	}
	if !reflect.DeepEqual(restored, store) || restored.StateHash != store.StateHash {
		return EconomicsSharedTestnetAcceptanceStore{}, runtimeError(CodeSharedTestnetAcceptanceStoreTampered, "shared Testnet acceptance restore did not preserve state")
	}
	return restored, nil
}

func LoadEconomicsSharedTestnetAcceptancePolicy(path string) (EconomicsSharedTestnetAcceptancePolicy, error) {
	var policy EconomicsSharedTestnetAcceptancePolicy
	if err := loadEconomicsSharedTestnetJSON(path, EconomicsSharedTestnetAcceptanceInputMaxBytes, false, &policy); err != nil {
		return EconomicsSharedTestnetAcceptancePolicy{}, err
	}
	if err := validateEconomicsSharedTestnetPolicy(policy); err != nil {
		return EconomicsSharedTestnetAcceptancePolicy{}, err
	}
	return policy, nil
}

func LoadEconomicsSharedTestnetEvidence(path string) (EconomicsSharedTestnetEvidence, error) {
	var evidence EconomicsSharedTestnetEvidence
	if err := loadEconomicsSharedTestnetJSON(path, EconomicsSharedTestnetAcceptanceInputMaxBytes, false, &evidence); err != nil {
		return EconomicsSharedTestnetEvidence{}, err
	}
	return evidence, nil
}

func loadEconomicsSharedTestnetJSON(path string, maxBytes int64, requireOwnerOnly bool, target any) error {
	if strings.TrimSpace(path) == "" {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, "shared Testnet acceptance JSON path is required")
	}
	cleanPath := filepath.Clean(path)
	info, err := os.Lstat(cleanPath)
	if err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxBytes {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, "shared Testnet acceptance JSON must be a bounded regular non-symlink file")
	}
	if requireOwnerOnly {
		if info.Mode().Perm()&0o077 != 0 {
			return runtimeError(CodeSharedTestnetAcceptanceStoreIO, "shared Testnet acceptance store permissions must not grant group or world access")
		}
	} else if info.Mode().Perm()&0o022 != 0 {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, "shared Testnet acceptance input must not be group or world writable")
	}
	file, err := os.Open(cleanPath)
	if err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, err.Error())
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, "decode shared Testnet acceptance JSON: "+err.Error())
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return runtimeError(CodeSharedTestnetAcceptanceStoreIO, "shared Testnet acceptance JSON must contain exactly one value")
	}
	return nil
}

func validateEconomicsSharedTestnetAcceptanceRecord(record EconomicsSharedTestnetAcceptanceRecord) error {
	expectedOwners := economicsSharedTestnetRequiredOwners()
	if record.SchemaVersion != EconomicsSharedTestnetAcceptanceStoreSchemaVersion || strings.TrimSpace(record.ID) == "" || !validSharedTestnetSHA256Hash(record.PolicyHash) || !validSharedTestnetSHA256Hash(record.EvidenceHash) || record.AcceptedAt.IsZero() || record.Summary.SchemaVersion != EconomicsSharedTestnetEvidenceSchemaVersion || record.Summary.ContractID != EconomicsIntegrationContractID || record.Summary.EvidenceHash != record.EvidenceHash || !record.Summary.SharedTestnet || record.Summary.PublicDeployment || record.Summary.Production || !validIntegrationSourceCommit(record.Summary.SourceCommit) || !validSharedTestnetTransactionHash(record.Summary.TransactionHash) || record.Summary.BlockHeight < 1 || !validSharedTestnetSHA256Hash(record.Summary.BlockHash) || !validSharedTestnetSHA256Hash(record.Summary.StoreStateHash) || !validSharedTestnetSHA256Hash(record.Summary.DataFabricReceipt) || !validSharedTestnetSHA256Hash(record.Summary.ExplorerResponse) || !validSharedTestnetSHA256Hash(record.Summary.MonitorResponse) || !validSharedTestnetSHA256Hash(record.Summary.IntegrationReceipt) || record.Summary.GeneratedAt.IsZero() || record.AcceptedAt.Before(record.Summary.GeneratedAt) || len(record.Summary.VerifiedOwners) != len(expectedOwners) || len(record.Summary.OwnerSourceCommits) != len(expectedOwners) {
		return runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "shared Testnet acceptance record is invalid")
	}
	for index, owner := range expectedOwners {
		if record.Summary.VerifiedOwners[index] != owner || !validIntegrationSourceCommit(record.Summary.OwnerSourceCommits[owner]) {
			return runtimeError(CodeSharedTestnetAcceptanceStoreInvalid, "shared Testnet acceptance record owner binding is invalid")
		}
	}
	if record.ID != economicsSharedTestnetAcceptanceRecordID(record) || record.AuditHash != economicsSharedTestnetAcceptanceRecordHash(record) {
		return runtimeError(CodeSharedTestnetAcceptanceStoreTampered, "shared Testnet acceptance record identity or audit hash mismatch")
	}
	return nil
}

func validateEconomicsSharedTestnetAcceptanceAuditEvent(event EconomicsSharedTestnetAcceptanceAuditEvent) error {
	if event.SchemaVersion != EconomicsSharedTestnetAcceptanceStoreSchemaVersion || event.Version != 1 || event.Type != "ynx.economics.shared_testnet.accepted.v1" || event.ContractID != EconomicsIntegrationContractID || strings.TrimSpace(event.RecordID) == "" || !validSharedTestnetSHA256Hash(event.PolicyHash) || !validSharedTestnetSHA256Hash(event.EvidenceHash) || !validIntegrationSourceCommit(event.SourceCommit) || !validSharedTestnetTransactionHash(event.TransactionHash) || event.AcceptedAt.IsZero() || event.OpeningRevision < 1 || event.ClosingRevision != event.OpeningRevision+1 || !validSharedTestnetSHA256Hash(event.PreviousStateHash) || event.ID != economicsSharedTestnetAcceptanceAuditEventID(event) || event.AuditHash != economicsSharedTestnetAcceptanceAuditEventHash(event) {
		return runtimeError(CodeSharedTestnetAcceptanceStoreTampered, "shared Testnet acceptance audit event is invalid")
	}
	return nil
}

func newEconomicsSharedTestnetAcceptanceReceipt(store EconomicsSharedTestnetAcceptanceStore, record EconomicsSharedTestnetAcceptanceRecord, applied, idempotent bool) EconomicsSharedTestnetAcceptanceReceipt {
	return EconomicsSharedTestnetAcceptanceReceipt{
		SchemaVersion:  EconomicsSharedTestnetAcceptanceStoreSchemaVersion,
		ContractID:     EconomicsIntegrationContractID,
		Applied:        applied,
		Idempotent:     idempotent,
		Revision:       store.Revision,
		RecordID:       record.ID,
		PolicyHash:     record.PolicyHash,
		EvidenceHash:   record.EvidenceHash,
		StoreStateHash: store.StateHash,
		AcceptedAt:     record.AcceptedAt,
		Summary:        cloneEconomicsSharedTestnetAcceptanceSummary(record.Summary),
	}
}

func economicsSharedTestnetAcceptanceRecordID(record EconomicsSharedTestnetAcceptanceRecord) string {
	return "econ-shared-accept-" + strings.TrimPrefix(economicsSharedTestnetValueHash(struct {
		PolicyHash      string `json:"policyHash"`
		EvidenceHash    string `json:"evidenceHash"`
		SourceCommit    string `json:"sourceCommit"`
		TransactionHash string `json:"transactionHash"`
	}{record.PolicyHash, record.EvidenceHash, record.Summary.SourceCommit, record.Summary.TransactionHash}), "sha256:")
}

func economicsSharedTestnetAcceptanceRecordHash(record EconomicsSharedTestnetAcceptanceRecord) string {
	copy := record
	copy.AuditHash = ""
	return economicsSharedTestnetValueHash(copy)
}

func economicsSharedTestnetAcceptanceAuditEventID(event EconomicsSharedTestnetAcceptanceAuditEvent) string {
	return "econ-shared-audit-" + strings.TrimPrefix(economicsSharedTestnetValueHash(struct {
		RecordID        string `json:"recordId"`
		EvidenceHash    string `json:"evidenceHash"`
		ClosingRevision int64  `json:"closingRevision"`
	}{event.RecordID, event.EvidenceHash, event.ClosingRevision}), "sha256:")
}

func economicsSharedTestnetAcceptanceAuditEventHash(event EconomicsSharedTestnetAcceptanceAuditEvent) string {
	copy := event
	copy.AuditHash = ""
	return economicsSharedTestnetValueHash(copy)
}

func economicsSharedTestnetAcceptanceStoreHash(store EconomicsSharedTestnetAcceptanceStore) string {
	copy := cloneEconomicsSharedTestnetAcceptanceStore(store)
	copy.StateHash = ""
	return economicsSharedTestnetValueHash(copy)
}

func economicsSharedTestnetAcceptanceStorePrefixHash(store EconomicsSharedTestnetAcceptanceStore, acceptedCount int) string {
	prefix := cloneEconomicsSharedTestnetAcceptanceStore(store)
	prefix.Accepted = prefix.Accepted[:acceptedCount]
	prefix.AuditEvents = prefix.AuditEvents[:acceptedCount]
	prefix.Revision = int64(1 + acceptedCount)
	if acceptedCount == 0 {
		prefix.UpdatedAt = prefix.CreatedAt
	} else {
		prefix.UpdatedAt = prefix.Accepted[acceptedCount-1].AcceptedAt
	}
	prefix.StateHash = ""
	return economicsSharedTestnetValueHash(prefix)
}

func cloneEconomicsSharedTestnetAcceptanceStore(store EconomicsSharedTestnetAcceptanceStore) EconomicsSharedTestnetAcceptanceStore {
	copy := store
	copy.Accepted = make([]EconomicsSharedTestnetAcceptanceRecord, len(store.Accepted))
	for index, record := range store.Accepted {
		copy.Accepted[index] = record
		copy.Accepted[index].Summary = cloneEconomicsSharedTestnetAcceptanceSummary(record.Summary)
	}
	copy.AuditEvents = make([]EconomicsSharedTestnetAcceptanceAuditEvent, len(store.AuditEvents))
	for index, event := range store.AuditEvents {
		copy.AuditEvents[index] = event
	}
	return copy
}

func cloneEconomicsSharedTestnetAcceptanceSummary(summary EconomicsSharedTestnetAcceptanceSummary) EconomicsSharedTestnetAcceptanceSummary {
	copy := summary
	copy.VerifiedOwners = append([]string(nil), summary.VerifiedOwners...)
	copy.OwnerSourceCommits = make(map[string]string, len(summary.OwnerSourceCommits))
	for owner, sourceCommit := range summary.OwnerSourceCommits {
		copy.OwnerSourceCommits[owner] = sourceCommit
	}
	return copy
}
