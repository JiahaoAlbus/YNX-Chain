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
	expected, err := datafabric.NewSaga(instance.SagaID, instance.Kind, instance.AggregateID, instance.CorrelationID, instance.AuditID, instance.CreatedAt, instance.Deadline)
	if err != nil {
		return err
	}
	if instance.Product != expected.Product || instance.Status != expected.Status || instance.UserVisibleStatus != expected.UserVisibleStatus || !instance.UpdatedAt.Equal(instance.CreatedAt) || instance.Failure != "" || len(instance.Steps) != len(expected.Steps) {
		return errors.New("Saga initial state is not canonical")
	}
	for index := range expected.Steps {
		if instance.Steps[index] != expected.Steps[index] {
			return errors.New("Saga steps do not match the canonical definition")
		}
	}
	return nil
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
	query := `SELECT saga_id,kind,product,aggregate_id,correlation_id,status,user_visible_status,created_at,updated_at,deadline,audit_id,COALESCE(failure,'') FROM ynx_fabric.sagas WHERE saga_id=$1`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	var instance datafabric.SagaInstance
	if err := queryer.QueryRowContext(ctx, query, id).Scan(&instance.SagaID, &instance.Kind, &instance.Product, &instance.AggregateID, &instance.CorrelationID, &instance.Status, &instance.UserVisibleStatus, &instance.CreatedAt, &instance.UpdatedAt, &instance.Deadline, &instance.AuditID, &instance.Failure); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return datafabric.SagaInstance{}, false, nil
		}
		return datafabric.SagaInstance{}, false, err
	}
	instance.CreatedAt = instance.CreatedAt.UTC()
	instance.UpdatedAt = instance.UpdatedAt.UTC()
	instance.Deadline = instance.Deadline.UTC()
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
	result, err := tx.ExecContext(ctx, `UPDATE ynx_fabric.sagas SET status=$2,user_visible_status=$3,updated_at=$4,failure=NULLIF($5,'') WHERE saga_id=$1`, instance.SagaID, instance.Status, instance.UserVisibleStatus, instance.UpdatedAt, instance.Failure)
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
	if err := tx.Commit(); err != nil {
		return mapSagaError(err)
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
	return s.mutateSaga(ctx, id, func(instance *datafabric.SagaInstance) error { return instance.CompleteCompensation(eventID, at) })
}

func (s *Store) RequireSagaManualRecovery(ctx context.Context, id, reason string, at time.Time) error {
	return s.mutateSaga(ctx, id, func(instance *datafabric.SagaInstance) error { return instance.RequireManualRecovery(reason, at) })
}
