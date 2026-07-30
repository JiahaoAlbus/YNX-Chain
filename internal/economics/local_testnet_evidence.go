package economics

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"
)

const (
	EconomicsLocalTestnetEvidenceSchemaVersion = 1
	EconomicsLocalTestnetEvidenceClass         = "local-testnet-simulation"
	EconomicsLocalTestnetEvidenceMaxBytes      = 16 << 20
)

const (
	CodeLocalTestnetEvidenceInvalid  = "YNX_ECONOMICS_LOCAL_TESTNET_EVIDENCE_INVALID"
	CodeLocalTestnetEvidenceConflict = "YNX_ECONOMICS_LOCAL_TESTNET_EVIDENCE_CONFLICT"
	CodeLocalTestnetEvidenceTampered = "YNX_ECONOMICS_LOCAL_TESTNET_EVIDENCE_TAMPERED"
	CodeLocalTestnetEvidenceIO       = "YNX_ECONOMICS_LOCAL_TESTNET_EVIDENCE_IO"
)

type EconomicsLocalTestnetTransaction struct {
	SchemaVersion    int       `json:"schemaVersion"`
	ID               string    `json:"id"`
	ContractID       string    `json:"contractId"`
	SourceCommit     string    `json:"sourceCommit"`
	AcceptedBundle   string    `json:"acceptedBundleId"`
	BundleHash       string    `json:"bundleHash"`
	StoreStateHash   string    `json:"storeStateHash"`
	Action           string    `json:"action"`
	Nonce            uint64    `json:"nonce"`
	SubmittedAt      time.Time `json:"submittedAt"`
	PayloadHash      string    `json:"payloadHash"`
	SharedTestnet    bool      `json:"sharedTestnet"`
	PublicDeployment bool      `json:"publicDeployment"`
	Production       bool      `json:"production"`
	AuditHash        string    `json:"auditHash"`
}

type EconomicsLocalTestnetBlock struct {
	SchemaVersion  int       `json:"schemaVersion"`
	Height         int64     `json:"height"`
	Hash           string    `json:"hash"`
	Timestamp      time.Time `json:"timestamp"`
	TransactionID  string    `json:"transactionId"`
	StoreStateHash string    `json:"storeStateHash"`
	SharedTestnet  bool      `json:"sharedTestnet"`
	AuditHash      string    `json:"auditHash"`
}

type EconomicsLocalTestnetAPIProof struct {
	SchemaVersion  int                              `json:"schemaVersion"`
	Path           string                           `json:"path"`
	StatusCode     int                              `json:"statusCode"`
	SourceCommit   string                           `json:"sourceCommit"`
	StoreStateHash string                           `json:"storeStateHash"`
	StoreRevision  int64                            `json:"storeRevision"`
	RecordCounts   EconomicsIntegrationRecordCounts `json:"recordCounts"`
	ReleaseStates  IntegrationReleaseStates         `json:"releaseStates"`
	SharedTestnet  bool                             `json:"sharedTestnet"`
	ResponseHash   string                           `json:"responseHash"`
}

type EconomicsLocalTestnetConsumerProof struct {
	SchemaVersion int    `json:"schemaVersion"`
	Kind          string `json:"kind"`
	ID            string `json:"id"`
	SourceEventID string `json:"sourceEventId"`
	SourceCommit  string `json:"sourceCommit"`
	AuditHash     string `json:"auditHash"`
}

type EconomicsLocalTestnetReceipt struct {
	SchemaVersion     int       `json:"schemaVersion"`
	TransactionID     string    `json:"transactionId"`
	BlockHeight       int64     `json:"blockHeight"`
	BlockHash         string    `json:"blockHash"`
	Status            string    `json:"status"`
	Finality          string    `json:"finality"`
	AcceptedBundleID  string    `json:"acceptedBundleId"`
	StoreStateHash    string    `json:"storeStateHash"`
	APIResponseHash   string    `json:"apiResponseHash"`
	ExplorerProofHash string    `json:"explorerProofHash"`
	MonitorProofHash  string    `json:"monitorProofHash"`
	OccurredAt        time.Time `json:"occurredAt"`
	SharedTestnet     bool      `json:"sharedTestnet"`
	PublicDeployment  bool      `json:"publicDeployment"`
	Production        bool      `json:"production"`
	AuditHash         string    `json:"auditHash"`
}

