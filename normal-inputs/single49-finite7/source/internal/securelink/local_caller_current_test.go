//go:build linux || darwin

package securelink

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func originalCallerRoute() LocalCallerRoute {
	r := localTestRoute()
	r.Timeout = 5 * time.Second
	return r
}

func originalCallerCall(ctx context.Context, c *LocalCallerClient) <-chan error {
	done := make(chan error, 1)
	go func() {
		_, err := c.Call(ctx, http.MethodPost, "/authority/prepare", "application/json", []byte(`{"opaque":"original"}`))
		done <- err
	}()
	return done
}

func requireOriginalCallerDenied(t *testing.T, c *LocalCaller, r *http.Request) {
	t.Helper()
	if err := c.CurrentOriginalCaller(r); !errors.Is(err, ErrDenied) {
		t.Fatalf("unbound original caller accepted or first error changed: %v", err)
	}
}

// Its callbacks must never be reached: the exact original request context is
// checked first, and only the private mint context may be consulted afterward.
type originalCallerUntrustedContext struct {
	context.Context
	called *atomic.Int32
}

func (c originalCallerUntrustedContext) Value(any) any         { c.called.Add(1); return nil }
func (c originalCallerUntrustedContext) Err() error            { c.called.Add(1); return context.Canceled }
func (c originalCallerUntrustedContext) Done() <-chan struct{} { c.called.Add(1); return nil }
func (c originalCallerUntrustedContext) Deadline() (time.Time, bool) {
	c.called.Add(1)
	return time.Time{}, false
}

func TestLocalCallerCurrentOriginalCallerIdentityBodyAndNoLockReentry(t *testing.T) {
	captured := make(chan localCaptured, 2)
	release := make(chan struct{})
	s, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			return
		}
		// Auth's full fresh capture still owns and verifies original body/UID/PID.
		m, err := caller.Current(r.Context())
		if err != nil || string(m.RequestBody) != `{"opaque":"original"}` {
			t.Error("full original OS capture failed", err)
			return
		}
		var decoded struct {
			Opaque string `json:"opaque"`
		}
		if err = json.NewDecoder(r.Body).Decode(&decoded); err != nil || decoded.Opaque != "original" {
			t.Error("normal body decoder failed", err)
			return
		}
		// A normal decoder may consume/close or replace its independent reader.
		// The sync lifetime getter does not read or clone that body again.
		_ = r.Body.Close()
		r.Body = io.NopCloser(strings.NewReader("decoded"))
		captured <- localCaptured{caller, r}
		<-release
		w.WriteHeader(http.StatusNoContent)
	}), originalCallerRoute())
	done1 := originalCallerCall(context.Background(), client)
	done2 := originalCallerCall(context.Background(), client)
	first, second := <-captured, <-captured
	released := false
	defer func() {
		if !released {
			close(release)
		}
	}()
	if err := first.caller.CurrentOriginalCaller(first.request); err != nil {
		t.Fatal("same original request refused", err)
	}
	alias := *first.caller
	if err := alias.CurrentOriginalCaller(first.request); err != nil {
		t.Fatal("handle value copy changed original shared lifetime", err)
	}
	requireOriginalCallerDenied(t, first.caller, second.request)
	requireOriginalCallerDenied(t, second.caller, first.request)
	requireOriginalCallerDenied(t, nil, first.request)
	requireOriginalCallerDenied(t, new(LocalCaller), first.request)
	requireOriginalCallerDenied(t, first.caller, nil)
	var fromJSON LocalCaller
	if err := json.Unmarshal([]byte(`{"Service":"auth-native","PeerUID":501,"PeerPID":123}`), &fromJSON); err != nil {
		t.Fatal(err)
	}
	requireOriginalCallerDenied(t, &fromJSON, first.request)
	copyRequest := *first.request
	requireOriginalCallerDenied(t, first.caller, &copyRequest)
	requireOriginalCallerDenied(t, first.caller, first.request.Clone(first.request.Context()))
	newRequest := httptest.NewRequest(http.MethodPost, "http://auth-native/authority/prepare", nil).WithContext(first.request.Context())
	newRequest.Header = first.request.Header.Clone()
	requireOriginalCallerDenied(t, first.caller, newRequest)
	// Holding the server lock models an external owner already holding its
	// Store/request lease lock. This method cannot acquire server/Store locks or
	// re-enter the full Current/FromRequest material acquisition path.
	s.mu.Lock()
	returned := make(chan error, 1)
	go func() { returned <- first.caller.CurrentOriginalCaller(first.request) }()
	select {
	case err := <-returned:
		s.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		s.mu.Unlock()
		t.Fatal("sync current re-entered a held server lock")
	}
	// Change only the original request while its handler is parked. No request
	// fields are mutated concurrently with a handler or another getter.
	for name, mutate := range map[string]func(*http.Request){
		"method":          func(r *http.Request) { r.Method = http.MethodGet },
		"host":            func(r *http.Request) { r.Host = "other-service" },
		"raw-target":      func(r *http.Request) { r.RequestURI += "?forged=1" },
		"path":            func(r *http.Request) { r.URL.Path = "/authority/other" },
		"query":           func(r *http.Request) { r.URL.RawQuery = "forged=1" },
		"absolute-url":    func(r *http.Request) { r.URL.Scheme = "http"; r.URL.Host = "auth-native" },
		"raw-path-alias":  func(r *http.Request) { r.URL.RawPath = "/%61uthority/prepare" },
		"url-user":        func(r *http.Request) { r.URL.User = url.User("forged") },
		"nil-url":         func(r *http.Request) { r.URL = nil },
		"mime":            func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") },
		"duplicate-mime":  func(r *http.Request) { r.Header.Add("Content-Type", "application/json") },
		"length":          func(r *http.Request) { r.ContentLength++ },
		"protocol":        func(r *http.Request) { r.ProtoMinor = 0 },
		"identity-header": func(r *http.Request) { r.Header.Set("X-Caller-PID", "123") },
		"context-copy": func(r *http.Request) {
			*r = *r.WithContext(context.WithValue(r.Context(), struct{ N int }{1}, "copied"))
		},
		"private-token-context-copy": func(r *http.Request) {
			*r = *r.WithContext(context.WithValue(r.Context(), localCallerKey{}, first.caller))
		},
	} {
		t.Run(name, func(t *testing.T) {
			saved := *first.request
			if saved.URL != nil {
				u := *saved.URL
				first.request.URL = &u
			}
			first.request.Header = saved.Header.Clone()
			mutate(first.request)
			requireOriginalCallerDenied(t, first.caller, first.request)
			*first.request = saved
			if err := first.caller.CurrentOriginalCaller(first.request); err != nil {
				t.Fatal("restored exact request lost lifecycle", err)
			}
		})
	}
	var callbacks atomic.Int32
	saved := *first.request
	*first.request = *first.request.WithContext(originalCallerUntrustedContext{Context: saved.Context(), called: &callbacks})
	requireOriginalCallerDenied(t, first.caller, first.request)
	*first.request = saved
	if callbacks.Load() != 0 {
		t.Fatal("sync getter invoked caller-supplied context callbacks")
	}
	// The registered peer binding is immutable production state; these private
	// package negative controls ensure this getter itself refuses wrong mint data.
	savedUID, savedPID := first.caller.state.material.PeerUID, first.caller.state.material.PeerPID
	first.caller.state.material.PeerUID++
	requireOriginalCallerDenied(t, first.caller, first.request)
	first.caller.state.material.PeerUID = savedUID
	first.caller.state.material.PeerPID++
	requireOriginalCallerDenied(t, first.caller, first.request)
	first.caller.state.material.PeerPID = savedPID
	close(release)
	released = true
	if err := <-done1; err != nil {
		t.Fatal(err)
	}
	if err := <-done2; err != nil {
		t.Fatal(err)
	}
	if err := alias.CurrentOriginalCaller(first.request); err == nil {
		t.Fatal("handle copy remained valid after handler return")
	}
}

