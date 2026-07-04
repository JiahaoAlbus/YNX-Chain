package chain

import "testing"

func TestValidatorSetConfigAndBlockRotation(t *testing.T) {
	validators, err := ParseValidatorSet("ynx_val_primary|primary|43.153.202.237|primary validator|peer-primary;ynx_val_sg|singapore|43.134.23.58|bonded validator|peer-sg;ynx_val_sv|silicon-valley|43.162.100.54|bonded validator|peer-sv")
	if err != nil {
		t.Fatal(err)
	}
	devnet := NewDevnetWithValidators(DefaultNetworkConfig("testnet"), validators)
	got := devnet.Validators()
	if len(got) != 3 {
		t.Fatalf("expected 3 validators, got %+v", got)
	}
	if got[0].Moniker != "primary" || got[0].Host != "43.153.202.237" || got[0].PeerID != "peer-primary" {
		t.Fatalf("validator metadata not preserved: %+v", got[0])
	}
	first := devnet.ProduceBlock()
	second := devnet.ProduceBlock()
	third := devnet.ProduceBlock()
	if first.Validator != "ynx_val_primary" || second.Validator != "ynx_val_sg" || third.Validator != "ynx_val_sv" {
		t.Fatalf("expected validator rotation, got %s %s %s", first.Validator, second.Validator, third.Validator)
	}
}

func TestStakeIncreasesResources(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_staker", 500); err != nil {
		t.Fatal(err)
	}
	before, err := devnet.Resources("ynx_staker")
	if err != nil {
		t.Fatal(err)
	}
	_, after, err := devnet.Stake("ynx_staker", 200)
	if err != nil {
		t.Fatal(err)
	}
	if after.BandwidthLimit <= before.BandwidthLimit {
		t.Fatalf("expected bandwidth to increase")
	}
}

func TestResourceDelegationRentalIncomeAndPersistence(t *testing.T) {
	dir := t.TempDir()
	devnet, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_provider", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_renter", 1000); err != nil {
		t.Fatal(err)
	}
	delegation, tx, resources, err := devnet.DelegateResources("ynx_provider", "ynx_provider", 500)
	if err != nil {
		t.Fatal(err)
	}
	if delegation.Status != "active" || tx.Type != "resource_delegate" {
		t.Fatalf("unexpected delegation: %+v tx=%+v", delegation, tx)
	}
	if resources.BandwidthLimit <= 1000 {
		t.Fatalf("expected delegated resources to increase provider capacity: %+v", resources)
	}
	rental, _, err := devnet.RentResources("ynx_renter", "ynx_provider", 100, 5, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	if rental.Provider != "ynx_provider" || rental.ProviderIncomeYNXT <= 0 || rental.ProtocolFeeYNXT <= 0 {
		t.Fatalf("unexpected rental split: %+v", rental)
	}
	income := devnet.ResourceIncome("ynx_provider")
	if len(income) != 1 || income[0].Amount != rental.ProviderIncomeYNXT {
		t.Fatalf("expected provider income record: %+v", income)
	}
	analytics := devnet.ResourceAnalytics()
	if analytics.ActiveDelegationCount != 1 || analytics.ResourceRentalCount != 1 || analytics.ProviderIncomeYNXT != rental.ProviderIncomeYNXT {
		t.Fatalf("unexpected analytics: %+v", analytics)
	}

	restored, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.ResourceDelegations("ynx_provider")) != 1 {
		t.Fatal("expected restored resource delegation")
	}
	if len(restored.ResourceIncome("ynx_provider")) != 1 {
		t.Fatal("expected restored resource income")
	}
}

func TestTransferRequiresTraceableLots(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Transfer("ynx_empty", "ynx_receiver", 1); err == nil {
		t.Fatal("expected transfer to fail without balance")
	}
}

func TestPersistentDevnetRestoresBlocksAndAccounts(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultNetworkConfig("devnet")
	devnet, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_persist_alice", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Transfer("ynx_persist_alice", "ynx_persist_bob", 125); err != nil {
		t.Fatal(err)
	}
	block := devnet.ProduceBlock()
	if block.Height == 0 {
		t.Fatal("expected produced block")
	}
	restored, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if restored.LatestBlock().Hash != block.Hash {
		t.Fatalf("expected restored latest block")
	}
	account, ok := restored.Account("ynx_persist_bob")
	if !ok {
		t.Fatal("expected restored account")
	}
	if account.Balance != 125 {
		t.Fatalf("expected balance 125, got %d", account.Balance)
	}
	trace, err := restored.TrustTrace("ynx_persist_bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.Lots) != 1 {
		t.Fatalf("expected restored trace lot")
	}
}

func TestPersistentDevnetRestoresProductState(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultNetworkConfig("devnet")
	devnet, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_product", 1000); err != nil {
		t.Fatal(err)
	}
	intent, err := devnet.CreatePayIntent("merchant_product", 75, "")
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := devnet.CreateInvoice(intent.ID, 24)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.AddRiskLabel("ynx_product", "reviewed", 100, "unit"); err != nil {
		t.Fatal(err)
	}
	evidence, err := devnet.EvidencePacket("ynx_product")
	if err != nil {
		t.Fatal(err)
	}
	source := "pragma solidity ^0.8.24; contract Persisted {}"
	contract, _, err := devnet.DeployContract("ynx_product", "Persisted", source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.VerifyContract(contract.Address, source); err != nil {
		t.Fatal(err)
	}

	restored, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.Invoice(invoice.ID); !ok {
		t.Fatal("expected restored invoice")
	}
	if _, ok := restored.StoredEvidencePacket(evidence.ID); !ok {
		t.Fatal("expected restored evidence packet")
	}
	restoredContract, ok := restored.Contract(contract.Address)
	if !ok {
		t.Fatal("expected restored contract")
	}
	if !restoredContract.Verified {
		t.Fatal("expected restored contract verification")
	}
}

