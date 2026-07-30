package datafabric

import (
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
	"time"
)

func TestUsageBillingPostsGrossRevenueAndProviderCostAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	event := billingUsageEvent(t, "event.cloud.usage.billing.0001", 250)
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
	plan := billingRatePlan(event)
	if err := store.RegisterBillingRatePlan(plan); err != nil {
		t.Fatal(err)
	}
	request := billingSettlementRequest(event, plan)
	settlement, err := store.SettleUsage(request)
	if err != nil {
		t.Fatal(err)
	}
	if settlement.BillableBlocks != 3 || settlement.UserChargeMinor != 30 || settlement.ProviderCostMinor != 12 || settlement.Status != "posted" {
		t.Fatalf("usage rating is incorrect: %+v", settlement)
	}
	journal := store.Journal()
	if len(journal) != 1 || len(journal[0].Postings) != 4 || journal[0].EventID != event.EventID {
		t.Fatalf("Billing and Ledger were not committed together: %+v", journal)
	}
	if journal[0].Postings[0].AccountID != event.Actor.AccountID || journal[0].Postings[0].Category != "compute-data-fee" {
		t.Fatalf("user charge authority is invalid: %+v", journal[0].Postings)
	}
	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	persisted, exists := restarted.BillingSettlement(settlement.SettlementID)
	if !exists || persisted.JournalEntryID != journal[0].EntryID || len(restarted.BillingRatePlans()) != 1 {
		t.Fatalf("Billing settlement did not survive restart: %+v", persisted)
	}
	if err := restarted.AuditIntegrity(map[string][]byte{"key.billing.test.0001": testKey}); err != nil {
		t.Fatalf("Billing restore integrity failed: %v", err)
	}
	if _, err := restarted.SettleUsage(request); ErrorCodeOf(err) != CodeBillingAlreadySettled {
		t.Fatalf("usage event was billed twice: %v", err)
	}
}

func TestUsageBillingFailsClosedOnPlanConsentAndPayloadMismatch(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "store.json"))
	if err != nil {
		t.Fatal(err)
	}
	event := billingUsageEvent(t, "event.cloud.usage.billing.0002", 250)
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
	plan := billingRatePlan(event)
	if err := store.RegisterBillingRatePlan(plan); err != nil {
		t.Fatal(err)
	}
	if err := store.RegisterBillingRatePlan(plan); ErrorCodeOf(err) != CodeBillingRatePlanDuplicate {
		t.Fatalf("immutable rate plan version was overwritten: %v", err)
	}
	request := billingSettlementRequest(event, plan)
	request.FeeConsent.MaximumAmountMinor = 29
	if _, err := store.SettleUsage(request); err == nil {
		t.Fatal("usage charge above consent was accepted")
	}
	request = billingSettlementRequest(event, plan)
	request.FeeConsent.AcceptedAt = event.Timestamp.Add(-30 * time.Minute)
	if _, err := store.SettleUsage(request); ErrorCodeOf(err) != CodeBillingAuthorityMismatch {
		t.Fatalf("retroactive usage consent was accepted: %v", err)
	}
	request = billingSettlementRequest(event, plan)
	request.FeeConsent.FeeScheduleVersion = "rate-v0.legacy"
	if _, err := store.SettleUsage(request); ErrorCodeOf(err) != CodeBillingAuthorityMismatch {
		t.Fatalf("consent for another rate plan was accepted: %v", err)
	}
	request = billingSettlementRequest(event, plan)
	request.RatePlanVersion = "rate-v2.0001"
	if _, err := store.SettleUsage(request); ErrorCodeOf(err) != CodeBillingRatePlanNotFound {
		t.Fatalf("unknown rate plan was accepted: %v", err)
	}

	tampered := event
	tampered.EventID = "event.cloud.usage.billing.0003"
	tampered.Sequence = 2
	tampered.Payload = json.RawMessage(`{"meter":"compute","unit":"request","quantity":250,"usageStart":"2026-07-22T13:00:00Z","usageEnd":"2026-07-22T14:00:00Z","unrated":true}`)
	tampered.Timestamp = event.Timestamp.Add(time.Second)
	tampered.EffectiveAt = tampered.Timestamp
	tampered.Source.AsOf = tampered.Timestamp
	if err := tampered.Sign("key.billing.test.0001", testKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(tampered, testKey); err != nil {
		t.Fatal(err)
	}
	tamperedRequest := billingSettlementRequest(tampered, plan)
	if _, err := store.SettleUsage(tamperedRequest); ErrorCodeOf(err) != CodeBillingUsageInvalid {
		t.Fatalf("non-canonical usage payload was billed: %v", err)
	}
}

