package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestStoppedReadySenderAccountReadback(t *testing.T) {
	work := os.Getenv("YNX_CHAIN_STOPPED_WINDOW")
	if work == "" {
		t.Skip("requires explicitly selected stopped local window")
	}
	manifestPath := filepath.Join(work, "network", "network-manifest.json")
	raw, err := readBounded(manifestPath, 16<<20)
	if err != nil {
		t.Fatal(err)
	}
	manifestRaw := append([]byte(nil), raw...)
	var m consensus.EphemeralNetworkManifest
	if err = json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if err = validateManifest(m); err != nil {
		t.Fatal(err)
	}
	if err = validateLocalPaths(m, manifestPath); err != nil {
		t.Fatal(err)
	}
	migration, err := readMigration(m)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = readBounded(filepath.Join(work, "transactions-result.json"), 16<<20)
	if err != nil {
		t.Fatal(err)
	}
	var report report
	if err = json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	receiptRaw, err := readBounded(filepath.Join(work, "window-receipt.json"), 16<<20)
	if err != nil {
		t.Fatal(err)
	}
	var receipt struct {
		AllGroupsGone bool
		FirstCause    *string
	}
	if err = json.Unmarshal(receiptRaw, &receipt); err != nil || !receipt.AllGroupsGone || receipt.FirstCause != nil || len(report.SetupErrors) != 0 {
		t.Fatal("requires a clean completed and retired window", err)
	}
	if report.RetentionMode != "" {
		input, err := readBounded(filepath.Join(work, "network", "transactions.json"), 8<<20)
		if err != nil {
			t.Fatal(err)
		}
		initial, err := decodeTransactions(input)
		if err != nil {
			t.Fatal(err)
		}
		if err = restoreCompletedSlotReport(work, manifestRaw, m, &report, len(initial)); err != nil {
			t.Fatal(err)
		}
	}
	if report.SenderMode != "ready-pool" || report.RoundsCompleted != report.RoundsRequested || report.Summary.FinalSubmitted != len(report.Transactions) || report.ReadySenders.Quarantined != 0 {
		t.Fatal("requires complete ready sender window")
	}
	input, err := readBounded(filepath.Join(work, "network", "transactions.json"), 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	initial, err := decodeTransactions(input)
	if err != nil {
		t.Fatal(err)
	}
	initialBalances := map[string]int64{}
	for _, account := range migration.Accounts {
		initialBalances[account.Address] = account.Balance
	}
	expected := map[string]int64{}
	recipients := map[string]bool{}
	for _, raw := range initial {
		tx, err := consensus.DecodeSignedTransaction(raw)
		if err != nil || tx.Verify(migration.Network.ChainID) != nil || tx.Amount != 1 || tx.Fee != 1 {
			t.Fatal("invalid initial fixture")
		}
		expected[tx.From] = initialBalances[tx.From] - int64(report.RoundsRequested)*2
		recipients[tx.To] = true
	}
	for sender := range expected {
		if recipients[sender] {
			t.Fatal("requires disjoint native fixture senders/recipients")
		}
	}
	type node struct {
		Name           string `json:"name"`
		Height         int64  `json:"height"`
		Senders        int    `json:"sendersVerified"`
		Nonce          int    `json:"expectedNonce"`
		FeeEvents      int    `json:"feeEvents"`
		SnapshotSHA256 string `json:"snapshotSha256"`
		StoreSHA256    string `json:"storeSha256"`
	}
	var nodes []node
	for _, n := range m.Nodes {
		data, err := readBounded(n.ABCIStatePath, durableSnapshotLimit)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := decodeDurableSnapshot(context.Background(), data, migration)
		if err != nil || decoded.incompleteTail {
			t.Fatal("invalid stopped store", err)
		}
		seen := 0
		for _, account := range decoded.state.Accounts {
			if balance, ok := expected[account.Address]; ok {
				seen++
				if account.Nonce != uint64(report.RoundsRequested) || account.Balance != balance {
					t.Fatal("actual nonce or balance differs from executed ready cycles")
				}
			}
		}
		if seen != len(initial) || len(decoded.state.FeeEvents) != len(report.Transactions) {
			t.Fatal("incomplete sender or fee state")
		}
		stateHash, storeHash := sha256.Sum256(decoded.payload), sha256.Sum256(data)
		nodes = append(nodes, node{n.Moniker, decoded.state.Height, seen, report.RoundsRequested, len(decoded.state.FeeEvents), hex.EncodeToString(stateHash[:]), hex.EncodeToString(storeHash[:])})
	}
	data, err := json.MarshalIndent(nodes, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(filepath.Join(work, "ready-account-readback.json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err = f.Write(append(data, '\n')); err != nil {
		t.Fatal(err)
	}
	t.Logf("four stopped nodes each verify %d senders at nonce %d with exact balance and %d fee events", len(initial), report.RoundsRequested, len(report.Transactions))
}
