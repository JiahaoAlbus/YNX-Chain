package economics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestEconomicsLocalTestnetEvidenceDeterministicAndBounded(t *testing.T) {
	store := integrationStoreAppliedFixture(t)
	generatedAt := store.UpdatedAt.Add(time.Hour)
	first, err := BuildEconomicsLocalTestnetEvidence(store, integrationFixtureSourceCommit, generatedAt, 42, 7)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildEconomicsLocalTestnetEvidence(store, integrationFixtureSourceCommit, generatedAt, 42, 7)
	if err != nil {
		t.Fatal(err)
	}
	if first.EvidenceHash != second.EvidenceHash || first.Transaction.ID != second.Transaction.ID || first.Block.Hash != second.Block.Hash || first.Receipt.AuditHash != second.Receipt.AuditHash {
		t.Fatalf("local Testnet evidence replay was not deterministic: first=%+v second=%+v", first, second)
	}
	if len(first.Explorer) != 5 || len(first.Monitor) != 15 {
		t.Fatalf("unexpected consumer proof cardinality: explorer=%d monitor=%d", len(first.Explorer), len(first.Monitor))
	}
	if first.SharedTestnet || first.PublicDeployment || first.Production || first.Transaction.SharedTestnet || first.Receipt.SharedTestnet || first.ReleaseStates.IntegratedCentral || first.ReleaseStates.DeployedPublic {
		t.Fatalf("local evidence promoted an unsupported release state: %+v", first)
	}
	if first.Receipt.Status != "simulated-committed" || first.Receipt.Finality != "local-deterministic-simulation" || first.API.Path != "/api/economics/testnet-evidence/local" {
		t.Fatalf("local evidence truth labels are invalid: receipt=%+v api=%+v", first.Receipt, first.API)
	}
	if err := ValidateEconomicsLocalTestnetEvidence(store, first); err != nil {
		t.Fatal(err)
	}
}

func TestEconomicsLocalTestnetEvidenceRejectsRehashedTamperingAndPromotion(t *testing.T) {
	store := integrationStoreAppliedFixture(t)
	evidence, err := BuildEconomicsLocalTestnetEvidence(store, integrationFixtureSourceCommit, store.UpdatedAt.Add(time.Hour), 42, 7)
	if err != nil {
		t.Fatal(err)
	}

	consumerTampered := cloneEconomicsLocalTestnetEvidence(t, evidence)
	consumerTampered.Explorer[0].ID = "forged-explorer-proof"
	consumerTampered.EvidenceHash = economicsLocalTestnetEvidenceHash(consumerTampered)
	assertRuntimeErrorCode(t, ValidateEconomicsLocalTestnetEvidence(store, consumerTampered), CodeLocalTestnetEvidenceConflict)

	payloadTampered := cloneEconomicsLocalTestnetEvidence(t, evidence)
	payloadTampered.Transaction.PayloadHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	payloadTampered.Transaction.ID = economicsLocalTestnetTransactionID(payloadTampered.Transaction)
	payloadTampered.Transaction.AuditHash = economicsLocalTestnetTransactionHash(payloadTampered.Transaction)
	payloadTampered.Block.TransactionID = payloadTampered.Transaction.ID
	payloadTampered.Block.Hash = economicsLocalTestnetBlockHash(payloadTampered.Block)
	payloadTampered.Block.AuditHash = economicsLocalTestnetBlockAuditHash(payloadTampered.Block)
	payloadTampered.Receipt.TransactionID = payloadTampered.Transaction.ID
	payloadTampered.Receipt.BlockHash = payloadTampered.Block.Hash
	payloadTampered.Receipt.AuditHash = economicsLocalTestnetReceiptHash(payloadTampered.Receipt)
	payloadTampered.EvidenceHash = economicsLocalTestnetEvidenceHash(payloadTampered)
	assertRuntimeErrorCode(t, ValidateEconomicsLocalTestnetEvidence(store, payloadTampered), CodeLocalTestnetEvidenceConflict)

	promoted := cloneEconomicsLocalTestnetEvidence(t, evidence)
	promoted.ReleaseStates.IntegratedCentral = true
	promoted.EvidenceHash = economicsLocalTestnetEvidenceHash(promoted)
	assertRuntimeErrorCode(t, ValidateEconomicsLocalTestnetEvidence(store, promoted), CodeLocalTestnetEvidenceInvalid)
}

func TestEconomicsLocalTestnetEvidenceRejectsRewrappedBundle(t *testing.T) {
	firstBundle := integrationStoreBundleFixture(t, integrationFixtureSourceCommit)
	store, err := NewEconomicsIntegrationStore(firstBundle.GeneratedAt.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	store, _, err = ApplyEconomicsIntegrationBundle(store, firstBundle, firstBundle.GeneratedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	secondBundle := integrationStoreBundleFixture(t, integrationStoreSecondSourceCommit)
	store, _, err = ApplyEconomicsIntegrationBundle(store, secondBundle, store.UpdatedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	_, err = BuildEconomicsLocalTestnetEvidence(store, integrationStoreSecondSourceCommit, store.UpdatedAt.Add(time.Hour), 43, 8)
	assertRuntimeErrorCode(t, err, CodeLocalTestnetEvidenceConflict)
}

func TestEconomicsLocalTestnetEvidenceSaveLoadAndTamperRejection(t *testing.T) {
	store := integrationStoreAppliedFixture(t)
	evidence, err := BuildEconomicsLocalTestnetEvidence(store, integrationFixtureSourceCommit, store.UpdatedAt.Add(time.Hour), 42, 7)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "evidence", "local-testnet.json")
	if err := SaveEconomicsLocalTestnetEvidence(path, evidence, store); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("local Testnet evidence permissions are %o", info.Mode().Perm())
	}
	loaded, err := LoadEconomicsLocalTestnetEvidence(path, store)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.EvidenceHash != evidence.EvidenceHash {
		t.Fatalf("loaded local Testnet evidence changed hash: loaded=%s expected=%s", loaded.EvidenceHash, evidence.EvidenceHash)
	}

	tampered := cloneEconomicsLocalTestnetEvidence(t, evidence)
	tampered.EvidenceHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	payload, err := json.Marshal(tampered)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = LoadEconomicsLocalTestnetEvidence(path, store)
	assertRuntimeErrorCode(t, err, CodeLocalTestnetEvidenceTampered)
}

func cloneEconomicsLocalTestnetEvidence(t *testing.T, input EconomicsLocalTestnetEvidence) EconomicsLocalTestnetEvidence {
	t.Helper()
	payload, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var cloned EconomicsLocalTestnetEvidence
	if err := json.Unmarshal(payload, &cloned); err != nil {
		t.Fatal(err)
	}
	return cloned
}