func TestUsageBillingRejectsMinorUnitOverflow(t *testing.T) {
	event := billingUsageEvent(t, "event.ai.usage.billing.0001", math.MaxInt64)
	event.Product = "ai"
	event.Service = "usage"
	event.EventType = "ai.usage.recorded"
	event.AggregateID = "usage.ai.billing.0001"
	event.Payload = json.RawMessage(`{"meter":"tokens","unit":"token","quantity":9223372036854775807,"usageStart":"2026-07-22T13:00:00Z","usageEnd":"2026-07-22T14:00:00Z"}`)
	if err := event.Sign("key.billing.test.0001", testKey); err != nil {
		t.Fatal(err)
	}
	plan := billingRatePlan(event)
	plan.Meter, plan.Unit, plan.UnitsPerBlock, plan.UserPriceMinor = "tokens", "token", 1, 2
	request := billingSettlementRequest(event, plan)
	if _, _, err := BuildBillingSettlement(plan, event, request); ErrorCodeOf(err) != CodeBillingRatingOverflow {
		t.Fatalf("minor-unit overflow was accepted: %v", err)
	}
}

func billingUsageEvent(t *testing.T, eventID string, quantity int64) EventEnvelope {
	t.Helper()
	usageStart := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	usageEnd := usageStart.Add(time.Hour)
	payload, err := json.Marshal(MeteredUsage{Meter: "compute", Unit: "request", Quantity: quantity, UsageStart: usageStart, UsageEnd: usageEnd})
	if err != nil {
		t.Fatal(err)
	}
	event := EventEnvelope{
		EventID: eventID, EventType: "cloud.usage.recorded", SchemaVersion: EnvelopeSchemaVersion,
		Product: "cloud", Service: "usage", AggregateID: "usage.cloud.billing.0001",
		Actor:         Actor{ActorID: "actor.billing.test.0001", AccountID: "account.billing.user.0001"},
		CorrelationID: "correlation.billing.test.0001", Sequence: 1, Timestamp: usageEnd,
		EffectiveAt: usageEnd, SourceCommit: "719e101", SourceRelease: "cloud-test",
		PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit." + eventID,
		Source:  SourceMetadata{Source: "cloud-meter", AsOf: usageEnd, Version: "1", Status: "authoritative"},
		Payload: payload,
	}
	if err := event.Sign("key.billing.test.0001", testKey); err != nil {
		t.Fatal(err)
	}
	return event
}

func billingRatePlan(event EventEnvelope) BillingRatePlan {
	return BillingRatePlan{
		PlanID: "rate-plan.billing.0001", Version: "rate-v1.0001", Product: event.Product,
		Meter: "compute", Unit: "request", UnitsPerBlock: 100, UserPriceMinor: 10, ProviderCostMinor: 4,
		Asset: "USD", Currency: "USD", ChargeCategory: "compute-data-fee",
		RevenueBoundary: "rated authoritative usage period ended", EffectiveFrom: event.EffectiveAt.Add(-24 * time.Hour),
		SourceCommit: "719e101", SourceRelease: "billing-plan-test", AuditID: "audit.billing.plan.0001",
	}
}

func billingSettlementRequest(event EventEnvelope, plan BillingRatePlan) BillingSettlementRequest {
	return BillingSettlementRequest{
		SettlementID: "billing.settlement.0001", UsageEventID: event.EventID, RatePlanID: plan.PlanID,
		RatePlanVersion: plan.Version, JournalEntryID: "journal.billing.0001",
		ProviderAccountID: "account.billing.provider.0001", ProviderCostAccountID: "account.billing.cost.0001",
		ProtocolRevenueAccountID: "account.billing.revenue.0001", RecordedAt: event.Timestamp.Add(time.Second),
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", AuditID: "audit.billing.settlement.0001",
		FeeConsent: &FeeConsent{ConsentID: "consent.billing.0001", FeeScheduleVersion: plan.Version, AcceptedAt: event.Timestamp.Add(-time.Hour), MaximumAmountMinor: 30, Basis: "metered usage price disclosed before usage"},
	}
}
