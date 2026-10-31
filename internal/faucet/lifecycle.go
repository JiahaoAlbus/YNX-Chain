package faucet

import (
	"errors"
	"sync"
)

var errServiceClosed = errors.New("faucet is closing; retain the original request ID")

type serviceLifecycle struct {
	mu      sync.Mutex
	active  sync.WaitGroup
	closing bool
	stop    chan struct{}
	done    chan struct{}
	err     error
}

// Public entry registration and closing admission share one mutex. No new
// root operation can increment an empty WaitGroup after Close starts waiting.
func (s *Service) beginOperation() bool {
	if s == nil {
		return false
	}
	l := &s.lifecycle
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closing {
		return false
	}
	l.active.Add(1)
	return true
}

func (s *Service) endOperation() { s.lifecycle.active.Done() }

// Only a synchronous descendant of an already registered public operation
// calls this, before its parent's deferred endOperation can run. Its positive
// parent count makes Add safe even when Close is already waiting. A caller
// disconnect must not cancel an admitted transfer or its receipt persistence.
func (s *Service) retainWorker() {
	s.lifecycle.mu.Lock()
	s.lifecycle.active.Add(1)
	s.lifecycle.mu.Unlock()
}

func (s *Service) isClosing() bool {
	if s == nil {
		return true
	}
	s.lifecycle.mu.Lock()
	defer s.lifecycle.mu.Unlock()
	return s.lifecycle.closing
}

func (s *Service) stopSignal() <-chan struct{} {
	s.lifecycle.mu.Lock()
	defer s.lifecycle.mu.Unlock()
	if s.lifecycle.stop == nil {
		s.lifecycle.stop = make(chan struct{})
	}
	return s.lifecycle.stop
}

// Close seals new entry points, drains all accepted calls and detached workers,
// then releases the admission lock. A bounded worker keeps its original HTTP
// deadline and UNKNOWN result; shutdown does not replay or cancel a Core write.
// Concurrent callers observe one close result, including the original error.
func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	l := &s.lifecycle
	l.mu.Lock()
	if l.closing {
		done := l.done
		l.mu.Unlock()
		<-done
		l.mu.Lock()
		err := l.err
		l.mu.Unlock()
		return err
	}
	l.closing = true
	l.done = make(chan struct{})
	if l.stop == nil {
		l.stop = make(chan struct{})
	}
	close(l.stop)
	l.mu.Unlock()
	l.active.Wait()
	var err error
	if s.admissions != nil {
		err = s.admissions.db.Close()
	}
	if s.httpClient != nil {
		s.httpClient.CloseIdleConnections()
	}
	if s.healthClient != nil {
		s.healthClient.CloseIdleConnections()
	}
	l.mu.Lock()
	l.err = err
	close(l.done)
	l.mu.Unlock()
	return err
}

func closingHealth(h Health) Health {
	h.OK, h.FundingReady, h.UpstreamOK = false, false, false
	h.AdmissionReady, h.AdmissionCapacityReady = false, false
	h.LastError, h.ProbeFailureStage = errServiceClosed.Error(), "lifecycle"
	return h
}