type EconomicsLocalTestnetEvidence struct {
	SchemaVersion    int                                  `json:"schemaVersion"`
	ContractID       string                               `json:"contractId"`
	SourceCommit     string                               `json:"sourceCommit"`
	GeneratedAt      time.Time                            `json:"generatedAt"`
	EvidenceClass    string                               `json:"evidenceClass"`
	StoreStateHash   string                               `json:"storeStateHash"`
	StoreRevision    int64                                `json:"storeRevision"`
	AcceptedBundleID string                               `json:"acceptedBundleId"`
	BundleHash       string                               `json:"bundleHash"`
	Transaction      EconomicsLocalTestnetTransaction     `json:"transaction"`
	Block            EconomicsLocalTestnetBlock           `json:"block"`
	Receipt          EconomicsLocalTestnetReceipt         `json:"receipt"`
	API              EconomicsLocalTestnetAPIProof        `json:"api"`
	Explorer         []EconomicsLocalTestnetConsumerProof `json:"explorer"`
	Monitor          []EconomicsLocalTestnetConsumerProof `json:"monitor"`
	ReleaseStates    IntegrationReleaseStates             `json:"releaseStates"`
	SharedTestnet    bool                                 `json:"sharedTestnet"`
	PublicDeployment bool                                 `json:"publicDeployment"`
	Production       bool                                 `json:"production"`
	EvidenceHash     string                               `json:"evidenceHash"`
}

