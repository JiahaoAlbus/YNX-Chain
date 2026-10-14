package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"
)

func awaitLifecycle[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(3 * time.Second):
		t.Fatal("lifecycle did not settle")
		var zero T
		return zero
	}
}

func TestHTTPDrainWaitsForAcceptedRequestAndStopsNewAccept(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "retained request")
	})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer server.Close()
	ended := make(chan error, 1)
	go func() { ended <- serveAndDrainHTTP(ctx, server, listener, time.Second) }()
	client := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	defer client.CloseIdleConnections()
	reply := make(chan error, 1)
	go func() {
		r, e := client.Get("http://" + listener.Addr().String())
		if e == nil {
			b, readErr := io.ReadAll(r.Body)
			r.Body.Close()
			e = readErr
			if string(b) != "retained request" {
				e = errors.New("accepted response lost")
			}
		}
		reply <- e
	}()
	awaitLifecycle(t, started)
	cancel()
	deadline := time.Now().Add(time.Second)
	for {
		c, e := net.DialTimeout("tcp", listener.Addr().String(), 20*time.Millisecond)
		if e != nil {
			break
		}
		c.Close()
		if time.Now().After(deadline) {
			t.Fatal("shutdown kept accepting")
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case err := <-ended:
		t.Fatalf("returned before accepted handler finished: %v", err)
	default:
	}
	once.Do(func() { close(release) })
	if err = awaitLifecycle(t, reply); err != nil {
		t.Fatal(err)
	}
	if err = awaitLifecycle(t, ended); err != nil {
		t.Fatal(err)
	}
}

func TestHTTPDrainDeadlineClosesActiveConnectionAndReportsError(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	closed := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done(); close(closed) })}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer server.Close()
	ended := make(chan error, 1)
	go func() { ended <- serveAndDrainHTTP(ctx, server, listener, 30*time.Millisecond) }()
	client := &http.Client{Timeout: time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	defer client.CloseIdleConnections()
	reply := make(chan error, 1)
	go func() {
		r, e := client.Get("http://" + listener.Addr().String())
		if r != nil {
			r.Body.Close()
		}
		reply <- e
	}()
	awaitLifecycle(t, started)
	cancel()
	err = awaitLifecycle(t, ended)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline error hidden: %v", err)
	}
	awaitLifecycle(t, closed)
	if awaitLifecycle(t, reply) == nil {
		t.Fatal("active connection was not closed")
	}
}

func TestHTTPBindFailureIsNotHiddenByCancellation(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	for _, cancelled := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		if cancelled {
			cancel()
		}
		err = runHTTPServer(ctx, &http.Server{Addr: listener.Addr().String()}, time.Second)
		cancel()
		var bind *net.OpError
		if !errors.As(err, &bind) {
			t.Fatalf("bind failure hidden: %v", err)
		}
	}
}

func TestHTTPUnexpectedServeFailureIsReturned(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	listener.Close()
	err = serveAndDrainHTTP(context.Background(), &http.Server{}, listener, time.Second)
	if err == nil || errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected serve failure hidden: %v", err)
	}
}

func TestHTTPAlreadyCancelledCanStopWithoutRequests(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err = serveAndDrainHTTP(ctx, &http.Server{}, listener, time.Second); err != nil {
		t.Fatal(err)
	}
}
