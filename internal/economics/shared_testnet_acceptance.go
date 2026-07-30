package economics

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	EconomicsSharedTestnetEvidenceSchemaVersion = 1
	EconomicsSharedTestnetEnvironment           = "ynx-shared-testnet"
	EconomicsSharedTestnetCosmosChainID         = "ynx_6423-1"
	EconomicsSharedTestnetEVMChainID            = 6423
)

const (
	EconomicsSharedTestnetOwnerChainCore   = "01 Chain Core"
	EconomicsSharedTestnetOwnerExplorer    = "12 Explorer"
	EconomicsSharedTestnetOwnerMonitor     = "13 Monitor"
	EconomicsSharedTestnetOwnerDataFabric  = "26 Data Fabric"
	EconomicsSharedTestnetOwnerIntegration = "29 Integration"
)

const (
	CodeSharedTestnetEvidenceInvalid     = "YNX_ECONOMICS_SHARED_TESTNET_EVIDENCE_INVALID"
	CodeSharedTestnetEvidenceStale       = "YNX_ECONOMICS_SHARED_TESTNET_EVIDENCE_STALE"
	CodeSharedTestnetEvidenceConflict    = "YNX_ECONOMICS_SHARED_TESTNET_EVIDENCE_CONFLICT"
	CodeSharedTestnetEvidenceAttestation = "YNX_ECONOMICS_SHARED_TESTNET_EVIDENCE_ATTESTATION"
	CodeSharedTestnetEvidenceTampered    = "YNX_ECONOMICS_SHARED_TESTNET_EVIDENCE_TAMPERED"
)

type EconomicsSharedTestnetAcceptancePolicy struct {
	SchemaVersion              int                              `json:"schemaVersion"`
	ContractID                 string                           `json:"contractId"`
	EconomicsSourceCommit      string                           `json:"economicsSourceCommit"`
	RequiredOwners             []string                         `json:"requiredOwners"`
	OwnerPublicKeys            map[string]map[string]string     `json:"ownerPublicKeys"`
	ExpectedOwnerSourceCommits map[string]string                `json:"expectedOwnerSourceCommits"`
	MaxClockSkewSeconds        int64                            `json:"maxClockSkewSeconds"`
	MaxProofAgeSeconds         int64                            `json:"maxProofAgeSeconds"`
	ExpectedCounts             EconomicsIntegrationRecordCounts `json:"expectedCounts"`
}

type EconomicsSharedTestnetStoreBinding struct {
	StateHash        string                           `json:"stateHash"`
	AcceptedBundleID string                           `json:"acceptedBundleId"`
	BundleHash       string                           `json:"bundleHash"`
	RecordCounts     EconomicsIntegrationRecordCounts `json:"recordCounts"`
}

type EconomicsSharedTestnetChainProof struct {
	SourceCommit    string    `json:"sourceCommit"`
	TransactionHash string    `json:"transactionHash"`
	BlockHeight     int64     `json:"blockHeight"`
	BlockHash       string    `json:"blockHash"`
	AppHash         string    `json:"appHash"`
	QuorumProofHash string    `json:"quorumProofHash"`
	Finality        string    `json:"finality"`
	ObservedAt      time.Time `json:"observedAt"`
}

type EconomicsSharedTestnetDataFabricProof struct {
	SourceCommit      string                           `json:"sourceCommit"`
	Accepted          bool                             `json:"accepted"`
	IngestReceiptHash string                           `json:"ingestReceiptHash"`
	RecordCounts      EconomicsIntegrationRecordCounts `json:"recordCounts"`
	ObservedAt        time.Time                        `json:"observedAt"`
}

type EconomicsSharedTestnetExplorerProof struct {
	SourceCommit    string    `json:"sourceCommit"`
	Accepted        bool      `json:"accepted"`
	Endpoint        string    `json:"endpoint"`
	ProjectionCount int       `json:"projectionCount"`
	ResponseHash    string    `json:"responseHash"`
	ObservedAt      time.Time `json:"observedAt"`
}

type EconomicsSharedTestnetMonitorProof struct {
	SourceCommit string    `json:"sourceCommit"`
	Accepted     bool      `json:"accepted"`
	Endpoint     string    `json:"endpoint"`
	CheckCount   int       `json:"checkCount"`
	AlertState   string    `json:"alertState"`
	ResponseHash string    `json:"responseHash"`
	ObservedAt   time.Time `json:"observedAt"`
}