func BuildEconomicsLocalTestnetEvidence(store EconomicsIntegrationStore, sourceCommit string, generatedAt time.Time, height int64, nonce uint64) (EconomicsLocalTestnetEvidence, error) {
	if err := ValidateEconomicsIntegrationStore(store); err != nil {
		return EconomicsLocalTestnetEvidence{}, err
	}
	if !validIntegrationSourceCommit(sourceCommit) || generatedAt.IsZero() || generatedAt.Before(store.UpdatedAt) || height < 1 || nonce < 1 {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceInvalid, "source commit, time, height or nonce is invalid")
	}
	generatedAt = generatedAt.UTC()
	accepted, ok := acceptedEconomicsBundle(store, sourceCommit)
	if !ok {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceConflict, "source commit is not accepted by the integration store")
	}
	if accepted.AddedCounts != accepted.BundleCounts || accepted.BundleCounts.Envelopes < 1 || accepted.BundleCounts.Explorer < 1 || accepted.BundleCounts.Monitor < 1 {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceConflict, "accepted bundle does not exclusively own complete persisted consumer facts")
	}

	explorer := localTestnetExplorerProofs(store, sourceCommit)
	monitor := localTestnetMonitorProofs(store, sourceCommit)
	if len(explorer) != accepted.BundleCounts.Explorer || len(monitor) != accepted.BundleCounts.Monitor {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceConflict, "persisted consumer facts do not match the accepted bundle counts")
	}
	explorerProofHash := economicsLocalTestnetValueHash(explorer)
	monitorProofHash := economicsLocalTestnetValueHash(monitor)

	api := EconomicsLocalTestnetAPIProof{
		SchemaVersion:  EconomicsLocalTestnetEvidenceSchemaVersion,
		Path:           "/api/economics/testnet-evidence/local",
		StatusCode:     200,
		SourceCommit:   sourceCommit,
		StoreStateHash: store.StateHash,
		StoreRevision:  store.Revision,
		RecordCounts:   accepted.BundleCounts,
		ReleaseStates:  LocalCandidateIntegrationReleaseStates(),
	}
	api.ResponseHash = economicsLocalTestnetAPIHash(api)

	payloadHash := economicsLocalTestnetValueHash(struct {
		SourceCommit      string `json:"sourceCommit"`
		AcceptedBundleID  string `json:"acceptedBundleId"`
		BundleHash        string `json:"bundleHash"`
		StoreStateHash    string `json:"storeStateHash"`
		APIResponseHash   string `json:"apiResponseHash"`
		ExplorerProofHash string `json:"explorerProofHash"`
		MonitorProofHash  string `json:"monitorProofHash"`
	}{sourceCommit, accepted.ID, accepted.BundleHash, store.StateHash, api.ResponseHash, explorerProofHash, monitorProofHash})

	transaction := EconomicsLocalTestnetTransaction{
		SchemaVersion:  EconomicsLocalTestnetEvidenceSchemaVersion,
		ContractID:     EconomicsIntegrationContractID,
		SourceCommit:   sourceCommit,
		AcceptedBundle: accepted.ID,
		BundleHash:     accepted.BundleHash,
		StoreStateHash: store.StateHash,
		Action:         "bind-accepted-economics-bundle",
		Nonce:          nonce,
		SubmittedAt:    generatedAt,
		PayloadHash:    payloadHash,
	}
	transaction.ID = economicsLocalTestnetTransactionID(transaction)
	transaction.AuditHash = economicsLocalTestnetTransactionHash(transaction)

	block := EconomicsLocalTestnetBlock{
		SchemaVersion:  EconomicsLocalTestnetEvidenceSchemaVersion,
		Height:         height,
		Timestamp:      generatedAt,
		TransactionID:  transaction.ID,
		StoreStateHash: store.StateHash,
	}
	block.Hash = economicsLocalTestnetBlockHash(block)
	block.AuditHash = economicsLocalTestnetBlockAuditHash(block)

	receipt := EconomicsLocalTestnetReceipt{
		SchemaVersion:     EconomicsLocalTestnetEvidenceSchemaVersion,
		TransactionID:     transaction.ID,
		BlockHeight:       block.Height,
		BlockHash:         block.Hash,
		Status:            "simulated-committed",
		Finality:          "local-deterministic-simulation",
		AcceptedBundleID:  accepted.ID,
		StoreStateHash:    store.StateHash,
		APIResponseHash:   api.ResponseHash,
		ExplorerProofHash: explorerProofHash,
		MonitorProofHash:  monitorProofHash,
		OccurredAt:        generatedAt,
	}
	receipt.AuditHash = economicsLocalTestnetReceiptHash(receipt)

	evidence := EconomicsLocalTestnetEvidence{
		SchemaVersion:    EconomicsLocalTestnetEvidenceSchemaVersion,
		ContractID:       EconomicsIntegrationContractID,
		SourceCommit:     sourceCommit,
		GeneratedAt:      generatedAt,
		EvidenceClass:    EconomicsLocalTestnetEvidenceClass,
		StoreStateHash:   store.StateHash,
		StoreRevision:    store.Revision,
		AcceptedBundleID: accepted.ID,
		BundleHash:       accepted.BundleHash,
		Transaction:      transaction,
		Block:            block,
		Receipt:          receipt,
		API:              api,
		Explorer:         explorer,
		Monitor:          monitor,
		ReleaseStates:    LocalCandidateIntegrationReleaseStates(),
	}
	evidence.EvidenceHash = economicsLocalTestnetEvidenceHash(evidence)
	if err := ValidateEconomicsLocalTestnetEvidence(store, evidence); err != nil {
		return EconomicsLocalTestnetEvidence{}, err
	}
	return evidence, nil
}

