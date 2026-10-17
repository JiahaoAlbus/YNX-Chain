package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
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
