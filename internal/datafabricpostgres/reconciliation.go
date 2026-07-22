package datafabricpostgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/lib/pq"
)

func (s *Store) ReconcileJournal(ctx context.Context, runID, entryID, auditID, sourceCommit, sourceRelease string, requiredSources []string, observations []datafabric.SettlementObservation, now time.Time) (datafabric.ReconciliationRun, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return datafabric.ReconciliationRun{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	entry, exists, err := loadJournalEntry(ctx, tx, entryID)
	if err != nil {
		return datafabric.ReconciliationRun{}, err
	}
	if !exists {
		return datafabric.ReconciliationRun{}, sql.ErrNoRows
	}
	var product string
	if err := tx.QueryRowContext(ctx, `SELECT product FROM ynx_fabric.events WHERE event_id=$1`, entry.EventID).Scan(&product); err != nil {
		return datafabric.ReconciliationRun{}, errors.New("journal reconciliation event authority is missing")
	}
	run, err := datafabric.BuildReconciliationRun(entry, product, runID, auditID, sourceCommit, sourceRelease, requiredSources, observations, now)
	if err != nil {
		return datafabric.ReconciliationRun{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ynx_fabric.reconciliation_runs(run_id,journal_entry_id,product,started_at,completed_at,status,coverage,audit_id,source_commit,source_release) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, run.RunID, run.JournalEntry, run.Product, run.StartedAt, run.CompletedAt, run.Status, run.Coverage, run.AuditID, run.SourceCommit, run.SourceRelease)
	if err != nil {
		return datafabric.ReconciliationRun{}, mapReconciliationError(err)
	}
	for index, finding := range run.Findings {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.reconciliation_findings(run_id,finding_index,source,reference_id,asset,currency,expected_minor,observed_minor,difference_minor,status,failure) VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7,$8,$9,$10,NULLIF($11,''))`, run.RunID, index, finding.Source, finding.ReferenceID, finding.Asset, finding.Currency, finding.ExpectedMinor, finding.ObservedMinor, finding.Difference, finding.Status, finding.Failure); err != nil {
			return datafabric.ReconciliationRun{}, mapReconciliationError(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return datafabric.ReconciliationRun{}, mapReconciliationError(err)
	}
	return run, nil
}

func mapReconciliationError(err error) error {
	var pqError *pq.Error
	if errors.As(err, &pqError) && pqError.Code == "23505" {
		return datafabric.ErrDuplicate
	}
	return fmt.Errorf("write reconciliation: %w", err)
}

func (s *Store) Reconciliations(ctx context.Context) ([]datafabric.ReconciliationRun, error) {
	return reconciliationsFromQueryer(ctx, s.db)
}

func reconciliationsFromQueryer(ctx context.Context, queryer sqlQueryer) ([]datafabric.ReconciliationRun, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT run_id,journal_entry_id,product,started_at,completed_at,status,coverage,audit_id,source_commit,source_release FROM ynx_fabric.reconciliation_runs ORDER BY completed_at,run_id`)
	if err != nil {
		return nil, err
	}
	var runs []datafabric.ReconciliationRun
	for rows.Next() {
		var run datafabric.ReconciliationRun
		if err := rows.Scan(&run.RunID, &run.JournalEntry, &run.Product, &run.StartedAt, &run.CompletedAt, &run.Status, &run.Coverage, &run.AuditID, &run.SourceCommit, &run.SourceRelease); err != nil {
			return nil, err
		}
		run.StartedAt = run.StartedAt.UTC()
		run.CompletedAt = run.CompletedAt.UTC()
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range runs {
		findings, err := reconciliationFindings(ctx, queryer, runs[index].RunID)
		if err != nil {
			return nil, err
		}
		runs[index].Findings = findings
	}
	return runs, nil
}

func reconciliationFindings(ctx context.Context, queryer sqlQueryer, runID string) ([]datafabric.ReconciliationFinding, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT source,COALESCE(reference_id,''),COALESCE(asset,''),COALESCE(currency,''),expected_minor,observed_minor,difference_minor,status,COALESCE(failure,'') FROM ynx_fabric.reconciliation_findings WHERE run_id=$1 ORDER BY finding_index`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var findings []datafabric.ReconciliationFinding
	for rows.Next() {
		var finding datafabric.ReconciliationFinding
		if err := rows.Scan(&finding.Source, &finding.ReferenceID, &finding.Asset, &finding.Currency, &finding.ExpectedMinor, &finding.ObservedMinor, &finding.Difference, &finding.Status, &finding.Failure); err != nil {
			return nil, err
		}
		findings = append(findings, finding)
	}
	return findings, rows.Err()
}