func ValidateEconomicsLocalTestnetEvidence(store EconomicsIntegrationStore, evidence EconomicsLocalTestnetEvidence) error {
	if err := ValidateEconomicsIntegrationStore(store); err != nil {
		return err
	}
	if evidence.SchemaVersion != EconomicsLocalTestnetEvidenceSchemaVersion || evidence.ContractID != EconomicsIntegrationContractID || !validIntegrationSourceCommit(evidence.SourceCommit) || evidence.GeneratedAt.IsZero() || evidence.EvidenceClass != EconomicsLocalTestnetEvidenceClass || evidence.StoreStateHash != store.StateHash || evidence.StoreRevision != store.Revision || evidence.ReleaseStates != LocalCandidateIntegrationReleaseStates() || evidence.SharedTestnet || evidence.PublicDeployment || evidence.Production {
		return runtimeError(CodeLocalTestnetEvidenceInvalid, "local Testnet evidence metadata or release truth is invalid")
	}
	accepted, ok := acceptedEconomicsBundle(store, evidence.SourceCommit)
	if !ok || evidence.AcceptedBundleID != accepted.ID || evidence.BundleHash != accepted.BundleHash || evidence.GeneratedAt.Before(accepted.IngestedAt) {
		return runtimeError(CodeLocalTestnetEvidenceConflict, "local Testnet evidence does not bind the accepted integration bundle")
	}
	if accepted.AddedCounts != accepted.BundleCounts {
		return runtimeError(CodeLocalTestnetEvidenceConflict, "local Testnet evidence cannot bind a semantically rewrapped bundle")
	}

	expectedExplorer := localTestnetExplorerProofs(store, evidence.SourceCommit)
	expectedMonitor := localTestnetMonitorProofs(store, evidence.SourceCommit)
	if !reflect.DeepEqual(evidence.Explorer, expectedExplorer) || !reflect.DeepEqual(evidence.Monitor, expectedMonitor) {
		return runtimeError(CodeLocalTestnetEvidenceConflict, "local Testnet consumer proofs do not match the accepted store")
	}
	if err := validateEconomicsLocalTestnetAPI(evidence.API, accepted, store); err != nil {
		return err
	}
	if err := validateEconomicsLocalTestnetTransaction(evidence.Transaction, evidence, accepted); err != nil {
		return err
	}
	if err := validateEconomicsLocalTestnetBlock(evidence.Block, evidence); err != nil {
		return err
	}
	if err := validateEconomicsLocalTestnetReceipt(evidence.Receipt, evidence); err != nil {
		return err
	}
	if evidence.EvidenceHash != economicsLocalTestnetEvidenceHash(evidence) {
		return runtimeError(CodeLocalTestnetEvidenceTampered, "local Testnet evidence hash mismatch")
	}
	return nil
}

