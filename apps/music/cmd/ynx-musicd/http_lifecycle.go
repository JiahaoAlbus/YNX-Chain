package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

// runHTTPServer binds before serving so a startup error cannot become a clean
// signal exit. This is entry-local lifecycle code, not a business authority.
func runHTTPServer(ctx context.Context, server *http.Server, timeout time.Duration) error {
	if ctx == nil || server == nil || timeout <= 0 {
		return errors.New("HTTP lifecycle configuration unavailable")
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	return serveAndDrainHTTP(ctx, server, listener, timeout)
}

func serveAndDrainHTTP(ctx context.Context, server *http.Server, listener net.Listener, timeout time.Duration) error {
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	select {
	case err := <-served:
		// Even ErrServerClosed is unexpected until THIS caller initiates shutdown.
		return err
	case <-ctx.Done():
		drain, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		err := server.Shutdown(drain)
		if err != nil {
			closeErr := server.Close()
			serveErr := <-served
			if errors.Is(serveErr, http.ErrServerClosed) {
				serveErr = nil
			}
			return fmt.Errorf("HTTP shutdown unconfirmed: %w", errors.Join(err, closeErr, serveErr))
		}
		serveErr := <-served
		if !errors.Is(serveErr, http.ErrServerClosed) {
			return serveErr
		}
		return nil
	}
}
