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

func (s *Store) StartSaga(ctx context.Context, instance datafabric.SagaInstance) error {
	if err := validateInitialSaga(instance); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	_, err = tx.ExecContext(ctx, `INSERT INTO ynx_fabric.sagas(saga_id,kind,product,aggregate_id,correlation_id,status,user_visible_status,created_at,updated_at,deadline,audit_id,failure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)`, instance.SagaID, instance.Kind, instance.Product, instance.AggregateID, instance.CorrelationID, instance.Status, instance.UserVisibleStatus, instance.CreatedAt, instance.UpdatedAt, instance.Deadline, instance.AuditID)
	if err != nil {
		return mapSagaError(err)
	}
	for index, step := range instance.Steps {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.saga_steps(saga_id,step_index,action,compensation) VALUES ($1,$2,$3,$4)`, instance.SagaID, index, step.Action, step.Compensation); err != nil {
			return mapSagaError(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return mapSagaError(err)
	}
	return nil
}

func validateInitialSaga(instance datafabric.SagaInstance) error {
	return datafabric.ValidateInitialSaga(instance)
}

func mapSagaError(err error) error {
	var pqError *pq.Error
	if errors.As(err, &pqError) && pqError.Code == "23505" {
		return datafabric.ErrDuplicate
	}
	return fmt.Errorf("write Saga: %w", err)
}

func (s *Store) Saga(ctx context.Context, id string) (datafabric.SagaInstance, bool, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return datafabric.SagaInstance{}, false, err
	}
	defer tx.Rollback() //nolint:errcheck
	instance, exists, err := loadSaga(ctx, tx, id, false)
	if err != nil || !exists {
		return instance, exists, err
	}
	if err := tx.Commit(); err != nil {
		return datafabric.SagaInstance{}, false, err
	}
	return instance, true, nil
}

func loadSaga(ctx context.Context, queryer sqlQueryer, id string, forUpdate bool) (datafabric.SagaInstance, bool, error) {
	query := `SELECT saga_id,kind,product,aggregate_id,correlation_id,status,user_visible_status,created_at,updated_at,deadline,audit_id,COALESCE(failure,''),
COALESCE(recovery_task_id,''),COALESCE(recovery_lease_owner,''),recovery_acquired_at,recovery_lease_until,recovery_attempt
FROM ynx_fabric.sagas WHERE saga_id=$1`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	var instance datafabric.SagaInstance
	var recoveryTaskID, recoveryOwner string
	var recoveryAcquiredAt, recoveryLeaseUntil sql.NullTime
	if err := queryer.QueryRowContext(ctx, query, id).Scan(
		&instance.SagaID, &instance.Kind, &instance.Product, &instance.AggregateID, &instance.CorrelationID,
		&instance.Status, &instance.UserVisibleStatus, &instance.CreatedAt, &instance.UpdatedAt, &instance.Deadline,
		&instance.AuditID, &instance.Failure, &recoveryTaskID, &recoveryOwner, &recoveryAcquiredAt,
		&recoveryLeaseUntil, &instance.RecoveryAttempt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return datafabric.SagaInstance{}, false, nil
		}
		return datafabric.SagaInstance{}, false, err
	}
	instance.CreatedAt = instance.CreatedAt.UTC()
	instance.UpdatedAt = instance.UpdatedAt.UTC()
	instance.Deadline = instance.Deadline.UTC()
	if recoveryTaskID != "" {
		if recoveryOwner == "" || !recoveryAcquiredAt.Valid || !recoveryLeaseUntil.Valid {
			return datafabric.SagaInstance{}, false, errors.New("stored Saga recovery lease is incomplete")
		}
		instance.RecoveryLease = &datafabric.SagaRecoveryLease{
			TaskID: recoveryTaskID, Owner: recoveryOwner, AcquiredAt: recoveryAcquiredAt.Time.UTC(), ExpiresAt: recoveryLeaseUntil.Time.UTC(),
		}
	}
	rows, err := queryer.QueryContext(ctx, `SELECT action,compensation,completed_at,compensated_at,COALESCE(failure,''),COALESCE(event_id,''),COALESCE(compensation_event_id,'') FROM ynx_fabric.saga_steps WHERE saga_id=$1 ORDER BY step_index`, id)
	if err != nil {
		return datafabric.SagaInstance{}, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var step datafabric.SagaStep
		var completedAt, compensatedAt sql.NullTime
		if err := rows.Scan(&step.Action, &step.Compensation, &completedAt, &compensatedAt, &step.Failure, &step.EventID, &step.CompensationID); err != nil {
			return datafabric.SagaInstance{}, false, err
		}
		if completedAt.Valid {
			step.CompletedAt = completedAt.Time.UTC()
		}
		if compensatedAt.Valid {
			step.CompensatedAt = compensatedAt.Time.UTC()
		}
		instance.Steps = append(instance.Steps, step)
	}
	if err := rows.Err(); err != nil {
		return datafabric.SagaInstance{}, false, err
	}
	return instance, true, nil
}

func (s *Store) Sagas(ctx context.Context) ([]datafabric.SagaInstance, error) {
	return sagasFromQueryer(ctx, s.db)
}

func sagasFromQueryer(ctx context.Context, queryer sqlQueryer) ([]datafabric.SagaInstance, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT saga_id FROM ynx_fabric.sagas ORDER BY created_at,saga_id`)
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
	instances := make([]datafabric.SagaInstance, 0, len(ids))
	for _, id := range ids {
		instance, exists, err := loadSaga(ctx, queryer, id, false)
		if err != nil {
			return nil, err
		}
		if exists {
			instances = append(instances, instance)
		}
	}
	return instances, nil
}

