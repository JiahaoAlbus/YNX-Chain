package aiproduct

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
)

// PUBLIC lifetime controls only. They create no OS caller, transport seal,
// registered Source, grant, receipt or successful real IPC execution.
type p08CallerLifetimeFixture struct {
	current                               func(context.Context) error
	effect, query                         func(context.Context, originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error)
	currentCalls, effectCalls, queryCalls atomic.Int32
}

func (f *p08CallerLifetimeFixture) Current(ctx context.Context) error {
	f.currentCalls.Add(1)
	if f.current != nil {
		return f.current(ctx)
	}
	return ctx.Err()
}
func (f *p08CallerLifetimeFixture) AuthorizeAtEffect(ctx context.Context, c originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	f.effectCalls.Add(1)
	if f.effect != nil {
		return f.effect(ctx, c)
	}
	return originalclient.TaskAuthorityResult{}, errTaskEffectSourceUnavailable
}
func (f *p08CallerLifetimeFixture) QueryOriginalEffect(ctx context.Context, c originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	f.queryCalls.Add(1)
	if f.query != nil {
		return f.query(ctx, c)
	}
	return originalclient.TaskAuthorityResult{}, errTaskEffectSourceUnavailable
}

func TestP08TaskCallerLifetimeRetiresCallsWithoutReplay(t *testing.T) {
	for _, query := range []bool{false, true} {
		t.Run(map[bool]string{false: "effect", true: "query"}[query], func(t *testing.T) {
			started := make(chan struct{})
			cause := errors.New("PUBLIC original caller failure")
			op := strings.Repeat("ab", 32)
			call := originalclient.TaskAuthorityCall{}
			if query {
				call.OriginalOperation = op
			}
			client := &p08CallerLifetimeFixture{}
			invoke := func(ctx context.Context, got originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
				if got.OriginalOperation != call.OriginalOperation {
					return originalclient.TaskAuthorityResult{}, errToolConflict
				}
				close(started)
				<-ctx.Done()
				return originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: op}, cause
			}
			client.effect, client.query = invoke, invoke
			managed, err := newTaskCallerLifetime(client)
			if err != nil {
				t.Fatal(err)
			}
			type outcome struct {
				result originalclient.TaskAuthorityResult
				err    error
			}
			done := make(chan outcome, 1)
			go func() {
				var r originalclient.TaskAuthorityResult
				var e error
				if query {
					r, e = managed.QueryOriginalEffect(context.Background(), call)
				} else {
					r, e = managed.AuthorizeAtEffect(context.Background(), call)
				}
				done <- outcome{r, e}
			}()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("caller did not enter")
			}
			if err := managed.Retire(); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := managed.Join(ctx); err != nil {
				t.Fatal(err)
			}
			result := <-done
			if !errors.Is(result.err, cause) || !errors.Is(result.err, context.Canceled) || !errors.Is(result.err, errTaskCallerRetired) || result.result.OriginalOperation != op || result.result.State != "UNKNOWN" {
				t.Fatalf("partial/failure changed: %+v %v", result.result, result.err)
			}
			if err := managed.Current(context.Background()); !errors.Is(err, errTaskCallerRetired) {
				t.Fatal(err)
			}
			if _, err := managed.AuthorizeAtEffect(context.Background(), call); !errors.Is(err, errTaskCallerRetired) {
				t.Fatal(err)
			}
			if _, err := managed.QueryOriginalEffect(context.Background(), call); !errors.Is(err, errTaskCallerRetired) {
				t.Fatal(err)
			}
			if query && (client.queryCalls.Load() != 1 || client.effectCalls.Load() != 0) || !query && (client.effectCalls.Load() != 1 || client.queryCalls.Load() != 0) || client.currentCalls.Load() != 0 {
				t.Fatal("retirement retried or changed original operation")
			}
		})
	}
}

func TestP08TaskCallerLifetimeJoinWaitsActualReturn(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	client := &p08CallerLifetimeFixture{current: func(context.Context) error { close(started); <-release; return nil }}
	managed, err := newTaskCallerLifetime(client)
	if err != nil {
		t.Fatal(err)
	}
	if err := managed.Join(context.Background()); !errors.Is(err, errTaskCallerNotRetired) {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- managed.Current(context.Background()) }()
	<-started
	if err := managed.Retire(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Millisecond)
	if err := managed.Join(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("undrained callback reported completion: %v", err)
	}
	cancel()
	select {
	case err := <-done:
		t.Fatalf("callback ended before actual return: %v", err)
	default:
	}
	close(release)
	if err := <-done; !errors.Is(err, context.Canceled) || !errors.Is(err, errTaskCallerRetired) {
		t.Fatalf("late success escaped retirement: %v", err)
	}
	if err := managed.Join(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestP08TaskCallerLifetimePanicStillReleasesLease(t *testing.T) {
	for _, operation := range []string{"current", "effect", "query"} {
		t.Run(operation, func(t *testing.T) {
			client := &p08CallerLifetimeFixture{current: func(context.Context) error { panic("PUBLIC callee panic") }}
			client.effect = func(context.Context, originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
				panic("PUBLIC callee panic")
			}
			client.query = client.effect
			managed, err := newTaskCallerLifetime(client)
			if err != nil {
				t.Fatal(err)
			}
			func() {
				defer func() {
					if recover() != "PUBLIC callee panic" {
						t.Error("callee panic replaced or swallowed")
					}
				}()
				switch operation {
				case "current":
					_ = managed.Current(context.Background())
				case "effect":
					_, _ = managed.AuthorizeAtEffect(context.Background(), originalclient.TaskAuthorityCall{})
				case "query":
					_, _ = managed.QueryOriginalEffect(context.Background(), originalclient.TaskAuthorityCall{})
				}
			}()
			if err := managed.Retire(); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := managed.Join(ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestP08TaskCallerOwnerCloseRetainsUndrainedCall(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	client := &p08CallerLifetimeFixture{current: func(context.Context) error { close(started); <-release; return nil }}
	managed, err := newTaskCallerLifetime(client)
	if err != nil {
		t.Fatal(err)
	}
	p := &PreparedOriginalTaskRuntime{owners: &originalTaskRuntimeOwners{calls: managed}}
	callDone := make(chan error, 1)
	go func() { callDone <- managed.Current(context.Background()) }()
	<-started
	closed := make(chan error, 1)
	go func() { closed <- p.Close() }()
	// Retire rejects the next use while the prior callback still owns custody.
	deadline := time.After(time.Second)
	for {
		managed.mu.Lock()
		retired := managed.retired
		managed.mu.Unlock()
		if retired {
			break
		}
		select {
		case <-deadline:
			t.Fatal("owner did not retire")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	select {
	case err := <-closed:
		t.Fatalf("owner fabricated drain: %v", err)
	default:
	}
	close(release)
	if err := <-callDone; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("owner did not close after actual return")
	}
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
}
