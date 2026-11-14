//go:build cgo && (linux || darwin)

package securelink

import (
	"context"
	"errors"
	"math"
	"net/http"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

// PUBLIC profile DATA controls only. No native Root loan, Source approval or
// provider is minted by constructing these private decoder test values.
func publicPayNativeProfile() payNativeTransportProfile {
	p := payNativeTransportProfile{version: 1, size: 10848, peerUID: 1, peerPID: 1, timeoutMS: 1000, maximumHeaderBytes: 4096, maximumResponseBytes: 4096}
	copy(p.resourceRef[:], "PUBLIC/original-resource")
	copy(p.socketPath[:], "/PUBLIC/private.sock")
	copy(p.service[:], "public-startup")
	for i := range p.routes {
		r := &p.routes[i]
		r.timeoutMS = 500
		r.maximumBodyBytes = 1024
		copy(r.method[:], "POST")
		copy(r.contentType[:], "application/json")
		copy(r.path[:], "/PUBLIC/disabled-original")
	}
	r := &p.routes[4]
	r.enabled = 1
	r.maximumBodyBytes = 0
	r.method = [5]byte{}
	copy(r.method[:], "GET")
	r.contentType = [17]byte{}
	r.path = [2049]byte{}
	copy(r.path[:], "/PUBLIC/original-query")
	return p
}
func TestPayNativeStartupBoundedProfileAndDisabledSlots(t *testing.T) {
	p := publicPayNativeProfile()
	cfg, bindings, err := decodePayNativeTransportProfile(p, 10848)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Routes) != 1 || cfg.Routes[0].MaxBodyBytes != 0 || cfg.Routes[0].Method != "GET" || bindings[4].ContentType != "" {
		t.Fatal("GET0 was expanded or changed", cfg, bindings)
	}
	for i := 0; i < 4; i++ {
		if bindings[i] != (NativeLocalCallerBinding{}) {
			t.Fatal("disabled original slot manufactured permission", i, bindings[i])
		}
	}
	for _, change := range []struct {
		name string
		f    func(*payNativeTransportProfile)
	}{
		{"version", func(p *payNativeTransportProfile) { p.version = 2 }},
		{"size", func(p *payNativeTransportProfile) { p.size-- }},
		{"unterminated", func(p *payNativeTransportProfile) {
			for i := range p.service {
				p.service[i] = 'x'
			}
		}},
		{"hidden-suffix", func(p *payNativeTransportProfile) { p.service[100] = 'x' }},
		{"UID", func(p *payNativeTransportProfile) { p.peerUID = 0 }},
		{"PID", func(p *payNativeTransportProfile) { p.peerPID = -1 }},
		{"duration-overflow", func(p *payNativeTransportProfile) { p.timeoutMS = math.MaxUint64 }},
		{"headers", func(p *payNativeTransportProfile) { p.maximumHeaderBytes = 65537 }},
		{"response", func(p *payNativeTransportProfile) { p.maximumResponseBytes = 1<<20 + 1 }},
		{"enabled-flag", func(p *payNativeTransportProfile) { p.routes[4].enabled = 2 }},
		{"empty-selection", func(p *payNativeTransportProfile) { p.routes[4].enabled = 0 }},
		{"GET-body", func(p *payNativeTransportProfile) { p.routes[4].maximumBodyBytes = 1 }},
		{"GET-mime", func(p *payNativeTransportProfile) { copy(p.routes[4].contentType[:], "application/json") }},
		{"route-timeout", func(p *payNativeTransportProfile) { p.routes[4].timeoutMS = 1001 }},
		{"route-query", func(p *payNativeTransportProfile) { copy(p.routes[4].path[:], "/PUBLIC/original-query?x=1") }},
	} {
		t.Run(change.name, func(t *testing.T) {
			p := publicPayNativeProfile()
			change.f(&p)
			if _, _, err := decodePayNativeTransportProfile(p, 10848); err == nil {
				t.Fatal("malformed profile accepted")
			}
		})
	}
}

func TestPayNativeStartupActualGETZeroBudget(t *testing.T) {
	route := LocalCallerRoute{Method: http.MethodGet, Path: "/PUBLIC/zero-body", MaxBodyBytes: 0, Timeout: time.Second}
	var calls atomic.Int32
	_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.ContentLength != 0 || r.Header.Get("Content-Type") != "" {
			t.Error("GET0 budget/MIME changed")
		}
		w.WriteHeader(204)
	}), route)
	packet, err := client.Call(context.Background(), route.Method, route.Path, "", nil)
	if err != nil || !packet.PacketPresent || packet.StatusCode != 204 {
		t.Fatal(packet, err)
	}
	packet, err = client.Call(context.Background(), route.Method, route.Path, "", []byte{1})
	var dispatch *DispatchError
	if !errors.Is(err, ErrBounds) || !errors.As(err, &dispatch) || dispatch.DispatchPossible || packet.PacketPresent || calls.Load() != 1 {
		t.Fatal("nonempty GET crossed zero budget", packet, err, calls.Load())
	}
	route.Method = http.MethodPost
	if _, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: client.cfg.SocketPath, Service: "auth-native", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}}); !errors.Is(err, ErrBounds) {
		t.Fatal("POST0 expanded", err)
	}
}
