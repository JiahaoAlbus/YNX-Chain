package datafabric

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type PostingSide string

const (
	Debit  PostingSide = "debit"
	Credit PostingSide = "credit"
)

type Posting struct {
	AccountID string      `json:"accountId"`
	Asset     string      `json:"asset"`
	Currency  string      `json:"currency"`
	Side      PostingSide `json:"side"`
	Amount    int64       `json:"amountMinor"`
	Category  string      `json:"category"`
}

type JournalEntry struct {
	EntryID         string      `json:"entryId"`
	CorrelationID   string      `json:"correlationId"`
	EventID         string      `json:"eventId"`
	EffectiveAt     time.Time   `json:"effectiveAt"`
	RecordedAt      time.Time   `json:"recordedAt"`
	Description     string      `json:"description"`
	CorrectionOf    string      `json:"correctionOf,omitempty"`
	RevenueBoundary string      `json:"revenueRecognitionBoundary"`
	Postings        []Posting   `json:"postings"`
	SourceCommit    string      `json:"sourceCommit"`
	SourceRelease   string      `json:"sourceRelease"`
	AuditID         string      `json:"auditId"`
	FeeConsent      *FeeConsent `json:"feeConsent,omitempty"`
}

type FeeConsent struct {
	ConsentID          string    `json:"consentId"`
	FeeScheduleVersion string    `json:"feeScheduleVersion"`
	AcceptedAt         time.Time `json:"acceptedAt"`
	MaximumAmountMinor int64     `json:"maximumAmountMinor"`
	Basis              string    `json:"basis"`
}

var ledgerCategories = map[string]bool{
	"user-charge": true, "provider-cost": true, "protocol-revenue": true,
	"gas": true, "venue-fee": true, "burn": true, "treasury": true,
	"insurance": true, "refund": true, "dispute-reserve": true,
	"merchant-net": true, "creator-net": true, "builder-net": true,
	"provider-net": true, "quant-compute": true, "quant-data": true,
	"quant-management-fee": true, "quant-performance-fee": true,
	"stablecoin-settlement": true, "bridge-settlement": true,
	"subscription": true, "compute-data-fee": true,
}

func (entry JournalEntry) Validate() error {
	if !idPattern.MatchString(entry.EntryID) || !idPattern.MatchString(entry.CorrelationID) || !idPattern.MatchString(entry.EventID) || !idPattern.MatchString(entry.AuditID) {
		return errors.New("journal identifiers are invalid")
	}
	if entry.CorrectionOf != "" && !idPattern.MatchString(entry.CorrectionOf) {
		return errors.New("correctionOf is invalid")
	}
	if entry.EffectiveAt.IsZero() || entry.RecordedAt.IsZero() || entry.EffectiveAt.Location() != time.UTC || entry.RecordedAt.Location() != time.UTC {
		return errors.New("journal timestamps must be UTC")
	}
	if strings.TrimSpace(entry.Description) == "" || strings.TrimSpace(entry.RevenueBoundary) == "" || !commitPattern.MatchString(entry.SourceCommit) || strings.TrimSpace(entry.SourceRelease) == "" {
		return errors.New("journal provenance and revenue boundary are required")
	}
	if len(entry.Postings) < 2 {
		return errors.New("journal entry requires at least two postings")
	}
	totals := map[string]int64{}
	var consentBoundDebits int64
	for i, posting := range entry.Postings {
		if !idPattern.MatchString(posting.AccountID) || posting.Asset == "" || posting.Currency == "" || posting.Amount <= 0 || !ledgerCategories[posting.Category] {
			return fmt.Errorf("posting %d is invalid", i)
		}
		key := posting.Asset + "\x00" + posting.Currency
		switch posting.Side {
		case Debit:
			totals[key] += posting.Amount
			if consentCategory(posting.Category) {
				consentBoundDebits += posting.Amount
			}
		case Credit:
			totals[key] -= posting.Amount
		default:
			return fmt.Errorf("posting %d side is invalid", i)
		}
	}
	if consentBoundDebits > 0 {
		if entry.FeeConsent == nil || !idPattern.MatchString(entry.FeeConsent.ConsentID) || entry.FeeConsent.FeeScheduleVersion == "" || entry.FeeConsent.Basis == "" || entry.FeeConsent.AcceptedAt.IsZero() || entry.FeeConsent.AcceptedAt.Location() != time.UTC || entry.FeeConsent.AcceptedAt.After(entry.RecordedAt) || entry.FeeConsent.MaximumAmountMinor < consentBoundDebits {
			return errors.New("user charge or fee requires prior bounded consent and fee schedule")
		}
	} else if entry.FeeConsent != nil {
		return errors.New("fee consent cannot be attached to an entry without a consent-bound debit")
	}
	for key, total := range totals {
		if total != 0 {
			return fmt.Errorf("journal is unbalanced for %q by %d minor units", key, total)
		}
	}
	return nil
}

