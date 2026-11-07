package aiproduct

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// PUBLIC registration/current, not Auth Source admission or Native capability.
type p08ReadReceiverRegistration struct {
	path        string
	config      link.LocalCallerServerConfig
	unavailable atomic.Bool
}

func (f *p08ReadReceiverRegistration) ReadOriginalTaskReadReceiverRegistration(ctx context.Context) (string, link.LocalCallerServerConfig, error) {
	return f.path, f.config, ctx.Err()
}
func (f *p08ReadReceiverRegistration) AssertOriginalTaskReadReceiverCurrent(ctx context.Context) error {
	if f.unavailable.Load() {
		return errTaskEffectSourceUnavailable
	}
	return ctx.Err()
}
func p08ReadReceiverFixture(t *testing.T) (*OriginalTaskReadResource, OriginalTaskResourceReadRequest, *p08ReadReceiverRegistration) {
	t.Helper()
	registration := p08CallerEndpointRegistration(t)
	o, r, _ := taskResourceFixture(t)
	dir, err := os.MkdirTemp("/tmp", "p08-read-mount-")
	if err != nil {
		t.Fatal(err)
	}
	f := &p08ReadReceiverRegistration{path: filepath.Join(dir, "r.sock"), config: link.LocalCallerServerConfig{Service: OriginalTaskReadResourceService, PeerUID: registration.callerUID, PeerPID: registration.callerPID}}
	for _, path := range []string{OriginalTaskReadInputPath, OriginalTaskReadExecutePath, OriginalTaskReadQueryPath} {
		f.config.Routes = append(f.config.Routes, link.LocalCallerRoute{Method: "POST", Path: path, MaxBodyBytes: 1 << 20, Timeout: 3 * time.Second})
	}
	t.Cleanup(func() { _ = os.Remove(f.path); _ = os.Remove(dir) }) // only this owned PUBLIC fixture
	return o, r, f
}
func p08CloseReadReceiver(t *testing.T, o *OriginalTaskReadReceiver) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := o.Retire(); err != nil {
		t.Error(err)
	}
	if err := o.Join(ctx); err != nil {
		t.Error(err)
	}
	if err := o.Close(); err != nil {
		t.Error(err)
	}
}

func TestP08TaskReadReceiverMountedFiniteThree(t *testing.T) {
	resource, r, source := p08ReadReceiverFixture(t)
	resource.verifier.(*p08ResourceReservationFixture).claimOverLink = true
	var effectsUnavailable atomic.Bool
	resource.current = func(ctx context.Context) error {
		if effectsUnavailable.Load() {
			return errTaskEffectSourceUnavailable
		}
		return ctx.Err()
	}
	owner, err := openOriginalTaskReadReceiver(context.Background(), &OriginalTaskReadReceiver{resource: resource, done: make(chan struct{})}, source)
	if err != nil {
		p08CloseReadReceiver(t, owner)
		t.Fatal(err)
	}
	t.Cleanup(func() { p08CloseReadReceiver(t, owner) })
	client, err := link.NewLocalCallerClient(link.LocalCallerClientConfig{SocketPath: source.path, Service: OriginalTaskReadResourceService, PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: source.config.Routes, Timeout: 3 * time.Second, MaxResponseBytes: OriginalTaskReadMaxResponseBytes})
	if err != nil {
		t.Fatal(err)
	}
	read := r
	read.AuthorityOperationID = ""
	read.RawInput = nil
	raw, _ := json.Marshal(read)
	response, err := client.Call(context.Background(), "POST", OriginalTaskReadInputPath, "application/json", raw)
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("mounted input: %d %v", response.StatusCode, err)
	}
	raw, _ = json.Marshal(r)
	// Plain execute must not acquire a continuation from JSON/profile alone.
	response, err = client.Call(context.Background(), "POST", OriginalTaskReadExecutePath, "application/json", raw)
	if err == nil && response.StatusCode < 400 {
		t.Fatal("plain execute admitted without SCM continuation")
	}
	response, err = p08MountedContinuationExchange(source.path, raw)
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("mounted SCM execute: %d %v", response.StatusCode, err)
	}
	var receipt OriginalTaskResourceReadResult
	if json.Unmarshal(response.Body, &receipt) != nil || receipt.OperationID != r.AuthorityOperationID || receipt.State != "COMMITTED" {
		t.Fatal("mounted resource lost original receipt")
	}
	sequence := resource.store.state.AuditSequence
	response, err = client.Call(context.Background(), "POST", OriginalTaskReadQueryPath, "application/json", raw)
	if err != nil || response.StatusCode != 200 || resource.store.state.AuditSequence != sequence {
		t.Fatalf("mounted original query: %d %v", response.StatusCode, err)
	}
	// An unavailable NEW-effect source must not erase independently authorized
	// original history on this already mounted registration.
	effectsUnavailable.Store(true)
	response, err = client.Call(context.Background(), "POST", OriginalTaskReadQueryPath, "application/json", raw)
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("new-effect loss erased original query: %d %v", response.StatusCode, err)
	}
	inputWire, _ := json.Marshal(read)
	response, err = client.Call(context.Background(), "POST", OriginalTaskReadInputPath, "application/json", inputWire)
	if err != nil || response.StatusCode != 409 {
		t.Fatal("new-effect unavailable input admitted")
	}
	source.unavailable.Store(true)
	response, err = client.Call(context.Background(), "POST", OriginalTaskReadQueryPath, "application/json", raw)
	if err != nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("registration changed but ingress continued: %d %v", response.StatusCode, err)
	}
	source.unavailable.Store(false)
	p08CloseReadReceiver(t, owner)
	if _, err = os.Lstat(source.path); err != nil {
		t.Fatal("mount removed original socket identity")
	}
	if err = source.AssertOriginalTaskReadReceiverCurrent(context.Background()); err != nil {
		t.Fatal("mount closed borrowed Source")
	}
}