type EconomicsSharedTestnetIntegrationProof struct {
	SourceCommit     string    `json:"sourceCommit"`
	Accepted         bool      `json:"accepted"`
	ContractVersion  int       `json:"contractVersion"`
	ReceiptHash      string    `json:"receiptHash"`
	SharedTestnet    bool      `json:"sharedTestnet"`
	PublicDeployment bool      `json:"publicDeployment"`
	Production       bool      `json:"production"`
	ObservedAt       time.Time `json:"observedAt"`
}

type EconomicsSharedTestnetOwnerAttestation struct {
	Owner             string `json:"owner"`
	KeyID             string `json:"keyId"`
	Algorithm         string `json:"algorithm"`
	SignedPayloadHash string `json:"signedPayloadHash"`
	Signature         string `json:"signature"`
}

type EconomicsSharedTestnetEvidence struct {
	SchemaVersion    int                                      `json:"schemaVersion"`
	ContractID       string                                   `json:"contractId"`
	Environment      string                                   `json:"environment"`
	CosmosChainID    string                                   `json:"cosmosChainId"`
	EVMChainID       int                                      `json:"evmChainId"`
	SourceCommit     string                                   `json:"sourceCommit"`
	GeneratedAt      time.Time                                `json:"generatedAt"`
	Store            EconomicsSharedTestnetStoreBinding       `json:"store"`
	Chain            EconomicsSharedTestnetChainProof         `json:"chain"`
	DataFabric       EconomicsSharedTestnetDataFabricProof    `json:"dataFabric"`
	Explorer         EconomicsSharedTestnetExplorerProof      `json:"explorer"`
	Monitor          EconomicsSharedTestnetMonitorProof       `json:"monitor"`
	Integration      EconomicsSharedTestnetIntegrationProof   `json:"integration"`
	ReleaseStates    IntegrationReleaseStates                 `json:"releaseStates"`
	SharedTestnet    bool                                     `json:"sharedTestnet"`
	PublicDeployment bool                                     `json:"publicDeployment"`
	Production       bool                                     `json:"production"`
	PayloadHash      string                                   `json:"payloadHash"`
	Attestations     []EconomicsSharedTestnetOwnerAttestation `json:"attestations"`
	EvidenceHash     string                                   `json:"evidenceHash"`
}

type EconomicsSharedTestnetAcceptanceSummary struct {
	SchemaVersion      int               `json:"schemaVersion"`
	ContractID         string            `json:"contractId"`
	SourceCommit       string            `json:"sourceCommit"`
	TransactionHash    string            `json:"transactionHash"`
	BlockHeight        int64             `json:"blockHeight"`
	BlockHash          string            `json:"blockHash"`
	StoreStateHash     string            `json:"storeStateHash"`
	DataFabricReceipt  string            `json:"dataFabricReceipt"`
	ExplorerResponse   string            `json:"explorerResponse"`
	MonitorResponse    string            `json:"monitorResponse"`
	IntegrationReceipt string            `json:"integrationReceipt"`
	VerifiedOwners     []string          `json:"verifiedOwners"`
	OwnerSourceCommits map[string]string `json:"ownerSourceCommits"`
	GeneratedAt        time.Time         `json:"generatedAt"`
	SharedTestnet      bool              `json:"sharedTestnet"`
	PublicDeployment   bool              `json:"publicDeployment"`
	Production         bool              `json:"production"`
	EvidenceHash       string            `json:"evidenceHash"`
}

