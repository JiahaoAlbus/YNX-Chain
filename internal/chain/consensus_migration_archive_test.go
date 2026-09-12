package chain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestFullMigrationArchivePreservesAllNativeFieldsAndRejectsMismatch(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	funding, err := d.Faucet("ynx_origin_archive_owner", 100)
	if err != nil {
		t.Fatal(err)
	}
	intent, err := d.CreatePayIntentWithIdempotency("legacy-merchant-without-signer", 5, "", "legacy-intent-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.CreateInvoiceWithIdempotency(intent.ID, 24, "legacy-invoice-1"); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	directory := filepath.Join(t.TempDir(), "bundle")
	state, err := d.SaveConsensusMigrationBundle(directory)
	if err != nil {
		t.Fatal(err)
	}
	decoded, origin, err := LoadConsensusMigrationBundle(directory)
	if err != nil {
		t.Fatal(err)
	}
	stateJSON, _ := state.CanonicalJSON()
	decodedJSON, _ := decoded.CanonicalJSON()
	if string(stateJSON) != string(decodedJSON) || !origin.MatchesMigration(state) {
		t.Fatal("archive did not reconcile to migration anchor")
	}
	expected := d.snapshotLocked()
	expected.SavedAt = expected.Blocks[len(expected.Blocks)-1].Time.UTC()
	expected, err = sealDevnetSnapshot(expected)
	if err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	after, err := json.Marshal(origin.snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("full native fields, transaction history or operational state changed")
	}
	sourcePath := filepath.Join(t.TempDir(), "frozen-native.json")
	if err := os.WriteFile(sourcePath, before, 0600); err != nil {
		t.Fatal(err)
	}
	exported, err := SaveConsensusMigrationBundleFromSnapshot(sourcePath, filepath.Join(t.TempDir(), "read-only-export"))
	if err != nil {
		t.Fatal(err)
	}
	untouched, err := os.ReadFile(sourcePath)
	if err != nil || string(untouched) != string(before) {
		t.Fatal("snapshot export changed its source")
	}
	if exported.StateHash != state.StateHash {
		t.Fatal("snapshot export did not match in-memory frozen source")
	}

	txRecord, err := origin.Record("transactions", funding.Hash)
	if err != nil {
		t.Fatal(err)
	}
	var txOrigin struct {
		Transaction Transaction `json:"transaction"`
		BlockHeight uint64      `json:"blockHeight"`
	}
	if err := json.Unmarshal(txRecord.Record, &txOrigin); err != nil {
		t.Fatal(err)
	}
	if txOrigin.Transaction.Hash != funding.Hash || txOrigin.Transaction.Amount != 100 || txOrigin.BlockHeight == 0 {
		t.Fatal("original funded transaction history lost")
	}
	record, err := origin.Record("payIntents", intent.ID)
	if err != nil {
		t.Fatal(err)
	}
	var actual PayIntent
	if err := json.Unmarshal(record.Record, &actual); err != nil {
		t.Fatal(err)
	}
	if actual != intent {
		t.Fatal("original Pay record changed")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(record.Record, &fields); err != nil {
		t.Fatal(err)
	}
	if _, ok := fields["signer"]; ok {
		t.Fatal("invented old signer")
	}
	if record.SourceArchiveRoot != state.SourceArchiveRoot || record.RecordHash == "" {
		t.Fatal("origin record lacks source binding")
	}
	record.Record[0] = 'x'
	again, err := origin.Record("payIntents", intent.ID)
	if err != nil || again.Record[0] != '{' {
		t.Fatalf("returned record aliases archive: %v", err)
	}
	second, err := d.SaveConsensusMigrationBundle(filepath.Join(t.TempDir(), "bundle"))
	if err != nil || second.StateHash != state.StateHash {
		t.Fatalf("unchanged export not deterministic: %v", err)
	}
	if _, err := d.SaveConsensusMigrationBundle(directory); err == nil {
		t.Fatal("existing bundle overwritten")
	}
	mismatch := state
	mismatch.LastBlockHash = "different-tip"
	mismatch.StateHash, err = mismatch.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadNativeMigrationArchive(filepath.Join(directory, "native-origin.json"), mismatch); err == nil {
		t.Fatal("source mismatched tip accepted")
	}
	// Mutating a historical module without the anchor's root must fail recovery.
	var raw map[string]json.RawMessage
	payload, err := os.ReadFile(filepath.Join(directory, "native-origin.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &raw); err != nil {
		t.Fatal(err)
	}
	raw["payIntents"] = json.RawMessage(`{}`)
	payload, err = json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "native-origin.json"), payload, 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadConsensusMigrationBundle(directory); err == nil {
		t.Fatal("historical record deletion accepted")
	}
}

func TestMigrationBundleRejectsPendingAndIncompleteExport(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	if _, err := d.Faucet("ynx_origin_pending", 100); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(t.TempDir(), "bundle")
	if _, err := d.SaveConsensusMigrationBundle(directory); err == nil {
		t.Fatal("pending migration exported")
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatal("failed pending export created directory")
	}
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadConsensusMigrationBundle(directory); err == nil {
		t.Fatal("incomplete export loaded")
	}
}
