package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestVerifyMigrationState(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_migration_verifier", 25); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "migration.json")
	if err := os.WriteFile(path, append(payload, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	verified, err := verifyMigrationState(path)
	if err != nil {
		t.Fatal(err)
	}
	if verified.StateHash != migration.StateHash || verified.Height != migration.Height {
		t.Fatalf("verified migration mismatch: %+v", verified)
	}

	var tamperedState map[string]any
	if err := json.Unmarshal(payload, &tamperedState); err != nil {
		t.Fatal(err)
	}
	tamperedState["height"] = migration.Height + 1
	tampered, err := json.Marshal(tamperedState)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyMigrationState(path); err == nil {
		t.Fatal("tampered migration state passed verification")
	}
}
