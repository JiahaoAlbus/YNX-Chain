package datafabricpostgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

type sqlQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Store) Events(ctx context.Context) ([]datafabric.EventEnvelope, error) {
	return loadEvents(ctx, s.db, `SELECT canonical_envelope FROM ynx_fabric.events ORDER BY ingested_at,event_id`)
}

func loadEvents(ctx context.Context, queryer sqlQueryer, query string, arguments ...any) ([]datafabric.EventEnvelope, error) {
	rows, err := queryer.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []datafabric.EventEnvelope
	for rows.Next() {
		var encoded []byte
		if err := rows.Scan(&encoded); err != nil {
			return nil, err
		}
		event, err := decodeStoredEnvelope(encoded)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) Journal(ctx context.Context) ([]datafabric.JournalEntry, error) {
	return journalFromQueryer(ctx, s.db)
}

func journalFromQueryer(ctx context.Context, queryer sqlQueryer) ([]datafabric.JournalEntry, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT entry_id FROM ynx_fabric.journal_entries ORDER BY recorded_at,entry_id`)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	entries := make([]datafabric.JournalEntry, 0, len(ids))
	for _, id := range ids {
		entry, exists, err := loadJournalEntry(ctx, queryer, id)
		if err != nil {
			return nil, err
		}
		if exists {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func (s *Store) JournalEntry(ctx context.Context, id string) (datafabric.JournalEntry, bool, error) {
	return loadJournalEntry(ctx, s.db, id)
}

func loadJournalEntry(ctx context.Context, queryer sqlQueryer, id string) (datafabric.JournalEntry, bool, error) {
	var entry datafabric.JournalEntry
	var correction sql.NullString
	var consentID, schedule, basis sql.NullString
	var acceptedAt sql.NullTime
	var maximum sql.NullInt64
	err := queryer.QueryRowContext(ctx, `
SELECT entry_id,correlation_id,event_id,effective_at,recorded_at,description,correction_of,
 revenue_recognition_boundary,source_commit,source_release,audit_id,fee_consent_id,
 fee_schedule_version,fee_accepted_at,fee_maximum_amount_minor,fee_basis
FROM ynx_fabric.journal_entries WHERE entry_id=$1`, id).Scan(
		&entry.EntryID, &entry.CorrelationID, &entry.EventID, &entry.EffectiveAt, &entry.RecordedAt, &entry.Description,
		&correction, &entry.RevenueBoundary, &entry.SourceCommit, &entry.SourceRelease, &entry.AuditID,
		&consentID, &schedule, &acceptedAt, &maximum, &basis)
	if errors.Is(err, sql.ErrNoRows) {
		return datafabric.JournalEntry{}, false, nil
	}
	if err != nil {
		return datafabric.JournalEntry{}, false, err
	}
	entry.EffectiveAt = entry.EffectiveAt.UTC()
	entry.RecordedAt = entry.RecordedAt.UTC()
	if correction.Valid {
		entry.CorrectionOf = correction.String
	}
	if consentID.Valid {
		if !schedule.Valid || !acceptedAt.Valid || !maximum.Valid || !basis.Valid {
			return datafabric.JournalEntry{}, false, errors.New("stored fee consent is incomplete")
		}
		entry.FeeConsent = &datafabric.FeeConsent{ConsentID: consentID.String, FeeScheduleVersion: schedule.String, AcceptedAt: acceptedAt.Time.UTC(), MaximumAmountMinor: maximum.Int64, Basis: basis.String}
	}
	rows, err := queryer.QueryContext(ctx, `SELECT account_id,asset,currency,side,amount_minor,category FROM ynx_fabric.postings WHERE entry_id=$1 ORDER BY posting_id`, id)
	if err != nil {
		return datafabric.JournalEntry{}, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var posting datafabric.Posting
		if err := rows.Scan(&posting.AccountID, &posting.Asset, &posting.Currency, &posting.Side, &posting.Amount, &posting.Category); err != nil {
			return datafabric.JournalEntry{}, false, err
		}
		entry.Postings = append(entry.Postings, posting)
	}
	if err := rows.Err(); err != nil {
		return datafabric.JournalEntry{}, false, err
	}
	if err := entry.Validate(); err != nil {
		return datafabric.JournalEntry{}, false, fmt.Errorf("stored journal %s failed validation: %w", id, err)
	}
	return entry, true, nil
}
