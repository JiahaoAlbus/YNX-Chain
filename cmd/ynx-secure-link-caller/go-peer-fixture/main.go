// go-peer-fixture is an isolated Unix transport test peer, not an Auth source.
// It echoes owned opaque bytes only after the real LocalCaller.Current boundary.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func main() {
	if len(os.Args) != 4 {
		panic("usage: go-peer-fixture socket clientUID clientPID")
	}
	uid, err := strconv.ParseUint(os.Args[2], 10, 32)
	if err != nil {
		panic(err)
	}
	pid, err := strconv.Atoi(os.Args[3])
	if err != nil {
		panic(err)
	}
	listener, err := securelink.ListenPrivate(os.Args[1], uint32(os.Geteuid()))
	if err != nil {
		panic(err)
	}
	defer listener.Close()
	routes := []securelink.LocalCallerRoute{
		{Method: "POST", Path: "/internal/auth/task-grants/effect", MaxBodyBytes: 1 << 20, Timeout: time.Second},
		{Method: "POST", Path: "/internal/auth/task-grants/effect-query", MaxBodyBytes: 1 << 20, Timeout: time.Second},
	}
	server, err := securelink.NewLocalCallerServer(securelink.LocalCallerServerConfig{Service: "isolated-auth", PeerUID: uint32(uid), PeerPID: pid, Routes: routes, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, err := securelink.LocalCallerFromRequest(r)
		if err != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		fromContext, err := securelink.LocalCallerFromContext(r.Context())
		if err != nil || fromContext != caller {
			http.Error(w, "unavailable", 503)
			return
		}
		actual, err := caller.Current(r.Context())
		if err != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(body, actual.RequestBody) || actual.ContentType != "application/json" {
			http.Error(w, "unavailable", 503)
			return
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"event": "request", "peerPID": actual.PeerPID, "peerUID": actual.PeerUID, "path": actual.Path})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})})
	if err != nil {
		panic(err)
	}
	defer server.Close()
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"event": "ready", "pid": os.Getpid(), "uid": os.Geteuid()})
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() { <-ctx.Done(); _ = server.Close() }()
	if err = server.Serve(listener); err != nil && ctx.Err() == nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
