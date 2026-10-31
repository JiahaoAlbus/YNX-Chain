package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNativeSourceSurvivesActualHTTPDrainTimeout(t *testing.T) {
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
		_, _ = w.Write([]byte("original request completed"))
	}))
	t.Cleanup(server.Close)
	// A real admitted HTTP request remains blocked while Shutdown expires.
	go func() {
		response, err := server.Client().Get(server.URL)
		if err == nil {
			_, err = io.Copy(io.Discard, response.Body)
			_ = response.Body.Close()
		}
		finished <- err
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	drainErr := server.Config.Shutdown(ctx)
	closed := 0
	closeSource := func() error { closed++; return nil }
	cleanupErr := closeNativePayAfterDrain(drainErr, closeSource)
	close(release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if !errors.Is(drainErr, context.DeadlineExceeded) || cleanupErr != drainErr || closed != 0 {
		t.Fatalf("failed drain released Source or lost cause: drain=%v cleanup=%v closes=%d", drainErr, cleanupErr, closed)
	}
	// Once that same real request has completed, the normal close is permitted.
	if err := server.Config.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := closeNativePayAfterDrain(nil, closeSource); err != nil || closed != 1 {
		t.Fatalf("successful drain did not close once: error=%v closes=%d", err, closed)
	}
}
