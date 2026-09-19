package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"
)

func serveHTTPUntilShutdown(ctx context.Context, server *http.Server, timeout time.Duration) error {
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	return serveAndDrainHTTP(ctx, server, listener, timeout)
}

// Do not return to the caller (which may close persistent state) until every
// admitted handler has returned. Shutdown alone only closes the listener before
// Serve returns; the HTTP drain must also finish before process teardown.
func serveAndDrainHTTP(ctx context.Context, server *http.Server, listener net.Listener, timeout time.Duration) error {
	handler := server.Handler
	if handler == nil {
		handler = http.DefaultServeMux
	}
	var admission sync.Mutex
	var active sync.WaitGroup
	draining := false
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		admission.Lock()
		if draining {
			admission.Unlock()
			w.Header().Set("Connection", "close")
			w.Header().Set("Cache-Control", "no-store")
			http.Error(w, "service is shutting down", http.StatusServiceUnavailable)
			return
		}
		active.Add(1)
		admission.Unlock()
		defer active.Done()
		handler.ServeHTTP(w, r)
	})
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	var serveErr error
	select {
	case serveErr = <-served:
	case <-ctx.Done():
	}
	// Serialize the final admission with Wait: no handler can increment active
	// after this gate closes, including a connection racing listener shutdown.
	admission.Lock()
	draining = true
	admission.Unlock()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	shutdownErr := server.Shutdown(shutdownCtx)
	var closeErr error
	if shutdownErr != nil {
		// Close cancels active request contexts, but does not wait for their handlers.
		closeErr = server.Close()
	}
	active.Wait()
	if serveErr == nil {
		serveErr = <-served
	}
	if errors.Is(serveErr, http.ErrServerClosed) {
		serveErr = nil
	}
	return errors.Join(serveErr, shutdownErr, closeErr)
}
