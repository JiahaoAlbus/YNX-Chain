package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

type testNodeDecision func(context.Context, ownednode.Intent, string) error

func (f testNodeDecision) Confirm(c context.Context, i ownednode.Intent, m string) error {
	return f(c, i, m)
}

func TestP09NativeNodeVisibleDecisionGates(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("actual Unix peer required")
	}
	base := os.TempDir()
	if info, e := os.Stat("/Volumes/西部数据"); e == nil && info.IsDir() {
		base = "/Volumes/西部数据"
	}
	root, err := os.MkdirTemp(base, "p09-consent-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	seen := make(chan localipc.Peer, 1)
	identity, err := localipc.Start(context.Background(), localipc.Config{Directory: filepath.Join(root, "identity"), Handler: func(c context.Context, p localipc.Peer, r localipc.Request) (localipc.Result, error) {
		seen <- p
		return localipc.Result{Status: &localipc.Status{Service: "consent-test", NodeControl: "unavailable", ResourceContribution: "disabled"}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer identity.Close(context.Background())
	if _, err = localipc.Call(context.Background(), filepath.Join(root, "identity"), localipc.Request{Version: localipc.Version, ID: "peer", Operation: "status"}); err != nil {
		t.Fatal(err)
	}
	peer := <-seen
	private := func(name string) string {
		p := filepath.Join(root, name)
		if err := os.Mkdir(p, 0700); err != nil {
			t.Fatal(err)
		}
		return filepath.Join(p, ownednode.DirectoryName)
	}
	production, err := ownednode.New(ownednode.Config{Directory: private("production")})
	if err != nil {
		t.Fatal(err)
	}
	defer production.Close(context.Background())
	intent, err := production.Prepare(peer, "start", "")
	if err != nil {
		t.Fatal(err)
	}
	wire, _ := json.Marshal(intent)
	calls := 0
	prompt := testNodeDecision(func(context.Context, ownednode.Intent, string) error { calls++; return nil })
	result, err := nativeNode(context.Background(), production, peer, localipc.Request{Operation: "node_start", Payload: wire}, prompt)
	if err != nil || calls != 0 || string(result.Payload) != "{\"code\":\"UNSUPPORTED\",\"node\":null,\"productionGrant\":false}" {
		t.Fatalf("missing release asked approval or ran: %s %v calls%d", result.Payload, err, calls)
	}
	fixture, err := ownednode.New(ownednode.Config{Directory: private("fixture"), IsolatedFixture: true})
	if err != nil {
		t.Fatal(err)
	}
	defer fixture.Close(context.Background())
	// A non-executable negative fixture is never started. This tests that a
	// cancelled visible decision cannot even reach the process-start path.
	artifact := []byte("negative-only-no-process")
	sum := sha256.Sum256(artifact)
	install, err := fixture.Prepare(peer, "install", hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatal(err)
	}
	approval, err := fixture.Approve(peer, install, true, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err = fixture.InstallFixture(context.Background(), peer, install, approval, artifact); err != nil {
		t.Fatal(err)
	}
	intent, err = fixture.Prepare(peer, "start", "")
	if err != nil {
		t.Fatal(err)
	}
	wire, _ = json.Marshal(intent)
	cancelled := testNodeDecision(func(c context.Context, i ownednode.Intent, m string) error {
		if i != intent || m != "isolated-lifecycle-fixture" {
			t.Fatal("visible packet changed")
		}
		return nativeconsent.ErrCancelled
	})
	result, err = nativeNode(context.Background(), fixture, peer, localipc.Request{Operation: "node_start", Payload: wire}, cancelled)
	if err != nil || !json.Valid(result.Payload) {
		t.Fatal(err)
	}
	var out struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(result.Payload, &out)
	if out.Code != "CANCELLED" {
		t.Fatalf("cancel result: %s", result.Payload)
	}
	finished := make(chan struct{})
	wait := testNodeDecision(func(c context.Context, _ ownednode.Intent, _ string) error {
		<-c.Done()
		close(finished)
		return c.Err()
	})
	dir := filepath.Join(root, "service")
	server, err := startNativeService(context.Background(), dir, nil, fixture, nil, wait)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	readback, err := localipc.Call(context.Background(), dir, localipc.Request{Version: localipc.Version, ID: "fixed_artifact_readback", Operation: "node_artifact", Payload: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	var artifactResult struct {
		Code  string                    `json:"code"`
		Node  ownednode.ManagedArtifact `json:"node"`
		Grant bool                      `json:"productionGrant"`
	}
	if err = json.Unmarshal(readback.Result.Payload, &artifactResult); err != nil || artifactResult.Code != "OK" || artifactResult.Node.SHA256 != hex.EncodeToString(sum[:]) || artifactResult.Node.Authority || artifactResult.Node.ProductionSupported || artifactResult.Grant {
		t.Fatalf("fixed artifact readback: %s %v", readback.Result.Payload, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	_, err = localipc.Call(ctx, dir, localipc.Request{Version: localipc.Version, ID: "cancel_visible", Operation: "node_start", Payload: wire})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("actual IPC cancellation: %v", err)
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("client cancellation left visible prompt alive")
	}
	status, err := fixture.Status(peer)
	if err != nil || status.ProcessOwned || status.Stage != "installed" {
		t.Fatalf("cancel changed node state: %+v %v", status, err)
	}
	if localipc.OperationTimeout("status") != 10*time.Second || localipc.OperationTimeout("node_start") != 65*time.Second {
		t.Fatal("visible review widened unrelated timeout")
	}
}
