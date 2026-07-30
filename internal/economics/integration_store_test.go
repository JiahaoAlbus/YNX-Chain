package economics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

const integrationStoreSecondSourceCommit = "5830b44cdca912774b4b104970b1c2fcea051eb8"

func TestEconomicsIntegrationStoreIngestIsDeterministicAndIdempotent(t *testing.T) {
	bundle := integrationStoreBundleFixture(t, integrationFixtureSourceCommit)
	store, err := NewEconomicsIntegrationStore(bundle.GeneratedAt.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	ingestedAt := bundle.GeneratedAt.Add(time.Hour)
	applied, receipt, err := ApplyEconomicsIntegrationBundle(store, bundle, ingestedAt)
	if err != nil {
		t.Fatal(err)
	}
	expectedAdded := EconomicsIntegrationRecordCounts{Envelopes: 5, BillingLedger: 18, Explorer: 5, Monitor: 15}
	if !receipt.Applied || receipt.Idempotent || receipt.AddedCounts != expectedAdded || receipt.Revision != 2 || receipt.StoreStateHash != applied.StateHash {
		t.Fatalf("unexpected first ingest receipt: %+v", receipt)
	}
	if applied.Revision != 2 || len(applied.AcceptedBundles) != 1 || len(applied.AuditEvents) != 1 || len(applied.Envelopes) != 5 || len(applied.BillingLedger) != 18 || len(applied.Explorer) != 5 || len(applied.Monitor) != 15 {
		t.Fatalf("unexpected first ingest store: %+v", applied)
	}
	if err := ValidateEconomicsIntegrationStore(applied); err != nil {
		t.Fatal(err)
	}

	replayed, replayReceipt, err := ApplyEconomicsIntegrationBundle(applied, bundle, ingestedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if replayReceipt.Applied || !replayReceipt.Idempotent || replayReceipt.AddedCounts != (EconomicsIntegrationRecordCounts{}) || replayReceipt.Revision != applied.Revision || replayed.StateHash != applied.StateHash {
		t.Fatalf("same bundle was not idempotent: receipt=%+v replayed=%+v", replayReceipt, replayed)
	}
}

func TestEconomicsIntegrationStoreAcceptsRewrappedFactsWithoutDoubleCounting(t *testing.T) {
	firstBundle := integrationStoreBundleFixture(t, integrationFixtureSourceCommit)
	secondBundle := integrationStoreBundleFixture(t, integrationStoreSecondSourceCommit)
	if firstBundle.BundleHash == secondBundle.BundleHash {
		t.Fatal("different source commits unexpectedly produced the same bundle hash")
	}
	store, err := NewEconomicsIntegrationStore(firstBundle.GeneratedAt.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	store, _, err = ApplyEconomicsIntegrationBundle(store, firstBundle, firstBundle.GeneratedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	second, receipt, err := ApplyEconomicsIntegrationBundle(store, secondBundle, firstBundle.GeneratedAt.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if !receipt.Applied || receipt.Idempotent || receipt.AddedCounts != (EconomicsIntegrationRecordCounts{}) || second.Revision != 3 || len(second.AcceptedBundles) != 2 || len(second.AuditEvents) != 2 {
		t.Fatalf("rewrapped evidence was not recorded correctly: receipt=%+v store=%+v", receipt, second)
	}
	if len(second.Envelopes) != 5 || len(second.BillingLedger) != 18 || len(second.Explorer) != 5 || len(second.Monitor) != 15 {
		t.Fatalf("rewrapped facts were double counted: envelopes=%d ledger=%d explorer=%d monitor=%d", len(second.Envelopes), len(second.BillingLedger), len(second.Explorer), len(second.Monitor))
	}
	if err := ValidateEconomicsIntegrationStore(second); err != nil {
		t.Fatal(err)
	}
}

func TestEconomicsIntegrationStoreRejectsCommitRebindingAndTimeRollback(t *testing.T) {
	bundle := integrationStoreBundleFixture(t, integrationFixtureSourceCommit)
	store, err := NewEconomicsIntegrationStore(bundle.GeneratedAt.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	store, _, err = ApplyEconomicsIntegrationBundle(store, bundle, bundle.GeneratedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	rebound := cloneIntegrationBundle(t, bundle)
	rebound.GeneratedAt = rebound.GeneratedAt.Add(time.Second)
	rebound.BundleHash = economicsIntegrationBundleHash(rebound)
	if err := ValidateEconomicsIntegrationBundle(rebound); err != nil {
		t.Fatalf("rebound fixture must remain a valid standalone bundle: %v", err)
	}
	_, _, err = ApplyEconomicsIntegrationBundle(store, rebound, store.UpdatedAt.Add(time.Hour))
	assertRuntimeErrorCode(t, err, CodeIntegrationStoreConflict)

	other := integrationStoreBundleFixture(t, integrationStoreSecondSourceCommit)
	_, _, err = ApplyEconomicsIntegrationBundle(store, other, store.UpdatedAt)
	assertRuntimeErrorCode(t, err, CodeIntegrationStoreInvalidTime)
}

func TestEconomicsIntegrationStoreRejectsRehashedStoreTampering(t *testing.T) {
	store := integrationStoreAppliedFixture(t)

	unacceptedSource := cloneEconomicsIntegrationStore(store)
	unacceptedSource.Envelopes[0].SourceCommit = integrationStoreSecondSourceCommit
	unacceptedSource.Envelopes[0].AuditHash = economicsIntegrationEnvelopeHash(unacceptedSource.Envelopes[0])
	unacceptedSource.StateHash = economicsIntegrationStoreHash(unacceptedSource)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationStore(unacceptedSource), CodeIntegrationStoreInvalidState)

	countTampered := cloneEconomicsIntegrationStore(store)
	countTampered.AcceptedBundles[0].AddedCounts.Envelopes--
	countTampered.AcceptedBundles[0].ID = economicsIntegrationAcceptedBundleID(countTampered.AcceptedBundles[0])
	countTampered.AcceptedBundles[0].AuditHash = economicsIntegrationAcceptedBundleHash(countTampered.AcceptedBundles[0])
	countTampered.AuditEvents[0].AcceptedBundleID = countTampered.AcceptedBundles[0].ID
	countTampered.AuditEvents[0].AddedCounts = countTampered.AcceptedBundles[0].AddedCounts
	countTampered.AuditEvents[0].ID = economicsIntegrationStoreAuditEventID(countTampered.AuditEvents[0])
	countTampered.AuditEvents[0].AuditHash = economicsIntegrationStoreAuditEventHash(countTampered.AuditEvents[0])
	countTampered.StateHash = economicsIntegrationStoreHash(countTampered)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationStore(countTampered), CodeIntegrationStoreInvalidState)

	ledgerTampered := cloneEconomicsIntegrationStore(store)
	ledgerTampered.BillingLedger[0].AmountYNXT++
	ledgerTampered.BillingLedger[0].ID = economicsBillingEntryID(ledgerTampered.BillingLedger[0])
	ledgerTampered.BillingLedger[0].AuditHash = economicsBillingEntryHash(ledgerTampered.BillingLedger[0])
	ledgerTampered.StateHash = economicsIntegrationStoreHash(ledgerTampered)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationStore(ledgerTampered), CodeIntegrationStoreInvalidState)
}

func TestEconomicsIntegrationStoreSaveLoadRestoreAndRestart(t *testing.T) {
	store := integrationStoreAppliedFixture(t)
	directory := t.TempDir()
	statePath := filepath.Join(directory, "state", "economics-integration.json")
	if err := SaveEconomicsIntegrationStore(statePath, store); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("integration store permissions are %o", info.Mode().Perm())
	}
	loaded, err := LoadEconomicsIntegrationStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.StateHash != store.StateHash || loaded.Revision != store.Revision {
		t.Fatalf("loaded store differs from saved state: loaded=%+v saved=%+v", loaded, store)
	}

	restorePath := filepath.Join(directory, "restore", "economics-integration.json")
	if err := SaveEconomicsIntegrationStore(restorePath, loaded); err != nil {
		t.Fatal(err)
	}
	restored, err := LoadEconomicsIntegrationStore(restorePath)
	if err != nil {
		t.Fatal(err)
	}
	originalJSON, _ := json.Marshal(store)
	restoredJSON, _ := json.Marshal(restored)
	if string(originalJSON) != string(restoredJSON) {
		t.Fatal("fresh-path restore did not preserve the full integration store")
	}

	bundle := integrationStoreBundleFixture(t, integrationFixtureSourceCommit)
	restarted, receipt, err := ApplyEconomicsIntegrationBundle(restored, bundle, restored.UpdatedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if !receipt.Idempotent || receipt.Applied || restarted.StateHash != restored.StateHash {
		t.Fatalf("restart replay was not idempotent: %+v", receipt)
	}
}

func TestEconomicsIntegrationStoreLoadRejectsTamperingPermissionsAndSymlink(t *testing.T) {
	store := integrationStoreAppliedFixture(t)
	directory := t.TempDir()
	validPath := filepath.Join(directory, "valid.json")
	if err := SaveEconomicsIntegrationStore(validPath, store); err != nil {
		t.Fatal(err)
	}

	tampered := cloneEconomicsIntegrationStore(store)
	tampered.StateHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	tamperedPath := filepath.Join(directory, "tampered.json")
	payload, _ := json.Marshal(tampered)
	if err := os.WriteFile(tamperedPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadEconomicsIntegrationStore(tamperedPath)
	assertRuntimeErrorCode(t, err, CodeIntegrationStoreTampered)

	if err := os.Chmod(validPath, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = LoadEconomicsIntegrationStore(validPath)
	assertRuntimeErrorCode(t, err, CodeIntegrationStoreIO)

	if runtime.GOOS != "windows" {
		symlinkPath := filepath.Join(directory, "state-link.json")
		if err := os.Symlink(tamperedPath, symlinkPath); err != nil {
			t.Fatal(err)
		}
		_, err = LoadEconomicsIntegrationStore(symlinkPath)
		assertRuntimeErrorCode(t, err, CodeIntegrationStoreIO)
	}
}

func integrationStoreBundleFixture(t *testing.T, sourceCommit string) EconomicsIntegrationBundle {
	t.Helper()
	economicState, stakingState := integrationRuntimeFixture(t)
	bundle, err := BuildEconomicsIntegrationBundle(sourceCommit, economicState, stakingState)
	if err != nil {
		t.Fatal(err)
	}
	return bundle
}

func integrationStoreAppliedFixture(t *testing.T) EconomicsIntegrationStore {
	t.Helper()
	bundle := integrationStoreBundleFixture(t, integrationFixtureSourceCommit)
	store, err := NewEconomicsIntegrationStore(bundle.GeneratedAt.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	store, _, err = ApplyEconomicsIntegrationBundle(store, bundle, bundle.GeneratedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	return store
}
