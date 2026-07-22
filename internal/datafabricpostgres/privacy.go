package datafabricpostgres

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func (s *Store) ExportSubject(ctx context.Context, accountID, sourceVersion string, now time.Time) (datafabric.SubjectExport, error) {
	// Validate before broad reads and then build from one repeatable snapshot.
	if _, err := datafabric.SubjectPseudonym(accountID, make([]byte, 32)); err != nil {
		return datafabric.SubjectExport{}, err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return datafabric.SubjectExport{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	events, err := loadEvents(ctx, tx, `SELECT canonical_envelope FROM ynx_fabric.events ORDER BY ingested_at,event_id`)
	if err != nil {
		return datafabric.SubjectExport{}, err
	}
	journal, err := journalFromQueryer(ctx, tx)
	if err != nil {
		return datafabric.SubjectExport{}, err
	}
	sagas, err := sagasFromQueryer(ctx, tx)
	if err != nil {
		return datafabric.SubjectExport{}, err
	}
	reconciliations, err := reconciliationsFromQueryer(ctx, tx)
	if err != nil {
		return datafabric.SubjectExport{}, err
	}
	export, err := datafabric.BuildSubjectExport(accountID, sourceVersion, now, events, journal, sagas, reconciliations)
	if err != nil {
		return datafabric.SubjectExport{}, err
	}
	if err := tx.Commit(); err != nil {
		return datafabric.SubjectExport{}, err
	}
	return export, nil
}

func (s *Store) RecordErasure(ctx context.Context, accountID, auditID string, privacyKey []byte, now time.Time) (datafabric.ErasureRecord, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return datafabric.ErasureRecord{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	events, err := loadEvents(ctx, tx, `SELECT canonical_envelope FROM ynx_fabric.events WHERE account_id=$1 ORDER BY ingested_at,event_id`, accountID)
	if err != nil {
		return datafabric.ErasureRecord{}, err
	}
	record, err := datafabric.BuildErasureRecord(accountID, auditID, privacyKey, now, events)
	if err != nil {
		return datafabric.ErasureRecord{}, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.erasure_requests(account_pseudonym,audit_id,requested_at,status,operational_records,financial_records_retained,audit_records_retained,legal_hold_records_retained) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (account_pseudonym) DO NOTHING`, record.AccountPseudonym, record.AuditID, record.RequestedAt, record.Status, record.Operational, record.Financial, record.Audit, record.LegalHold)
	if err != nil {
		return datafabric.ErasureRecord{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return datafabric.ErasureRecord{}, err
	}
	if count == 0 {
		existing, exists, err := erasureRecord(ctx, tx, record.AccountPseudonym)
		if err != nil {
			return datafabric.ErasureRecord{}, err
		}
		if !exists {
			return datafabric.ErasureRecord{}, errors.New("erasure conflict exists but record is unreadable")
		}
		return existing, datafabric.ErrDuplicate
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM ynx_analytics.event_facts WHERE account_pseudonym=$1`, record.AccountPseudonym); err != nil {
		return datafabric.ErasureRecord{}, errors.New("delete subject analytics projection")
	}
	if err := tx.Commit(); err != nil {
		return datafabric.ErasureRecord{}, err
	}
	return record, nil
}

func (s *Store) SubjectSuppressed(ctx context.Context, accountID string, privacyKey []byte) (bool, error) {
	pseudonym, err := datafabric.SubjectPseudonym(accountID, privacyKey)
	if err != nil {
		return false, err
	}
	var exists bool
	err = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM ynx_fabric.erasure_requests WHERE account_pseudonym=$1)`, pseudonym).Scan(&exists)
	return exists, err
}

func (s *Store) ErasureRecords(ctx context.Context) ([]datafabric.ErasureRecord, error) {
	return erasuresFromQueryer(ctx, s.db)
}

func erasureRecord(ctx context.Context, queryer sqlQueryer, pseudonym string) (datafabric.ErasureRecord, bool, error) {
	var record datafabric.ErasureRecord
	err := queryer.QueryRowContext(ctx, `SELECT account_pseudonym,audit_id,requested_at,status,operational_records,financial_records_retained,audit_records_retained,legal_hold_records_retained FROM ynx_fabric.erasure_requests WHERE account_pseudonym=$1`, pseudonym).Scan(&record.AccountPseudonym, &record.AuditID, &record.RequestedAt, &record.Status, &record.Operational, &record.Financial, &record.Audit, &record.LegalHold)
	if errors.Is(err, sql.ErrNoRows) {
		return datafabric.ErasureRecord{}, false, nil
	}
	if err == nil {
		record.RequestedAt = record.RequestedAt.UTC()
	}
	return record, err == nil, err
}
