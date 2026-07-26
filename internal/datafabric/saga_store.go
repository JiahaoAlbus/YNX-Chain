package datafabric

import (
	"errors"
	"os"
	"sort"
	"time"
)

func (s *Store) StartSaga(instance SagaInstance) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ValidateInitialSaga(instance); err != nil {
		return err
	}
	for _, existing := range s.state.Sagas {
		if existing.SagaID == instance.SagaID {
			return ErrDuplicate
		}
	}
	next := cloneState(s.state)
	next.Sagas = append(next.Sagas, instance)
	return s.commit(next)
}

func (s *Store) Saga(id string) (SagaInstance, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, instance := range s.state.Sagas {
		if instance.SagaID == id {
			return instance, true
		}
	}
	return SagaInstance{}, false
}

func (s *Store) Sagas() []SagaInstance {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]SagaInstance(nil), s.state.Sagas...)
}

func (s *Store) mutateSaga(id string, mutate func(*SagaInstance) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	for i := range next.Sagas {
		if next.Sagas[i].SagaID == id {
			if err := mutate(&next.Sagas[i]); err != nil {
				return err
			}
			return s.commit(next)
		}
	}
	return os.ErrNotExist
}

func (s *Store) CompleteSagaStep(id, eventID string, at time.Time) error {
	return s.mutateSagaWithEvent(id, eventID, func(instance *SagaInstance) error { return instance.CompleteStep(eventID, at) })
}

func (s *Store) FailSaga(id, reason string, at time.Time) error {
	return s.mutateSaga(id, func(instance *SagaInstance) error { return instance.Fail(reason, at) })
}

func (s *Store) CompleteSagaCompensation(id, eventID string, at time.Time) error {
	return Reject(CodeSagaRecoveryRouteRequired, "Saga compensation must complete a claimed recovery task", map[string]string{"sagaId": id, "eventId": eventID})
}

func (s *Store) RequireSagaManualRecovery(id, reason string, at time.Time) error {
	return s.mutateSaga(id, func(instance *SagaInstance) error { return instance.RequireManualRecovery(reason, at) })
}

func (s *Store) ClaimSagaRecoveries(product, owner string, now time.Time, lease time.Duration, limit int) ([]SagaRecoveryTask, error) {
	if product == "" || !idPattern.MatchString(owner) || now.IsZero() || now.Location() != time.UTC || lease <= 0 || lease > 15*time.Minute || limit <= 0 || limit > 200 {
		return nil, errors.New("Saga recovery claim is invalid")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	indices := make([]int, len(next.Sagas))
	for index := range next.Sagas {
		indices[index] = index
	}
	sort.SliceStable(indices, func(i, j int) bool {
		left, right := next.Sagas[indices[i]], next.Sagas[indices[j]]
		if left.Deadline.Equal(right.Deadline) {
			return left.SagaID < right.SagaID
		}
		return left.Deadline.Before(right.Deadline)
	})
	tasks := make([]SagaRecoveryTask, 0, limit)
	changed := false
	for _, index := range indices {
		instance := &next.Sagas[index]
		if instance.Product != product || instance.Status != SagaCompensating || len(tasks) >= limit {
			continue
		}
		if instance.RecoveryLease != nil && instance.RecoveryLease.ExpiresAt.After(now) {
			continue
		}
		task, claimed, err := instance.ClaimRecovery(owner, now, now.Add(lease))
		if err != nil {
			if ErrorCodeOf(err) == CodeSagaRecoveryLeaseConflict {
				continue
			}
			return nil, err
		}
		changed = true
		if claimed {
			tasks = append(tasks, task)
		}
	}
	if changed {
		if err := s.commit(next); err != nil {
			return nil, err
		}
	}
	return tasks, nil
}

func (s *Store) CompleteSagaRecovery(id, taskID, owner, eventID string, at time.Time) error {
	return s.mutateSagaWithEvent(id, eventID, func(instance *SagaInstance) error {
		return instance.CompleteClaimedRecovery(taskID, owner, eventID, at)
	})
}

func (s *Store) mutateSagaWithEvent(id, eventID string, mutate func(*SagaInstance) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	for index := range next.Sagas {
		instance := &next.Sagas[index]
		if instance.SagaID != id {
			continue
		}
		if err := mutate(instance); err != nil {
			return err
		}
		for _, event := range s.state.Events {
			if event.EventID == eventID && event.Product == instance.Product && event.CorrelationID == instance.CorrelationID {
				return s.commit(next)
			}
		}
		return Reject(CodeSagaEventAuthorityMismatch, "Saga transition event is missing or outside product/correlation authority", map[string]string{"sagaId": id, "eventId": eventID})
	}
	return os.ErrNotExist
}

func (s *Store) ExpireSagas(now time.Time) ([]string, error) {
	if now.IsZero() || now.Location() != time.UTC {
		return nil, errors.New("Saga expiration time must be UTC")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	var expired []string
	for i := range next.Sagas {
		instance := &next.Sagas[i]
		if instance.Status == SagaRunning && !now.Before(instance.Deadline) {
			if err := instance.Fail("saga deadline exceeded", now); err != nil {
				return nil, err
			}
			if _, exists := instance.nextCompensationStep(); !exists {
				if err := instance.CompleteCompensation("", now); err != nil {
					return nil, err
				}
			}
			expired = append(expired, instance.SagaID)
		}
	}
	if len(expired) == 0 {
		return nil, nil
	}
	if err := s.commit(next); err != nil {
		return nil, err
	}
	return expired, nil
}

func validateSaga(instance SagaInstance) error {
	product, exists := sagaProducts[instance.Kind]
	if !exists || instance.Product != product || !idPattern.MatchString(instance.SagaID) {
		return errors.New("stored saga is invalid")
	}
	if instance.RecoveryLease != nil {
		lease := instance.RecoveryLease
		stepIndex, hasStep := instance.nextCompensationStep()
		if instance.Status != SagaCompensating || !hasStep || lease.TaskID != sagaRecoveryTaskID(instance.SagaID, stepIndex) || instance.RecoveryAttempt == 0 || !idPattern.MatchString(lease.TaskID) || !idPattern.MatchString(lease.Owner) || lease.AcquiredAt.IsZero() || lease.AcquiredAt.Location() != time.UTC || lease.ExpiresAt.IsZero() || lease.ExpiresAt.Location() != time.UTC || !lease.ExpiresAt.After(lease.AcquiredAt) || instance.UpdatedAt.Before(lease.AcquiredAt) {
			return errors.New("stored Saga recovery lease is invalid")
		}
	}
	return nil
}
