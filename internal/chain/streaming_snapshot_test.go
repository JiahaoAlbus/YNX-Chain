package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStreamingSnapshotEncodingPreservesCanonicalBytesAndIntegrity(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	devnet.mu.RLock()
	snapshot := devnet.snapshotLocked()
	devnet.mu.RUnlock()
	snapshot.Accounts["ynx1streamingtest"] = &Account{Address: "ynx1streamingtest", Balance: 17}

	legacyIntegrityInput := snapshot
	legacyIntegrityInput.StateIntegrity = ""
	legacyPayload, err := json.Marshal(legacyIntegrityInput)
	if err != nil {
		t.Fatal(err)
	}
	legacyDigest := sha256.New()
	_, _ = legacyDigest.Write([]byte(devnetSnapshotHashDomain))
	_, _ = legacyDigest.Write([]byte{0})
	_, _ = legacyDigest.Write(legacyPayload)
	expectedIntegrity := hex.EncodeToString(legacyDigest.Sum(nil))
	actualIntegrity, err := devnetSnapshotIntegrity(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if actualIntegrity != expectedIntegrity {
		t.Fatalf("streamed integrity changed canonical digest: got %s want %s", actualIntegrity, expectedIntegrity)
	}

	sealed, err := sealDevnetSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	expectedFile, err := json.MarshalIndent(sealed, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	if err := writeDurableSnapshotJSON(path, sealed); err != nil {
		t.Fatal(err)
	}
	actualFile, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(actualFile) != string(expectedFile) {
		t.Fatal("streamed durable JSON differs from the prior canonical indented encoding")
	}
}