func ValidateEconomicsSharedTestnetEvidence(policy EconomicsSharedTestnetAcceptancePolicy, evidence EconomicsSharedTestnetEvidence, now time.Time) (EconomicsSharedTestnetAcceptanceSummary, error) {
	if err := validateEconomicsSharedTestnetPolicy(policy); err != nil {
		return EconomicsSharedTestnetAcceptanceSummary{}, err
	}
	if now.IsZero() {
		return EconomicsSharedTestnetAcceptanceSummary{}, runtimeError(CodeSharedTestnetEvidenceInvalid, "validation time is required")
	}
	now = now.UTC()
	if evidence.SchemaVersion != EconomicsSharedTestnetEvidenceSchemaVersion || evidence.ContractID != EconomicsIntegrationContractID || evidence.Environment != EconomicsSharedTestnetEnvironment || evidence.CosmosChainID != EconomicsSharedTestnetCosmosChainID || evidence.EVMChainID != EconomicsSharedTestnetEVMChainID || evidence.SourceCommit != policy.EconomicsSourceCommit || evidence.GeneratedAt.IsZero() || !evidence.SharedTestnet || evidence.PublicDeployment || evidence.Production {
		return EconomicsSharedTestnetAcceptanceSummary{}, runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet evidence metadata or release truth is invalid")
	}
	if evidence.GeneratedAt.After(now.Add(time.Duration(policy.MaxClockSkewSeconds) * time.Second)) {
		return EconomicsSharedTestnetAcceptanceSummary{}, runtimeError(CodeSharedTestnetEvidenceStale, "shared Testnet evidence is from the future")
	}
	if now.Sub(evidence.GeneratedAt) > time.Duration(policy.MaxProofAgeSeconds)*time.Second {
		return EconomicsSharedTestnetAcceptanceSummary{}, runtimeError(CodeSharedTestnetEvidenceStale, "shared Testnet evidence has expired")
	}
	if !evidence.ReleaseStates.ImplementedLocal || !evidence.ReleaseStates.TestedLocal || !evidence.ReleaseStates.InstalledLocal || !evidence.ReleaseStates.IntegratedCentral || !evidence.ReleaseStates.DeployedStaging || evidence.ReleaseStates.DeployedPublic || evidence.ReleaseStates.DownloadHosted || evidence.ReleaseStates.ProductionSigned || evidence.ReleaseStates.StoreReleased {
		return EconomicsSharedTestnetAcceptanceSummary{}, runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet release states are not evidence-bounded")
	}
	if err := validateEconomicsSharedTestnetStore(policy, evidence); err != nil {
		return EconomicsSharedTestnetAcceptanceSummary{}, err
	}
	if err := validateEconomicsSharedTestnetProofs(policy, evidence, now); err != nil {
		return EconomicsSharedTestnetAcceptanceSummary{}, err
	}
	if evidence.PayloadHash != economicsSharedTestnetPayloadHash(evidence) {
		return EconomicsSharedTestnetAcceptanceSummary{}, runtimeError(CodeSharedTestnetEvidenceTampered, "shared Testnet payload hash mismatch")
	}
	owners, err := validateEconomicsSharedTestnetAttestations(policy, evidence)
	if err != nil {
		return EconomicsSharedTestnetAcceptanceSummary{}, err
	}
	if evidence.EvidenceHash != economicsSharedTestnetEvidenceHash(evidence) {
		return EconomicsSharedTestnetAcceptanceSummary{}, runtimeError(CodeSharedTestnetEvidenceTampered, "shared Testnet evidence hash mismatch")
	}
	return EconomicsSharedTestnetAcceptanceSummary{
		SchemaVersion:      EconomicsSharedTestnetEvidenceSchemaVersion,
		ContractID:         evidence.ContractID,
		SourceCommit:       evidence.SourceCommit,
		TransactionHash:    evidence.Chain.TransactionHash,
		BlockHeight:        evidence.Chain.BlockHeight,
		BlockHash:          evidence.Chain.BlockHash,
		StoreStateHash:     evidence.Store.StateHash,
		DataFabricReceipt:  evidence.DataFabric.IngestReceiptHash,
		ExplorerResponse:   evidence.Explorer.ResponseHash,
		MonitorResponse:    evidence.Monitor.ResponseHash,
		IntegrationReceipt: evidence.Integration.ReceiptHash,
		VerifiedOwners:     owners,
		OwnerSourceCommits: economicsSharedTestnetOwnerSourceCommits(evidence),
		GeneratedAt:        evidence.GeneratedAt.UTC(),
		SharedTestnet:      true,
		PublicDeployment:   false,
		Production:         false,
		EvidenceHash:       evidence.EvidenceHash,
	}, nil
}

func EconomicsSharedTestnetSigningPayloadHash(evidence EconomicsSharedTestnetEvidence) string {
	return economicsSharedTestnetPayloadHash(evidence)
}

func EconomicsSharedTestnetEvidenceHash(evidence EconomicsSharedTestnetEvidence) string {
	return economicsSharedTestnetEvidenceHash(evidence)
}