func TestLocalCallerCurrentOriginalCallerObservedLifecycle(t *testing.T) {
	for _, mode := range []string{"handler-return", "client-cancel", "timeout", "retire", "close", "connection-close"} {
		t.Run(mode, func(t *testing.T) {
			captured := make(chan localCaptured, 1)
			release := make(chan struct{})
			route := originalCallerRoute()
			if mode == "timeout" {
				route.Timeout = 70 * time.Millisecond
			}
			s, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				c, err := LocalCallerFromRequest(r)
				if err != nil {
					t.Error(err)
					return
				}
				captured <- localCaptured{c, r}
				<-release
				w.WriteHeader(http.StatusNoContent)
			}), route)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := originalCallerCall(ctx, client)
			cap := <-captured
			if err := cap.caller.CurrentOriginalCaller(cap.request); err != nil {
				t.Fatal(err)
			}
			released := false
			defer func() {
				if !released {
					close(release)
				}
			}()
			switch mode {
			case "handler-return":
				close(release)
				released = true
				if err := <-done; err != nil {
					t.Fatal(err)
				}
			case "client-cancel":
				cancel()
			case "retire":
				if err := s.Retire(); err != nil {
					t.Fatal(err)
				}
			case "close":
				if err := s.Close(); !errors.Is(err, ErrLocalCallerDraining) {
					t.Fatal("Close falsely reported drained handler", err)
				}
			case "connection-close":
				_ = cap.caller.state.conn.Close()
			}
			if mode != "handler-return" {
				// Remote client close is asynchronous. The memory-only contract starts
				// from the actual ORIGINAL server context observing cancellation/EOF.
				select {
				case <-cap.request.Context().Done():
				case <-time.After(time.Second):
					t.Fatal("original server request did not observe its lifecycle ending")
				}
				want := cap.request.Context().Err()
				if want == nil {
					t.Fatal("missing original context first cause")
				}
				if err := cap.caller.CurrentOriginalCaller(cap.request); !errors.Is(err, want) {
					t.Fatal("original context first cause replaced", err, want)
				}
				close(release)
				released = true
				<-done
			}
			if err := cap.caller.CurrentOriginalCaller(cap.request); err == nil {
				t.Fatal("ended observed lifecycle was accepted")
			}
		})
	}
}

func TestLocalCallerCurrentOriginalCallerRaceWithObservedCancellation(t *testing.T) {
	captured := make(chan localCaptured, 1)
	release := make(chan struct{})
	_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			return
		}
		captured <- localCaptured{c, r}
		<-release
	}), originalCallerRoute())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := originalCallerCall(ctx, client)
	cap := <-captured
	started := make(chan struct{}, 8)
	stop := make(chan struct{})
	var workers sync.WaitGroup
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			started <- struct{}{}
			for {
				select {
				case <-stop:
					return
				default:
					_ = cap.caller.CurrentOriginalCaller(cap.request)
				}
			}
		}()
	}
	for i := 0; i < 8; i++ {
		<-started
	}
	cancel()
	select {
	case <-cap.request.Context().Done():
	case <-time.After(time.Second):
		close(stop)
		workers.Wait()
		close(release)
		t.Fatal("original request did not observe cancellation")
	}
	close(stop)
	workers.Wait()
	for i := 0; i < 32; i++ {
		if err := cap.caller.CurrentOriginalCaller(cap.request); !errors.Is(err, context.Canceled) {
			t.Fatal("observed cancellation accepted or cause lost", err)
		}
	}
	close(release)
	<-done
}
