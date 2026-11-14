//go:build pay_pq && pay_localcaller_current && (darwin || linux)

package payproduct

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// Combined production LINK caller + original Pay Store delta. The body carries
// only a fixture reference; it is never a Root, bill, Source or spend grant.
func TestNativeMerchantFenceOriginalLocalCallerAndStoreCommit(t *testing.T) {
	base := os.Getenv("PAY_NATIVE_CALLER_SOCKET_ROOT")
	if base == "" {
		t.Skip("requires explicit owned short external Unix socket root")
	}
	if !filepath.IsAbs(base) || os.Geteuid() == 0 {
		t.Fatal("absolute socket root and non-root registered OS peer required")
	}
	dir, err := os.MkdirTemp(base, "pc-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(dir, "s")
	listener, err := securelink.ListenPrivate(socket, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	store, id, principal, account := merchantFenceFixture(t)
	captured, release, handlerDone := make(chan error, 1), make(chan struct{}), make(chan error, 1)
	route := securelink.LocalCallerRoute{Method: http.MethodPost, Path: "/fixture/original-pay-current", MaxBodyBytes: 1024, Timeout: 5 * time.Second}
	server, err := securelink.NewLocalCallerServer(securelink.LocalCallerServerConfig{Service: "pay-source-fixture", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: []securelink.LocalCallerRoute{route}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, e := securelink.LocalCallerFromRequest(r)
		if e != nil {
			captured <- e
			return
		}
		material, e := caller.Current(r.Context())
		if e != nil || string(material.RequestBody) != `{"original":"bill-reference"}` {
			if e == nil {
				e = errors.New("original body changed")
			}
			captured <- e
			return
		}
		var decoded struct {
			Original string `json:"original"`
		}
		if e = json.NewDecoder(r.Body).Decode(&decoded); e != nil || decoded.Original != "bill-reference" {
			if e == nil {
				e = errors.New("decoder lost original reference")
			}
			captured <- e
			return
		}
		role, e := store.CaptureNativeMerchantFence(id, principal, principal, true)
		if e != nil {
			captured <- e
			return
		}
		current := func() error {
			if e := caller.CurrentOriginalCaller(r); e != nil {
				return e
			}
			return role.Current()
		}
		e = store.Update(func(*Snapshot) error { return current() })
		captured <- e
		if e != nil {
			return
		}
		select {
		case <-release:
		case <-r.Context().Done():
			handlerDone <- r.Context().Err()
			return
		}
		e = store.Update(func(data *Snapshot) error {
			if e := current(); e != nil {
				return e
			}
			if data.BusinessDispatches == nil {
				data.BusinessDispatches = map[string]BusinessDispatchRecord{}
			}
			data.BusinessDispatches["forbidden-after-revoke"] = BusinessDispatchRecord{}
			return nil
		})
		handlerDone <- e
		if e != nil {
			nativePayError(w, e)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})})
	if err != nil {
		t.Fatal(err)
	}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	defer func() {
		_ = server.Close()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if e := server.Join(ctx); e != nil {
			t.Error("original caller did not drain", e)
		}
		if e := <-served; e != nil && !errors.Is(e, http.ErrServerClosed) {
			t.Error(e)
		}
	}()
	client, err := securelink.NewLocalCallerClient(securelink.LocalCallerClientConfig{SocketPath: socket, Service: "pay-source-fixture", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: []securelink.LocalCallerRoute{route}, Timeout: 5 * time.Second, MaxResponseBytes: 4096})
	if err != nil {
		t.Fatal(err)
	}
	callContext, cancelCall := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelCall()
	response := make(chan error, 1)
	go func() {
		result, e := client.Call(callContext, http.MethodPost, route.Path, "application/json", []byte(`{"original":"bill-reference"}`))
		if e == nil && result.StatusCode != 503 {
			e = errors.New("original private caller did not receive authority refusal")
		}
		response <- e
	}()
	select {
	case err = <-captured:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("combined original caller/role Current re-entered Store or stalled")
	}
	if err = store.Update(func(data *Snapshot) error {
		key := id + ":" + account
		m := data.MerchantMembers[key]
		m.Status = "revoked"
		data.MerchantMembers[key] = m
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	close(release)
	select {
	case err = <-handlerDone:
		if !errors.Is(err, ErrNativeMerchantFenceUnavailable) {
			t.Fatal("same original caller bypassed committed role revoke", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("final combined Store commit stalled")
	}
	if err = <-response; err != nil {
		t.Fatal(err)
	}
	_ = store.View(func(data Snapshot) error {
		if _, ok := data.BusinessDispatches["forbidden-after-revoke"]; ok {
			t.Fatal("revoked combined source committed mutation")
		}
		return nil
	})
}
