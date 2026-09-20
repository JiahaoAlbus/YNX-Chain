package main

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
)

type lifecycleFixture struct {
	started      chan struct{}
	serveDone    chan struct{}
	shutdownGate chan struct{}
	shutdownErr  error
	serveErr     error
	mu           sync.Mutex
	shutdowns    int
	closes       int
}

func newLifecycleFixture() *lifecycleFixture {
	return &lifecycleFixture{started: make(chan struct{}), serveDone: make(chan struct{}), shutdownGate: make(chan struct{})}
}

func (f *lifecycleFixture) ListenAndServe() error {
	close(f.started)
	<-f.serveDone
	return f.serveErr
}

func (f *lifecycleFixture) Shutdown(ctx context.Context) error {
	f.mu.Lock()
	f.shutdowns++
	f.mu.Unlock()
	select {
	case <-f.shutdownGate:
		close(f.serveDone)
		return f.shutdownErr
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (f *lifecycleFixture) Close() error {
	f.mu.Lock()
	f.closes++
	f.mu.Unlock()
	select {
	case <-f.serveDone:
	default:
		close(f.serveDone)
	}
	return nil
}

func TestServeUntilShutdownDrainsAndTreatsErrServerClosedAsSuccess(t *testing.T) {
	fixture := newLifecycleFixture()
	fixture.serveErr = http.ErrServerClosed
	ctx, cancel := context.WithCancel(context.Background())
	drained := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		result <- serveUntilShutdown(ctx, fixture, func() finance.DrainSnapshot {
			close(drained)
			return finance.DrainSnapshot{State: "draining", Draining: true, ActiveRequests: 1}
		}, time.Second)
	}()
	<-fixture.started
	cancel()
	<-drained
	close(fixture.shutdownGate)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.shutdowns != 1 || fixture.closes != 0 {
		t.Fatalf("shutdowns=%d closes=%d", fixture.shutdowns, fixture.closes)
	}
}

func TestServeUntilShutdownTimeoutClosesAndReturnsExplicitError(t *testing.T) {
	fixture := newLifecycleFixture()
	fixture.serveErr = http.ErrServerClosed
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		result <- serveUntilShutdown(ctx, fixture, func() finance.DrainSnapshot {
			return finance.DrainSnapshot{State: "draining", Draining: true, ActiveRequests: 1}
		}, 20*time.Millisecond)
	}()
	<-fixture.started
	cancel()
	err := <-result
	if err == nil || err.Error() != "Finance graceful shutdown timed out: context deadline exceeded" {
		t.Fatalf("unexpected timeout result: %v", err)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.shutdowns != 1 || fixture.closes != 1 {
		t.Fatalf("shutdowns=%d closes=%d", fixture.shutdowns, fixture.closes)
	}
}

func TestServeUntilShutdownWithZeroActiveRequests(t *testing.T) {
	fixture := newLifecycleFixture()
	fixture.serveErr = http.ErrServerClosed
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		result <- serveUntilShutdown(ctx, fixture, func() finance.DrainSnapshot {
			return finance.DrainSnapshot{State: "draining", Draining: true, ActiveRequests: 0}
		}, time.Second)
	}()
	<-fixture.started
	cancel()
	close(fixture.shutdownGate)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.shutdowns != 1 || fixture.closes != 0 {
		t.Fatalf("shutdowns=%d closes=%d", fixture.shutdowns, fixture.closes)
	}
}

func TestServeUntilShutdownReturnsListenFailureWithoutDrain(t *testing.T) {
	fixture := newLifecycleFixture()
	fixture.serveErr = errors.New("listen failed")
	close(fixture.serveDone)
	drains := 0
	err := serveUntilShutdown(context.Background(), fixture, func() finance.DrainSnapshot {
		drains++
		return finance.DrainSnapshot{}
	}, time.Second)
	if err == nil || err.Error() != "listen failed" || drains != 0 {
		t.Fatalf("err=%v drains=%d", err, drains)
	}
}

func TestShutdownTimeoutConfiguration(t *testing.T) {
	for name, testCase := range map[string]struct {
		raw  string
		want time.Duration
		err  bool
	}{
		"default":  {want: 30 * time.Second},
		"bounded":  {raw: " 45 ", want: 45 * time.Second},
		"zero":     {raw: "0", err: true},
		"too high": {raw: "301", err: true},
		"invalid":  {raw: "thirty", err: true},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := shutdownTimeout(testCase.raw)
			if (err != nil) != testCase.err || got != testCase.want {
				t.Fatalf("got=%s err=%v", got, err)
			}
		})
	}
}
