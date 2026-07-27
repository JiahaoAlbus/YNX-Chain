package economics

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestEconomicsSharedTestnetEvidenceRequiresAllOwnerAttestations(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
	signSharedTestnetEvidence(t, &evidence, privateKeys)

	summary, err := ValidateEconomicsSharedTestnetEvidence(policy, evidence, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.VerifiedOwners) != 5 || !summary.SharedTestnet || summary.PublicDeployment || summary.Production {
		t.Fatalf("unexpected shared Testnet acceptance summary: %+v", summary)
	}
	if summary.TransactionHash != evidence.Chain.TransactionHash || summary.BlockHash != evidence.Chain.BlockHash || summary.StoreStateHash != evidence.Store.StateHash || summary.EvidenceHash != evidence.EvidenceHash {
		t.Fatalf("shared Testnet summary lost source proof identity: %+v", summary)
	}
	if len(summary.OwnerSourceCommits) != 5 || summary.OwnerSourceCommits[EconomicsSharedTestnetOwnerChainCore] != evidence.Chain.SourceCommit || summary.OwnerSourceCommits[EconomicsSharedTestnetOwnerIntegration] != evidence.Integration.SourceCommit {
		t.Fatalf("shared Testnet summary lost owner source commits: %+v", summary.OwnerSourceCommits)
	}
}

func TestEconomicsSharedTestnetEvidenceRejectsMissingDuplicateAndInvalidSignatures(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
	signSharedTestnetEvidence(t, &evidence, privateKeys)

	missing := cloneSharedTestnetEvidence(t, evidence)
	missing.Attestations = missing.Attestations[:len(missing.Attestations)-1]
	missing.EvidenceHash = EconomicsSharedTestnetEvidenceHash(missing)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, missing, now), CodeSharedTestnetEvidenceAttestation)

	duplicate := cloneSharedTestnetEvidence(t, evidence)
	duplicate.Attestations[1] = duplicate.Attestations[0]
	duplicate.EvidenceHash = EconomicsSharedTestnetEvidenceHash(duplicate)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, duplicate, now), CodeSharedTestnetEvidenceAttestation)

	invalid := cloneSharedTestnetEvidence(t, evidence)
	invalid.Attestations[0].Signature = base64.RawStdEncoding.EncodeToString(make([]byte, ed25519.SignatureSize))
	invalid.EvidenceHash = EconomicsSharedTestnetEvidenceHash(invalid)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, invalid, now), CodeSharedTestnetEvidenceAttestation)
}

func TestEconomicsSharedTestnetEvidenceRejectsReSignedConflictsAndLocalEndpoints(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)

	commitConflict := cloneSharedTestnetEvidence(t, evidence)
	commitConflict.DataFabric.SourceCommit = strings.Repeat("b", 40)
	signSharedTestnetEvidence(t, &commitConflict, privateKeys)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, commitConflict, now), CodeSharedTestnetEvidenceConflict)

	countConflict := cloneSharedTestnetEvidence(t, evidence)
	countConflict.DataFabric.RecordCounts.BillingLedger--
	signSharedTestnetEvidence(t, &countConflict, privateKeys)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, countConflict, now), CodeSharedTestnetEvidenceConflict)

	localEndpoint := cloneSharedTestnetEvidence(t, evidence)
	localEndpoint.Explorer.Endpoint = "https://localhost/api/economics"
	signSharedTestnetEvidence(t, &localEndpoint, privateKeys)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, localEndpoint, now), CodeSharedTestnetEvidenceInvalid)
}

func TestEconomicsSharedTestnetEvidenceRejectsPromotionStalenessAndTampering(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)

	promoted := cloneSharedTestnetEvidence(t, evidence)
	promoted.PublicDeployment = true
	signSharedTestnetEvidence(t, &promoted, privateKeys)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, promoted, now), CodeSharedTestnetEvidenceInvalid)

	stale := cloneSharedTestnetEvidence(t, evidence)
	stale.GeneratedAt = now.Add(-2 * time.Hour)
	stale.Chain.ObservedAt = stale.GeneratedAt.Add(-time.Minute)
	stale.DataFabric.ObservedAt = stale.GeneratedAt.Add(-time.Minute)
	stale.Explorer.ObservedAt = stale.GeneratedAt.Add(-time.Minute)
	stale.Monitor.ObservedAt = stale.GeneratedAt.Add(-time.Minute)
	stale.Integration.ObservedAt = stale.GeneratedAt.Add(-time.Minute)
	signSharedTestnetEvidence(t, &stale, privateKeys)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, stale, now), CodeSharedTestnetEvidenceStale)

	tampered := cloneSharedTestnetEvidence(t, evidence)
	signSharedTestnetEvidence(t, &tampered, privateKeys)
	tampered.Chain.BlockHeight++
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, tampered, now), CodeSharedTestnetEvidenceTampered)
}

