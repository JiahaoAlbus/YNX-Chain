package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

func TestNativeNodeRestartRequiresOriginalOwnedRun(t *testing.T) {
	dir, err := os.MkdirTemp("/Volumes/西部数据", "p09-restart-peer-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	seen := make(chan localipc.Peer, 1)
	identity, err := localipc.Start(context.Background(), localipc.Config{Directory: filepath.Join(dir, "ipc"), Handler: func(_ context.Context, p localipc.Peer, _ localipc.Request) (localipc.Result, error) {
		seen <- p
		return localipc.Result{Status: &localipc.Status{Service: "restart-contract", NodeControl: "unavailable", ResourceContribution: "disabled"}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer identity.Close(context.Background())
	if _, err = localipc.Call(context.Background(), filepath.Join(dir, "ipc"), localipc.Request{Version: localipc.Version, ID: "restart_identity", Operation: "status"}); err != nil {
		t.Fatal(err)
	}
	peer := <-seen
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	node, err := ownednode.New(ownednode.Config{Directory: filepath.Join(root, ownednode.DirectoryName)})
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close(context.Background())
	calls := 0
	prompt := testNodeDecision(func(context.Context, ownednode.Intent, string) error { calls++; return nil })
	result, err := nativeNode(context.Background(), node, peer, localipc.Request{Operation: "node_restart", Payload: json.RawMessage(`{}`)}, prompt)

	var outcome struct {
		Code            string
		Node            any
		ProductionGrant bool
		Capabilities    nodeCapabilitySet
	}
	if err != nil || json.Unmarshal(result.Payload, &outcome) != nil || calls != 0 || outcome.Code != "NOT_RUNNING" || outcome.Node != nil || outcome.ProductionGrant || !outcome.Capabilities.Read || !outcome.Capabilities.VisibleConsent || outcome.Capabilities.Install || outcome.Capabilities.Start || outcome.Capabilities.Stop || outcome.Capabilities.Restart {
		t.Fatalf("unowned restart prompt/effect: %s %v calls%d", result.Payload, err, calls)
	}

	for _, raw := range []string{`{"pid":1}`, `{"approved":true}`, `{"action":"start"}`} {
		if _, err = nativeNode(context.Background(), node, peer, localipc.Request{Operation: "node_restart", Payload: json.RawMessage(raw)}, prompt); err == nil {
			t.Fatalf("restart caller selected state %s", raw)
		}
	}
	if localipc.OperationTimeout("node_restart") != 130*time.Second || localipc.OperationTimeout("node_start") != 65*time.Second || localipc.OperationTimeout("resource_review") != 10*time.Second {
		t.Fatal("review budget changed unrelated actions")
	}
	state, err := node.Status(peer)
	if err != nil || state.ProcessOwned || state.Stage != "not_installed" || calls != 0 {
		t.Fatal("restart mutated absent node", state, err, calls)
	}
}
