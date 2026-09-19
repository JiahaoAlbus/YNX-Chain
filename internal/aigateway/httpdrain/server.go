// Package httpdrain owns the process lifetime of the two AI HTTP services.
package httpdrain

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"
)

func ListenAndServe(server *http.Server, timeout time.Duration) error {
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	return Serve(server, listener, timeout)
}

// Serve installs process signal handling and blocks until draining finishes.
// The caller must propagate a returned error to a nonzero process exit.
// BaseContext is owned here so deadline expiry can cancel every request.
func Serve(server *http.Server, listener net.Listener, timeout time.Duration) error {
	if timeout <= 0 || server.BaseContext != nil {
		_ = listener.Close()
		return errors.New("AI HTTP drain requires a positive timeout and an unset BaseContext")
	}
	signals, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	requests, cancelRequests := context.WithCancel(context.Background())
	defer cancelRequests()
	server.BaseContext = func(net.Listener) context.Context { return requests }
	var draining atomic.Bool
	handler := server.Handler
	if handler == nil {
		handler = http.DefaultServeMux
	}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if draining.Load() {
			w.Header().Set("Connection", "close")
			w.Header().Set("Cache-Control", "no-store")
			http.Error(w, "AI service is draining", http.StatusServiceUnavailable)
			return
		}
		handler.ServeHTTP(w, r)
	})
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	select {
	case err := <-served:
		cancelRequests()
		_ = server.Close()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-signals.Done():
		draining.Store(true)
	}
	log.Printf("AI HTTP drain started; deadline=%s", timeout)
	drain, cancelDrain := context.WithTimeout(context.Background(), timeout)
	defer cancelDrain()
	if err := server.Shutdown(drain); err != nil {
		cancelRequests()
		closeErr := server.Close()
		<-served
		return fmt.Errorf("AI HTTP drain failed; in-flight requests cancelled: %w", errors.Join(err, closeErr))
	}
	if err := <-served; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Print("AI HTTP drain completed; all HTTP handlers returned")
	return nil
}
