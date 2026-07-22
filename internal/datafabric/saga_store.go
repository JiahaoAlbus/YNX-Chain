package datafabric

import (
	"errors"
	"os"
	"time"
)

func (s *Store) StartSaga(instance SagaInstance) error {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	return s.mutateSaga(id, func(instance *SagaInstance) error { return instance.CompleteStep(eventID, at) })
}

func (s *Store) FailSaga(id, reason string, at time.Time) error {
	return s.mutateSaga(id, func(instance *SagaInstance) error { return instance.Fail(reason, at) })
}

func (s *Store) CompleteSagaCompensation(id, eventID string, at time.Time) error {
	return s.mutateSaga(id, func(instance *SagaInstance) error { return instance.CompleteCompensation(eventID, at) })
}

func (s *Store) RequireSagaManualRecovery(id, reason string, at time.Time) error {
	return s.mutateSaga(id, func(instance *SagaInstance) error { return instance.RequireManualRecovery(reason, at) })
}

func (s *Store) ExpireSagas(now time.Time) ([]string, error) {
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
	return nil
}
