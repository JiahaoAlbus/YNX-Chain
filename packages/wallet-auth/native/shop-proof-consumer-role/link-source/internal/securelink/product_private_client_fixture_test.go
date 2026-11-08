//go:build securelink_product_pay_transport && securelink_product_pay_transport_fixture && cgo && (linux || darwin)

package securelink

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func productFixtureCleanup(t *testing.T, f *productFixture) {
	t.Helper()
	f.retire()
	_, done := f.join()
	if !done {
		t.Error("actual Product child debt remained")
		return
	}
	_, done = f.close()
	if !done {
		t.Error("closed identity not physically drained")
		return
	}
	if rc := f.destroy(); rc != 0 {
		t.Error("PUBLIC test-loan borrow abandoned", rc)
	}
}

func TestProductPrivateCABIResponseCompletenessAndDebt(t *testing.T) {
	for _, mode := range []string{"complete", "truncated", "late-native-revoke"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			route := LocalCallerRoute{Method: "POST", Path: productPrivateTemplates[0], MaxBodyBytes: 1 << 20, Timeout: 2 * time.Second}
			_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.Header().Add("X-Public-Multi", "first")
				w.Header().Add("X-Public-Multi", "second")
				if mode == "truncated" {
					w.Header().Set("Content-Length", "10")
				}
				w.WriteHeader(202)
				_, _ = w.Write([]byte("abc"))
			}), route)
			at, code := 0, 0
			if mode == "late-native-revoke" {
				at, code = 3, 53
			}
			f, rc := newProductFixture(client.cfg, 1, at, code, 0, 0)
			if rc != 0 {
				t.Fatal("real C open", rc)
			}
			defer productFixtureCleanup(t, f)
			response, rc := f.request(productPrivateTestRequest(0))
			defer response.release()
			if mode == "complete" && rc != 0 || mode != "complete" && rc == 0 {
				t.Fatal("original exchange status", rc)
			}
			packet, diag := response.packet()
			if diag != 0 || packet.status != 202 || packet.method != "POST" || packet.path != route.Path || !bytes.Equal(packet.body, []byte("abc")) || !packet.dispatch || packet.complete != (mode != "truncated") || packet.errorPresent != (mode != "complete") {
				t.Fatal("actual response/latepartial DATA lost", packet, diag, rc)
			}
			if mode == "late-native-revoke" && (packet.first != 6 || packet.native != 53) {
				t.Fatal("late native first cause lost", packet)
			}
			var header http.Header
			if err := json.Unmarshal(packet.headers, &header); err != nil || len(header.Values("X-Public-Multi")) != 2 {
				t.Fatal("normalized multi-value Header lost", string(packet.headers), err)
			}
			packet.body[0] = 'X'
			copy, _ := response.packet()
			if string(copy.body) != "abc" {
				t.Fatal("caller copy mutated C original")
			}
			if rc, done := f.close(); rc != 5 || done {
				t.Fatal("response owner was dropped before release", rc, done)
			}
			refs, releases, _, native, request := f.counts()
			if refs != 2 || releases != 0 || native != 1 || request != 1 {
				t.Fatal("actual loan/fence lifetime", refs, releases, native, request)
			}
			response.release()
			rc, done := f.join()
			if !done {
				t.Fatal("real release did not unblock drain", rc)
			}
			if mode == "complete" && rc != 0 {
				t.Fatal("transient busy became sticky business first cause", rc)
			}
			refs, releases, _, _, _ = f.counts()
			if refs != 1 || releases != 1 {
				t.Fatal("loan not dropped exactly once after physical drain", refs, releases)
			}
		})
	}
}

