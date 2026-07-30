package datafabric

import (
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"
)

type SettlementObservation struct {
	Source       string         `json:"source"`
	ReferenceID  string         `json:"referenceId"`
	Asset        string         `json:"asset"`
	Currency     string         `json:"currency"`
	AmountMinor  int64          `json:"amountMinor"`
	ObservedAt   time.Time      `json:"observedAt"`
	Metadata     SourceMetadata `json:"metadata"`
	EvidenceHash string         `json:"evidenceHash"`
}

type ReconciliationFinding struct {
	Source        string `json:"source"`
	ReferenceID   string `json:"referenceId"`
	Asset         string `json:"asset"`
	Currency      string `json:"currency"`
	ExpectedMinor int64  `json:"expectedMinor"`
	ObservedMinor int64  `json:"observedMinor"`
	Difference    int64  `json:"differenceMinor"`
	Status        string `json:"status"`
	Failure       string `json:"failure,omitempty"`
}

type ReconciliationRun struct {
	RunID         string                  `json:"runId"`
	JournalEntry  string                  `json:"journalEntryId"`
	Product       string                  `json:"product"`
	StartedAt     time.Time               `json:"startedAt"`
	CompletedAt   time.Time               `json:"completedAt"`
	Status        string                  `json:"status"`
	Coverage      float64                 `json:"coverage"`
	Findings      []ReconciliationFinding `json:"findings"`
	AuditID       string                  `json:"auditId"`
	SourceCommit  string                  `json:"sourceCommit"`
	SourceRelease string                  `json:"sourceRelease"`
}

// ReconcileJournal compares authoritative ledger debits with independent
// observations. Missing/unavailable sources remain explicit findings and can
// never be reported as matched.
func (s *Store) ReconcileJournal(runID, entryID, auditID, sourceCommit, sourceRelease string, requiredSources []string, observations []SettlementObservation, now time.Time) (ReconciliationRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.state.Reconciliations {
		if existing.RunID == runID {
			return ReconciliationRun{}, ErrDuplicate
		}
	}
	var entry *JournalEntry
	product := ""
	for i := range s.state.Ledger {
		if s.state.Ledger[i].EntryID == entryID {
			copy := s.state.Ledger[i]
			entry = &copy
			break
		}
	}
	if entry == nil {
		return ReconciliationRun{}, osNotExist("journal entry")
	}
	for _, event := range s.state.Events {
		if event.EventID == entry.EventID {
			product = event.Product
			break
		}
	}
	if product == "" {
		return ReconciliationRun{}, errors.New("journal reconciliation event authority is missing")
	}
	run, err := BuildReconciliationRun(*entry, product, runID, auditID, sourceCommit, sourceRelease, requiredSources, observations, now)
	if err != nil {
		return ReconciliationRun{}, err
	}
	next := cloneState(s.state)
	next.Reconciliations = append(next.Reconciliations, run)
	if err := s.commit(next); err != nil {
		return ReconciliationRun{}, err
	}
	return run, nil
}