func validateEconomicsSharedTestnetPolicy(policy EconomicsSharedTestnetAcceptancePolicy) error {
	if policy.SchemaVersion != EconomicsSharedTestnetEvidenceSchemaVersion || policy.ContractID != EconomicsIntegrationContractID || !validIntegrationSourceCommit(policy.EconomicsSourceCommit) || policy.MaxClockSkewSeconds < 0 || policy.MaxClockSkewSeconds > 300 || policy.MaxProofAgeSeconds < 60 || policy.MaxProofAgeSeconds > 86400 || policy.ExpectedCounts.Envelopes < 1 || policy.ExpectedCounts.BillingLedger < 1 || policy.ExpectedCounts.Explorer < 1 || policy.ExpectedCounts.Monitor < 1 {
		return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet acceptance policy is invalid")
	}
	expectedOwners := economicsSharedTestnetRequiredOwners()
	actualOwners := append([]string(nil), policy.RequiredOwners...)
	sort.Strings(actualOwners)
	if len(actualOwners) != len(expectedOwners) || len(policy.OwnerPublicKeys) != len(expectedOwners) || len(policy.ExpectedOwnerSourceCommits) != len(expectedOwners) {
		return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet policy requires the exact owner set")
	}
	for index, owner := range expectedOwners {
		if actualOwners[index] != owner {
			return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet policy owner set is invalid")
		}
		expectedSourceCommit, ok := policy.ExpectedOwnerSourceCommits[owner]
		if !ok || !validIntegrationSourceCommit(expectedSourceCommit) {
			return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet policy owner source commit is invalid")
		}
		keys, ok := policy.OwnerPublicKeys[owner]
		if !ok || len(keys) < 1 {
			return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet policy owner has no verification key")
		}
		for keyID, encoded := range keys {
			if strings.TrimSpace(keyID) == "" {
				return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet policy key id is empty")
			}
			publicKey, err := base64.RawStdEncoding.DecodeString(encoded)
			if err != nil || len(publicKey) != ed25519.PublicKeySize {
				return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet policy public key is invalid")
			}
		}
	}
	return nil
}

func validateEconomicsSharedTestnetStore(policy EconomicsSharedTestnetAcceptancePolicy, evidence EconomicsSharedTestnetEvidence) error {
	if !validSharedTestnetSHA256Hash(evidence.Store.StateHash) || !validSharedTestnetSHA256Hash(evidence.Store.BundleHash) || strings.TrimSpace(evidence.Store.AcceptedBundleID) == "" || evidence.Store.RecordCounts != policy.ExpectedCounts || evidence.DataFabric.RecordCounts != policy.ExpectedCounts {
		return runtimeError(CodeSharedTestnetEvidenceConflict, "shared Testnet Store binding or record counts conflict with policy")
	}
	return nil
}

func validateEconomicsSharedTestnetProofs(policy EconomicsSharedTestnetAcceptancePolicy, evidence EconomicsSharedTestnetEvidence, now time.Time) error {
	clockSkew := time.Duration(policy.MaxClockSkewSeconds) * time.Second
	proofTimes := []time.Time{evidence.Chain.ObservedAt, evidence.DataFabric.ObservedAt, evidence.Explorer.ObservedAt, evidence.Monitor.ObservedAt, evidence.Integration.ObservedAt}
	for _, observedAt := range proofTimes {
		if observedAt.IsZero() || observedAt.After(evidence.GeneratedAt.Add(clockSkew)) || observedAt.After(now.Add(clockSkew)) || now.Sub(observedAt) > time.Duration(policy.MaxProofAgeSeconds)*time.Second {
			return runtimeError(CodeSharedTestnetEvidenceStale, "shared Testnet owner proof is missing, future-dated or expired")
		}
	}
	for owner, sourceCommit := range economicsSharedTestnetOwnerSourceCommits(evidence) {
		if sourceCommit != policy.ExpectedOwnerSourceCommits[owner] {
			return runtimeError(CodeSharedTestnetEvidenceConflict, "shared Testnet owner proof source commit mismatch")
		}
	}
	if !validSharedTestnetTransactionHash(evidence.Chain.TransactionHash) || evidence.Chain.BlockHeight < 1 || !validSharedTestnetSHA256Hash(evidence.Chain.BlockHash) || !validSharedTestnetSHA256Hash(evidence.Chain.AppHash) || !validSharedTestnetSHA256Hash(evidence.Chain.QuorumProofHash) || evidence.Chain.Finality != "bft-committed" {
		return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet Chain proof is invalid")
	}
	if !evidence.DataFabric.Accepted || !validSharedTestnetSHA256Hash(evidence.DataFabric.IngestReceiptHash) {
		return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet Data Fabric proof is invalid")
	}
	if !evidence.Explorer.Accepted || evidence.Explorer.ProjectionCount != policy.ExpectedCounts.Explorer || !validSharedTestnetEndpoint(evidence.Explorer.Endpoint) || !validSharedTestnetSHA256Hash(evidence.Explorer.ResponseHash) {
		return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet Explorer proof is invalid")
	}
	if !evidence.Monitor.Accepted || evidence.Monitor.CheckCount != policy.ExpectedCounts.Monitor || evidence.Monitor.AlertState != "clear" || !validSharedTestnetEndpoint(evidence.Monitor.Endpoint) || !validSharedTestnetSHA256Hash(evidence.Monitor.ResponseHash) {
		return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet Monitor proof is invalid")
	}
	if !evidence.Integration.Accepted || evidence.Integration.ContractVersion != EconomicsSharedTestnetEvidenceSchemaVersion || !validSharedTestnetSHA256Hash(evidence.Integration.ReceiptHash) || !evidence.Integration.SharedTestnet || evidence.Integration.PublicDeployment || evidence.Integration.Production {
		return runtimeError(CodeSharedTestnetEvidenceInvalid, "shared Testnet Integration proof is invalid")
	}
	return nil
}

