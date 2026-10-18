package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestEngineAuthorizationStartupRequiresIndependentCompletePins(t *testing.T) {
	if a, err := readEngineAuthorization("", "", ""); err != nil || a != nil {
		t.Fatalf("legacy startup changed: %v", err)
	}
	hash := strings.Repeat("12", 32)
	schedule := consensus.PQEngineSchedule{Version: 1, GenesisID: bytes.Repeat([]byte{1}, 32), ChainID: "ynx-startup-test", RegistryHeight: 10, AuthorizedAt: 11, ParamsUpdateHeight: 11, ValidatorUpdateHeight: 12, ActivationHeight: 14, RegistryEventCount: 1, RegistryRoot: hash, OriginalValidatorSetHash: hash, ActivationValidatorSetHash: hash}
	pin, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "schedule.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if a, err := readEngineAuthorization(path, pin, "independently-pinned-genesis.json"); err != nil || a == nil {
		t.Fatalf("exact operator schedule rejected: %v", err)
	}
	for _, tc := range []struct{ path, pin, genesis string }{
		{path, "", "genesis.json"}, {"", pin, "genesis.json"}, {path, pin, ""},
		{path, strings.Repeat("34", 32), "genesis.json"}, {path + ".missing", pin, "genesis.json"},
	} {
		if a, err := readEngineAuthorization(tc.path, tc.pin, tc.genesis); err == nil || a != nil {
			t.Fatal("incomplete or substituted startup authorization accepted")
		}
	}
	for _, bad := range [][]byte{append([]byte(" "), append(raw[:len(raw)-1], []byte(",\"version\":1}")...)...), bytes.Repeat([]byte{' '}, 32*1024+1)} {
		if err := os.WriteFile(path, bad, 0o600); err != nil {
			t.Fatal(err)
		}
		if a, err := readEngineAuthorization(path, pin, "genesis.json"); err == nil || a != nil {
			t.Fatal("duplicate fields or oversized startup schedule accepted")
		}
	}
}
