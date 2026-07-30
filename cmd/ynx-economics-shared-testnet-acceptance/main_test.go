package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
)

func TestRunAcceptReplayRestoreAndRejectTamper(t *testing.T) {
	policy, evidence, acceptedAt := sharedTestnetCLIFixture(t)
	directory := t.TempDir()
	policyPath := filepath.Join(directory, "policy.json")
	evidencePath := filepath.Join(directory, "evidence.json")
	statePath := filepath.Join(directory, "state", "acceptance.json")
	writeCLIJSON(t, policyPath, policy, 0o644)
	writeCLIJSON(t, evidencePath, evidence, 0o644)

	args := []string{
		"-policy", policyPath,
		"-evidence", evidencePath,
		"-state", statePath,
		"-summary",
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := runWithClock(args, &stdout, &stderr, func() time.Time { return acceptedAt }); code != 0 {
		t.Fatalf("first acceptance failed: code=%d stderr=%s", code, stderr.String())
	}
	var first struct {
		Applied          bool   `json:"applied"`
		Idempotent       bool   `json:"idempotent"`
		Revision         int64  `json:"revision"`
		EvidenceHash     string `json:"evidenceHash"`
		StoreStateHash   string `json:"storeStateHash"`
		SharedTestnet    bool   `json:"sharedTestnet"`
		PublicDeployment bool   `json:"publicDeployment"`
		Production       bool   `json:"production"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if !first.Applied || first.Idempotent || first.Revision != 2 || first.EvidenceHash != evidence.EvidenceHash || !first.SharedTestnet || first.PublicDeployment || first.Production {
		t.Fatalf("unexpected first acceptance summary: %+v", first)
	}
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("CLI state mode = %04o, want 0600", info.Mode().Perm())
	}

	stdout.Reset()
	stderr.Reset()
	if code := runWithClock(args, &stdout, &stderr, func() time.Time { return acceptedAt.Add(time.Second) }); code != 0 {
		t.Fatalf("replay failed: code=%d stderr=%s", code, stderr.String())
	}
	var replay struct {
		Applied        bool   `json:"applied"`
		Idempotent     bool   `json:"idempotent"`
		Revision       int64  `json:"revision"`
		StoreStateHash string `json:"storeStateHash"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &replay); err != nil {
		t.Fatal(err)
	}
	if replay.Applied || !replay.Idempotent || replay.Revision != first.Revision || replay.StoreStateHash != first.StoreStateHash {
		t.Fatalf("replay changed persisted state: %+v", replay)
	}

	restorePath := filepath.Join(directory, "restore", "acceptance.json")
	stdout.Reset()
	stderr.Reset()
	if code := run([]string{"-restore-from", statePath, "-state", restorePath, "-summary"}, &stdout, &stderr); code != 0 {
		t.Fatalf("restore failed: code=%d stderr=%s", code, stderr.String())
	}
	var restored struct {
		Restored       bool   `json:"restored"`
		Revision       int64  `json:"revision"`
		AcceptedCount  int    `json:"acceptedCount"`
		StoreStateHash string `json:"storeStateHash"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if !restored.Restored || restored.Revision != first.Revision || restored.AcceptedCount != 1 || restored.StoreStateHash != first.StoreStateHash {
		t.Fatalf("unexpected restore summary: %+v", restored)
	}

	tampered := evidence
	tampered.EvidenceHash = cliHash("f")
	tamperedPath := filepath.Join(directory, "tampered-evidence.json")
	tamperedStatePath := filepath.Join(directory, "state", "tampered-acceptance.json")
	writeCLIJSON(t, tamperedPath, tampered, 0o644)
	stdout.Reset()
	stderr.Reset()
	if code := runWithClock([]string{
		"-policy", policyPath,
		"-evidence", tamperedPath,
		"-state", tamperedStatePath,
	}, &stdout, &stderr, func() time.Time { return acceptedAt }); code == 0 {
		t.Fatal("tampered evidence was accepted")
	}
	if _, err := os.Stat(tamperedStatePath); !os.IsNotExist(err) {
		t.Fatalf("tampered evidence created state: %v", err)
	}
}

func TestRunRejectsExpiredEvidenceAndInvalidClock(t *testing.T) {
	policy, evidence, acceptedAt := sharedTestnetCLIFixture(t)
	directory := t.TempDir()
	policyPath := filepath.Join(directory, "policy.json")
	evidencePath := filepath.Join(directory, "evidence.json")
	writeCLIJSON(t, policyPath, policy, 0o644)
	writeCLIJSON(t, evidencePath, evidence, 0o644)
	args := []string{"-policy", policyPath, "-evidence", evidencePath, "-state", filepath.Join(directory, "expired.json")}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := runWithClock(args, &stdout, &stderr, func() time.Time { return acceptedAt.Add(2 * time.Hour) }); code == 0 {
		t.Fatal("expired evidence was accepted using a later system clock")
	}
	if _, err := os.Stat(args[5]); !os.IsNotExist(err) {
		t.Fatalf("expired evidence created state: %v", err)
	}

	stdout.Reset()
	stderr.Reset()
	if code := runWithClock(args, &stdout, &stderr, nil); code == 0 {
		t.Fatal("nil system clock was accepted")
	}
	stdout.Reset()
	stderr.Reset()
	if code := runWithClock(args, &stdout, &stderr, func() time.Time { return time.Time{} }); code == 0 {
		t.Fatal("zero system clock was accepted")
	}
}

func TestRunVersionIsTruthBounded(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := run([]string{"-version"}, &stdout, &stderr); code != 0 {
		t.Fatalf("version failed: code=%d stderr=%s", code, stderr.String())
	}
	var version struct {
		CLISchemaVersion      int    `json:"cliSchemaVersion"`
		StoreSchemaVersion    int    `json:"storeSchemaVersion"`
		EvidenceSchemaVersion int    `json:"evidenceSchemaVersion"`
		ReleaseClass          string `json:"releaseClass"`
		PublicDeployment      bool   `json:"publicDeployment"`
		Production            bool   `json:"production"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &version); err != nil {
		t.Fatal(err)
	}
	if version.CLISchemaVersion != 1 || version.StoreSchemaVersion != 1 || version.EvidenceSchemaVersion != 1 || version.ReleaseClass != "shared-testnet-acceptance-validator" || version.PublicDeployment || version.Production {
		t.Fatalf("unexpected version truth: %+v", version)
	}
}

func sharedTestnetCLIFixture(t *testing.T) (economics.EconomicsSharedTestnetAcceptancePolicy, economics.EconomicsSharedTestnetEvidence, time.Time) {
	t.Helper()
	owners := []string{
		economics.EconomicsSharedTestnetOwnerChainCore,
		economics.EconomicsSharedTestnetOwnerExplorer,
		economics.EconomicsSharedTestnetOwnerMonitor,
		economics.EconomicsSharedTestnetOwnerDataFabric,
		economics.EconomicsSharedTestnetOwnerIntegration,
	}
	ownerCommits := map[string]string{
		economics.EconomicsSharedTestnetOwnerChainCore:   strings.Repeat("1", 40),
		economics.EconomicsSharedTestnetOwnerExplorer:    strings.Repeat("2", 40),
		economics.EconomicsSharedTestnetOwnerMonitor:     strings.Repeat("3", 40),
		economics.EconomicsSharedTestnetOwnerDataFabric:  strings.Repeat("4", 40),
		economics.EconomicsSharedTestnetOwnerIntegration: strings.Repeat("5", 40),
	}
	publicKeys := map[string]map[string]string{}
	privateKeys := map[string]ed25519.PrivateKey{}
	for _, owner := range owners {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		publicKeys[owner] = map[string]string{"cli-test-v1": base64.RawStdEncoding.EncodeToString(publicKey)}
		privateKeys[owner] = privateKey
	}
	counts := economics.EconomicsIntegrationRecordCounts{Envelopes: 5, BillingLedger: 18, Explorer: 5, Monitor: 15}
	economicsSourceCommit := strings.Repeat("a", 40)
	policy := economics.EconomicsSharedTestnetAcceptancePolicy{
		SchemaVersion:              1,
		ContractID:                 economics.EconomicsIntegrationContractID,
		EconomicsSourceCommit:      economicsSourceCommit,
		RequiredOwners:             owners,
		OwnerPublicKeys:            publicKeys,
		ExpectedOwnerSourceCommits: ownerCommits,
		MaxClockSkewSeconds:        30,
		MaxProofAgeSeconds:         3600,
		ExpectedCounts:             counts,
	}
	acceptedAt := time.Date(2026, time.August, 4, 2, 0, 0, 0, time.UTC)
	generatedAt := acceptedAt.Add(-5 * time.Minute)
	observedAt := generatedAt.Add(-time.Minute)
	evidence := economics.EconomicsSharedTestnetEvidence{
		SchemaVersion: 1,
		ContractID:    economics.EconomicsIntegrationContractID,
		Environment:   economics.EconomicsSharedTestnetEnvironment,
		CosmosChainID: economics.EconomicsSharedTestnetCosmosChainID,
		EVMChainID:    economics.EconomicsSharedTestnetEVMChainID,
		SourceCommit:  economicsSourceCommit,
		GeneratedAt:   generatedAt,
		Store: economics.EconomicsSharedTestnetStoreBinding{
			StateHash:        cliHash("1"),
			AcceptedBundleID: "econ-bundle-cli-test",
			BundleHash:       cliHash("2"),
			RecordCounts:     counts,
		},
		Chain: economics.EconomicsSharedTestnetChainProof{
			SourceCommit:    ownerCommits[economics.EconomicsSharedTestnetOwnerChainCore],
			TransactionHash: "0x" + strings.Repeat("3", 64),
			BlockHeight:     6423,
			BlockHash:       cliHash("4"),
			AppHash:         cliHash("5"),
			QuorumProofHash: cliHash("6"),
			Finality:        "bft-committed",
			ObservedAt:      observedAt,
		},
		DataFabric: economics.EconomicsSharedTestnetDataFabricProof{
			SourceCommit:      ownerCommits[economics.EconomicsSharedTestnetOwnerDataFabric],
			Accepted:          true,
			IngestReceiptHash: cliHash("7"),
			RecordCounts:      counts,
			ObservedAt:        observedAt,
		},
		Explorer: economics.EconomicsSharedTestnetExplorerProof{
			SourceCommit:    ownerCommits[economics.EconomicsSharedTestnetOwnerExplorer],
			Accepted:        true,
			Endpoint:        "https://explorer.ynxweb4.com/api/economics",
			ProjectionCount: 5,
			ResponseHash:    cliHash("8"),
			ObservedAt:      observedAt,
		},
		Monitor: economics.EconomicsSharedTestnetMonitorProof{
			SourceCommit: ownerCommits[economics.EconomicsSharedTestnetOwnerMonitor],
			Accepted:     true,
			Endpoint:     "https://status.ynxweb4.com/api/economics",
			CheckCount:   15,
			AlertState:   "clear",
			ResponseHash: cliHash("9"),
			ObservedAt:   observedAt,
		},
		Integration: economics.EconomicsSharedTestnetIntegrationProof{
			SourceCommit:    ownerCommits[economics.EconomicsSharedTestnetOwnerIntegration],
			Accepted:        true,
			ContractVersion: 1,
			ReceiptHash:     cliHash("a"),
			SharedTestnet:   true,
			ObservedAt:      observedAt,
		},
		ReleaseStates: economics.IntegrationReleaseStates{
			ImplementedLocal:  true,
			TestedLocal:       true,
			InstalledLocal:    true,
			IntegratedCentral: true,
			DeployedStaging:   true,
		},
		SharedTestnet: true,
	}
	evidence.PayloadHash = economics.EconomicsSharedTestnetSigningPayloadHash(evidence)
	for _, owner := range owners {
		evidence.Attestations = append(evidence.Attestations, economics.EconomicsSharedTestnetOwnerAttestation{
			Owner:             owner,
			KeyID:             "cli-test-v1",
			Algorithm:         "ed25519",
			SignedPayloadHash: evidence.PayloadHash,
			Signature:         base64.RawStdEncoding.EncodeToString(ed25519.Sign(privateKeys[owner], []byte(evidence.PayloadHash))),
		})
	}
	evidence.EvidenceHash = economics.EconomicsSharedTestnetEvidenceHash(evidence)
	return policy, evidence, acceptedAt
}

func writeCLIJSON(t *testing.T, path string, value any, mode os.FileMode) {
	t.Helper()
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(payload, '\n'), mode); err != nil {
		t.Fatal(err)
	}
}

func cliHash(character string) string {
	return "sha256:" + strings.Repeat(character, 64)
}