type sagaMutation func(*datafabric.SagaInstance) error

func (s *Store) mutateSaga(ctx context.Context, id string, mutate sagaMutation) error {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	instance, exists, err := loadSaga(ctx, tx, id, true)
	if err != nil {
		return err
	}
	if !exists {
		return sql.ErrNoRows
	}
	if err := mutate(&instance); err != nil {
		return err
	}
	if err := persistSaga(ctx, tx, instance); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return mapSagaError(err)
	}
	return nil
}

func persistSaga(ctx context.Context, tx *sql.Tx, instance datafabric.SagaInstance) error {
	var recoveryTaskID, recoveryOwner any
	var recoveryAcquiredAt, recoveryLeaseUntil any
	if instance.RecoveryLease != nil {
		recoveryTaskID, recoveryOwner = instance.RecoveryLease.TaskID, instance.RecoveryLease.Owner
		recoveryAcquiredAt, recoveryLeaseUntil = instance.RecoveryLease.AcquiredAt, instance.RecoveryLease.ExpiresAt
	}
	result, err := tx.ExecContext(ctx, `UPDATE ynx_fabric.sagas
SET status=$2,user_visible_status=$3,updated_at=$4,failure=NULLIF($5,''),
    recovery_task_id=$6,recovery_lease_owner=$7,recovery_acquired_at=$8,recovery_lease_until=$9,recovery_attempt=$10
WHERE saga_id=$1`, instance.SagaID, instance.Status, instance.UserVisibleStatus, instance.UpdatedAt, instance.Failure,
		recoveryTaskID, recoveryOwner, recoveryAcquiredAt, recoveryLeaseUntil, instance.RecoveryAttempt)
	if err != nil {
		return mapSagaError(err)
	}
	if err := requireOneRow(result, "Saga mutation"); err != nil {
		return err
	}
	for index, step := range instance.Steps {
		if _, err := tx.ExecContext(ctx, `UPDATE ynx_fabric.saga_steps SET completed_at=$3,compensated_at=$4,failure=NULLIF($5,''),event_id=NULLIF($6,''),compensation_event_id=NULLIF($7,'') WHERE saga_id=$1 AND step_index=$2`, instance.SagaID, index, nullableTime(step.CompletedAt), nullableTime(step.CompensatedAt), step.Failure, step.EventID, step.CompensationID); err != nil {
			return mapSagaError(err)
		}
	}
	return nil
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

func (s *Store) CompleteSagaStep(ctx context.Context, id, eventID string, at time.Time) error {
	return s.mutateSaga(ctx, id, func(instance *datafabric.SagaInstance) error { return instance.CompleteStep(eventID, at) })
}

func (s *Store) FailSaga(ctx context.Context, id, reason string, at time.Time) error {
	return s.mutateSaga(ctx, id, func(instance *datafabric.SagaInstance) error { return instance.Fail(reason, at) })
}

func (s *Store) CompleteSagaCompensation(ctx context.Context, id, eventID string, at time.Time) error {
	return datafabric.Reject(datafabric.CodeSagaRecoveryRouteRequired, "Saga compensation must complete a claimed recovery task", map[string]string{"sagaId": id, "eventId": eventID})
}

func (s *Store) RequireSagaManualRecovery(ctx context.Context, id, reason string, at time.Time) error {
	return s.mutateSaga(ctx, id, func(instance *datafabric.SagaInstance) error { return instance.RequireManualRecovery(reason, at) })
}

func (s *Store) CompleteSagaRecovery(ctx context.Context, id, taskID, owner, eventID string, at time.Time) error {
	return s.mutateSaga(ctx, id, func(instance *datafabric.SagaInstance) error {
		return instance.CompleteClaimedRecovery(taskID, owner, eventID, at)
	})
}

func (s *Store) ExpireSagas(ctx context.Context, now time.Time, limit int) ([]string, error) {
	if now.IsZero() || now.Location() != time.UTC || limit <= 0 || limit > 1000 {
		return nil, errors.New("Saga expiration request is invalid")
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck
	ids, err := selectSagaIDs(ctx, tx, `SELECT saga_id FROM ynx_fabric.sagas
WHERE status='running' AND deadline <= $1 ORDER BY deadline,saga_id LIMIT $2 FOR UPDATE SKIP LOCKED`, now, limit)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		instance, exists, err := loadSaga(ctx, tx, id, false)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}
		if err := instance.Fail("saga deadline exceeded", now); err != nil {
			return nil, err
		}
		hasRecovery := false
		for _, step := range instance.Steps {
			if !step.CompletedAt.IsZero() && step.CompensatedAt.IsZero() {
				hasRecovery = true
				break
			}
		}
		if !hasRecovery {
			if err := persistSaga(ctx, tx, instance); err != nil {
				return nil, err
			}
			if err := instance.CompleteCompensation("", now); err != nil {
				return nil, err
			}
		}
		if err := persistSaga(ctx, tx, instance); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, mapSagaError(err)
	}
	return ids, nil
}

