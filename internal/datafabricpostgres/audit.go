package datafabricpostgres

import (
	"context"
	"database/sql"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func (s *Store) AuditIntegrity(ctx context.Context, keys map[string][]byte) error {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	events, err := loadEvents(ctx, tx, `SELECT canonical_envelope FROM ynx_fabric.events ORDER BY ingested_at,event_id`)
	if err != nil {
		return err
	}
	outbox, err := loadOutbox(ctx, tx)
	if err != nil {
		return err
	}
	inbox, err := loadInbox(ctx, tx)
	if err != nil {
		return err
	}
	journal, err := journalFromQueryer(ctx, tx)
	if err != nil {
		return err
	}
	sagas, err := sagasFromQueryer(ctx, tx)
	if err != nil {
		return err
	}
	reconciliations, err := reconciliationsFromQueryer(ctx, tx)
	if err != nil {
		return err
	}
	erasures, err := erasuresFromQueryer(ctx, tx)
	if err != nil {
		return err
	}
	if err := datafabric.AuditRecords(keys, events, outbox, inbox, journal, sagas, reconciliations, erasures); err != nil {
		return err
	}
	var sequenceMismatches uint64
	if err := tx.QueryRowContext(ctx, `
SELECT count(*) FROM (
    SELECT COALESCE(s.product,e.product) AS product
    FROM ynx_fabric.aggregate_sequences s
    FULL JOIN (
        SELECT product,service,aggregate_id,max(sequence) AS last_sequence,count(*) AS event_count
        FROM ynx_fabric.events GROUP BY product,service,aggregate_id
    ) e USING (product,service,aggregate_id)
    WHERE s.last_sequence IS DISTINCT FROM e.last_sequence OR e.event_count IS DISTINCT FROM e.last_sequence
) mismatches`).Scan(&sequenceMismatches); err != nil {
		return err
	}
	if sequenceMismatches != 0 {
		return datafabric.ErrTampered
	}
	return tx.Commit()
}

func loadOutbox(ctx context.Context, queryer sqlQueryer) ([]datafabric.OutboxRecord, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT event_id,partition_key,attempt,available_at,published_at,COALESCE(last_failure,'') FROM ynx_fabric.outbox ORDER BY event_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []datafabric.OutboxRecord
	for rows.Next() {
		var record datafabric.OutboxRecord
		var published sql.NullTime
		if err := rows.Scan(&record.EventID, &record.PartitionKey, &record.Attempt, &record.AvailableAt, &published, &record.LastFailure); err != nil {
			return nil, err
		}
		record.AvailableAt = record.AvailableAt.UTC()
		if published.Valid {
			record.PublishedAt = published.Time.UTC()
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func loadInbox(ctx context.Context, queryer sqlQueryer) ([]datafabric.InboxRecord, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT consumer,event_id,processed_at,effect_hash FROM ynx_fabric.inbox ORDER BY consumer,event_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []datafabric.InboxRecord
	for rows.Next() {
		var record datafabric.InboxRecord
		if err := rows.Scan(&record.Consumer, &record.EventID, &record.ProcessedAt, &record.EffectHash); err != nil {
			return nil, err
		}
		record.ProcessedAt = record.ProcessedAt.UTC()
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *Store) Stats(ctx context.Context) (datafabric.StoreStats, error) {
	var stats datafabric.StoreStats
	err := s.db.QueryRowContext(ctx, `
SELECT
 (SELECT count(*) FROM ynx_fabric.events),
 (SELECT count(*) FROM ynx_fabric.outbox WHERE published_at IS NULL),
 COALESCE((SELECT EXTRACT(EPOCH FROM min(available_at)) FROM ynx_fabric.outbox WHERE published_at IS NULL),0),
 (SELECT count(*) FROM ynx_fabric.inbox),
 (SELECT count(*) FROM ynx_fabric.dead_letters WHERE requeued_at IS NULL),
 (SELECT count(*) FROM ynx_fabric.journal_entries),
 (SELECT count(*) FROM ynx_fabric.sagas WHERE status='running'),
 (SELECT count(*) FROM ynx_fabric.sagas WHERE status IN ('compensating','manual-recovery')),
 (SELECT count(*) FROM ynx_fabric.reconciliation_runs),
 (SELECT count(*) FROM ynx_fabric.reconciliation_runs WHERE status <> 'matched'),
 (SELECT count(*) FROM ynx_fabric.erasure_requests),
 (SELECT count(*) FROM ynx_analytics.event_facts)`).Scan(
		&stats.Events, &stats.OutboxPending, &stats.OutboxOldestUnix, &stats.InboxEffects, &stats.DeadLetters, &stats.JournalEntries,
		&stats.SagasRunning, &stats.SagasRecovery, &stats.Reconciliations, &stats.ReconciliationMismatches, &stats.ErasureRequests, &stats.AnalyticsFacts)
	return stats, err
}

func erasuresFromQueryer(ctx context.Context, queryer sqlQueryer) ([]datafabric.ErasureRecord, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT account_pseudonym,audit_id,requested_at,status,operational_records,financial_records_retained,audit_records_retained,legal_hold_records_retained FROM ynx_fabric.erasure_requests ORDER BY requested_at,account_pseudonym`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []datafabric.ErasureRecord
	for rows.Next() {
		var record datafabric.ErasureRecord
		if err := rows.Scan(&record.AccountPseudonym, &record.AuditID, &record.RequestedAt, &record.Status, &record.Operational, &record.Financial, &record.Audit, &record.LegalHold); err != nil {
			return nil, err
		}
		record.RequestedAt = record.RequestedAt.UTC()
		records = append(records, record)
	}
	return records, rows.Err()
}
