//go:build unix

package consensus

import (
	"context"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	sm "github.com/cometbft/cometbft/state"
)

// A cancelled request has no reason to touch any original source. Leaving the
// source absent makes an accidental read observable without keys or a Node.
func TestPQLabLiveMaterialsCancelledBeforeCapture(t *testing.T) {
	c := &PQLabLiveMaterialsControl{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.capture(ctx, PQLabLiveMaterialsRequest{}, nil, "", nil, "", time.Now()); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled capture reached source instead of retiring: %v", err)
	}
	// Cancellation must not turn a real unavailable-source failure into success.
	if _, err := c.capture(context.Background(), PQLabLiveMaterialsRequest{}, nil, "", nil, "", time.Now()); err == nil {
		t.Fatal("active capture accepted missing original source")
	}
}

// This observes entry at the real context boundary, without a polling sleep,
// replacing the App, or providing a caller-selected source implementation.
type pqLabObservedCancelContext struct {
	context.Context
	entered chan struct{}
	once    sync.Once
}

func (c *pqLabObservedCancelContext) Err() error {
	err := c.Context.Err()
	c.once.Do(func() { close(c.entered) })
	return err
}

func TestPQLabLiveMaterialsCancelledAppReadDrainsOriginal(t *testing.T) {
	for _, valid := range []bool{true, false} {
		name := "completed_read_retires_before_decode"
		if !valid {
			name = "original_read_failure_kept"
		}
		t.Run(name, func(t *testing.T) {
			actual := sm.State{ChainID: "cancel-control", LastBlockHeight: 7, AppHash: []byte{1}}
			app := &Application{bootstrap: &ConsensusBootstrap{record: ValidatorBootstrapRecord{ChainID: actual.ChainID}}, committed: CommittedState{Height: 7, AppHash: hex.EncodeToString(actual.AppHash)}}
			if !valid {
				app.bootstrap.record.ChainID = "another-original-chain"
			}
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &pqLabObservedCancelContext{Context: parent, entered: make(chan struct{})}
			in := &pqLabLiveMaterialsInputs{cache: NewPQLabStaticCache()}
			c := &PQLabLiveMaterialsControl{app: app, in: in, cancel: cancel, started: true, done: make(chan struct{})}
			// Deliberately hold the ORIGINAL App write lock. The registered read
			// cannot be forcibly abandoned by Close. No Node, keys or crypto fixture.
			app.mu.Lock()
			locked := true
			defer func() {
				if locked {
					app.mu.Unlock()
				}
			}()
			read := make(chan error, 1)
			c.wg.Add(1)
			go func() {
				defer c.wg.Done()
				_, err := c.captureCommitted(ctx, actual)
				read <- err
			}()
			<-ctx.entered
			closed := make(chan error, 1)
			go func() { closed <- c.Close() }()
			<-parent.Done()
			select {
			case err := <-closed:
				t.Fatalf("Close abandoned original reader: %v", err)
			default:
			}
			app.mu.Unlock()
			locked = false
			err := <-read
			if valid && !errors.Is(err, context.Canceled) {
				t.Fatalf("cancelled completed App read continued: %v", err)
			}
			if !valid && (err == nil || errors.Is(err, context.Canceled)) {
				t.Fatalf("cancellation replaced original App failure: %v", err)
			}
			if err := <-closed; err != nil {
				t.Fatal(err)
			}
			if !in.closed || !in.cache.Stats().Closed {
				t.Fatal("drain did not close original source")
			}
			if err := c.Start(context.Background()); err == nil {
				t.Fatal("retired original owner restarted")
			}
		})
	}
}

func TestPQLabLiveMaterialsCancellationPreservesCurrentAndCloseFailure(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "original.json")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	f, err := readProofHostOriginal(path, "", 4096)
	if err != nil {
		t.Fatal(err)
	}
	in := &pqLabLiveMaterialsInputs{directory: dir, originals: []*proofHostOriginal{f}, cache: NewPQLabStaticCache()}
	first := errors.New("retained original capture failure")
	c := &PQLabLiveMaterialsControl{in: in, err: first, done: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// An actual closed descriptor makes any continued current read observable.
	if err := f.file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := c.current(ctx); !errors.Is(err, context.Canceled) || errors.Is(err, os.ErrClosed) {
		t.Fatalf("cancelled current entered original source: %v", err)
	}
	if err := c.current(context.Background()); err == nil {
		t.Fatal("active current omitted original descriptor check")
	}
	err = c.Close()
	if !errors.Is(err, first) || !errors.Is(err, os.ErrClosed) {
		t.Fatalf("Close lost original failure or descriptor debt: %v", err)
	}
	if c.Close() != err {
		t.Fatal("Close did not retain the original terminal error")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("Close removed original evidence", err)
	}
}
