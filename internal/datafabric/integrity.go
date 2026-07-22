package datafabric

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// AuditIntegrity is intended for cold start, restore drills, and operator
// verification. It checks signatures, aggregate ordering, transport indexes,
// the ledger, sagas, and reconciliation references without mutating state.
func (s *Store) AuditIntegrity(keys map[string][]byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	inbox := make([]InboxRecord, 0, len(s.state.Inbox))
	for _, record := range s.state.Inbox {
		inbox = append(inbox, record)
	}
	privacy := make([]ErasureRecord, 0, len(s.state.ErasureRequests))
	for _, record := range s.state.ErasureRequests {
		privacy = append(privacy, record)
	}
	return AuditRecords(keys, s.state.Events, s.state.Outbox, inbox, s.state.Ledger, s.state.Sagas, s.state.Reconciliations, privacy)
}

// AuditRecords is the persistence-independent cold-start/restore integrity
// verifier used by both local and PostgreSQL repositories.
func AuditRecords(keys map[string][]byte, eventRecords []EventEnvelope, outboxRecords []OutboxRecord, inboxRecords []InboxRecord, journal []JournalEntry, sagas []SagaInstance, reconciliations []ReconciliationRun, erasures []ErasureRecord) error {
	events := map[string]EventEnvelope{}
	sequences := map[string]uint64{}
	for _, event := range eventRecords {
		if _, duplicate := events[event.EventID]; duplicate {
			return fmt.Errorf("duplicate event id %s", event.EventID)
		}
		key, exists := keys[event.Integrity.KeyID]
		if !exists {
			return fmt.Errorf("missing verification key %s", event.Integrity.KeyID)
		}
		if err := event.Verify(key); err != nil {
			return fmt.Errorf("event %s: %w", event.EventID, err)
		}
		aggregate := event.Product + "\x00" + event.Service + "\x00" + event.AggregateID
		if event.Sequence != sequences[aggregate]+1 {
			return fmt.Errorf("event %s breaks aggregate sequence", event.EventID)
		}
		sequences[aggregate] = event.Sequence
		events[event.EventID] = event
	}
	outbox := map[string]bool{}
	for _, record := range outboxRecords {
		event, exists := events[record.EventID]
		if !exists {
			return fmt.Errorf("outbox references missing event %s", record.EventID)
		}
		if record.PartitionKey != event.PartitionKey() {
			return fmt.Errorf("outbox partition key does not match event %s", record.EventID)
		}
		if record.AvailableAt.IsZero() || record.AvailableAt.Location() != time.UTC || (!record.PublishedAt.IsZero() && record.PublishedAt.Location() != time.UTC) {
			return fmt.Errorf("outbox timestamps are invalid for event %s", record.EventID)
		}
		if outbox[record.EventID] {
			return fmt.Errorf("duplicate outbox record for %s", record.EventID)
		}
		outbox[record.EventID] = true
	}
	for eventID := range events {
		if !outbox[eventID] {
			return fmt.Errorf("event %s has no transactional outbox record", eventID)
		}
	}
	inboxKeys := map[string]bool{}
	for _, record := range inboxRecords {
		key := record.Consumer + ":" + record.EventID
		if inboxKeys[key] || record.Consumer == "" || record.EffectHash == "" || record.ProcessedAt.IsZero() || record.ProcessedAt.Location() != time.UTC {
			return errors.New("consumer inbox key or effect is invalid")
		}
		inboxKeys[key] = true
		if _, exists := events[record.EventID]; !exists {
			return fmt.Errorf("consumer inbox references missing event %s", record.EventID)
		}
	}
	journalByID := map[string]JournalEntry{}
	for _, entry := range journal {
		if _, duplicate := journalByID[entry.EntryID]; duplicate {
			return fmt.Errorf("duplicate journal entry %s", entry.EntryID)
		}
		if err := entry.Validate(); err != nil {
			return fmt.Errorf("journal entry %s: %w", entry.EntryID, err)
		}
		event, exists := events[entry.EventID]
		if !exists || event.CorrelationID != entry.CorrelationID {
			return fmt.Errorf("journal entry %s is not linked to its canonical event", entry.EntryID)
		}
		journalByID[entry.EntryID] = entry
	}
	for _, entry := range journal {
		if entry.CorrectionOf == "" {
			continue
		}
		prior, exists := journalByID[entry.CorrectionOf]
		if !exists || prior.RecordedAt.After(entry.RecordedAt) {
			return fmt.Errorf("journal correction %s does not reference prior history", entry.EntryID)
		}
		seen := map[string]bool{entry.EntryID: true}
		cursor := prior
		for cursor.CorrectionOf != "" {
			if seen[cursor.EntryID] {
				return fmt.Errorf("journal correction cycle at %s", entry.EntryID)
			}
			seen[cursor.EntryID] = true
			next, exists := journalByID[cursor.CorrectionOf]
			if !exists {
				return fmt.Errorf("journal correction chain is missing %s", cursor.CorrectionOf)
			}
			cursor = next
		}
	}
	seenSagas := map[string]bool{}
	for _, instance := range sagas {
		if seenSagas[instance.SagaID] {
			return fmt.Errorf("duplicate saga %s", instance.SagaID)
		}
		if err := validateSaga(instance); err != nil {
			return err
		}
		seenSagas[instance.SagaID] = true
	}
	seenRuns := map[string]bool{}
	for _, run := range reconciliations {
		if seenRuns[run.RunID] || journalByID[run.JournalEntry].EntryID == "" || run.Product == "" || run.Coverage < 0 || run.Coverage > 1 {
			return fmt.Errorf("reconciliation record %s is invalid", run.RunID)
		}
		seenRuns[run.RunID] = true
	}
	seenPseudonyms := map[string]bool{}
	for _, record := range erasures {
		pseudonym := record.AccountPseudonym
		decoded, err := hex.DecodeString(pseudonym)
		if seenPseudonyms[pseudonym] || err != nil || len(decoded) != sha256.Size || !idPattern.MatchString(record.AuditID) || record.RequestedAt.IsZero() || record.RequestedAt.Location() != time.UTC || record.Status != "analytics-suppressed-authoritative-retention-applied" {
			return errors.New("privacy erasure record is invalid")
		}
		seenPseudonyms[pseudonym] = true
	}
	return nil
}
