package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestFixtureIsBoundedSignedAndNeverReusesDirectory(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	if err := run(root, consensus.EphemeralWorkloadMaxTransactions+1, true, 31656, 31757, 31858); err == nil {
		t.Fatal("unbounded count accepted")
	}
	if err := run(root, 2, false, 31656, 31757, 31858); err == nil {
		t.Fatal("missing ephemeral acknowledgement accepted")
	}
	if err := run(root, 2, true, 31656, 31757, 31858); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(root, consensus.EphemeralSenderFile)); !os.IsNotExist(err) {
		t.Fatal("default fixture retained native signing keys")
	}
	raw, err := os.ReadFile(filepath.Join(root, "transactions.json"))
	if err != nil {
		t.Fatal(err)
	}
	var workload struct{ Transactions [][]byte }
	if err := json.Unmarshal(raw, &workload); err != nil || len(workload.Transactions) != 2 {
		t.Fatalf("bad workload: %v", err)
	}
	senders := map[string]bool{}
	for _, raw := range workload.Transactions {
		tx, err := consensus.DecodeSignedTransaction(raw)
		if err != nil || tx.Verify(6423) != nil || tx.Nonce != 1 || tx.Amount != 1 || senders[tx.From] {
			t.Fatalf("invalid or duplicate sender: %+v %v", tx, err)
		}
		senders[tx.From] = true
	}
	if err := run(root, 2, true, 31656, 31757, 31858); err == nil {
		t.Fatal("existing directory reused")
	}
	after, err := os.ReadFile(filepath.Join(root, "transactions.json"))
	if err != nil || string(after) != string(raw) {
		t.Fatal("existing fixture changed after refused retry")
	}
}

func TestRetainedSendersAreNewPrivateAndManifestBound(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	if err := runWithSenders(root, 3, true, 31656, 31757, 31858, true); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, consensus.EphemeralSenderFile)
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatal("private file permissions", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var bundle consensus.EphemeralSenderBundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		t.Fatal(err)
	}
	manifestRaw, err := os.ReadFile(filepath.Join(root, "network-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(manifestRaw)
	var m consensus.EphemeralNetworkManifest
	if err := json.Unmarshal(manifestRaw, &m); err != nil {
		t.Fatal(err)
	}
	if bundle.ManifestSHA256 != hex.EncodeToString(sum[:]) || bundle.GenesisHash != m.GenesisHash || bundle.MigrationStateHash != m.MigrationStateHash || bundle.Purpose != consensus.EphemeralSenderPurpose || len(bundle.Senders) != 3 {
		t.Fatal("bundle identity mismatch")
	}
	var workload struct{ Transactions [][]byte }
	txRaw, _ := os.ReadFile(filepath.Join(root, "transactions.json"))
	if err := json.Unmarshal(txRaw, &workload); err != nil {
		t.Fatal(err)
	}
	for i, secret := range bundle.Senders {
		keyRaw, err := hex.DecodeString(secret.PrivateKey)
		if err != nil || len(keyRaw) != 32 {
			t.Fatal("invalid key encoding")
		}
		address, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(keyRaw).PubKey().SerializeCompressed())
		tx, decodeErr := consensus.DecodeSignedTransaction(workload.Transactions[i])
		if err != nil || decodeErr != nil || address != secret.Address || address != tx.From || tx.Verify(6423) != nil {
			t.Fatal("retained sender does not sign generated transaction")
		}
	}
	if err := runWithSenders(root, 3, true, 31656, 31757, 31858, true); err == nil {
		t.Fatal("retained bundle overwritten")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(raw) {
		t.Fatal("refused fixture reuse changed keys")
	}
}
