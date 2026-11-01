//go:build securelink_private_client_fixture && cgo && (linux || darwin)

// PUBLIC c-shared transport controls only. This is not a production startup,
// Source producer, daemon or authority installer. It creates its own temporary
// Unix endpoint in the SAME process as the Go runtime and native C++ controls.
package main

/*
#include "../ynx-secure-link-caller/private_client_v1.h"
*/
import "C"

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

type fixture struct {
	registration *securelink.NativeLocalCallerRegistration
	server       *securelink.LocalCallerServer
	cancel       context.CancelFunc
	dir          string
	done         <-chan error
}

var fixtures = struct {
	sync.Mutex
	values map[uint32]*fixture
}{values: make(map[uint32]*fixture)}

//export ynx_link_private_fixture_registration_v1
func ynx_link_private_fixture_registration_v1(mode C.uint32_t) *C.ynx_link_private_client_registration_v1 {
	fixtures.Lock()
	defer fixtures.Unlock()
	if mode > 3 {
		return nil
	}
	if old := fixtures.values[uint32(mode)]; old != nil {
		return (*C.ynx_link_private_client_registration_v1)(old.registration.NativeRegistrationPointer())
	}
	dir, err := os.MkdirTemp("", "ynx-pc-")
	if err != nil {
		return nil
	}
	path := filepath.Join(dir, "p.sock")
	uid := uint32(os.Getuid())
	pid := os.Getpid()
	if uid == 0 {
		_ = os.RemoveAll(dir)
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	var routes []securelink.LocalCallerRoute
	var bindings [5]securelink.NativeLocalCallerBinding
	intent := "npi_" + strings.Repeat("a", 48)
	invoice := "/v5/pay/invoices/0x" + strings.Repeat("2", 40) + "/original-invoice"
	paths := [5]string{"/v5/pay/invoice-intents/" + intent + "/merchant-member", invoice + "/settlements", invoice + "/refunds", "/v5/pay/invoice-intents/" + intent, invoice}
	for i := range bindings {
		if mode == 3 && (i == 0 || i == 3) {
			continue
		}
		method := http.MethodPost
		contentType := "application/json"
		if i >= 3 {
			method = http.MethodGet
			contentType = ""
		}
		p := paths[i]
		routes = append(routes, securelink.LocalCallerRoute{Method: method, Path: p, MaxBodyBytes: 4096, Timeout: 2 * time.Second})
		bindings[i] = securelink.NativeLocalCallerBinding{Method: method, Path: p, ContentType: contentType}
	}
	server, err := securelink.NewLocalCallerServer(securelink.LocalCallerServerConfig{Service: "public-private-fixture", PeerUID: uid, PeerPID: pid, Routes: routes, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Add("X-Public-Multi", "first")
		w.Header().Add("X-Public-Multi", "second")
		if mode == 1 {
			w.Header().Set("Content-Length", "10")
			_, _ = w.Write([]byte("abc"))
			return
		}
		_, _ = w.Write([]byte(`{"PUBLIC":"original packet"}`))
	})})
	if err != nil {
		cancel()
		_ = os.RemoveAll(dir)
		return nil
	}
	listener, err := securelink.ListenPrivate(path, uid)
	if err != nil {
		cancel()
		_ = os.RemoveAll(dir)
		return nil
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	client, err := securelink.NewLocalCallerClient(securelink.LocalCallerClientConfig{SocketPath: path, Service: "public-private-fixture", PeerUID: uid, PeerPID: pid, Routes: routes, Timeout: 2 * time.Second})
	if err != nil {
		_ = server.Close()
		cancel()
		_ = os.RemoveAll(dir)
		return nil
	}
	registration, err := securelink.RegisterNativeLocalCallerClient(ctx, client, bindings)
	if err != nil {
		_ = server.Close()
		cancel()
		_ = os.RemoveAll(dir)
		return nil
	}
	fixtures.values[uint32(mode)] = &fixture{registration: registration, server: server, cancel: cancel, dir: dir, done: done}
	return (*C.ynx_link_private_client_registration_v1)(unsafe.Pointer(registration.NativeRegistrationPointer()))
}

//export ynx_link_private_fixture_finish_v1
func ynx_link_private_fixture_finish_v1() C.int32_t {
	fixtures.Lock()
	defer fixtures.Unlock()
	for mode, f := range fixtures.values {
		_ = f.registration.Retire()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := f.registration.Join(ctx)
		cancel()
		if err != nil {
			return 5
		}
		if f.registration.Close() != nil {
			return 5
		}
		_ = f.server.Retire()
		ctx, cancel = context.WithTimeout(context.Background(), time.Second)
		err = f.server.Join(ctx)
		cancel()
		if err != nil {
			return 5
		}
		if f.server.Close() != nil {
			return 5
		}
		f.cancel()
		<-f.done
		_ = os.RemoveAll(f.dir)
		delete(fixtures.values, mode)
	}
	return 0
}

//export ynx_link_private_fixture_borrow_v1
func ynx_link_private_fixture_borrow_v1(mode C.uint32_t) *C.ynx_link_private_client_registration_borrow_v1 {
	if ynx_link_private_fixture_registration_v1(mode) == nil {
		return nil
	}
	fixtures.Lock()
	defer fixtures.Unlock()
	p, err := fixtures.values[uint32(mode)].registration.BorrowNativeRegistrationPointer()
	if err != nil {
		return nil
	}
	return (*C.ynx_link_private_client_registration_borrow_v1)(p)
}
func main() {}