func TestEconomicsSharedTestnetPolicyRejectsIncompleteOwnerSet(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
	signSharedTestnetEvidence(t, &evidence, privateKeys)
	policy.RequiredOwners = policy.RequiredOwners[:len(policy.RequiredOwners)-1]
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, evidence, now), CodeSharedTestnetEvidenceInvalid)
}

func TestEconomicsSharedTestnetEvidenceRejectsReorderedAttestations(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
	signSharedTestnetEvidence(t, &evidence, privateKeys)
	evidence.Attestations[0], evidence.Attestations[1] = evidence.Attestations[1], evidence.Attestations[0]
	evidence.EvidenceHash = EconomicsSharedTestnetEvidenceHash(evidence)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, evidence, now), CodeSharedTestnetEvidenceAttestation)
}

func TestEconomicsSharedTestnetPolicyRejectsMissingAndExtraOwnerBindings(t *testing.T) {
	t.Run("missing source commit", func(t *testing.T) {
		policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
		signSharedTestnetEvidence(t, &evidence, privateKeys)
		delete(policy.ExpectedOwnerSourceCommits, EconomicsSharedTestnetOwnerExplorer)
		assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, evidence, now), CodeSharedTestnetEvidenceInvalid)
	})
	t.Run("extra owner binding", func(t *testing.T) {
		policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
		signSharedTestnetEvidence(t, &evidence, privateKeys)
		policy.ExpectedOwnerSourceCommits["unexpected owner"] = strings.Repeat("6", 40)
		assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, evidence, now), CodeSharedTestnetEvidenceInvalid)
	})
	t.Run("invalid economics source", func(t *testing.T) {
		policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
		signSharedTestnetEvidence(t, &evidence, privateKeys)
		policy.EconomicsSourceCommit = "not-a-commit"
		assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, evidence, now), CodeSharedTestnetEvidenceInvalid)
	})
}

func TestEconomicsSharedTestnetEvidenceRejectsMissingInstallationAndFutureProof(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)

	missingInstallation := cloneSharedTestnetEvidence(t, evidence)
	missingInstallation.ReleaseStates.InstalledLocal = false
	signSharedTestnetEvidence(t, &missingInstallation, privateKeys)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, missingInstallation, now), CodeSharedTestnetEvidenceInvalid)

	futureProof := cloneSharedTestnetEvidence(t, evidence)
	futureProof.GeneratedAt = now.Add(20 * time.Second)
	futureProof.Chain.ObservedAt = now.Add(40 * time.Second)
	futureProof.DataFabric.ObservedAt = now
	futureProof.Explorer.ObservedAt = now
	futureProof.Monitor.ObservedAt = now
	futureProof.Integration.ObservedAt = now
	signSharedTestnetEvidence(t, &futureProof, privateKeys)
	assertRuntimeErrorCode(t, sharedTestnetValidationError(policy, futureProof, now), CodeSharedTestnetEvidenceStale)
}

