package datafabricpostgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

type redeliveryQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (s *Store) PreviewRedelivery(ctx context.Context, mode datafabric.RedeliveryMode, scope datafabric.RedeliveryScope, at time.Time) (datafabric.RedeliveryPreview, error) {
	if s == nil || s.db == nil {
		return datafabric.RedeliveryPreview{}, errors.New("PostgreSQL store is unavailable")
	}
	return queryRedeliveryPreview(ctx, s.db, mode, scope, at, false)
}

func (s *Store) ExecuteRedelivery(ctx context.Context, command datafabric.RedeliveryCommand, at time.Time) (datafabric.RedeliveryRun, error) {
	if s == nil || s.db == nil {
		return datafabric.RedeliveryRun{}, errors.New("PostgreSQL store is unavailable")
	}
	if err := command.Validate(); err != nil {
		return datafabric.RedeliveryRun{}, err
	}
	if at.IsZero() || at.Location() != time.UTC {
		return datafabric.RedeliveryRun{}, errors.New("redelivery execution time must be UTC")
	}
	requestHash, err := datafabric.RedeliveryRequestHash(command)
	if err != nil {
		return datafabric.RedeliveryRun{}, err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return datafabric.RedeliveryRun{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	if existing, found, err := readRedeliveryRun(ctx, tx, command.IdempotencyKey); err != nil {
		return datafabric.RedeliveryRun{}, err
	} else if found {
		if existing.RequestHash != requestHash {
			return datafabric.RedeliveryRun{}, datafabric.Reject(datafabric.CodeRedeliveryIdempotencyConflict, "idempotency key was already used for a different redelivery command", map[string]string{"idempotencyKey": command.IdempotencyKey, "runId": existing.RunID})
		}
		return existing, nil
	}
	preview, err := queryRedeliveryPreview(ctx, tx, command.Mode, command.Scope, at, true)
	if err != nil {
		return datafabric.RedeliveryRun{}, err
	}
	if preview.ScopeHash != command.PreviewHash {
		return datafabric.RedeliveryRun{}, datafabric.Reject(datafabric.CodeRedeliveryPreviewStale, "redelivery preview no longer matches authoritative delivery state", map[string]string{"expectedPreviewHash": preview.ScopeHash, "providedPreviewHash": command.PreviewHash})
	}
	if preview.CandidateCount == 0 {
		return datafabric.RedeliveryRun{}, datafabric.Reject(datafabric.CodeRedeliveryNoCandidates, "redelivery scope has no eligible canonical events", map[string]string{"previewHash": preview.ScopeHash})
	}
	run := datafabric.RedeliveryRun{
		RunID: datafabric.RedeliveryRunID(command.IdempotencyKey), RequestID: command.RequestID, IdempotencyKey: command.IdempotencyKey,
		RequestHash: requestHash, Mode: command.Mode, Scope: command.Scope, PreviewHash: command.PreviewHash,
		Reason: command.Reason, ApprovalID: command.ApprovalID, ApprovalStatus: command.ApprovalStatus,
		AuditID: command.AuditID, RequestedBy: command.RequestedBy, ControlVersion: command.ControlVersion,
		SourceCommit: command.SourceCommit, SourceRelease: command.SourceRelease,
		Status: "completed", CandidateCount: preview.CandidateCount, StartedAt: at, CompletedAt: at,
	}
	actions := make([]string, 0, len(preview.Candidates))
	for _, candidate := range preview.Candidates {
		result, err := tx.ExecContext(ctx, `UPDATE ynx_fabric.outbox SET attempt=0, available_at=$2, published_at=NULL, last_failure=NULL, lease_owner=NULL, lease_until=NULL WHERE event_id=$1 AND (published_at IS NOT NULL OR EXISTS (SELECT 1 FROM ynx_fabric.dead_letters d WHERE d.event_id=$1 AND d.consumer='' AND d.requeued_at IS NULL))`, candidate.EventID, at)
		if err != nil {
			return datafabric.RedeliveryRun{}, fmt.Errorf("requeue transactional Outbox record: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return datafabric.RedeliveryRun{}, err
		}
		action := "skipped-pending"
		if affected == 1 {
			run.EnqueuedCount++
			run.EventIDs = append(run.EventIDs, candidate.EventID)
			action = "enqueued"
			if _, err := tx.ExecContext(ctx, `UPDATE ynx_fabric.dead_letters SET requeued_at=$2, requeue_audit_id=$3 WHERE event_id=$1 AND consumer='' AND requeued_at IS NULL`, candidate.EventID, at, command.AuditID); err != nil {
				return datafabric.RedeliveryRun{}, fmt.Errorf("mark Dead Letter replay audit: %w", err)
			}
		} else {
			run.SkippedPending++
		}
		actions = append(actions, action)
	}
	scopeJSON, err := json.Marshal(command.Scope)
	if err != nil {
		return datafabric.RedeliveryRun{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.redelivery_runs(run_id,request_id,idempotency_key,request_hash,mode,product,scope,preview_hash,reason,approval_id,approval_status,confirmed,audit_id,requested_by,control_version,source_commit,source_release,status,candidate_count,enqueued_count,skipped_pending,started_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
		run.RunID, run.RequestID, run.IdempotencyKey, run.RequestHash, string(run.Mode), run.Scope.Product, scopeJSON,
		run.PreviewHash, run.Reason, run.ApprovalID, run.ApprovalStatus, command.Confirmed, run.AuditID, run.RequestedBy,
		run.ControlVersion, run.SourceCommit, run.SourceRelease, run.Status, run.CandidateCount, run.EnqueuedCount,
		run.SkippedPending, run.StartedAt, run.CompletedAt); err != nil {
		return datafabric.RedeliveryRun{}, fmt.Errorf("persist redelivery run: %w", err)
	}
	for index, candidate := range preview.Candidates {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.redelivery_run_events(run_id,event_id,ordinal,action) VALUES($1,$2,$3,$4)`, run.RunID, candidate.EventID, index, actions[index]); err != nil {
			return datafabric.RedeliveryRun{}, fmt.Errorf("persist redelivery run event: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return datafabric.RedeliveryRun{}, err
	}
	return run, nil
}

func queryRedeliveryPreview(ctx context.Context, queryer redeliveryQueryer, mode datafabric.RedeliveryMode, scope datafabric.RedeliveryScope, at time.Time, lockOutbox bool) (datafabric.RedeliveryPreview, error) {
	if mode != datafabric.RedeliveryReplay && mode != datafabric.RedeliveryBackfill {
		return datafabric.RedeliveryPreview{}, errors.New("redelivery mode is invalid")
	}
	if err := scope.Validate(); err != nil {
		return datafabric.RedeliveryPreview{}, err
	}
	if at.IsZero() || at.Location() != time.UTC {
		return datafabric.RedeliveryPreview{}, errors.New("redelivery preview time must be UTC")
	}
	query := `
SELECT e.event_id,e.event_type,e.schema_version,e.aggregate_type,e.aggregate_id,e.sequence,e.occurred_at,e.integrity_digest,
       CASE WHEN EXISTS (SELECT 1 FROM ynx_fabric.dead_letters d WHERE d.event_id=e.event_id AND d.consumer='' AND d.requeued_at IS NULL) THEN 'dead-letter'
            WHEN o.published_at IS NULL THEN 'pending'
            ELSE 'published' END AS delivery_status
FROM ynx_fabric.events e
JOIN ynx_fabric.outbox o ON o.event_id=e.event_id
WHERE e.product=$1
  AND ($2='' OR e.event_type=$2)
  AND ($3='' OR e.aggregate_type=$3)
  AND ($4='' OR e.aggregate_id=$4)
  AND ($5::bigint=0 OR e.sequence >= $5::bigint)
  AND ($6::bigint=0 OR e.sequence <= $6::bigint)
  AND ($7::timestamptz IS NULL OR e.occurred_at >= $7::timestamptz)
  AND ($8::timestamptz IS NULL OR e.occurred_at <= $8::timestamptz)
  AND ($9 <> 'replay' OR o.published_at IS NOT NULL OR EXISTS (SELECT 1 FROM ynx_fabric.dead_letters d WHERE d.event_id=e.event_id AND d.consumer='' AND d.requeued_at IS NULL))
ORDER BY e.occurred_at,e.event_id
LIMIT $10`
	if lockOutbox {
		query += ` FOR UPDATE OF o`
	}
	var fromTime, toTime any
	if scope.OccurredFrom != nil {
		fromTime = *scope.OccurredFrom
	}
	if scope.OccurredTo != nil {
		toTime = *scope.OccurredTo
	}
	rows, err := queryer.QueryContext(ctx, query, scope.Product, scope.EventType, scope.AggregateType, scope.AggregateID, scope.FromSequence, scope.ToSequence, fromTime, toTime, string(mode), scope.Limit+1)
	if err != nil {
		return datafabric.RedeliveryPreview{}, err
	}
	defer rows.Close()
	candidates := make([]datafabric.RedeliveryCandidate, 0, scope.Limit+1)
	for rows.Next() {
		var candidate datafabric.RedeliveryCandidate
		var sequence int64
		if err := rows.Scan(&candidate.EventID, &candidate.EventType, &candidate.SchemaVersion, &candidate.AggregateType, &candidate.AggregateID, &sequence, &candidate.OccurredAt, &candidate.IntegrityHash, &candidate.DeliveryStatus); err != nil {
			return datafabric.RedeliveryPreview{}, err
		}
		if sequence < 0 {
			return datafabric.RedeliveryPreview{}, errors.New("redelivery candidate sequence is negative")
		}
		candidate.Sequence = uint64(sequence)
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return datafabric.RedeliveryPreview{}, err
	}
	truncated := len(candidates) > scope.Limit
	if truncated {
		candidates = candidates[:scope.Limit]
	}
	return datafabric.FinalizeRedeliveryPreview(mode, scope, candidates, truncated, at)
}

func readRedeliveryRun(ctx context.Context, tx *sql.Tx, idempotencyKey string) (datafabric.RedeliveryRun, bool, error) {
	var run datafabric.RedeliveryRun
	var mode string
	var scopeJSON []byte
	err := tx.QueryRowContext(ctx, `SELECT run_id,request_id,idempotency_key,request_hash,mode,scope,preview_hash,reason,approval_id,approval_status,audit_id,requested_by,control_version,source_commit,source_release,status,candidate_count,enqueued_count,skipped_pending,started_at,completed_at FROM ynx_fabric.redelivery_runs WHERE idempotency_key=$1 FOR KEY SHARE`, idempotencyKey).Scan(
		&run.RunID, &run.RequestID, &run.IdempotencyKey, &run.RequestHash, &mode, &scopeJSON, &run.PreviewHash, &run.Reason,
		&run.ApprovalID, &run.ApprovalStatus, &run.AuditID, &run.RequestedBy, &run.ControlVersion, &run.SourceCommit,
		&run.SourceRelease, &run.Status, &run.CandidateCount, &run.EnqueuedCount, &run.SkippedPending, &run.StartedAt, &run.CompletedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return datafabric.RedeliveryRun{}, false, nil
	}
	if err != nil {
		return datafabric.RedeliveryRun{}, false, err
	}
	run.Mode = datafabric.RedeliveryMode(mode)
	if err := json.Unmarshal(scopeJSON, &run.Scope); err != nil {
		return datafabric.RedeliveryRun{}, false, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT event_id FROM ynx_fabric.redelivery_run_events WHERE run_id=$1 AND action='enqueued' ORDER BY ordinal`, run.RunID)
	if err != nil {
		return datafabric.RedeliveryRun{}, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var eventID string
		if err := rows.Scan(&eventID); err != nil {
			return datafabric.RedeliveryRun{}, false, err
		}
		run.EventIDs = append(run.EventIDs, eventID)
	}
	return run, true, rows.Err()
}
