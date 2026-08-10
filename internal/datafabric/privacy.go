package datafabric

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"
)

type SubjectExport struct {
	AccountID       string              `json:"accountId"`
	GeneratedAt     time.Time           `json:"generatedAt"`
	Source          SourceMetadata      `json:"source"`
	Events          []EventEnvelope     `json:"events"`
	Journal         []JournalEntry      `json:"journal"`
	Sagas           []SagaInstance      `json:"sagas"`
	Reconciliations []ReconciliationRun `json:"reconciliations"`
	RetentionNotice string              `json:"retentionNotice"`
}

type ErasureRecord struct {
	AccountPseudonym string    `json:"accountPseudonym"`
	AuditID          string    `json:"auditId"`
	RequestedAt      time.Time `json:"requestedAt"`
	Status           string    `json:"status"`
	Operational      uint64    `json:"operationalRecords"`
	Financial        uint64    `json:"financialRecordsRetained"`
	Audit            uint64    `json:"auditRecordsRetained"`
	LegalHold        uint64    `json:"legalHoldRecordsRetained"`
}

func (s *Store) ExportSubject(accountID, sourceVersion string, now time.Time) (SubjectExport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return BuildSubjectExport(accountID, sourceVersion, now, s.state.Events, s.state.Ledger, s.state.Sagas, s.state.Reconciliations)
}

// BuildSubjectExport deterministically filters authoritative records for one
// canonical account. It is shared by all persistence implementations.
func BuildSubjectExport(accountID, sourceVersion string, now time.Time, events []EventEnvelope, journal []JournalEntry, sagas []SagaInstance, reconciliations []ReconciliationRun) (SubjectExport, error) {
	if !idPattern.MatchString(accountID) || sourceVersion == "" || now.IsZero() || now.Location() != time.UTC {
		return SubjectExport{}, errors.New("subject export identity, version, and UTC time are required")
	}
	export := SubjectExport{AccountID: accountID, GeneratedAt: now, Source: SourceMetadata{Source: "ynx-data-fabric", AsOf: now, Version: sourceVersion, Status: "authoritative"}, Events: make([]EventEnvelope, 0), Journal: make([]JournalEntry, 0), Sagas: make([]SagaInstance, 0), Reconciliations: make([]ReconciliationRun, 0), RetentionNotice: "Authoritative financial, audit, dispute, legal-hold, and integrity records remain subject to their retention class."}
	correlations := map[string]bool{}
	journalIDs := map[string]bool{}
	for _, event := range events {
		if event.Actor.AccountID == accountID {
			export.Events = append(export.Events, event)
			correlations[event.CorrelationID] = true
		}
	}
	for _, entry := range journal {
		matches := false
		for _, posting := range entry.Postings {
			if posting.AccountID == accountID {
				matches = true
				break
			}
		}
		if matches || correlations[entry.CorrelationID] {
			export.Journal = append(export.Journal, entry)
			journalIDs[entry.EntryID] = true
		}
	}
	for _, saga := range sagas {
		if correlations[saga.CorrelationID] {
			export.Sagas = append(export.Sagas, saga)
		}
	}
	for _, run := range reconciliations {
		if journalIDs[run.JournalEntry] {
			export.Reconciliations = append(export.Reconciliations, run)
		}
	}
	return export, nil
}

func (s *Store) RecordErasure(accountID, auditID string, privacyKey []byte, now time.Time) (ErasureRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := BuildErasureRecord(accountID, auditID, privacyKey, now, s.state.Events)
	if err != nil {
		return ErasureRecord{}, err
	}
	pseudonym := record.AccountPseudonym
	if existing, exists := s.state.ErasureRequests[pseudonym]; exists {
		return existing, ErrDuplicate
	}
	next := cloneState(s.state)
	next.ErasureRequests[pseudonym] = record
	if err := s.commit(next); err != nil {
		return ErasureRecord{}, err
	}
	return record, nil
}

func BuildErasureRecord(accountID, auditID string, privacyKey []byte, now time.Time, events []EventEnvelope) (ErasureRecord, error) {
	if !idPattern.MatchString(accountID) || !idPattern.MatchString(auditID) || len(privacyKey) < 32 || now.IsZero() || now.Location() != time.UTC {
		return ErasureRecord{}, errors.New("erasure identity, audit ID, privacy key, and UTC time are required")
	}
	pseudonym := subjectPseudonym(accountID, privacyKey)
	record := ErasureRecord{AccountPseudonym: pseudonym, AuditID: auditID, RequestedAt: now, Status: "analytics-suppressed-authoritative-retention-applied"}
	for _, event := range events {
		if event.Actor.AccountID != accountID {
			continue
		}
		switch event.RetentionClass {
		case "financial-7y":
			record.Financial++
		case "audit-7y":
			record.Audit++
		case "legal-hold":
			record.LegalHold++
		default:
			record.Operational++
		}
	}
	return record, nil
}

func SubjectPseudonym(accountID string, key []byte) (string, error) {
	if !idPattern.MatchString(accountID) || len(key) < 32 {
		return "", errors.New("canonical account and privacy key are required")
	}
	return subjectPseudonym(accountID, key), nil
}

func (s *Store) SubjectSuppressed(accountID string, privacyKey []byte) bool {
	if len(privacyKey) < 32 {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, exists := s.state.ErasureRequests[subjectPseudonym(accountID, privacyKey)]
	return exists
}

func (s *Store) ErasureRecords() []ErasureRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]ErasureRecord, 0, len(s.state.ErasureRequests))
	for _, record := range s.state.ErasureRequests {
		records = append(records, record)
	}
	return records
}

func subjectPseudonym(accountID string, key []byte) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("ynx-data-fabric-subject-v1\x00" + accountID))
	return hex.EncodeToString(mac.Sum(nil))
}
