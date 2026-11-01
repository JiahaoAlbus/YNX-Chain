package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

func TestNetworkOriginalResourceCurrentPrivateIPC(t *testing.T) {
	root, err := os.MkdirTemp("/Volumes/西部数据", "p09-current-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	runner, err := contribution.NewDisabled(filepath.Join(root, "resource.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Close()
	if err = runner.InitializeCurrentResource(ctx, contribution.ResourceIdentity{SourceID: "PUBLIC-private-source", InstanceID: "PUBLIC-private-own-instance", ResourceKey: "PUBLIC-private-resource"}); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(root, "ipc")
	server, err := startNativeService(ctx, directory, nil, nil, runner)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	before, _ := os.ReadFile(filepath.Join(root, "resource.json"))
	reply, err := localipc.Call(ctx, directory, localipc.Request{Version: localipc.Version, ID: "current_read", Operation: "resource_current", Payload: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Code              string         `json:"code"`
		Classification    string         `json:"classification"`
		Authority         bool           `json:"authority"`
		RegisteredIssuer  bool           `json:"registeredIssuer"`
		ProductionEnabled bool           `json:"productionEnabled"`
		ResourceCurrent   map[string]any `json:"resourceCurrent"`
	}
	if err = json.Unmarshal(reply.Result.Payload, &data); err != nil {
		t.Fatal(err)
	}
	if !reply.Peer.NativeIPCVerified || reply.Peer.BrowserIdentityVerified || data.Code != "DATA_ONLY" || data.Classification != "UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA" || data.Authority || data.RegisteredIssuer || data.ProductionEnabled || len(data.ResourceCurrent) != 9 || data.ResourceCurrent["epoch"] != "1" || data.ResourceCurrent["sequence"] != "1" {
		t.Fatalf("private DATA invented authority: %s", reply.Result.Payload)
	}
	for _, raw := range []string{`{"epoch":"17","sequence":"9007199254740993"}`, `{"sourceId":"other"}`, `{"head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`, `{"approved":true}`} {
		if _, err = localipc.Call(ctx, directory, localipc.Request{Version: localipc.Version, ID: "current_forged", Operation: "resource_current", Payload: json.RawMessage(raw)}); err == nil {
			t.Fatalf("caller current mapping accepted %s", raw)
		}
	}
	after, _ := os.ReadFile(filepath.Join(root, "resource.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("private current reader rewrote original")
	}
	h, s := fixture(t, "https://rpc.example")
	h.ipcDirectory = directory
	ticket := pair(t, s)
	code, _ := call(t, s, "/api/resource_current", s.URL, ticket, map[string]any{})
	if code != 404 {
		t.Fatal("read ticket gained protected current API", code)
	}
	meter := runner.VerifyResourceMeter()
	if meter.ActiveWorkers != 0 || meter.VerifiedJobs != 0 || meter.VerifiedBytes != 0 {
		t.Fatal("metadata dispatched work", meter)
	}
	t.Logf("actual original kernel IPC consistent9=%s; unsigned local metadata only; epoch/seq independently owned", reply.Result.Payload)
}