func (s *Store) ClaimSagaRecoveries(ctx context.Context, product, owner string, now time.Time, lease time.Duration, limit int) ([]datafabric.SagaRecoveryTask, error) {
	if product == "" || owner == "" || now.IsZero() || now.Location() != time.UTC || lease <= 0 || lease > 15*time.Minute || limit <= 0 || limit > 200 {
		return nil, errors.New("Saga recovery claim is invalid")
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck
	ids, err := selectSagaIDs(ctx, tx, `SELECT saga_id FROM ynx_fabric.sagas
WHERE product=$1 AND status='compensating' AND (recovery_lease_until IS NULL OR recovery_lease_until <= $2)
ORDER BY deadline,saga_id LIMIT $3 FOR UPDATE SKIP LOCKED`, product, now, limit)
	if err != nil {
		return nil, err
	}
	tasks := make([]datafabric.SagaRecoveryTask, 0, len(ids))
	for _, id := range ids {
		instance, exists, err := loadSaga(ctx, tx, id, false)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}
		task, claimed, err := instance.ClaimRecovery(owner, now, now.Add(lease))
		if err != nil {
			return nil, err
		}
		if err := persistSaga(ctx, tx, instance); err != nil {
			return nil, err
		}
		if claimed {
			tasks = append(tasks, task)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, mapSagaError(err)
	}
	return tasks, nil
}

func selectSagaIDs(ctx context.Context, tx *sql.Tx, query string, arguments ...any) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
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
	return ids, nil
}
