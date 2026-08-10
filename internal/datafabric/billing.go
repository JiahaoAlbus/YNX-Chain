package datafabric

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strings"
	"time"
)

var usageBillingEventTypes = map[string]string{
	"resource.usage.recorded": "resource",
	"cloud.usage.recorded":    "cloud",
	"ai.usage.recorded":       "ai",
}

var billingChargeCategories = map[string]bool{
	"user-charge": true, "subscription": true, "compute-data-fee": true,
	"quant-compute": true, "quant-data": true,
}

type BillingRatePlan struct {
	PlanID            string    `json:"planId"`
	Version           string    `json:"version"`
	Product           string    `json:"product"`
	Meter             string    `json:"meter"`
	Unit              string    `json:"unit"`
	UnitsPerBlock     int64     `json:"unitsPerBlock"`
	UserPriceMinor    int64     `json:"userPriceMinor"`
	ProviderCostMinor int64     `json:"providerCostMinor"`
	Asset             string    `json:"asset"`
	Currency          string    `json:"currency"`
	ChargeCategory    string    `json:"chargeCategory"`
	RevenueBoundary   string    `json:"revenueRecognitionBoundary"`
	EffectiveFrom     time.Time `json:"effectiveFrom"`
	EffectiveUntil    time.Time `json:"effectiveUntil,omitempty"`
	SourceCommit      string    `json:"sourceCommit"`
	SourceRelease     string    `json:"sourceRelease"`
	AuditID           string    `json:"auditId"`
}

func (p BillingRatePlan) Validate() error {
	if !idPattern.MatchString(p.PlanID) || !idPattern.MatchString(p.AuditID) || !idPattern.MatchString(p.Version) {
		return Reject(CodeBillingRatePlanInvalid, "Billing rate plan identifiers are invalid", map[string]string{"planId": p.PlanID, "version": p.Version})
	}
	if p.Product != "resource" && p.Product != "cloud" && p.Product != "ai" {
		return Reject(CodeBillingRatePlanInvalid, "Billing rate plan product is not usage-billable", map[string]string{"planId": p.PlanID, "product": p.Product})
	}
	if !slugPattern.MatchString(p.Meter) || !slugPattern.MatchString(p.Unit) || p.UnitsPerBlock <= 0 || p.UserPriceMinor < 0 || p.ProviderCostMinor < 0 || p.UserPriceMinor == 0 && p.ProviderCostMinor == 0 {
		return Reject(CodeBillingRatePlanInvalid, "Billing rate and meter values are invalid", map[string]string{"planId": p.PlanID})
	}
	if strings.TrimSpace(p.Asset) == "" || strings.TrimSpace(p.Currency) == "" || !billingChargeCategories[p.ChargeCategory] || strings.TrimSpace(p.RevenueBoundary) == "" {
		return Reject(CodeBillingRatePlanInvalid, "Billing accounting classification is invalid", map[string]string{"planId": p.PlanID})
	}
	if p.EffectiveFrom.IsZero() || p.EffectiveFrom.Location() != time.UTC || !p.EffectiveUntil.IsZero() && (p.EffectiveUntil.Location() != time.UTC || !p.EffectiveUntil.After(p.EffectiveFrom)) {
		return Reject(CodeBillingRatePlanInvalid, "Billing rate plan effective window is invalid", map[string]string{"planId": p.PlanID})
	}
	if !commitPattern.MatchString(p.SourceCommit) || strings.TrimSpace(p.SourceRelease) == "" {
		return Reject(CodeBillingRatePlanInvalid, "Billing rate plan provenance is invalid", map[string]string{"planId": p.PlanID})
	}
	return nil
}

type MeteredUsage struct {
	Meter      string    `json:"meter"`
	Unit       string    `json:"unit"`
	Quantity   int64     `json:"quantity"`
	UsageStart time.Time `json:"usageStart"`
	UsageEnd   time.Time `json:"usageEnd"`
}

type BillingSettlementRequest struct {
	SettlementID             string      `json:"settlementId"`
	UsageEventID             string      `json:"usageEventId"`
	RatePlanID               string      `json:"ratePlanId"`
	RatePlanVersion          string      `json:"ratePlanVersion"`
	JournalEntryID           string      `json:"journalEntryId"`
	ProviderAccountID        string      `json:"providerAccountId"`
	ProviderCostAccountID    string      `json:"providerCostAccountId"`
	ProtocolRevenueAccountID string      `json:"protocolRevenueAccountId"`
	RecordedAt               time.Time   `json:"recordedAt"`
	SourceCommit             string      `json:"sourceCommit"`
	SourceRelease            string      `json:"sourceRelease"`
	AuditID                  string      `json:"auditId"`
	FeeConsent               *FeeConsent `json:"feeConsent,omitempty"`
}

