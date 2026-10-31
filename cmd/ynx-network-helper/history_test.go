package main

import (
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
)

func TestP09ProofHistorySurvivesRestartWithoutGrantingTrust(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private", "proof-history.json")
	store, err := receipt.OpenHistory(path)
	if err != nil {
		t.Fatal(err)
	}
	view := receipt.ProofView{Level: receipt.InclusionVerified, TxID: knownTx, Height: "19", Source: "isolated-verified-source"}
	for i := 0; i < 2; i++ {
		if err := store.Observe(view, "fixture-context-digest"); err != nil {
			t.Fatal(err)
		}
	}
	if len(store.List()) != 1 {
		t.Fatal("duplicate query multiplied history")
	}
	if _, err := receipt.OpenHistory(path); err == nil {
		t.Fatal("two writers shared history")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	restored, err := receipt.OpenHistory(path)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	rows := restored.List()
	if len(rows) != 1 || !rows[0].Historical || rows[0].ReportedLevel != receipt.InclusionVerified {
		t.Fatalf("lost historical result: %+v", rows)
	}
	h, s := fixture(t, "https://rpc.example")
	h.history = restored
	ticket := pair(t, s)
	code, result := call(t, s, "/api/history", s.URL, ticket, nil)
	if code != 200 || result["authority"] != false || result["classification"] != "historical-local-projection" {
		t.Fatalf("history minted authority: %d %+v", code, result)
	}
	// A history item is never passed as the new request's trusted checkpoint.
	code, result = call(t, s, "/api/verify", s.URL, ticket, map[string]any{"txId": knownTx, "proof": map[string]string{"height": "19"}})
	if code != 200 || result["level"] != "RPC_ONLY" {
		t.Fatalf("history became checkpoint: %d %+v", code, result)
	}
	if code, _ := call(t, s, "/api/revoke", s.URL, ticket, nil); code != 200 {
		t.Fatal(code)
	}
	if code, _ := call(t, s, "/api/history", s.URL, ticket, nil); code != 401 {
		t.Fatal("revoked history read")
	}
}
