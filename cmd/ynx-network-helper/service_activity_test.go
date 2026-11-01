package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

func TestNetworkActualLocalActivityReadonly(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("kernel native channel unsupported")
	}
	base := os.TempDir()
	if info, err := os.Stat("/Volumes/西部数据"); err == nil && info.IsDir() {
		base = "/Volumes/西部数据"
	} else if runtime.GOOS == "darwin" {
		base = "/private/tmp"
	}
	root, err := os.MkdirTemp(base, "p09-activity-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	node, err := ownednode.New(ownednode.Config{Directory: filepath.Join(root, ownednode.DirectoryName)})
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close(context.Background())
	resource, err := contribution.NewDisabled(filepath.Join(root, "resource.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer resource.Close()
	dir := filepath.Join(root, "ipc")
	server, err := startNativeService(context.Background(), dir, nil, node, resource)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	read := func() *localipc.Activity {
		t.Helper()
		r, err := localipc.Call(context.Background(), dir, localipc.Request{Version: localipc.Version, ID: "actual_status", Operation: "status"})
		if err != nil {
			t.Fatal(err)
		}
		if r.Peer.BrowserIdentityVerified || !r.Peer.NativeIPCVerified || r.Result.Status == nil || r.Result.Status.Activity == nil {
			t.Fatalf("missing actual self observation: %+v", r)
		}
		return r.Result.Status.Activity
	}
	a := read()
	if a.Authority || a.ProductionGrant || a.Version != "YNX-NETWORK-LOCAL-ACTIVITY/v1" || a.Node.Code != "UNSUPPORTED" || a.Node.Stage != "not_installed" || a.Node.ProcessOwned || a.Participation.Code != "NOT_SUPPLIED" || a.Participation.Configured || a.Resource.Code != "DISABLED" || a.Resource.ActiveWorkers != "0" || a.Resource.VerifiedJobs != "0" || a.Resource.ProductionEnabled || a.Resource.Rewards != "NOT_AUTHORIZED" {
		t.Fatalf("misstated actual local activity: %+v", a)
	}
	var diagnostic ownednode.Diagnostics
	if len(a.Node.Diagnostics) == 0 || len(a.Node.Diagnostics) > 8192 || json.Unmarshal(a.Node.Diagnostics, &diagnostic) != nil || diagnostic.Authority || diagnostic.Logs.Code != "NOT_SUPPLIED" || diagnostic.Synchronization.Code != "NOT_SUPPLIED" || diagnostic.Synchronization.LocalHeight != nil || diagnostic.Recovery.AutoRestart || diagnostic.Recovery.StoredPIDIsControlHandle {
		t.Fatalf("bounded normal activity lost diagnostics: %s", a.Node.Diagnostics)
	}
	// A second read starts no worker, publishes nothing, and never creates a node.
	b := read()
	if b.Node.Stage != a.Node.Stage || b.Resource != a.Resource {
		t.Fatalf("read changed module state: %+v -> %+v", a, b)
	}
	if err := resource.StopContribution(context.Background()); err != nil {
		t.Fatal(err)
	}
	if c := read(); c.Resource.State != "stopped" || c.Resource.Code != "DISABLED" {
		t.Fatalf("actual stop missing: %+v", c.Resource)
	}
	if err := node.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if c := read(); c.Node.Code != "UNAVAILABLE" || c.Node.CapacityComplete || c.Node.UsedBytes != "" {
		t.Fatalf("closed node displayed live capacity: %+v", c.Node)
	}
	// The ordinary receipt ticket can read this self-diagnostic, not call native
	// operations; it is never upgraded to the browser's kernel identity.
	h, s := fixture(t, "https://rpc.example")
	h.ipcDirectory = dir
	ticket := pair(t, s)
	code, out := call(t, s, "/api/native-status", s.URL, ticket, map[string]any{})
	if code != 200 || out["browserIdentityVerified"] != false || out["native"] == nil {
		t.Fatalf("HTTP observation: %d %+v", code, out)
	}
	for _, path := range []string{"/api/node_start", "/api/participation_submit", "/api/resource_start"} {
		code, _ = call(t, s, path, s.URL, ticket, map[string]any{})
		if code != 404 {
			t.Fatalf("read ticket gained effect endpoint %s: %d", path, code)
		}
	}
}
func TestNetworkAbsentLocalActivity(t *testing.T) {
	a := nativeActivity(localipc.Peer{}, nil, nil, nil)
	if a.Node.Code != "NOT_SUPPLIED" || a.Participation.Code != "NOT_SUPPLIED" || a.Resource.Code != "UNAVAILABLE" || a.Resource.ActiveWorkers != "" || a.Authority || a.ProductionGrant {
		t.Fatalf("missing module fabricated data: %+v", a)
	}
}