func consentCategory(category string) bool {
	switch category {
	case "user-charge", "gas", "venue-fee", "quant-compute", "quant-data", "quant-management-fee", "quant-performance-fee", "subscription", "compute-data-fee":
		return true
	default:
		return false
	}
}

func (s *Store) PostJournal(entry JournalEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := entry.Validate(); err != nil {
		return err
	}
	eventFound := false
	userAccountPosted := false
	for _, event := range s.state.Events {
		if event.EventID == entry.EventID {
			if event.CorrelationID != entry.CorrelationID {
				return errors.New("journal correlation does not match its canonical event")
			}
			eventFound = true
			if entry.FeeConsent != nil {
				for _, posting := range entry.Postings {
					if posting.Side == Debit && consentCategory(posting.Category) && posting.AccountID == event.Actor.AccountID {
						userAccountPosted = true
					}
				}
			}
			break
		}
	}
	if !eventFound {
		return errors.New("journal references an unknown canonical event")
	}
	if entry.FeeConsent != nil && !userAccountPosted {
		return errors.New("consent-bound debit does not belong to the canonical event account")
	}
	correctionFound := entry.CorrectionOf == ""
	for _, existing := range s.state.Ledger {
		if existing.EntryID == entry.EntryID {
			return ErrDuplicate
		}
		if existing.EntryID == entry.CorrectionOf {
			correctionFound = true
		}
	}
	if !correctionFound {
		return errors.New("correction references an unknown journal entry")
	}
	next := cloneState(s.state)
	next.Ledger = append(next.Ledger, entry)
	return s.commit(next)
}

func (s *Store) Journal() []JournalEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]JournalEntry(nil), s.state.Ledger...)
}

func (s *Store) JournalEntry(id string) (JournalEntry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, entry := range s.state.Ledger {
		if entry.EntryID == id {
			return entry, true
		}
	}
	return JournalEntry{}, false
}

func (s *Store) VerifyLedger() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	seen := map[string]bool{}
	events := map[string]EventEnvelope{}
	for _, event := range s.state.Events {
		events[event.EventID] = event
	}
	for _, entry := range s.state.Ledger {
		if seen[entry.EntryID] {
			return fmt.Errorf("duplicate journal entry %s", entry.EntryID)
		}
		if err := entry.Validate(); err != nil {
			return fmt.Errorf("journal entry %s: %w", entry.EntryID, err)
		}
		event, exists := events[entry.EventID]
		if !exists || event.CorrelationID != entry.CorrelationID {
			return fmt.Errorf("journal entry %s is not linked to its canonical event", entry.EntryID)
		}
		if entry.CorrectionOf != "" && !seen[entry.CorrectionOf] {
			return fmt.Errorf("journal correction %s does not reference prior history", entry.EntryID)
		}
		seen[entry.EntryID] = true
	}
	return nil
}