func (r BillingSettlementRequest) Validate() error {
	for _, value := range []string{r.SettlementID, r.UsageEventID, r.RatePlanID, r.RatePlanVersion, r.JournalEntryID, r.ProviderAccountID, r.ProviderCostAccountID, r.ProtocolRevenueAccountID, r.AuditID} {
		if !idPattern.MatchString(value) {
			return Reject(CodeBillingUsageInvalid, "Billing settlement identifiers are invalid", map[string]string{"settlementId": r.SettlementID})
		}
	}
	if r.RecordedAt.IsZero() || r.RecordedAt.Location() != time.UTC || !commitPattern.MatchString(r.SourceCommit) || strings.TrimSpace(r.SourceRelease) == "" {
		return Reject(CodeBillingUsageInvalid, "Billing settlement provenance or recordedAt is invalid", map[string]string{"settlementId": r.SettlementID})
	}
	if r.ProviderAccountID == r.ProviderCostAccountID || r.ProviderAccountID == r.ProtocolRevenueAccountID || r.ProviderCostAccountID == r.ProtocolRevenueAccountID {
		return Reject(CodeBillingUsageInvalid, "Billing provider and YNX accounting identities must be distinct", map[string]string{"settlementId": r.SettlementID})
	}
	return nil
}

type BillingSettlement struct {
	SettlementID      string    `json:"settlementId"`
	UsageEventID      string    `json:"usageEventId"`
	RatePlanID        string    `json:"ratePlanId"`
	RatePlanVersion   string    `json:"ratePlanVersion"`
	Product           string    `json:"product"`
	Meter             string    `json:"meter"`
	Unit              string    `json:"unit"`
	Quantity          int64     `json:"quantity"`
	BillableBlocks    int64     `json:"billableBlocks"`
	UserChargeMinor   int64     `json:"userChargeMinor"`
	ProviderCostMinor int64     `json:"providerCostMinor"`
	Asset             string    `json:"asset"`
	Currency          string    `json:"currency"`
	JournalEntryID    string    `json:"journalEntryId"`
	RecordedAt        time.Time `json:"recordedAt"`
	AuditID           string    `json:"auditId"`
	SourceCommit      string    `json:"sourceCommit"`
	SourceRelease     string    `json:"sourceRelease"`
	Status            string    `json:"status"`
}

func DecodeMeteredUsage(event EventEnvelope) (MeteredUsage, error) {
	product, supported := usageBillingEventTypes[event.EventType]
	if !supported || product != event.Product {
		return MeteredUsage{}, Reject(CodeBillingAuthorityMismatch, "Canonical event is not an owned usage event", map[string]string{"eventId": event.EventID, "eventType": event.EventType, "product": event.Product})
	}
	decoder := json.NewDecoder(bytes.NewReader(event.Payload))
	decoder.DisallowUnknownFields()
	var payload MeteredUsage
	if err := decoder.Decode(&payload); err != nil {
		return MeteredUsage{}, WrapReject(CodeBillingUsageInvalid, "Usage payload is not the canonical billing shape", err, map[string]string{"eventId": event.EventID})
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return MeteredUsage{}, Reject(CodeBillingUsageInvalid, "Usage payload contains multiple JSON values", map[string]string{"eventId": event.EventID})
	}
	if !slugPattern.MatchString(payload.Meter) || !slugPattern.MatchString(payload.Unit) || payload.Quantity <= 0 || payload.UsageStart.IsZero() || payload.UsageEnd.IsZero() || payload.UsageStart.Location() != time.UTC || payload.UsageEnd.Location() != time.UTC || !payload.UsageEnd.After(payload.UsageStart) || payload.UsageEnd.After(event.EffectiveAt) {
		return MeteredUsage{}, Reject(CodeBillingUsageInvalid, "Usage quantity, meter, unit, or time window is invalid", map[string]string{"eventId": event.EventID})
	}
	return payload, nil
}