func TestP08TaskReadReceiverRejectsOldOrMutableProfile(t *testing.T) {
	for _, kind := range []string{"old-purpose", "two-routes", "duplicate", "oversize", "handler", "retired"} {
		t.Run(kind, func(t *testing.T) {
			resource, _, source := p08ReadReceiverFixture(t)
			switch kind {
			case "old-purpose":
				source.config.Service = "ynx-task-authority-v1"
			case "two-routes":
				source.config.Routes = source.config.Routes[:2]
			case "duplicate":
				source.config.Routes[2] = source.config.Routes[1]
			case "oversize":
				source.config.Routes[0].MaxBodyBytes = 1<<20 + 1
			case "handler":
				source.config.Handler = http.NotFoundHandler()
			case "retired":
				source.unavailable.Store(true)
			}
			owner, err := openOriginalTaskReadReceiver(context.Background(), &OriginalTaskReadReceiver{resource: resource, done: make(chan struct{})}, source)
			if owner == nil || err == nil {
				t.Fatal("unregistered finite3 mount accepted")
			}
			if _, err = os.Lstat(source.path); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("refused mount created socket")
			}
			p08CloseReadReceiver(t, owner)
		})
	}
}

func TestP08TaskReadReceiverNormalUnavailablePartial(t *testing.T) {
	resource, _, _ := taskResourceFixture(t)
	owner, err := OpenOriginalTaskReadReceiver(context.Background(), &Server{store: resource.store})
	if owner == nil || !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatalf("ordinary Server mounted authority: %v", err)
	}
	p08CloseReadReceiver(t, owner)
}

func TestP08TaskReadReceiverDrainRetainsActiveClaim(t *testing.T) {
	resource, r, source := p08ReadReceiverFixture(t)
	held := resource.verifier.(*p08ResourceReservationFixture)
	entered, release := make(chan struct{}), make(chan struct{})
	held.onClaim = func() error { close(entered); <-release; return nil }
	owner, err := openOriginalTaskReadReceiver(context.Background(), &OriginalTaskReadReceiver{resource: resource, done: make(chan struct{})}, source)
	if err != nil {
		p08CloseReadReceiver(t, owner)
		t.Fatal(err)
	}
	t.Cleanup(func() { p08CloseReadReceiver(t, owner) })
	raw, _ := json.Marshal(r)
	result := make(chan error, 1)
	go func() {
		_, err := p08MountedContinuationExchange(source.path, raw)
		result <- err
	}()
	select {
	case <-entered:
	case err := <-result:
		close(release)
		t.Fatalf("original request refused before claim: %v", err)
	case <-time.After(4 * time.Second):
		close(release)
		t.Fatal("original claim did not enter")
	}
	if err = owner.Retire(); err != nil {
		close(release)
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	err = owner.Join(ctx)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		close(release)
		t.Fatalf("active claim drain acknowledged early: %v", err)
	}
	if err = owner.Close(); !errors.Is(err, link.ErrLocalCallerDraining) {
		close(release)
		t.Fatalf("live claim lost debt: %v", err)
	}
	close(release)
	<-result
	p08CloseReadReceiver(t, owner)
	if resource.store.state.Actions[r.Binding.StepID].Status == "COMPLETED" {
		t.Fatal("retired in-flight claim committed a result")
	}
}
