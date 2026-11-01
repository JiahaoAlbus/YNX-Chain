package resourceauthority

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type publicSource struct {
	mu              sync.Mutex
	currentErr      error
	joinReady       chan struct{}
	closes, retires int
	complete        bool
}

func (s *publicSource) Current(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentErr
}
func (s *publicSource) Retire() error { s.mu.Lock(); defer s.mu.Unlock(); s.retires++; return nil }
func (s *publicSource) Join(ctx context.Context) (bool, error) {
	if s.joinReady != nil {
		select {
		case <-s.joinReady:
		case <-ctx.Done():
			return false, ctx.Err()
		}
	}
	return true, nil
}
func (s *publicSource) Close(context.Context) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closes++
	return s.complete, nil
}

func TestPartialPhysicalDrainPreservesFirstCauseAndOwner(t *testing.T) {
	first := errors.New("PUBLIC first acquisition failure")
	s := &publicSource{joinReady: make(chan struct{}), complete: true}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	o := adopt(ctx, s, first, true)
	a := o.Snapshot()
	if a.Code != "NOT_ADMITTED" || !a.PartialAcquired || !a.CleanupPending || a.PhysicalComplete || a.Current || a.FirstCauseCode != "SOURCE_ERROR" {
		t.Fatal(a)
	}
	close(s.joinReady)
	if complete, err := o.Close(context.Background()); !complete || err != nil {
		t.Fatal(complete, err)
	}
	a = o.Snapshot()
	if !a.PhysicalComplete || a.CleanupPending || a.Current || o.first != first || o.source != s {
		t.Fatal(a)
	}
	before := s.closes
	if complete, err := o.Close(context.Background()); !complete || err != nil || s.closes != before {
		t.Fatal("repeat Close changed original owner", complete, err)
	}
}

func TestCurrentLossRetiresWithoutReacquisition(t *testing.T) {
	s := &publicSource{complete: true}
	o := adopt(context.Background(), s, nil, true)
	if !o.Observe(context.Background()).Current {
		t.Fatal("initial observation missing")
	}
	s.mu.Lock()
	s.currentErr = errors.New("PUBLIC revoked")
	s.mu.Unlock()
	a := o.Observe(context.Background())
	if a.Current || a.Code != "NOT_ADMITTED" || !a.PhysicalComplete || s.closes != 1 {
		t.Fatal(a)
	}
	o.Observe(context.Background())
	if s.closes != 1 || o.source != s {
		t.Fatal("reopened original Source")
	}
}

func TestPendingCloseStaysOwnedAndClientStatusContainsNoErrorText(t *testing.T) {
	s := &publicSource{}
	o := adopt(context.Background(), s, nil, true)
	if complete, err := o.Close(context.Background()); complete || err != nil {
		t.Fatal(complete, err)
	}
	a := o.Snapshot()
	if !a.CleanupPending || a.PhysicalComplete || a.Current || a.Code != "RETIRED" {
		t.Fatal(a)
	}
	s.mu.Lock()
	s.complete = true
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if complete, err := o.Close(ctx); !complete || err != nil {
		t.Fatal(complete, err)
	}
	if causeCode(errors.New("sensitive arbitrary native text")) != "SOURCE_ERROR" {
		t.Fatal("raw error escaped")
	}
}