func BuildBillingSettlement(plan BillingRatePlan, event EventEnvelope, request BillingSettlementRequest) (BillingSettlement, JournalEntry, error) {
	if err := plan.Validate(); err != nil {
		return BillingSettlement{}, JournalEntry{}, err
	}
	if err := request.Validate(); err != nil {
		return BillingSettlement{}, JournalEntry{}, err
	}
	usage, err := DecodeMeteredUsage(event)
	if err != nil {
		return BillingSettlement{}, JournalEntry{}, err
	}
	if request.RatePlanID != plan.PlanID || request.RatePlanVersion != plan.Version || event.Product != plan.Product || usage.Meter != plan.Meter || usage.Unit != plan.Unit || usage.UsageEnd.Before(plan.EffectiveFrom) || !plan.EffectiveUntil.IsZero() && !usage.UsageEnd.Before(plan.EffectiveUntil) || event.Actor.AccountID == "" || request.RecordedAt.Before(event.Timestamp) || request.RecordedAt.Before(usage.UsageEnd) || event.Actor.AccountID == request.ProviderAccountID || event.Actor.AccountID == request.ProviderCostAccountID || event.Actor.AccountID == request.ProtocolRevenueAccountID {
		return BillingSettlement{}, JournalEntry{}, Reject(CodeBillingAuthorityMismatch, "Usage event does not match the immutable rate plan authority", map[string]string{"eventId": event.EventID, "planId": plan.PlanID, "version": plan.Version})
	}
	blocks := (usage.Quantity-1)/plan.UnitsPerBlock + 1
	if blocks > math.MaxInt64/maxInt64(1, plan.UserPriceMinor) || blocks > math.MaxInt64/maxInt64(1, plan.ProviderCostMinor) {
		return BillingSettlement{}, JournalEntry{}, Reject(CodeBillingRatingOverflow, "Usage rating exceeds signed minor-unit capacity", map[string]string{"eventId": event.EventID, "planId": plan.PlanID})
	}
	userCharge := blocks * plan.UserPriceMinor
	providerCost := blocks * plan.ProviderCostMinor
	if userCharge > 0 && (request.FeeConsent == nil || request.FeeConsent.FeeScheduleVersion != plan.Version || request.FeeConsent.AcceptedAt.After(usage.UsageStart)) {
		return BillingSettlement{}, JournalEntry{}, Reject(CodeBillingAuthorityMismatch, "Usage charge lacks pre-usage consent for the immutable rate plan", map[string]string{"eventId": event.EventID, "planId": plan.PlanID, "version": plan.Version})
	}
	postings := make([]Posting, 0, 4)
	if userCharge > 0 {
		postings = append(postings,
			Posting{AccountID: event.Actor.AccountID, Asset: plan.Asset, Currency: plan.Currency, Side: Debit, Amount: userCharge, Category: plan.ChargeCategory},
			Posting{AccountID: request.ProtocolRevenueAccountID, Asset: plan.Asset, Currency: plan.Currency, Side: Credit, Amount: userCharge, Category: "protocol-revenue"},
		)
	}
	if providerCost > 0 {
		postings = append(postings,
			Posting{AccountID: request.ProviderCostAccountID, Asset: plan.Asset, Currency: plan.Currency, Side: Debit, Amount: providerCost, Category: "provider-cost"},
			Posting{AccountID: request.ProviderAccountID, Asset: plan.Asset, Currency: plan.Currency, Side: Credit, Amount: providerCost, Category: "provider-net"},
		)
	}
	entry := JournalEntry{
		EntryID: request.JournalEntryID, CorrelationID: event.CorrelationID, EventID: event.EventID,
		EffectiveAt: usage.UsageEnd, RecordedAt: request.RecordedAt,
		Description:     "Rated " + plan.Product + " usage for meter " + plan.Meter,
		RevenueBoundary: plan.RevenueBoundary, Postings: postings, SourceCommit: request.SourceCommit,
		SourceRelease: request.SourceRelease, AuditID: request.AuditID, FeeConsent: request.FeeConsent,
	}
	if err := entry.Validate(); err != nil {
		return BillingSettlement{}, JournalEntry{}, err
	}
	settlement := BillingSettlement{
		SettlementID: request.SettlementID, UsageEventID: event.EventID, RatePlanID: plan.PlanID,
		RatePlanVersion: plan.Version, Product: plan.Product, Meter: plan.Meter, Unit: plan.Unit,
		Quantity: usage.Quantity, BillableBlocks: blocks, UserChargeMinor: userCharge,
		ProviderCostMinor: providerCost, Asset: plan.Asset, Currency: plan.Currency,
		JournalEntryID: entry.EntryID, RecordedAt: request.RecordedAt, AuditID: request.AuditID,
		SourceCommit: request.SourceCommit, SourceRelease: request.SourceRelease, Status: "posted",
	}
	return settlement, entry, nil
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func AuditBillingRecords(events []EventEnvelope, journal []JournalEntry, plans []BillingRatePlan, settlements []BillingSettlement) error {
	eventByID := make(map[string]EventEnvelope, len(events))
	for _, event := range events {
		eventByID[event.EventID] = event
	}
	journalByID := make(map[string]JournalEntry, len(journal))
	for _, entry := range journal {
		journalByID[entry.EntryID] = entry
	}
	planByKey := make(map[string]BillingRatePlan, len(plans))
	for _, plan := range plans {
		if err := plan.Validate(); err != nil {
			return err
		}
		key := plan.PlanID + "\x00" + plan.Version
		if _, exists := planByKey[key]; exists {
			return errors.New("duplicate Billing rate plan version")
		}
		planByKey[key] = plan
	}
	settlementIDs := map[string]bool{}
	settledEvents := map[string]bool{}
	settledJournals := map[string]bool{}
	for _, settlement := range settlements {
		if settlementIDs[settlement.SettlementID] || settledEvents[settlement.UsageEventID] || settledJournals[settlement.JournalEntryID] || settlement.Status != "posted" {
			return errors.New("duplicate or invalid Billing settlement identity")
		}
		event, eventExists := eventByID[settlement.UsageEventID]
		plan, planExists := planByKey[settlement.RatePlanID+"\x00"+settlement.RatePlanVersion]
		entry, entryExists := journalByID[settlement.JournalEntryID]
		if !eventExists || !planExists || !entryExists {
			return errors.New("Billing settlement authority reference is missing")
		}
		usage, err := DecodeMeteredUsage(event)
		if err != nil {
			return err
		}
		blocks := (usage.Quantity-1)/plan.UnitsPerBlock + 1
		if blocks > math.MaxInt64/maxInt64(1, plan.UserPriceMinor) || blocks > math.MaxInt64/maxInt64(1, plan.ProviderCostMinor) {
			return errors.New("stored Billing settlement rating overflows")
		}
		userCharge, providerCost := blocks*plan.UserPriceMinor, blocks*plan.ProviderCostMinor
		if event.Product != plan.Product || usage.Meter != plan.Meter || usage.Unit != plan.Unit || usage.UsageEnd.Before(plan.EffectiveFrom) || !plan.EffectiveUntil.IsZero() && !usage.UsageEnd.Before(plan.EffectiveUntil) || settlement.Product != plan.Product || settlement.Meter != plan.Meter || settlement.Unit != plan.Unit || settlement.Quantity != usage.Quantity || settlement.BillableBlocks != blocks || settlement.UserChargeMinor != userCharge || settlement.ProviderCostMinor != providerCost || settlement.Asset != plan.Asset || settlement.Currency != plan.Currency || !settlement.RecordedAt.Equal(entry.RecordedAt) || settlement.AuditID != entry.AuditID || settlement.SourceCommit != entry.SourceCommit || settlement.SourceRelease != entry.SourceRelease || entry.EventID != event.EventID || entry.RevenueBoundary != plan.RevenueBoundary || userCharge > 0 && (entry.FeeConsent == nil || entry.FeeConsent.FeeScheduleVersion != plan.Version || entry.FeeConsent.AcceptedAt.After(usage.UsageStart)) {
			return errors.New("Billing settlement contradicts rate plan, usage, or Journal authority")
		}
		var userDebits, revenueCredits, costDebits, providerCredits int64
		for _, posting := range entry.Postings {
			if posting.Asset != plan.Asset || posting.Currency != plan.Currency {
				return errors.New("Billing Journal asset or currency differs from rate plan")
			}
			switch {
			case posting.Side == Debit && posting.Category == plan.ChargeCategory && posting.AccountID == event.Actor.AccountID:
				userDebits += posting.Amount
			case posting.Side == Credit && posting.Category == "protocol-revenue":
				revenueCredits += posting.Amount
			case posting.Side == Debit && posting.Category == "provider-cost":
				costDebits += posting.Amount
			case posting.Side == Credit && posting.Category == "provider-net":
				providerCredits += posting.Amount
			default:
				return errors.New("Billing Journal contains an unrecognized posting")
			}
		}
		if userDebits != userCharge || revenueCredits != userCharge || costDebits != providerCost || providerCredits != providerCost {
			return errors.New("Billing Journal amounts contradict rated usage")
		}
		settlementIDs[settlement.SettlementID], settledEvents[settlement.UsageEventID], settledJournals[settlement.JournalEntryID] = true, true, true
	}
	return nil
}
