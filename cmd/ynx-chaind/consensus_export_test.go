package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestExportConsensusStateWritesValidatedPrivateFile(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet("ynx_export_owner", 500); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	destination := filepath.Join(t.TempDir(), "nested", "consensus-state.json")
	var output bytes.Buffer
	if err := exportConsensusState(devnet, destination, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "consensus migration state exported") {
		t.Fatalf("missing export evidence: %s", output.String())
	}
	info, err := os.Stat(destination)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("consensus export permissions = %o, want 600", info.Mode().Perm())
	}
	payload, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	var state chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &state); err != nil {
		t.Fatal(err)
	}
	if err := state.Validate(); err != nil {
		t.Fatalf("exported state failed validation: %v", err)
	}
}
