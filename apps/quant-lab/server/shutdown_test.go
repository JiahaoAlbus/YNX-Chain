package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestShutdownJoinsAdmittedHTTPHandlerEvenAfterGraceExpires(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered, cancelled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(cancelled)
		<-release
	})}
	done := make(chan error, 1)
	go func() { done <- serveUntilShutdown(ctx, srv, listener, 10*time.Millisecond) }()
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		client := &http.Client{Timeout: 2 * time.Second}
		response, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			response.Body.Close()
		}
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("request not admitted")
	}
	cancel()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("handler context not cancelled")
	}
	select {
	case err := <-done:
		t.Fatalf("returned while handler could still use storage: %v", err)
	case <-time.After(40 * time.Millisecond):
	}
	close(release)
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("shutdown result %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("handler join did not finish")
	}
	<-clientDone
	// Late admission cannot touch the wrapped business handler/storage.
	recorder := &shutdownResponse{header: make(http.Header)}
	srv.Handler.ServeHTTP(recorder, &http.Request{})
	if recorder.status != http.StatusServiceUnavailable {
		t.Fatal("late handler admitted")
	}
}

type shutdownResponse struct {
	header http.Header
	status int
}

func TestShutdownDrainsCooperativeHandlerSuccessfully(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
	})}
	done := make(chan error, 1)
	go func() { done <- serveUntilShutdown(ctx, srv, listener, time.Second) }()
	go func() {
		client := &http.Client{Timeout: time.Second}
		response, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			response.Body.Close()
		}
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("request not admitted")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("graceful shutdown did not finish")
	}
}

func (r *shutdownResponse) Header() http.Header         { return r.header }
func (r *shutdownResponse) WriteHeader(code int)        { r.status = code }
func (r *shutdownResponse) Write(p []byte) (int, error) { return len(p), nil }
