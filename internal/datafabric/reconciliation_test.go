package datafabric

import (
	"strings"
	"testing"
	"time"
)

func TestReconciliationMatchedMismatchAndUnavailable(t *testing.T) {
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(signedEvent(t, "event.pay.invoice.created.0001", 1), testKey); err != nil {
		t.Fatal(err)
	}
	entry := journalEntry("journal.reconcile.0001", "")
	if err := store.PostJournal(entry); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	metadata := SourceMetadata{Source: "ynx-testnet-rpc", AsOf: now, Version: "v1", Status: "authoritative"}
	observations := []SettlementObservation{
		{Source: "chain", ReferenceID: "transaction.chain.0001", Asset: "USD", Currency: "USD", AmountMinor: 1250, ObservedAt: now, Metadata: metadata, EvidenceHash: strings.Repeat("a", 64)},
		{Source: "pay", ReferenceID: "receipt.pay.0001", Asset: "USD", Currency: "USD", AmountMinor: 1249, ObservedAt: now, Metadata: metadata, EvidenceHash: strings.Repeat("b", 64)},
	}
	run, err := store.ReconcileJournal("reconciliation.run.0001", entry.EntryID, "audit.reconcile.0001", entry.SourceCommit, entry.SourceRelease, []string{"chain", "pay", "exchange"}, observations, now)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "mismatch" || run.Coverage != 1.0/3.0 || len(run.Findings) != 3 {
		t.Fatalf("truthful reconciliation status lost: %+v", run)
	}
	statuses := map[string]string{}
	for _, finding := range run.Findings {
		statuses[finding.Source] = finding.Status
	}
	if statuses["chain"] != "matched" || statuses["pay"] != "mismatch" || statuses["exchange"] != "unavailable" {
		t.Fatalf("unexpected findings: %+v", statuses)
	}
	if len(store.Reconciliations()) != 1 {
		t.Fatalf("reconciliation run was not persisted")
	}
}