// BuildReconciliationRun is the shared deterministic reconciliation engine for
// file and PostgreSQL repositories. Persistence layers must separately enforce
// uniqueness and authoritative journal/event references.
func BuildReconciliationRun(entry JournalEntry, product, runID, auditID, sourceCommit, sourceRelease string, requiredSources []string, observations []SettlementObservation, now time.Time) (ReconciliationRun, error) {
	if !idPattern.MatchString(runID) || !idPattern.MatchString(entry.EntryID) || !idPattern.MatchString(auditID) || !commitPattern.MatchString(sourceCommit) || sourceRelease == "" || product == "" || now.IsZero() || now.Location() != time.UTC || len(requiredSources) == 0 {
		return ReconciliationRun{}, errors.New("reconciliation provenance is invalid")
	}
	expected := map[string]int64{}
	for _, posting := range entry.Postings {
		if posting.Side == Debit {
			expected[posting.Asset+"\x00"+posting.Currency] += posting.Amount
		}
	}
	bySource := map[string][]SettlementObservation{}
	required := map[string]bool{}
	for _, source := range requiredSources {
		if required[source] || !oneOf(source, "chain", "pay", "exchange", "dex", "quant", "provider") {
			return ReconciliationRun{}, errors.New("required reconciliation sources must be unique and supported")
		}
		required[source] = true
	}
	observationKeys := map[string]bool{}
	for _, observation := range observations {
		evidence, evidenceErr := hex.DecodeString(observation.EvidenceHash)
		key := observation.Source + "\x00" + observation.ReferenceID
		if observationKeys[key] || !oneOf(observation.Source, "chain", "pay", "exchange", "dex", "quant", "provider") || !idPattern.MatchString(observation.ReferenceID) || observation.Asset == "" || observation.Currency == "" || observation.ObservedAt.IsZero() || observation.ObservedAt.Location() != time.UTC || evidenceErr != nil || len(evidence) != 32 {
			return ReconciliationRun{}, errors.New("settlement observation is invalid")
		}
		observationKeys[key] = true
		if observation.Metadata.Source == "" || observation.Metadata.AsOf.IsZero() || observation.Metadata.AsOf.Location() != time.UTC || observation.Metadata.Version == "" || !oneOf(observation.Metadata.Status, "authoritative", "third-party", "estimated", "ai-inferred", "cached", "user-input", "unavailable") || (observation.Metadata.Status == "unavailable") != (observation.Metadata.Failure != "") || (observation.Metadata.Confidence != nil && (*observation.Metadata.Confidence < 0 || *observation.Metadata.Confidence > 1)) || (observation.Metadata.Coverage != nil && (*observation.Metadata.Coverage < 0 || *observation.Metadata.Coverage > 1)) {
			return ReconciliationRun{}, errors.New("settlement observation source metadata is incomplete")
		}
		bySource[observation.Source] = append(bySource[observation.Source], observation)
	}
	var findings []ReconciliationFinding
	matchedSources := 0
	for _, source := range requiredSources {
		items := bySource[source]
		if len(items) == 0 {
			findings = append(findings, ReconciliationFinding{Source: source, Status: "unavailable", Failure: "required source did not provide an observation"})
			continue
		}
		sourceMatched := true
		for _, item := range items {
			want := expected[item.Asset+"\x00"+item.Currency]
			finding := ReconciliationFinding{Source: source, ReferenceID: item.ReferenceID, Asset: item.Asset, Currency: item.Currency, ExpectedMinor: want, ObservedMinor: item.AmountMinor, Difference: item.AmountMinor - want, Status: "matched"}
			if item.Metadata.Status == "unavailable" {
				finding.Status, finding.Failure, sourceMatched = "unavailable", item.Metadata.Failure, false
			} else if finding.Difference != 0 {
				finding.Status, sourceMatched = "mismatch", false
			}
			findings = append(findings, finding)
		}
		if sourceMatched {
			matchedSources++
		}
	}
	status := "matched"
	for _, finding := range findings {
		if finding.Status == "mismatch" {
			status = "mismatch"
			break
		}
		if finding.Status == "unavailable" {
			status = "incomplete"
		}
	}
	coverage := 1.0
	if len(requiredSources) > 0 {
		coverage = float64(matchedSources) / float64(len(requiredSources))
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].Source < findings[j].Source })
	return ReconciliationRun{RunID: runID, JournalEntry: entry.EntryID, Product: product, StartedAt: now, CompletedAt: now, Status: status, Coverage: coverage, Findings: findings, AuditID: auditID, SourceCommit: sourceCommit, SourceRelease: sourceRelease}, nil
}

func (s *Store) Reconciliations() []ReconciliationRun {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]ReconciliationRun(nil), s.state.Reconciliations...)
}

type notExistError string

func (e notExistError) Error() string { return fmt.Sprintf("%s not found", string(e)) }
func osNotExist(subject string) error { return notExistError(subject) }
