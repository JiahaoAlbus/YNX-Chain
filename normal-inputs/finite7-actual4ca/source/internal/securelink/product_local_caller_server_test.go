//go:build linux || darwin

package securelink

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestProductPrivateArchiveServerOriginalCaller(t *testing.T) {
	request := productPrivateTestRequest(12)
	route := LocalCallerRoute{Method: http.MethodGet, Path: request.path, Timeout: 2 * time.Second}
	cfg := LocalCallerServerConfig{Service: "product-archive", PeerUID: uint32(os.Getuid()), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}}
	cfg.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.RequestURI != request.path || r.URL.RawPath != request.path {
			t.Errorf("wire path changed: %q %q", r.RequestURI, r.URL.RawPath)
		}
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Errorf("original Unix caller: %v", err)
			http.Error(w, "denied", 403)
			return
		}
		if err = caller.CurrentOriginalCaller(r); err != nil {
			t.Errorf("same-request fence: %v", err)
		}
		if caller.CurrentOriginalCaller(r.Clone(r.Context())) == nil {
			t.Error("cloned request acquired original capability")
		}
		w.Header().Add("X-Public-Original", "first")
		w.Header().Add("X-Public-Original", "second")
		_, _ = w.Write([]byte("PUBLIC archive"))
	})
	if _, err := NewLocalCallerServer(cfg); err == nil {
		t.Fatal("ordinary constructor expanded escaped-path policy")
	}
	server, err := NewProductLocalCallerServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	socket, listener := localTestSocket(t)
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	t.Cleanup(func() {
		_ = server.Retire()
		_ = listener.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := server.Join(ctx); err != nil {
			t.Error(err)
		}
		select {
		case <-done:
		case <-ctx.Done():
			t.Error("real Unix server did not drain")
		}
	})
	owner, err := newProductPrivateClient(context.Background(), productPrivateProfile{enabled: 1 << 12, cfg: LocalCallerClientConfig{
		SocketPath: socket, Service: cfg.Service, PeerUID: cfg.PeerUID, PeerPID: cfg.PeerPID,
		Timeout: 2 * time.Second, MaxHeaderBytes: 4096, MaxResponseBytes: 4096,
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer owner.retire()
	out, err := owner.request(request, func() error { return nil })
	if err != nil || !out.BodyComplete || string(out.Body) != "PUBLIC archive" || out.RequestPath != request.path || len(out.Header.Values("X-Public-Original")) != 2 {
		t.Fatalf("actual Unix archive response mismatch: %+v %v", out, err)
	}
}

func TestProductPrivateArchiveServerRejectsAliases(t *testing.T) {
	path := productPrivateTestRequest(12).path
	for _, bad := range []string{
		strings.Replace(path, "%3A", "%253A", 1), strings.Replace(path, "%3A", "%3a", 1),
		strings.Replace(path, "%3A", "%2F", 1), strings.Replace(path, "%3A", ":", 1),
		path + "?x=1", path + "#fragment", path + "/", "/ordinary%3Aroute",
	} {
		cfg := LocalCallerServerConfig{Service: "product-archive", PeerUID: uint32(os.Getuid()), PeerPID: os.Getpid(), Handler: http.NotFoundHandler(),
			Routes: []LocalCallerRoute{{Method: http.MethodGet, Path: bad, Timeout: time.Second}}}
		if _, err := NewProductLocalCallerServer(cfg); err == nil {
			t.Fatalf("noncanonical archive route registered: %q", bad)
		}
	}
}