func TestProductPrivateCABIAllocationAndWriteAdmission(t *testing.T) {
	var calls atomic.Int32
	route := LocalCallerRoute{Method: "POST", Path: productPrivateTemplates[0], MaxBodyBytes: 1 << 20, Timeout: time.Second}
	_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); _, _ = w.Write([]byte("PUBLIC body")) }), route)
	t.Run("known-source-release-debt", func(t *testing.T) {
		f, rc := newProductFixture(client.cfg, 1, 0, 0, 0, 0)
		if rc != 0 {
			t.Fatal(rc)
		}
		defer productFixtureCleanup(t, f)
		f.releaseBusyOnce()
		if rc, done := f.close(); rc != 5 || done {
			t.Fatal("known active source debt abandoned", rc, done)
		}
		if refs, releases, _, _, _ := f.counts(); refs != 2 || releases != 0 {
			t.Fatal("known source debt was dropped", refs, releases)
		}
		if rc, done := f.join(); rc != 0 || !done {
			t.Fatal("same original release debt could not drain", rc, done)
		}
		response, rc := f.request(productPrivateTestRequest(0))
		defer response.release()
		if rc != 7 || response.hasOwner() {
			t.Fatal("terminal identity minted new response debt", rc)
		}
	})
	for _, fault := range []int{1, 3, 2} {
		t.Run(string(rune('0'+fault)), func(t *testing.T) {
			f, rc := newProductFixture(client.cfg, 1, 0, 0, 0, 0)
			if rc != 0 {
				t.Fatal(rc)
			}
			defer productFixtureCleanup(t, f)
			before := calls.Load()
			productFixtureFault(fault)
			response, rc := f.request(productPrivateTestRequest(0))
			defer response.release()
			if rc != 3 {
				t.Fatal("bounded allocation failure status", rc)
			}
			if fault != 2 {
				if calls.Load() != before {
					t.Fatal("pre-reserve failure dispatched")
				}
				return
			}
			packet, diag := response.packet()
			if diag != 0 || !packet.dispatch || !packet.complete || packet.first != 3 || packet.partial != uint64(len("PUBLIC body")) || calls.Load() != before+1 {
				t.Fatal("late conversion lost UNKNOWN/pending evidence", packet, diag)
			}
			if _, done := f.close(); done {
				t.Fatal("late conversion abandoned retained Go response")
			}
			if string(f.pendingBody()) != "PUBLIC body" {
				t.Fatal("late conversion dropped original received bytes")
			}
			response.release()
			if _, done := f.join(); !done {
				t.Fatal("explicit response release did not settle original debt")
			}
		})
	}
	t.Run("truncated-copy-first-cause", func(t *testing.T) {
		_, truncated, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Length", "10")
			w.WriteHeader(202)
			_, _ = w.Write([]byte("abc"))
		}), route)
		f, rc := newProductFixture(truncated.cfg, 1, 0, 0, 0, 0)
		if rc != 0 {
			t.Fatal(rc)
		}
		defer productFixtureCleanup(t, f)
		productFixtureFault(2)
		response, rc := f.request(productPrivateTestRequest(0))
		defer response.release()
		packet, diag := response.packet()
		if rc != 1 || diag != 0 || packet.first != 1 || packet.complete || !packet.dispatch || packet.partial != 3 || string(f.pendingBody()) != "abc" {
			t.Fatal("copy failure replaced original IO first cause", rc, packet, diag)
		}
	})
	f, rc := newProductFixture(client.cfg, 1, 0, 0, 0, 71)
	if rc != 0 {
		t.Fatal(rc)
	}
	defer productFixtureCleanup(t, f)
	before := calls.Load()
	response, rc := f.request(productPrivateTestRequest(0))
	defer response.release()
	packet, _ := response.packet()
	if rc != 6 || packet.native != 71 || packet.dispatch || calls.Load() != before {
		t.Fatal("actual prewrite source fence was bypassed", packet, rc)
	}
	response.release()
	local, rc := f.request(productPrivateRequest{operation: 10, method: "LOCAL"})
	defer local.release()
	if rc == 0 || calls.Load() != before {
		t.Fatal("LOCAL dispatched")
	}
}

func TestProductPrivateCABIArchiveRawTarget(t *testing.T) {
	// Actual dedicated Product registration uses the original Unix listener,
	// OS peer, private request handle and full/synchronous-current lifecycle.
	_, listener := localTestSocket(t)
	received := make(chan string, 1)
	req := productPrivateTestRequest(12)
	server, err := NewProductLocalCallerServer(LocalCallerServerConfig{Service: "public-product", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{{Method: "GET", Path: req.path, Timeout: time.Second}}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			http.Error(w, "denied", 403)
			return
		}
		if err = caller.CurrentOriginalCaller(r); err != nil {
			t.Error(err)
		}
		received <- r.RequestURI
		_, _ = w.Write([]byte("PUBLIC archive"))
	})})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	defer func() {
		_ = server.Retire()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := server.Join(ctx); err != nil {
			t.Error(err)
		}
		_ = server.Close()
		<-done
	}()
	path := listener.Addr().String()
	cfg := LocalCallerClientConfig{SocketPath: path, Service: "public-product", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Timeout: time.Second, MaxHeaderBytes: 16384, MaxResponseBytes: 1 << 20}
	f, rc := newProductFixture(cfg, 1<<12, 0, 0, 0, 0)
	if rc != 0 {
		t.Fatal(rc)
	}
	defer productFixtureCleanup(t, f)
	response, rc := f.request(req)
	defer response.release()
	packet, _ := response.packet()
	if rc != 0 || packet.path != req.path || !strings.Contains(packet.path, "%3A") || packet.complete != true {
		t.Fatal("canonical archive raw target changed", packet, rc)
	}
	select {
	case actual := <-received:
		if actual != req.path {
			t.Fatal("actual HTTP target reencoded", actual, req.path)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("actual Unix request missing")
	}
}

func TestProductPrivateCABICancelInflightNoRetry(t *testing.T) {
	entered := make(chan struct{})
	var calls atomic.Int32
	route := LocalCallerRoute{Method: "POST", Path: productPrivateTemplates[0], MaxBodyBytes: 1 << 20, Timeout: 2 * time.Second}
	_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); close(entered); <-r.Context().Done() }), route)
	f, rc := newProductFixture(client.cfg, 1, 0, 0, 0, 0)
	if rc != 0 {
		t.Fatal(rc)
	}
	defer productFixtureCleanup(t, f)
	type result struct {
		response *productFixtureResponse
		rc       int32
	}
	finished := make(chan result, 1)
	go func() { response, rc := f.request(productPrivateTestRequest(0)); finished <- result{response, rc} }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("actual request did not enter")
	}
	if f.cancel() != 0 {
		t.Fatal("cancel failed")
	}
	if _, done := f.join(); done {
		t.Fatal("inflight request/response was abandoned")
	}
	select {
	case out := <-finished:
		defer out.response.release()
		packet, diag := out.response.packet()
		if out.rc == 0 || diag != 0 || !packet.dispatch || calls.Load() != 1 {
			t.Fatal("cancel lost original UNKNOWN/no-retry", out.rc, packet, diag, calls.Load())
		}
		out.response.release()
		rc, done := f.join()
		if !done || rc == 0 || rc == 5 {
			t.Fatal("transient Join replaced real exchange cause", rc, done)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not bound original request")
	}
}