func validateEconomicsSharedTestnetAttestations(policy EconomicsSharedTestnetAcceptancePolicy, evidence EconomicsSharedTestnetEvidence) ([]string, error) {
	expectedOwners := economicsSharedTestnetRequiredOwners()
	if len(evidence.Attestations) != len(expectedOwners) {
		return nil, runtimeError(CodeSharedTestnetEvidenceAttestation, "shared Testnet owner attestation count is invalid")
	}
	owners := make([]string, len(evidence.Attestations))
	for index, attestation := range evidence.Attestations {
		if attestation.Owner != expectedOwners[index] {
			return nil, runtimeError(CodeSharedTestnetEvidenceAttestation, "shared Testnet owner attestations are missing, duplicated or out of canonical order")
		}
		keys := policy.OwnerPublicKeys[attestation.Owner]
		encodedKey, ok := keys[attestation.KeyID]
		if !ok || attestation.Algorithm != "ed25519" || attestation.SignedPayloadHash != evidence.PayloadHash {
			return nil, runtimeError(CodeSharedTestnetEvidenceAttestation, "shared Testnet owner attestation metadata is invalid")
		}
		publicKey, err := base64.RawStdEncoding.DecodeString(encodedKey)
		if err != nil || len(publicKey) != ed25519.PublicKeySize {
			return nil, runtimeError(CodeSharedTestnetEvidenceAttestation, "shared Testnet owner public key is invalid")
		}
		signature, err := base64.RawStdEncoding.DecodeString(attestation.Signature)
		if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(evidence.PayloadHash), signature) {
			return nil, runtimeError(CodeSharedTestnetEvidenceAttestation, "shared Testnet owner signature verification failed")
		}
		owners[index] = attestation.Owner
	}
	return owners, nil
}

func economicsSharedTestnetPayloadHash(evidence EconomicsSharedTestnetEvidence) string {
	copy := evidence
	copy.PayloadHash = ""
	copy.Attestations = nil
	copy.EvidenceHash = ""
	return economicsSharedTestnetValueHash(copy)
}

func economicsSharedTestnetEvidenceHash(evidence EconomicsSharedTestnetEvidence) string {
	copy := evidence
	copy.EvidenceHash = ""
	return economicsSharedTestnetValueHash(copy)
}

func economicsSharedTestnetValueHash(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func economicsSharedTestnetRequiredOwners() []string {
	owners := []string{
		EconomicsSharedTestnetOwnerChainCore,
		EconomicsSharedTestnetOwnerExplorer,
		EconomicsSharedTestnetOwnerMonitor,
		EconomicsSharedTestnetOwnerDataFabric,
		EconomicsSharedTestnetOwnerIntegration,
	}
	sort.Strings(owners)
	return owners
}

func economicsSharedTestnetOwnerSourceCommits(evidence EconomicsSharedTestnetEvidence) map[string]string {
	return map[string]string{
		EconomicsSharedTestnetOwnerChainCore:   evidence.Chain.SourceCommit,
		EconomicsSharedTestnetOwnerExplorer:    evidence.Explorer.SourceCommit,
		EconomicsSharedTestnetOwnerMonitor:     evidence.Monitor.SourceCommit,
		EconomicsSharedTestnetOwnerDataFabric:  evidence.DataFabric.SourceCommit,
		EconomicsSharedTestnetOwnerIntegration: evidence.Integration.SourceCommit,
	}
}

func validSharedTestnetTransactionHash(value string) bool {
	if len(value) != 66 || !strings.HasPrefix(value, "0x") || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value[2:])
	return err == nil
}

func validSharedTestnetSHA256Hash(value string) bool {
	if len(value) != 71 || !strings.HasPrefix(value, "sha256:") || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func validSharedTestnetEndpoint(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return false
	}
	return true
}
