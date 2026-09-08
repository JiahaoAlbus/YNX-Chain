package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func shutdownFixture(t *testing.T, handler http.Handler, timeout time.Duration) (context.CancelFunc, *http.Server, string, <-chan error) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	server := &http.Server{Handler: handler, ReadHeaderTimeout: time.Second}
	done := make(chan error, 1)
	go func() { done <- serveAndDrainHTTP(ctx, server, listener, timeout) }()
	t.Cleanup(func() { cancel(); _ = server.Close() })
	return cancel, server, listener.Addr().String(), done
}

func awaitShutdownChannel(t *testing.T, ch <-chan struct{}, message string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal(message)
	}
}

func waitListenerClosed(t *testing.T, address string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", address, 50*time.Millisecond)
		if err != nil {
			return
		}
		_ = conn.Close()
		time.Sleep(time.Millisecond)
	}
	t.Fatal("listener still admits connections after shutdown")
}

func TestHTTPShutdownWaitsForAdmittedHandler(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	var admitted atomic.Int32
	cancel, server, address, done := shutdownFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if admitted.Add(1) == 1 {
			close(entered)
		}
		<-release
		_, _ = io.WriteString(w, "completed")
	}), time.Second)
	clientResult := make(chan error, 1)
	go func() {
		client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}, Timeout: 3 * time.Second}
		response, err := client.Get("http://" + address + "/admitted")
		if err == nil {
			defer response.Body.Close()
			var body []byte
			body, err = io.ReadAll(response.Body)
			if err == nil && (response.StatusCode != http.StatusOK || string(body) != "completed") {
				err = errors.New("admitted response was lost")
			}
		}
		clientResult <- err
	}()
	awaitShutdownChannel(t, entered, "request not admitted")
	cancel()
	waitListenerClosed(t, address)
	// Model a connection which reached dispatch concurrently with listener close.
	// It must not start a new handler once the drain has started.
	rejected := httptest.NewRecorder()
	server.Handler.ServeHTTP(rejected, httptest.NewRequest(http.MethodGet, "/late", nil))
	if rejected.Code != http.StatusServiceUnavailable || admitted.Load() != 1 {
		t.Fatal("shutdown admitted a new handler")
	}
	select {
	case err := <-done:
		t.Fatalf("returned before admitted handler completed: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	unblock()
	select {
	case err := <-clientResult:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("admitted response did not complete")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not complete")
	}
}

func TestHTTPShutdownTimeoutCancelsThenWaitsForHandler(t *testing.T) {
	entered, canceled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	cancel, _, address, done := shutdownFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(canceled)
		<-release // Cleanup may still touch persistent state after context cancellation.
	}), 20*time.Millisecond)
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}, Timeout: 3 * time.Second}
		response, err := client.Get("http://" + address + "/held")
		if err == nil {
			_ = response.Body.Close()
		}
	}()
	awaitShutdownChannel(t, entered, "request not admitted")
	cancel()
	awaitShutdownChannel(t, canceled, "timeout did not cancel active request context")
	select {
	case err := <-done:
		t.Fatalf("returned before canceled handler cleanup finished: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	unblock()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("timeout must remain observable: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not finish cleanup")
	}
	awaitShutdownChannel(t, clientDone, "client did not exit")
}

func TestHTTPShutdownReturnsListenerFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_ = listener.Close()
	if err := serveAndDrainHTTP(context.Background(), &http.Server{}, listener, time.Second); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("lost listener failure: %v", err)
	}
}
