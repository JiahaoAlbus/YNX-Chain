package resourcemarket

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
)

func signedMeter(t *testing.T, e *Engine, p Provider, o Order, q Quote, start, end time.Time, quantity int64, source Source, keyID string) string {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.RegisterWorkerKey(p.Wallet, p.ID, keyID, base64.RawURLEncoding.EncodeToString(public), end.Add(time.Hour), evidence(start, "worker_key_attestation")); err != nil {
		t.Fatal(err)
	}
	payload, err := MeterPayloadJSON(o, q, start, end, quantity, source)
	if err != nil {
		t.Fatal(err)
	}
	return "ed25519:" + keyID + ":" + base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, payload))
}

func evidence(now time.Time, kind string) Source {
	return Source{Kind: kind, URI: "ynx-evidence://test/sha256", AsOf: now, Version: "1", Confidence: 1, Coverage: "test vector", Status: "available"}
}

func provider(t *testing.T, e *Engine, wallet, name, region string, bond int64) Provider {
	t.Helper()
	p, err := e.RegisterProvider(wallet, Provider{Wallet: wallet, Name: name, Region: region, Hardware: []string{"test-worker"}, SecurityBond: bond, Source: evidence(e.now(), "provider_attestation")})
	if err != nil {
		t.Fatal(err)
	}
	p, err = e.VerifyProvider("independent-verifier", p.ID, []string{"attestation-sha256"})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestTwoProviderQuoteMeterSettlementAndRecovery(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "market.json")
	e, err := New(path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	p1 := provider(t, e, "wallet-provider-a", "Shanghai Compute", "cn-east", 10_000)
	p2 := provider(t, e, "wallet-provider-b", "Singapore Compute", "sg", 20_000)

	o1, err := e.PublishOffer(p1.Wallet, Offer{ProviderID: p1.ID, Resource: "quant_backtest", Unit: "worker-second", Pricing: "fixed", Currency: "YNXT-testnet", UnitPrice: 2, Capacity: 10_000, MinUnits: 10, MaxUnits: 5_000, SLAUptime: .99, LatencyMS: 30, Source: evidence(now, "provider_measurement"), ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.PublishOffer(p2.Wallet, Offer{ProviderID: p2.ID, Resource: "quant_backtest", Unit: "worker-second", Pricing: "fixed", Currency: "YNXT-testnet", UnitPrice: 3, Capacity: 10_000, MinUnits: 10, MaxUnits: 5_000, SLAUptime: .999, LatencyMS: 10, Source: evidence(now, "provider_measurement"), ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if got := e.Match("quant_backtest", "", 100); len(got) != 2 {
		t.Fatalf("providers=%d", len(got))
	}

	q, err := e.CreateQuote("wallet-buyer", o1.ID, 100, 5)
	if err != nil {
		t.Fatal(err)
	}
	if q.Status != "quote" || q.GrossCost != 205 {
		t.Fatalf("quote=%+v", q)
	}
	_, _, _, orders, _, receipts, _ := e.Snapshot()
	if len(orders) != 0 || len(receipts) != 0 {
		t.Fatal("quote was treated as order or settlement")
	}

	order, err := e.AcceptIntent("wallet-buyer", q.ID, Digest(map[string]any{"quoteId": q.ID, "units": 100}))
	if err != nil {
		t.Fatal(err)
	}
	order, err = e.Reserve(p1.Wallet, order.ID, "reservation-attestation")
	if err != nil || order.Status != "capacity_reserved" {
		t.Fatalf("reserve=%+v err=%v", order, err)
	}
	order, err = e.StartService(p1.Wallet, order.ID, "worker-start-attestation")
	if err != nil {
		t.Fatal(err)
	}
	meterSource := evidence(now.Add(90*time.Second), "signed_worker_meter")
	prepared, err := e.PrepareMeter(p1.Wallet, order.ID, now, now.Add(90*time.Second), 90, meterSource)
	if err != nil || prepared.Algorithm != "Ed25519" || len(prepared.SHA256) != 64 {
		t.Fatalf("prepared=%+v err=%v", prepared, err)
	}
	integrity := signedMeter(t, e, p1, order, q, now, now.Add(90*time.Second), 90, meterSource, "worker-a")
	cut := strings.LastIndex(integrity, ":") + 1
	replacement := "A"
	if integrity[cut] == 'A' {
		replacement = "B"
	}
	tampered := integrity[:cut] + replacement + integrity[cut+1:]
	if _, err = e.RecordUsage(p1.Wallet, order.ID, now, now.Add(90*time.Second), 90, tampered, meterSource); err == nil {
		t.Fatal("tampered worker meter accepted")
	}
	meter, err := e.RecordUsage(p1.Wallet, order.ID, now, now.Add(90*time.Second), 90, integrity, meterSource)
	if err != nil {
		t.Fatal(err)
	}
	if meter.GrossCost != 184 || meter.ProviderNet != 180 || meter.ProtocolFee != 4 {
		t.Fatalf("meter=%+v", meter)
	}
	if revoked, err := e.RevokeWorkerKey(p1.Wallet, "worker-a"); err != nil || revoked.Status != "revoked" {
		t.Fatalf("revoke=%+v err=%v", revoked, err)
	}
	order, err = e.CompleteService(p1.Wallet, order.ID, "artifact-sha256")
	if err != nil {
		t.Fatal(err)
	}
	order, err = e.MarkSettlementPending("wallet-buyer", order.ID)
	if err != nil || order.Status != "settlement_pending" {
		t.Fatalf("pending=%+v err=%v", order, err)
	}
	if _, err = e.ConfirmSettlement("chain-receipt-indexer", order.ID, Receipt{Asset: "YNXT-testnet", TransactionHash: "0xabc", Evidence: "receipt-proof", GrossCost: 205, ProviderNet: 200, ProtocolFee: 5, Source: evidence(now, "chain_receipt")}); err == nil {
		t.Fatal("unreconciled receipt accepted")
	}
	r, err := e.ConfirmSettlement("chain-receipt-indexer", order.ID, Receipt{Asset: "YNXT-testnet", TransactionHash: "0xabc", Evidence: "receipt-proof", GrossCost: 184, ProviderNet: 180, ProtocolFee: 4, Source: evidence(now, "chain_receipt")})
	if err != nil || r.Status != "asset_settlement_confirmed" {
		t.Fatalf("receipt=%+v err=%v", r, err)
	}

	restarted, err := New(path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	ps, _, _, os, ms, rs, _ := restarted.Snapshot()
	if len(ps) != 2 || len(os) != 1 || os[0].Status != "asset_settlement_confirmed" || len(ms) != 1 || len(rs) != 1 {
		t.Fatalf("recovery lost state: providers=%d orders=%+v meters=%d receipts=%d", len(ps), os, len(ms), len(rs))
	}
}

func TestSettlementReceiptRejectsTransactionReplayAndNormalizesReference(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	e, err := New(filepath.Join(t.TempDir(), "market.json"), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	p := provider(t, e, "provider", "Provider", "region", 100)
	offer, err := e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID, Resource: "cpu_compute", Unit: "vcpu-second", Pricing: "fixed", Currency: "YNXT-testnet", UnitPrice: 2, Capacity: 100, MinUnits: 1, MaxUnits: 100, Source: evidence(now, "capacity_proof"), ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}

	pendingOrder := func(buyer, keyID string) (Order, Meter) {
		t.Helper()
		quote, createErr := e.CreateQuote(buyer, offer.ID, 10, 0)
		if createErr != nil {
			t.Fatal(createErr)
		}
		order, acceptErr := e.AcceptIntent(buyer, quote.ID, Digest(map[string]string{"quoteId": quote.ID, "buyer": buyer}))
		if acceptErr != nil {
			t.Fatal(acceptErr)
		}
		order, acceptErr = e.Reserve(p.Wallet, order.ID, "reservation-proof")
		if acceptErr != nil {
			t.Fatal(acceptErr)
		}
		order, acceptErr = e.StartService(p.Wallet, order.ID, "service-start-proof")
		if acceptErr != nil {
			t.Fatal(acceptErr)
		}
		meterSource := evidence(now.Add(10*time.Second), "signed_meter")
		integrity := signedMeter(t, e, p, order, quote, now, now.Add(10*time.Second), 10, meterSource, keyID)
		meter, meterErr := e.RecordUsage(p.Wallet, order.ID, now, now.Add(10*time.Second), 10, integrity, meterSource)
		if meterErr != nil {
			t.Fatal(meterErr)
		}
		order, meterErr = e.CompleteService(p.Wallet, order.ID, "completion-proof")
		if meterErr != nil {
			t.Fatal(meterErr)
		}
		order, meterErr = e.MarkSettlementPending(buyer, order.ID)
		if meterErr != nil {
			t.Fatal(meterErr)
		}
		return order, meter
	}

	first, firstMeter := pendingOrder("buyer-a", "worker-a")
	if _, err = e.ConfirmSettlement("   ", first.ID, Receipt{Asset: "YNXT-testnet", TransactionHash: "0xabc", Evidence: "proof-a", GrossCost: firstMeter.GrossCost, ProviderNet: firstMeter.ProviderNet, ProtocolFee: firstMeter.ProtocolFee, Source: evidence(now, "chain_receipt")}); err == nil {
		t.Fatal("blank settlement authority accepted")
	}
	firstReceipt, err := e.ConfirmSettlement("chain-receipt-indexer", first.ID, Receipt{Asset: " YNXT-testnet ", TransactionHash: " 0xAbC ", Evidence: " proof-a ", GrossCost: firstMeter.GrossCost, ProviderNet: firstMeter.ProviderNet, ProtocolFee: firstMeter.ProtocolFee, Source: evidence(now, "chain_receipt")})
	if err != nil {
		t.Fatal(err)
	}
	if firstReceipt.TransactionHash != "0xabc" || firstReceipt.Asset != "YNXT-testnet" || firstReceipt.Evidence != "proof-a" {
		t.Fatalf("settlement reference was not normalized: %+v", firstReceipt)
	}

	second, secondMeter := pendingOrder("buyer-b", "worker-b")
	if _, err = e.ConfirmSettlement("chain-receipt-indexer", second.ID, Receipt{Asset: "YNXT-testnet", TransactionHash: "0xABC", Evidence: "proof-b", GrossCost: secondMeter.GrossCost, ProviderNet: secondMeter.ProviderNet, ProtocolFee: secondMeter.ProtocolFee, Source: evidence(now, "chain_receipt")}); err == nil || !strings.Contains(err.Error(), "already consumed") {
		t.Fatalf("replayed settlement transaction was not rejected: %v", err)
	}
	if _, err = e.ConfirmSettlement("chain-receipt-indexer", second.ID, Receipt{Asset: "YNXT-testnet", TransactionHash: "0xdef", Evidence: "proof-b", GrossCost: secondMeter.GrossCost, ProviderNet: secondMeter.ProviderNet, ProtocolFee: secondMeter.ProtocolFee, Source: evidence(now, "chain_receipt")}); err != nil {
		t.Fatalf("fresh settlement transaction rejected: %v", err)
	}
}

func TestSegmentedMeteringRejectsOverlapAndCumulativeOverrun(t *testing.T) {
	now := time.Date(2026, 7, 27, 11, 0, 0, 0, time.UTC)
	e, err := New(filepath.Join(t.TempDir(), "market.json"), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	p := provider(t, e, "provider-segmented", "Segmented Provider", "region", 100)
	offer, err := e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID, Resource: "cpu_compute", Unit: "vcpu-second", Pricing: "fixed", Currency: "YNXT-testnet", UnitPrice: 2, Capacity: 100, MinUnits: 1, MaxUnits: 100, Source: evidence(now, "capacity_proof"), ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	quote, err := e.CreateQuote("segmented-buyer", offer.ID, 100, 5)
	if err != nil {
		t.Fatal(err)
	}
	order, err := e.AcceptIntent("segmented-buyer", quote.ID, Digest(map[string]string{"quoteId": quote.ID, "buyer": "segmented-buyer"}))
	if err != nil {
		t.Fatal(err)
	}
	order, err = e.Reserve(p.Wallet, order.ID, "reservation-proof")
	if err != nil {
		t.Fatal(err)
	}
	order, err = e.StartService(p.Wallet, order.ID, "service-start-proof")
	if err != nil {
		t.Fatal(err)
	}

	firstSource := evidence(now.Add(40*time.Second), "signed_meter")
	firstIntegrity := signedMeter(t, e, p, order, quote, now, now.Add(40*time.Second), 40, firstSource, "segmented-worker-a")
	first, err := e.RecordUsage(p.Wallet, order.ID, now, now.Add(40*time.Second), 40, firstIntegrity, firstSource)
	if err != nil {
		t.Fatal(err)
	}
	if first.Quantity != 40 || first.ProviderNet != 80 || first.ProtocolFee != 2 || first.GrossCost != 82 {
		t.Fatalf("first meter=%+v", first)
	}
	if _, err = e.PrepareMeter(p.Wallet, order.ID, now.Add(20*time.Second), now.Add(50*time.Second), 10, evidence(now.Add(50*time.Second), "signed_meter")); err == nil || !strings.Contains(err.Error(), "overlaps") {
		t.Fatalf("overlapping meter window was not rejected: %v", err)
	}
	if _, err = e.PrepareMeter(p.Wallet, order.ID, now.Add(40*time.Second), now.Add(101*time.Second), 61, evidence(now.Add(101*time.Second), "signed_meter")); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("cumulative meter overrun was not rejected: %v", err)
	}
	if _, err = e.PrepareMeter(p.Wallet, order.ID, now.Add(-time.Second), now.Add(time.Second), 1, evidence(now.Add(time.Second), "signed_meter")); err == nil || !strings.Contains(err.Error(), "service start") {
		t.Fatalf("pre-service meter was not rejected: %v", err)
	}

	secondSource := evidence(now.Add(100*time.Second), "signed_meter")
	secondIntegrity := signedMeter(t, e, p, order, quote, now.Add(40*time.Second), now.Add(100*time.Second), 60, secondSource, "segmented-worker-b")
	second, err := e.RecordUsage(p.Wallet, order.ID, now.Add(40*time.Second), now.Add(100*time.Second), 60, secondIntegrity, secondSource)
	if err != nil {
		t.Fatal(err)
	}
	if second.Quantity != 60 || second.ProviderNet != 120 || second.ProtocolFee != 3 || second.GrossCost != 123 {
		t.Fatalf("second meter=%+v", second)
	}
	order, err = e.CompleteService(p.Wallet, order.ID, "completion-proof")
	if err != nil {
		t.Fatal(err)
	}
	order, err = e.MarkSettlementPending("segmented-buyer", order.ID)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := e.ConfirmSettlement("chain-receipt-indexer", order.ID, Receipt{Asset: "YNXT-testnet", TransactionHash: "0xsegmented", Evidence: "receipt-proof", GrossCost: 205, ProviderNet: 200, ProtocolFee: 5, Source: evidence(now.Add(101*time.Second), "chain_receipt")})
	if err != nil {
		t.Fatal(err)
	}
	if receipt.GrossCost != 205 || receipt.ProviderNet != 200 || receipt.ProtocolFee != 5 {
		t.Fatalf("segmented receipt=%+v", receipt)
	}
}

func TestFailClosedTransitionsAndCapacity(t *testing.T) {
	now := time.Now().UTC()
	e, _ := New(filepath.Join(t.TempDir(), "market.json"), func() time.Time { return now })
	p := provider(t, e, "provider", "Provider", "region", 100)
	o, err := e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID, Resource: "storage", Unit: "gib-hour", Pricing: "reservation", Currency: "YNXT-testnet", UnitPrice: 1, Capacity: 10, MinUnits: 1, MaxUnits: 10, Source: evidence(now, "capacity_proof"), ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	q, _ := e.CreateQuote("buyer", o.ID, 10, 0)
	order, _ := e.AcceptIntent("buyer", q.ID, Digest(q))
	if _, err = e.StartService(p.Wallet, order.ID, "start"); err == nil {
		t.Fatal("service started before reservation")
	}
	if _, err = e.Reserve("wrong-wallet", order.ID, "proof"); err == nil {
		t.Fatal("wrong provider reserved capacity")
	}
	if _, err = e.Reserve(p.Wallet, order.ID, ""); err == nil {
		t.Fatal("reservation without evidence accepted")
	}
	if _, err = e.CreateQuote("buyer-2", o.ID, 1, 0); err != nil {
		t.Fatal("quote should not reserve capacity")
	}
	if _, err = e.Reserve(p.Wallet, order.ID, "proof"); err != nil {
		t.Fatal(err)
	}
	q2, _ := e.CreateQuote("buyer-2", o.ID, 1, 0)
	o2, _ := e.AcceptIntent("buyer-2", q2.ID, Digest(q2))
	if _, err = e.Reserve(p.Wallet, o2.ID, "proof"); err == nil {
		t.Fatal("oversubscribed capacity")
	}
}

func TestProviderFailureRetryRefundBondAndAppeal(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	e, _ := New(filepath.Join(t.TempDir(), "market.json"), func() time.Time { return now })
	p := provider(t, e, "provider", "Provider", "region", 100)
	o, _ := e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID, Resource: "developer_build", Unit: "build-minute", Pricing: "fixed", Currency: "YNXT-testnet", UnitPrice: 10, Capacity: 100, MinUnits: 1, MaxUnits: 100, Source: evidence(now, "capacity_proof"), ExpiresAt: now.Add(time.Hour)})
	q, _ := e.CreateQuote("buyer", o.ID, 10, 0)
	order, _ := e.AcceptIntent("buyer", q.ID, Digest(q))
	order, _ = e.Reserve(p.Wallet, order.ID, "reserve-proof")
	order, _ = e.StartService(p.Wallet, order.ID, "worker-start")
	meterSource := evidence(now, "signed_meter")
	integrity := signedMeter(t, e, p, order, q, now, now.Add(5*time.Minute), 5, meterSource, "worker-failure")
	_, _ = e.RecordUsage(p.Wallet, order.ID, now, now.Add(5*time.Minute), 5, integrity, meterSource)
	failed, err := e.ReportFailure(p.Wallet, order.ID, "worker-crash-evidence")
	if err != nil || failed.Status != "provider_failed" {
		t.Fatalf("failure=%+v err=%v", failed, err)
	}
	retry, err := e.RetryFailure("buyer", failed.ID)
	if err != nil || retry.Status != "accepted" || retry.ID == failed.ID {
		t.Fatalf("retry=%+v err=%v", retry, err)
	}
	d, err := e.OpenDispute("buyer", failed.ID, "paid usage did not complete", "failure-and-meter-evidence")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.DecideDispute("reviewer", d.ID, "upheld", "review-record", 101, 50); err == nil {
		t.Fatal("uncapped bond penalty accepted")
	}
	d, err = e.DecideDispute("reviewer", d.ID, "upheld", "review-record", 20, 50)
	if err != nil || d.Status != "decided_pending_appeal" || d.AppealUntil.IsZero() {
		t.Fatalf("decision=%+v err=%v", d, err)
	}
	d, err = e.AppealDispute(p.Wallet, d.ID, "worker host outage was upstream", "provider-appeal-evidence")
	if err != nil || d.Status != "appealed" {
		t.Fatalf("appeal=%+v err=%v", d, err)
	}
	d, err = e.ResolveAppeal("appeal-reviewer", d.ID, "affirmed", "appeal-review-record")
	if err != nil || d.Status != "final" {
		t.Fatalf("final=%+v err=%v", d, err)
	}
	ps, _, _, orders, _, _, ds := e.Snapshot()
	if ps[0].BondAvailable != 80 || len(orders) != 2 || len(ds) != 1 {
		t.Fatalf("bond/retry state providers=%+v orders=%d disputes=%d", ps, len(orders), len(ds))
	}
}

func TestMarketBackupRestoreDrill(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "market.json")
	e, _ := New(path, func() time.Time { return now })
	p, err := e.RegisterProvider("provider", Provider{Wallet: "provider", Name: "Recovery Provider", Region: "local", Hardware: []string{"worker"}, Source: evidence(now, "attestation")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.VerifyProvider("reviewer", p.ID, []string{"verification"}); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte("corrupted-primary"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = New(path, func() time.Time { return now }); err == nil {
		t.Fatal("corrupted primary started successfully")
	}
	if err = RestoreBackup(path); err != nil {
		t.Fatal(err)
	}
	restored, err := New(path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	providers, _, _, _, _, _, _ := restored.Snapshot()
	if len(providers) != 1 || providers[0].Status != "pending_verification" {
		t.Fatalf("backup restore did not recover prior exact snapshot: %+v", providers)
	}
}

func TestSchemaV1MigratesWithoutInventingWorkerKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.json")
	legacy := emptyState()
	legacy.Version = 1
	legacy.WorkerKeys = nil
	if err := productstore.Save(path, legacy); err != nil {
		t.Fatal(err)
	}
	e, err := New(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	if e.data.Version != SchemaVersion || e.data.WorkerKeys == nil || len(e.data.WorkerKeys) != 0 {
		t.Fatalf("migration=%+v", e.data)
	}
	if _, err = e.RegisterProvider("wallet", Provider{Wallet: "wallet", Name: "Migrated", Region: "local", Hardware: []string{"worker"}, Source: evidence(time.Now().UTC(), "migration_test")}); err != nil {
		t.Fatal(err)
	}
	var persisted state
	if _, err = productstore.Load(path, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.Version != SchemaVersion {
		t.Fatalf("persisted version=%d", persisted.Version)
	}
}

func TestProviderMaintenanceCapacityAndExitMigration(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	e, _ := New(filepath.Join(t.TempDir(), "market.json"), func() time.Time { return now })
	p := provider(t, e, "provider-lifecycle", "Lifecycle Provider", "cn-east", 100)
	o, err := e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID, Resource: "cpu_compute", Unit: "vcpu-second", Pricing: "fixed", Currency: "YNXT-testnet", UnitPrice: 2, Capacity: 100, MinUnits: 1, MaxUnits: 80, Source: evidence(now, "capacity_proof"), ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if got := e.Match("cpu_compute", "", 10); len(got) != 1 {
		t.Fatalf("initial matches=%d", len(got))
	}
	if _, err = e.SetMaintenance(p.Wallet, p.ID, true, "scheduled-window-42"); err != nil {
		t.Fatal(err)
	}
	if got := e.Match("cpu_compute", "", 10); len(got) != 0 {
		t.Fatal("maintenance provider remained matchable")
	}
	if _, err = e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID}); err == nil {
		t.Fatal("maintenance provider published an offer")
	}
	if _, err = e.SetMaintenance(p.Wallet, p.ID, false, "recovery-check-passed"); err != nil {
		t.Fatal(err)
	}
	updated, err := e.UpdateCapacity(p.Wallet, o.ID, 150, 120, evidence(now, "capacity_reassessment"))
	if err != nil || updated.Capacity != 150 || updated.MaxUnits != 120 {
		t.Fatalf("capacity update=%+v err=%v", updated, err)
	}
	exited, err := e.ExitProvider(p.Wallet, p.ID, "exit-notice-90-days", "ynx-provider://replacement-a")
	if err != nil || exited.Status != "exited" || exited.MigrationTarget == "" {
		t.Fatalf("exit=%+v err=%v", exited, err)
	}
	if got := e.Match("cpu_compute", "", 10); len(got) != 0 {
		t.Fatal("exited provider remained matchable")
	}
	_, offers, _, _, _, _, _ := e.Snapshot()
	if len(offers) != 1 || offers[0].Status != "closed_provider_exit" {
		t.Fatalf("offers after exit=%+v", offers)
	}
}

func TestReverseAndBatchAuctionDeterministicClearing(t *testing.T) {
	clock := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	e, _ := New(filepath.Join(t.TempDir(), "market.json"), func() time.Time { return clock })
	p1 := provider(t, e, "auction-provider-a", "Auction A", "cn-east", 100)
	p2 := provider(t, e, "auction-provider-b", "Auction B", "cn-east", 100)
	reverseOffer1, _ := e.PublishOffer(p1.Wallet, Offer{ProviderID: p1.ID, Resource: "gpu_compute", Unit: "gpu-second", Pricing: "reverse_auction", Currency: "YNXT-testnet", UnitPrice: 10, Capacity: 200, MinUnits: 1, MaxUnits: 200, Source: evidence(clock, "capacity"), ExpiresAt: clock.Add(2 * time.Hour)})
	reverseOffer2, _ := e.PublishOffer(p2.Wallet, Offer{ProviderID: p2.ID, Resource: "gpu_compute", Unit: "gpu-second", Pricing: "reverse_auction", Currency: "YNXT-testnet", UnitPrice: 10, Capacity: 200, MinUnits: 1, MaxUnits: 200, Source: evidence(clock, "capacity"), ExpiresAt: clock.Add(2 * time.Hour)})
	a, err := e.CreateAuction("auction-buyer", "reverse_auction", "gpu_compute", "cn-east", "YNXT-testnet", 100, 10, 500, clock.Add(10*time.Minute), evidence(clock, "buyer_demand"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.SubmitAuctionBid("auction-buyer", a.ID, reverseOffer1.ID, 100, 1, evidence(clock, "self_dealing")); err == nil {
		t.Fatal("buyer self-dealing bid accepted")
	}
	b1, err := e.SubmitAuctionBid(p1.Wallet, a.ID, reverseOffer1.ID, 100, 8, evidence(clock, "sealed_bid"))
	if err != nil {
		t.Fatal(err)
	}
	if len(b1.CommitmentDigest) != 64 || b1.Status != "sealed" {
		t.Fatalf("bid=%+v", b1)
	}
	if _, err = e.SubmitAuctionBid(p2.Wallet, a.ID, reverseOffer2.ID, 100, 7, evidence(clock, "sealed_bid")); err != nil {
		t.Fatal(err)
	}
	if _, err = e.ClearAuction("operator", a.ID); err == nil {
		t.Fatal("auction cleared before deadline")
	}
	clock = clock.Add(11 * time.Minute)
	cleared, err := e.ClearAuction("operator", a.ID)
	if err != nil || cleared.Auction.Status != "cleared" || len(cleared.Quotes) != 1 || cleared.Quotes[0].ProviderID != p2.ID || cleared.Quotes[0].UnitPrice != 7 || cleared.Quotes[0].ProtocolFee != 35 {
		t.Fatalf("reverse clearing=%+v err=%v", cleared, err)
	}

	batchOffer1, _ := e.PublishOffer(p1.Wallet, Offer{ProviderID: p1.ID, Resource: "cpu_compute", Unit: "vcpu-second", Pricing: "batch_auction", Currency: "YNXT-testnet", UnitPrice: 5, Capacity: 100, MinUnits: 1, MaxUnits: 100, Source: evidence(clock, "capacity"), ExpiresAt: clock.Add(2 * time.Hour)})
	batchOffer2, _ := e.PublishOffer(p2.Wallet, Offer{ProviderID: p2.ID, Resource: "cpu_compute", Unit: "vcpu-second", Pricing: "batch_auction", Currency: "YNXT-testnet", UnitPrice: 5, Capacity: 100, MinUnits: 1, MaxUnits: 100, Source: evidence(clock, "capacity"), ExpiresAt: clock.Add(2 * time.Hour)})
	batch, _ := e.CreateAuction("batch-buyer", "batch_auction", "cpu_compute", "", "YNXT-testnet", 100, 5, 0, clock.Add(10*time.Minute), evidence(clock, "buyer_demand"))
	_, _ = e.SubmitAuctionBid(p1.Wallet, batch.ID, batchOffer1.ID, 60, 2, evidence(clock, "sealed_bid"))
	_, _ = e.SubmitAuctionBid(p2.Wallet, batch.ID, batchOffer2.ID, 60, 3, evidence(clock, "sealed_bid"))
	clock = clock.Add(11 * time.Minute)
	batchCleared, err := e.ClearAuction("operator", batch.ID)
	if err != nil || len(batchCleared.Quotes) != 2 || batchCleared.Quotes[0].Units != 60 || batchCleared.Quotes[1].Units != 40 || batchCleared.Quotes[0].UnitPrice != 2 || batchCleared.Quotes[1].UnitPrice != 3 {
		t.Fatalf("batch clearing=%+v err=%v", batchCleared, err)
	}
}

func TestErasurePseudonymizesIdentityButPreservesEconomicRecords(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	e, _ := New(filepath.Join(t.TempDir(), "market.json"), func() time.Time { return now })
	p := provider(t, e, "erasure-provider", "Erasure Provider", "local", 100)
	o, _ := e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID, Resource: "storage", Unit: "gib-hour", Pricing: "fixed", Currency: "YNXT-testnet", UnitPrice: 2, Capacity: 100, MinUnits: 1, MaxUnits: 100, Source: evidence(now, "capacity"), ExpiresAt: now.Add(time.Hour)})
	q, _ := e.CreateQuote("erasure-buyer", o.ID, 10, 0)
	r, err := e.RequestErasure("erasure-buyer", "remove direct identity", evidence(now, "privacy_request"))
	if err != nil {
		t.Fatal(err)
	}
	fulfilled, err := e.FulfillErasure("privacy-operator", r.ID)
	if err != nil || fulfilled.Status != "fulfilled" || !strings.HasPrefix(fulfilled.Subject, "deleted:") {
		t.Fatalf("fulfilled=%+v err=%v", fulfilled, err)
	}
	_, _, quotes, _, _, _, _ := e.Snapshot()
	if len(quotes) != 1 || quotes[0].ID != q.ID || quotes[0].Buyer != fulfilled.Subject {
		t.Fatalf("economic quote was lost or not pseudonymized: %+v", quotes)
	}
	providerRequest, _ := e.RequestErasure(p.Wallet, "remove provider profile", evidence(now, "privacy_request"))
	if _, err = e.FulfillErasure("privacy-operator", providerRequest.ID); err == nil {
		t.Fatal("verified provider erased without guarded exit")
	}
}

func TestRetentionSweepDeletesOnlyExpiredTransientRecords(t *testing.T) {
	clock := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e, _ := New(filepath.Join(t.TempDir(), "market.json"), func() time.Time { return clock })
	p := provider(t, e, "retention-provider", "Retention Provider", "local", 100)
	fixed, _ := e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID, Resource: "cpu_compute", Unit: "vcpu-second", Pricing: "fixed", Currency: "YNXT-testnet", UnitPrice: 1, Capacity: 100, MinUnits: 1, MaxUnits: 100, Source: evidence(clock, "capacity"), ExpiresAt: clock.Add(200 * 24 * time.Hour)})
	_, _ = e.CreateQuote("retention-buyer", fixed.ID, 10, 0)
	batchOffer, _ := e.PublishOffer(p.Wallet, Offer{ProviderID: p.ID, Resource: "cpu_compute", Unit: "vcpu-second", Pricing: "batch_auction", Currency: "YNXT-testnet", UnitPrice: 2, Capacity: 100, MinUnits: 1, MaxUnits: 100, Source: evidence(clock, "capacity"), ExpiresAt: clock.Add(200 * 24 * time.Hour)})
	a, _ := e.CreateAuction("retention-buyer", "batch_auction", "cpu_compute", "", "YNXT-testnet", 100, 2, 0, clock.Add(10*time.Minute), evidence(clock, "demand"))
	_, _ = e.SubmitAuctionBid(p.Wallet, a.ID, batchOffer.ID, 20, 2, evidence(clock, "bid"))
	clock = clock.Add(11 * time.Minute)
	failed, err := e.ClearAuction("auction-operator", a.ID)
	if err != nil || failed.Auction.Status != "failed_insufficient_bids" {
		t.Fatalf("failed auction=%+v err=%v", failed, err)
	}
	clock = clock.Add(91 * 24 * time.Hour)
	report, err := e.ApplyRetention("retention-operator")
	if err != nil || report.ExpiredQuotesDeleted != 1 || report.FailedAuctionsDeleted != 1 || report.RejectedBidsDeleted != 1 {
		t.Fatalf("retention=%+v err=%v", report, err)
	}
	_, _, quotes, orders, meters, receipts, disputes := e.Snapshot()
	auctions, bids := e.AuctionSnapshot()
	if len(quotes) != 0 || len(auctions) != 0 || len(bids) != 0 || len(orders) != 0 || len(meters) != 0 || len(receipts) != 0 || len(disputes) != 0 {
		t.Fatal("retention sweep left transient records or touched unexpected records")
	}
}
