package chain

import (
	"reflect"
	"strings"
	"testing"
)

func TestConsensusMigrationRejectsAppliedPendingAndUnknown(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	if _, err := d.Faucet("ynx_cutover_pending", 10); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExportConsensusMigrationState(); err == nil || !strings.Contains(err.Error(), "pending") {
		t.Fatalf("applied pending effects were detached from history: %v", err)
	}
	d.ProduceBlock()
	d.lastPersistenceError = "UNKNOWN fixture"
	if _, err := d.ExportConsensusMigrationState(); err == nil {
		t.Fatal("uncertain state was exported as a cutover")
	}
}

func TestConsensusMigrationRestoresCompleteTypedSourceRuntime(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	intent, err := d.CreatePayIntentWithIdempotency("original-merchant", 25, "https://merchant.invalid/callback", "source-idempotency")
	if err != nil {
		t.Fatal(err)
	}
	permission, err := d.RequestAIPermission(AIPermissionInput{SessionID: "source-session", Requester: "original-requester", Scope: "read", Purpose: "source permission", ExpiryHours: 1})
	if err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if migration.Runtime == nil || migration.AccountPolicy == nil || migration.OriginalGenesisHash != d.blocks[0].Hash {
		t.Fatal("full state or original policy anchor missing")
	}
	restored, err := migration.RestoreSourceRuntime()
	if err != nil {
		t.Fatal(err)
	}
	gotIntent, exists := restored.PayIntent(intent.ID)
	if !exists || !reflect.DeepEqual(gotIntent, intent) {
		t.Fatal("source Pay state is not usable through actual runtime query")
	}
	gotPermission, exists := restored.AIPermission(permission.ID)
	if !exists || !reflect.DeepEqual(gotPermission, permission) {
		t.Fatal("source AI state was lost or attributed to a fabricated signer")
	}
	if !reflect.DeepEqual(d.lots, restored.lots) || !reflect.DeepEqual(d.blocks, restored.blocks) {
		t.Fatal("source lineage or history was lost")
	}
	migration.Runtime.PayIntents[intent.ID] = PayIntent{}
	if got, _ := restored.PayIntent(intent.ID); !reflect.DeepEqual(got, intent) {
		t.Fatal("restored runtime aliases migration document")
	}
	if got, _ := d.PayIntent(intent.ID); !reflect.DeepEqual(got, intent) {
		t.Fatal("export aliases live source")
	}
}

func TestConsensusMigrationV2RejectsOmittedRuntimeAndPolicy(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	omitted := m
	omitted.Runtime = nil
	omitted.StateHash, _ = omitted.calculateHash()
	if err := omitted.Validate(); err == nil {
		t.Fatal("v2 migration accepted missing business state")
	}
	omitted = m
	omitted.AccountPolicy = nil
	omitted.StateHash, _ = omitted.calculateHash()
	if err := omitted.Validate(); err == nil {
		t.Fatal("top-level policy omission accepted")
	}
	omitted = m
	omitted.Accounts = append([]ConsensusAccount(nil), m.Accounts...)
	omitted.Accounts[0].Nonce++
	omitted.StateHash, _ = omitted.calculateHash()
	if err := omitted.Validate(); err == nil {
		t.Fatal("contradictory account execution copy accepted")
	}
}
