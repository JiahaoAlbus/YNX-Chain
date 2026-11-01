package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/resourceauthority"
)

func TestNetworkResourceSourceNormalIPCProjection(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	source := resourceauthority.Open(ctx)
	defer source.Close(context.Background())
	a := source.Snapshot()
	if a.Current || !a.PhysicalComplete || a.CleanupPending || a.ProductionEnabled || a.NativeLinked && (!a.PartialAcquired || a.Code != "NOT_ADMITTED") || !a.NativeLinked && a.Code != "NOT_SUPPLIED" {
		t.Fatalf("normal Root0/absent platform changed: %+v", a)
	}
	dir, err := os.MkdirTemp("/Volumes/西部数据", "p09-auth-source-")
	if err != nil {
		dir = t.TempDir()
	} else {
		t.Cleanup(func() { _ = os.RemoveAll(dir) })
	}
	r, err := contribution.NewDisabled(filepath.Join(dir, "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	server, err := startNativeServiceWithSource(ctx, filepath.Join(dir, "ipc"), nil, nil, r, source)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	result, err := localipc.Call(ctx, filepath.Join(dir, "ipc"), localipc.Request{Version: localipc.Version, ID: "actual_source_status", Operation: "status"})
	if err != nil {
		t.Fatal(err)
	}
	activity := result.Result.Status.Activity
	if activity.Resource.Source == nil || activity.Resource.Source.Current || activity.Resource.Source.NativeLinked != a.NativeLinked || activity.Resource.ActiveWorkers != "0" || activity.Authority || activity.ProductionGrant || result.Peer.BrowserIdentityVerified {
		t.Fatalf("actual status inflated authority: %+v", result)
	}
	raw, err := json.Marshal(map[string]any{"browserIdentityVerified": false, "native": result})
	if err != nil {
		t.Fatal(err)
	}
	// Exercise the actual browser projection against the real kernel DTO,
	// including OS accounting fields that the older projection rejected.
	js := `const fs=require('node:fs'),vm=require('node:vm');const box={window:{}};vm.runInNewContext(fs.readFileSync('../../apps/network/web/overview.js','utf8'),box);const s=JSON.parse(fs.readFileSync(0,'utf8'));const p=box.window.NetworkOverview.project(null,s).native;if(!p?.activity?.resource?.source||p.activity.resource.verifiedJobs!=='0'||p.activity.resource.source.nativeLinked!==s.native.result.status.activity.resource.source.nativeLinked)throw Error('real resource DTO rejected');console.log(JSON.stringify(p.activity.resource));`
	cmd := exec.CommandContext(ctx, "node", "-e", js)
	cmd.Stdin = strings.NewReader(string(raw))
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("actual client projection: %v %s", err, out)
	}
	t.Logf("actual same-process Native linked=%t partial=%t first=%s; kernel self-status -> strict client projection %s", a.NativeLinked, a.PartialAcquired, a.FirstCauseCode, out)
	if complete, err := source.Close(ctx); !complete || err != nil {
		t.Fatal("original source not physically drained", complete, err)
	}
}