func TestGovernanceRequestClassificationAppealTransparencyAndPersistence(t *testing.T) {
	dir := t.TempDir()
	devnet, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	illegal, err := devnet.CreateGovernanceRequest(GovernanceRequestInput{
		Requester:   "agency_case_1",
		Subject:     "ynx_subject",
		Action:      "freeze native YNXT without evidence",
		AssetType:   "YNXT",
		Scope:       "ynx_subject",
		Description: "Freeze native YNXT directly from protocol controls.",
	})
	if err != nil {
		t.Fatal(err)
	}
	if illegal.Classification != RequestIllegalOrAbusive || illegal.Status != "rejected" {
		t.Fatalf("expected illegal rejected request: %+v", illegal)
	}
	if !illegal.NativeYNXTProtected || illegal.TransparencyEntryID == "" {
		t.Fatalf("expected native YNXT protection and transparency entry: %+v", illegal)
	}
	report := devnet.TransparencyReport()
	if report.EntryCount != 1 || report.RejectedCount != 1 {
		t.Fatalf("expected rejected transparency entry: %+v", report)
	}

	review, err := devnet.CreateGovernanceRequest(GovernanceRequestInput{
		Requester:   "merchant_risk",
		Subject:     "ynx_subject",
		Action:      "risk label review",
		AssetType:   "stablecoin",
		Scope:       "single transfer",
		Description: "Review a scoped risk label with attached case evidence.",
		Evidence:    []string{"case:42", "tx:0xabc"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if review.Classification != RequestRequiresReview || !review.RequiresUserNotice {
		t.Fatalf("expected governance review classification: %+v", review)
	}
	appeal, err := devnet.CreateTrustAppeal(TrustAppealInput{RequestID: review.ID, Subject: "ynx_subject", Appellant: "ynx_subject", Reason: "label is a false positive", Evidence: []string{"wallet ownership proof"}})
	if err != nil {
		t.Fatal(err)
	}
	if appeal.Status != "SUBMITTED" || appeal.TransparencyEntryID == "" {
		t.Fatalf("expected open appeal with transparency entry: %+v", appeal)
	}
	resolved, err := devnet.ResolveTrustAppeal(appeal.ID, TrustAppealDecisionInput{Reviewer: "reviewer_1", Decision: "LABEL_REMOVED", ResolutionReason: "evidence proved false positive"})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Status != "LABEL_REMOVED" || resolved.Reviewer != "reviewer_1" || resolved.ResolutionReason == "" {
		t.Fatalf("expected resolved appeal: %+v", resolved)
	}
	labels := devnet.riskLabels["ynx_subject"]
	if len(labels) == 0 || labels[len(labels)-1].Label != "false-positive-corrected" || labels[len(labels)-1].RiskWeightBps != 0 {
		t.Fatalf("expected false-positive correction label: %+v", labels)
	}
	tracking, err := devnet.CreateTrackingPolicyReview(TrackingPolicyReviewInput{Requester: "merchant_risk", Subject: "ynx_subject", Purpose: "single transaction screening", QueryType: "trace", Scope: "single transfer", Description: "purpose limited check", Evidence: []string{"case:42"}, MinimumNecessary: true, ConfidenceBps: 7500, ExpiryHours: 24})
	if err != nil {
		t.Fatal(err)
	}
	if tracking.Classification != RequestValidUnderYNXChainLaw || tracking.Status != "logged" || tracking.LabelExpiresAt == nil || tracking.AppealPath == "" {
		t.Fatalf("expected valid tracking review: %+v", tracking)
	}
	overbroad, err := devnet.CreateTrackingPolicyReview(TrackingPolicyReviewInput{Requester: "merchant_risk", Subject: "ynx_subject", Purpose: "bulk profile all wallets", QueryType: "batch", Scope: "all wallets", Description: "mass tracking", Evidence: []string{"case:bulk"}, MinimumNecessary: false})
	if err != nil {
		t.Fatal(err)
	}
	if overbroad.Classification != RequestOverbroad || overbroad.Status != "rejected" {
		t.Fatalf("expected overbroad tracking rejection: %+v", overbroad)
	}

	restored, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.GovernanceRequest(illegal.ID); !ok {
		t.Fatal("expected restored governance request")
	}
	if _, ok := restored.TrustAppeal(appeal.ID); !ok {
		t.Fatal("expected restored trust appeal")
	}
	if restoredAppeal, ok := restored.TrustAppeal(appeal.ID); !ok || restoredAppeal.Status != "LABEL_REMOVED" {
		t.Fatalf("expected restored resolved appeal, got %+v ok=%v", restoredAppeal, ok)
	}
	if _, ok := restored.TrackingPolicyReview(tracking.ID); !ok {
		t.Fatal("expected restored tracking review")
	}
	report = restored.TransparencyReport()
	if report.AppealCount != 1 || report.ReviewCount == 0 {
		t.Fatalf("expected restored appeal and review counts: %+v", report)
	}
}
