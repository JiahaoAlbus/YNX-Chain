package economics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestEconomicsSharedTestnetAcceptanceStoreLifecycleAndRestore(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
	signSharedTestnetEvidence(t, &evidence, privateKeys)
	store, err := NewEconomicsSharedTestnetAcceptanceStore(evidence.GeneratedAt)
	if err != nil {
		t.Fatal(err)
	}
	next, receipt, err := ApplyEconomicsSharedTestnetAcceptance(store, policy, evidence, now)
	if err != nil {
		t.Fatal(err)
	}
	if !receipt.Applied || receipt.Idempotent || receipt.Revision != 2 || receipt.EvidenceHash != evidence.EvidenceHash || receipt.Summary.TransactionHash != evidence.Chain.TransactionHash || next.Revision != 2 || len(next.Accepted) != 1 || len(next.AuditEvents) != 1 {
		t.Fatalf("unexpected shared Testnet acceptance result: receipt=%+v store=%+v", receipt, next)
	}
	if err := ValidateEconomicsSharedTestnetAcceptanceStore(next); err != nil {
		t.Fatal(err)
	}

	directory := t.TempDir()
	storePath := filepath.Join(directory, "state", "shared-testnet-acceptance.json")
	if err := SaveEconomicsSharedTestnetAcceptanceStore(storePath, next); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("acceptance store mode = %04o, want 0600", info.Mode().Perm())
	}
	loaded, err := LoadEconomicsSharedTestnetAcceptanceStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(loaded, next) {
		t.Fatal("loaded acceptance store differs from persisted store")
	}

	replayed, replayReceipt, err := ApplyEconomicsSharedTestnetAcceptance(loaded, policy, evidence, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if replayReceipt.Applied || !replayReceipt.Idempotent || replayReceipt.Revision != loaded.Revision || !reflect.DeepEqual(replayed, loaded) {
		t.Fatalf("idempotent replay changed state: receipt=%+v", replayReceipt)
	}

	restorePath := filepath.Join(directory, "restore", "shared-testnet-acceptance.json")
	restored, err := RestoreEconomicsSharedTestnetAcceptanceStore(storePath, restorePath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored, loaded) || restored.StateHash != loaded.StateHash {
		t.Fatal("restore drill did not preserve acceptance state")
	}
	restoreInfo, err := os.Stat(restorePath)
	if err != nil {
		t.Fatal(err)
	}
	if restoreInfo.Mode().Perm() != 0o600 {
		t.Fatalf("restored acceptance store mode = %04o, want 0600", restoreInfo.Mode().Perm())
	}
	_, err = RestoreEconomicsSharedTestnetAcceptanceStore(storePath, restorePath)
	assertRuntimeErrorCode(t, err, CodeSharedTestnetAcceptanceStoreConflict)
}

func TestEconomicsSharedTestnetAcceptanceStoreRejectsReplayRebindingAndTamper(t *testing.T) {
	policy, privateKeys, evidence, now := sharedTestnetAcceptanceFixture(t)
	signSharedTestnetEvidence(t, &evidence, privateKeys)
	store, err := NewEconomicsSharedTestnetAcceptanceStore(evidence.GeneratedAt)
	if err != nil {
		t.Fatal(err)
	}
	accepted, _, err := ApplyEconomicsSharedTestnetAcceptance(store, policy, evidence, now)
	if err != nil {
		t.Fatal(err)
	}

	rebound := cloneSharedTestnetEvidence(t, evidence)
	rebound.Chain.TransactionHash = "0x" + strings.Repeat("b", 64)
	signSharedTestnetEvidence(t, &rebound, privateKeys)
	_, _, err = ApplyEconomicsSharedTestnetAcceptance(accepted, policy, rebound, now.Add(time.Second))
	assertRuntimeErrorCode(t, err, CodeSharedTestnetAcceptanceStoreConflict)

	changedPolicy := policy
	changedPolicy.MaxProofAgeSeconds--
	_, _, err = ApplyEconomicsSharedTestnetAcceptance(accepted, changedPolicy, evidence, now.Add(time.Second))
	assertRuntimeErrorCode(t, err, CodeSharedTestnetAcceptanceStoreConflict)

	tampered := cloneEconomicsSharedTestnetAcceptanceStore(accepted)
	tampered.Accepted[0].Summary.BlockHeight++
	assertRuntimeErrorCode(t, ValidateEconomicsSharedTestnetAcceptanceStore(tampered), CodeSharedTestnetAcceptanceStoreTampered)

	directory := t.TempDir()
	path := filepath.Join(directory, "tampered.json")
	payload, err := json.MarshalIndent(tampered, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(payload, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = LoadEconomicsSharedTestnetAcceptanceStore(path)
	assertRuntimeErrorCode(t, err, CodeSharedTestnetAcceptanceStoreTampered)

	validPath := filepath.Join(directory, "valid.json")
	if err := SaveEconomicsSharedTestnetAcceptanceStore(validPath, accepted); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(validPath, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = LoadEconomicsSharedTestnetAcceptanceStore(validPath)
	assertRuntimeErrorCode(t, err, CodeSharedTestnetAcceptanceStoreIO)
}

func TestEconomicsSharedTestnetAcceptanceInputsAreStrictAndNonWritable(t *testing.T) {
	policy, privateKeys, evidence, _ := sharedTestnetAcceptanceFixture(t)
	signSharedTestnetEvidence(t, &evidence, privateKeys)
	directory := t.TempDir()
	policyPath := filepath.Join(directory, "policy.json")
	evidencePath := filepath.Join(directory, "evidence.json")
	writeSharedTestnetJSONFixture(t, policyPath, policy)
	writeSharedTestnetJSONFixture(t, evidencePath, evidence)

	loadedPolicy, err := LoadEconomicsSharedTestnetAcceptancePolicy(policyPath)
	if err != nil {
		t.Fatal(err)
	}
	loadedEvidence, err := LoadEconomicsSharedTestnetEvidence(evidencePath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(loadedPolicy, policy) || !reflect.DeepEqual(loadedEvidence, evidence) {
		t.Fatal("strict input loaders changed policy or evidence")
	}

	unknownPath := filepath.Join(directory, "unknown.json")
	var object map[string]any
	payload, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &object); err != nil {
		t.Fatal(err)
	}
	object["unexpected"] = true
	writeSharedTestnetJSONFixture(t, unknownPath, object)
	_, err = LoadEconomicsSharedTestnetAcceptancePolicy(unknownPath)
	assertRuntimeErrorCode(t, err, CodeSharedTestnetAcceptanceStoreIO)

	if err := os.Chmod(evidencePath, 0o666); err != nil {
		t.Fatal(err)
	}
	_, err = LoadEconomicsSharedTestnetEvidence(evidencePath)
	assertRuntimeErrorCode(t, err, CodeSharedTestnetAcceptanceStoreIO)

	symlinkPath := filepath.Join(directory, "evidence-link.json")
	if err := os.Symlink(policyPath, symlinkPath); err != nil {
		t.Fatal(err)
	}
	_, err = LoadEconomicsSharedTestnetAcceptancePolicy(symlinkPath)
	assertRuntimeErrorCode(t, err, CodeSharedTestnetAcceptanceStoreIO)
}

func writeSharedTestnetJSONFixture(t *testing.T, path string, value any) {
	t.Helper()
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(payload, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}