func SaveEconomicsLocalTestnetEvidence(path string, evidence EconomicsLocalTestnetEvidence, store EconomicsIntegrationStore) error {
	if strings.TrimSpace(path) == "" {
		return runtimeError(CodeLocalTestnetEvidenceIO, "local Testnet evidence path is required")
	}
	if err := ValidateEconomicsLocalTestnetEvidence(store, evidence); err != nil {
		return err
	}
	cleanPath := filepath.Clean(path)
	if info, err := os.Lstat(cleanPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return runtimeError(CodeLocalTestnetEvidenceIO, "local Testnet evidence path must not be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	directory := filepath.Dir(cleanPath)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	payload, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(directory, ".ynx-economics-local-testnet-*.tmp")
	if err != nil {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
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
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	if _, err := temporary.Write(payload); err != nil {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	if err := temporary.Sync(); err != nil {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	if err := temporary.Close(); err != nil {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	if err := os.Rename(temporaryPath, cleanPath); err != nil {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	removeTemporary = false
	if err := os.Chmod(cleanPath, 0o600); err != nil {
		return runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	return nil
}

func LoadEconomicsLocalTestnetEvidence(path string, store EconomicsIntegrationStore) (EconomicsLocalTestnetEvidence, error) {
	if strings.TrimSpace(path) == "" {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceIO, "local Testnet evidence path is required")
	}
	cleanPath := filepath.Clean(path)
	info, err := os.Lstat(cleanPath)
	if err != nil {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 || info.Size() <= 0 || info.Size() > EconomicsLocalTestnetEvidenceMaxBytes {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceIO, "local Testnet evidence file mode or size is invalid")
	}
	file, err := os.Open(cleanPath)
	if err != nil {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceIO, err.Error())
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, EconomicsLocalTestnetEvidenceMaxBytes+1))
	decoder.DisallowUnknownFields()
	var evidence EconomicsLocalTestnetEvidence
	if err := decoder.Decode(&evidence); err != nil {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceIO, "decode local Testnet evidence: "+err.Error())
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return EconomicsLocalTestnetEvidence{}, runtimeError(CodeLocalTestnetEvidenceIO, "local Testnet evidence must contain exactly one JSON value")
	}
	if err := ValidateEconomicsLocalTestnetEvidence(store, evidence); err != nil {
		return EconomicsLocalTestnetEvidence{}, err
	}
	return evidence, nil
}

func acceptedEconomicsBundle(store EconomicsIntegrationStore, sourceCommit string) (EconomicsIntegrationAcceptedBundle, bool) {
	for _, accepted := range store.AcceptedBundles {
		if accepted.SourceCommit == sourceCommit {
			return accepted, true
		}
	}
	return EconomicsIntegrationAcceptedBundle{}, false
}

func localTestnetExplorerProofs(store EconomicsIntegrationStore, sourceCommit string) []EconomicsLocalTestnetConsumerProof {
	proofs := make([]EconomicsLocalTestnetConsumerProof, 0)
	for _, projection := range store.Explorer {
		if projection.SourceCommit == sourceCommit {
			proofs = append(proofs, EconomicsLocalTestnetConsumerProof{EconomicsLocalTestnetEvidenceSchemaVersion, "explorer", projection.ID, projection.SourceEventID, projection.SourceCommit, projection.AuditHash})
		}
	}
	sort.Slice(proofs, func(i, j int) bool { return proofs[i].ID < proofs[j].ID })
	return proofs
}

func localTestnetMonitorProofs(store EconomicsIntegrationStore, sourceCommit string) []EconomicsLocalTestnetConsumerProof {
	proofs := make([]EconomicsLocalTestnetConsumerProof, 0)
	for _, check := range store.Monitor {
		if check.SourceCommit == sourceCommit {
			proofs = append(proofs, EconomicsLocalTestnetConsumerProof{EconomicsLocalTestnetEvidenceSchemaVersion, "monitor", check.ID, check.SourceEventID, check.SourceCommit, check.AuditHash})
		}
	}
	sort.Slice(proofs, func(i, j int) bool { return proofs[i].ID < proofs[j].ID })
	return proofs
}

func validateEconomicsLocalTestnetAPI(api EconomicsLocalTestnetAPIProof, accepted EconomicsIntegrationAcceptedBundle, store EconomicsIntegrationStore) error {
	if api.SchemaVersion != EconomicsLocalTestnetEvidenceSchemaVersion || api.Path != "/api/economics/testnet-evidence/local" || api.StatusCode != 200 || api.SourceCommit != accepted.SourceCommit || api.StoreStateHash != store.StateHash || api.StoreRevision != store.Revision || api.RecordCounts != accepted.BundleCounts || api.ReleaseStates != LocalCandidateIntegrationReleaseStates() || api.SharedTestnet || api.ResponseHash != economicsLocalTestnetAPIHash(api) {
		return runtimeError(CodeLocalTestnetEvidenceTampered, "local Testnet API proof is invalid")
	}
	return nil
}

func validateEconomicsLocalTestnetTransaction(tx EconomicsLocalTestnetTransaction, evidence EconomicsLocalTestnetEvidence, accepted EconomicsIntegrationAcceptedBundle) error {
	if tx.SchemaVersion != EconomicsLocalTestnetEvidenceSchemaVersion || tx.ContractID != EconomicsIntegrationContractID || tx.SourceCommit != evidence.SourceCommit || tx.AcceptedBundle != accepted.ID || tx.BundleHash != accepted.BundleHash || tx.StoreStateHash != evidence.StoreStateHash || tx.Action != "bind-accepted-economics-bundle" || tx.Nonce < 1 || !tx.SubmittedAt.Equal(evidence.GeneratedAt) || tx.SharedTestnet || tx.PublicDeployment || tx.Production || tx.ID != economicsLocalTestnetTransactionID(tx) || tx.AuditHash != economicsLocalTestnetTransactionHash(tx) {
		return runtimeError(CodeLocalTestnetEvidenceTampered, "local Testnet transaction proof is invalid")
	}
	expectedPayload := economicsLocalTestnetValueHash(struct {
		SourceCommit      string `json:"sourceCommit"`
		AcceptedBundleID  string `json:"acceptedBundleId"`
		BundleHash        string `json:"bundleHash"`
		StoreStateHash    string `json:"storeStateHash"`
		APIResponseHash   string `json:"apiResponseHash"`
		ExplorerProofHash string `json:"explorerProofHash"`
		MonitorProofHash  string `json:"monitorProofHash"`
	}{evidence.SourceCommit, evidence.AcceptedBundleID, evidence.BundleHash, evidence.StoreStateHash, evidence.API.ResponseHash, economicsLocalTestnetValueHash(evidence.Explorer), economicsLocalTestnetValueHash(evidence.Monitor)})
	if tx.PayloadHash != expectedPayload {
		return runtimeError(CodeLocalTestnetEvidenceConflict, "local Testnet transaction payload is not bound to consumer proofs")
	}
	return nil
}

func validateEconomicsLocalTestnetBlock(block EconomicsLocalTestnetBlock, evidence EconomicsLocalTestnetEvidence) error {
	if block.SchemaVersion != EconomicsLocalTestnetEvidenceSchemaVersion || block.Height < 1 || !block.Timestamp.Equal(evidence.GeneratedAt) || block.TransactionID != evidence.Transaction.ID || block.StoreStateHash != evidence.StoreStateHash || block.SharedTestnet || block.Hash != economicsLocalTestnetBlockHash(block) || block.AuditHash != economicsLocalTestnetBlockAuditHash(block) {
		return runtimeError(CodeLocalTestnetEvidenceTampered, "local Testnet block proof is invalid")
	}
	return nil
}

func validateEconomicsLocalTestnetReceipt(receipt EconomicsLocalTestnetReceipt, evidence EconomicsLocalTestnetEvidence) error {
	if receipt.SchemaVersion != EconomicsLocalTestnetEvidenceSchemaVersion || receipt.TransactionID != evidence.Transaction.ID || receipt.BlockHeight != evidence.Block.Height || receipt.BlockHash != evidence.Block.Hash || receipt.Status != "simulated-committed" || receipt.Finality != "local-deterministic-simulation" || receipt.AcceptedBundleID != evidence.AcceptedBundleID || receipt.StoreStateHash != evidence.StoreStateHash || receipt.APIResponseHash != evidence.API.ResponseHash || receipt.ExplorerProofHash != economicsLocalTestnetValueHash(evidence.Explorer) || receipt.MonitorProofHash != economicsLocalTestnetValueHash(evidence.Monitor) || !receipt.OccurredAt.Equal(evidence.GeneratedAt) || receipt.SharedTestnet || receipt.PublicDeployment || receipt.Production || receipt.AuditHash != economicsLocalTestnetReceiptHash(receipt) {
		return runtimeError(CodeLocalTestnetEvidenceTampered, "local Testnet receipt proof is invalid")
	}
	return nil
}

func economicsLocalTestnetTransactionID(tx EconomicsLocalTestnetTransaction) string {
	return "econ-local-tx-" + strings.TrimPrefix(economicsLocalTestnetValueHash(struct {
		SourceCommit string    `json:"sourceCommit"`
		BundleHash   string    `json:"bundleHash"`
		Nonce        uint64    `json:"nonce"`
		SubmittedAt  time.Time `json:"submittedAt"`
		PayloadHash  string    `json:"payloadHash"`
	}{tx.SourceCommit, tx.BundleHash, tx.Nonce, tx.SubmittedAt.UTC(), tx.PayloadHash}), "sha256:")
}

func economicsLocalTestnetTransactionHash(tx EconomicsLocalTestnetTransaction) string {
	copy := tx
	copy.AuditHash = ""
	return economicsLocalTestnetValueHash(copy)
}

func economicsLocalTestnetBlockHash(block EconomicsLocalTestnetBlock) string {
	return economicsLocalTestnetValueHash(struct {
		Height         int64     `json:"height"`
		Timestamp      time.Time `json:"timestamp"`
		TransactionID  string    `json:"transactionId"`
		StoreStateHash string    `json:"storeStateHash"`
	}{block.Height, block.Timestamp.UTC(), block.TransactionID, block.StoreStateHash})
}

func economicsLocalTestnetBlockAuditHash(block EconomicsLocalTestnetBlock) string {
	copy := block
	copy.AuditHash = ""
	return economicsLocalTestnetValueHash(copy)
}

func economicsLocalTestnetAPIHash(api EconomicsLocalTestnetAPIProof) string {
	copy := api
	copy.ResponseHash = ""
	return economicsLocalTestnetValueHash(copy)
}

func economicsLocalTestnetReceiptHash(receipt EconomicsLocalTestnetReceipt) string {
	copy := receipt
	copy.AuditHash = ""
	return economicsLocalTestnetValueHash(copy)
}

func economicsLocalTestnetEvidenceHash(evidence EconomicsLocalTestnetEvidence) string {
	copy := evidence
	copy.EvidenceHash = ""
	return economicsLocalTestnetValueHash(copy)
}

func economicsLocalTestnetValueHash(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	payload = bytes.TrimSpace(payload)
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}