func sharedTestnetAcceptanceFixture(t *testing.T) (EconomicsSharedTestnetAcceptancePolicy, map[string]ed25519.PrivateKey, EconomicsSharedTestnetEvidence, time.Time) {
	t.Helper()
	owners := economicsSharedTestnetRequiredOwners()
	publicKeys := make(map[string]map[string]string, len(owners))
	privateKeys := make(map[string]ed25519.PrivateKey, len(owners))
	for _, owner := range owners {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		publicKeys[owner] = map[string]string{"test-key-v1": base64.RawStdEncoding.EncodeToString(publicKey)}
		privateKeys[owner] = privateKey
	}
	counts := EconomicsIntegrationRecordCounts{Envelopes: 5, BillingLedger: 18, Explorer: 5, Monitor: 15}
	economicsSourceCommit := strings.Repeat("a", 40)
	ownerSourceCommits := map[string]string{
		EconomicsSharedTestnetOwnerChainCore:   strings.Repeat("1", 40),
		EconomicsSharedTestnetOwnerExplorer:    strings.Repeat("2", 40),
		EconomicsSharedTestnetOwnerMonitor:     strings.Repeat("3", 40),
		EconomicsSharedTestnetOwnerDataFabric:  strings.Repeat("4", 40),
		EconomicsSharedTestnetOwnerIntegration: strings.Repeat("5", 40),
	}
	policy := EconomicsSharedTestnetAcceptancePolicy{
		SchemaVersion:              EconomicsSharedTestnetEvidenceSchemaVersion,
		ContractID:                 EconomicsIntegrationContractID,
		EconomicsSourceCommit:      economicsSourceCommit,
		RequiredOwners:             owners,
		OwnerPublicKeys:            publicKeys,
		ExpectedOwnerSourceCommits: ownerSourceCommits,
		MaxClockSkewSeconds:        30,
		MaxProofAgeSeconds:         3600,
		ExpectedCounts:             counts,
	}
	now := time.Date(2026, time.August, 4, 2, 0, 0, 0, time.UTC)
	generatedAt := now.Add(-5 * time.Minute)
	observedAt := generatedAt.Add(-time.Minute)
	evidence := EconomicsSharedTestnetEvidence{
		SchemaVersion: EconomicsSharedTestnetEvidenceSchemaVersion,
		ContractID:    EconomicsIntegrationContractID,
		Environment:   EconomicsSharedTestnetEnvironment,
		CosmosChainID: EconomicsSharedTestnetCosmosChainID,
		EVMChainID:    EconomicsSharedTestnetEVMChainID,
		SourceCommit:  economicsSourceCommit,
		GeneratedAt:   generatedAt,
		Store: EconomicsSharedTestnetStoreBinding{
			StateHash:        sharedTestnetHash("1"),
			AcceptedBundleID: "accepted-economics-bundle-v1",
			BundleHash:       sharedTestnetHash("2"),
			RecordCounts:     counts,
		},
		Chain: EconomicsSharedTestnetChainProof{
			SourceCommit:    ownerSourceCommits[EconomicsSharedTestnetOwnerChainCore],
			TransactionHash: "0x" + strings.Repeat("3", 64),
			BlockHeight:     6423,
			BlockHash:       sharedTestnetHash("4"),
			AppHash:         sharedTestnetHash("5"),
			QuorumProofHash: sharedTestnetHash("6"),
			Finality:        "bft-committed",
			ObservedAt:      observedAt,
		},
		DataFabric: EconomicsSharedTestnetDataFabricProof{
			SourceCommit:      ownerSourceCommits[EconomicsSharedTestnetOwnerDataFabric],
			Accepted:          true,
			IngestReceiptHash: sharedTestnetHash("7"),
			RecordCounts:      counts,
			ObservedAt:        observedAt,
		},
		Explorer: EconomicsSharedTestnetExplorerProof{
			SourceCommit:    ownerSourceCommits[EconomicsSharedTestnetOwnerExplorer],
			Accepted:        true,
			Endpoint:        "https://explorer.ynxweb4.com/api/economics",
			ProjectionCount: 5,
			ResponseHash:    sharedTestnetHash("8"),
			ObservedAt:      observedAt,
		},
		Monitor: EconomicsSharedTestnetMonitorProof{
			SourceCommit: ownerSourceCommits[EconomicsSharedTestnetOwnerMonitor],
			Accepted:     true,
			Endpoint:     "https://status.ynxweb4.com/api/economics",
			CheckCount:   15,
			AlertState:   "clear",
			ResponseHash: sharedTestnetHash("9"),
			ObservedAt:   observedAt,
		},
		Integration: EconomicsSharedTestnetIntegrationProof{
			SourceCommit:    ownerSourceCommits[EconomicsSharedTestnetOwnerIntegration],
			Accepted:        true,
			ContractVersion: 1,
			ReceiptHash:     sharedTestnetHash("a"),
			SharedTestnet:   true,
			ObservedAt:      observedAt,
		},
		ReleaseStates: IntegrationReleaseStates{
			ImplementedLocal:  true,
			TestedLocal:       true,
			InstalledLocal:    true,
			IntegratedCentral: true,
			DeployedStaging:   true,
		},
		SharedTestnet: true,
	}
	return policy, privateKeys, evidence, now
}

func signSharedTestnetEvidence(t *testing.T, evidence *EconomicsSharedTestnetEvidence, privateKeys map[string]ed25519.PrivateKey) {
	t.Helper()
	evidence.Attestations = nil
	evidence.EvidenceHash = ""
	evidence.PayloadHash = EconomicsSharedTestnetSigningPayloadHash(*evidence)
	for _, owner := range economicsSharedTestnetRequiredOwners() {
		signature := ed25519.Sign(privateKeys[owner], []byte(evidence.PayloadHash))
		evidence.Attestations = append(evidence.Attestations, EconomicsSharedTestnetOwnerAttestation{
			Owner:             owner,
			KeyID:             "test-key-v1",
			Algorithm:         "ed25519",
			SignedPayloadHash: evidence.PayloadHash,
			Signature:         base64.RawStdEncoding.EncodeToString(signature),
		})
	}
	evidence.EvidenceHash = EconomicsSharedTestnetEvidenceHash(*evidence)
}

func cloneSharedTestnetEvidence(t *testing.T, evidence EconomicsSharedTestnetEvidence) EconomicsSharedTestnetEvidence {
	t.Helper()
	payload, err := json.Marshal(evidence)
	if err != nil {
		t.Fatal(err)
	}
	var clone EconomicsSharedTestnetEvidence
	if err := json.Unmarshal(payload, &clone); err != nil {
		t.Fatal(err)
	}
	return clone
}

func sharedTestnetValidationError(policy EconomicsSharedTestnetAcceptancePolicy, evidence EconomicsSharedTestnetEvidence, now time.Time) error {
	_, err := ValidateEconomicsSharedTestnetEvidence(policy, evidence, now)
	return err
}

func sharedTestnetHash(character string) string {
	return "sha256:" + strings.Repeat(character, 64)
}
