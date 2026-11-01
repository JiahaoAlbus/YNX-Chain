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
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/resourceauthority"
)

func TestNetworkResourceOriginalReviewNormalIPC(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	source := resourceauthority.Open(ctx)
	defer source.Close(context.Background())
	initial := source.Snapshot()
	if initial.Current || !initial.PhysicalComplete {
		t.Fatalf("Root0 unexpectedly admitted: %+v", initial)
	}
	root, err := os.MkdirTemp("/Volumes/西部数据", "p09-review-")
	if err != nil {
		root = t.TempDir()
	} else {
		t.Cleanup(func() { _ = os.RemoveAll(root) })
	}
	journal := filepath.Join(root, "resource.json")
	runner, err := contribution.NewDisabled(journal)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Close()
	before, beforeErr := os.ReadFile(journal)
	directory := filepath.Join(root, "ipc")
	server, err := startNativeServiceWithSource(ctx, directory, nil, nil, runner, source)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	for _, operation := range []string{"resource_review", "resource_review_cancel", "resource_review"} {
		result, err := localipc.Call(ctx, directory, localipc.Request{Version: localipc.Version, ID: "original_review", Operation: operation, Payload: json.RawMessage(`{}`)})
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			Code              string `json:"code"`
			Authority         bool   `json:"authority"`
			ProductionEnabled bool   `json:"productionEnabled"`
			ConsentProduced   bool   `json:"consentProduced"`
			PreviewBytes      string `json:"previewBytes"`
			PreviewSHA256     string `json:"previewSHA256"`
		}
		if err = json.Unmarshal(result.Result.Payload, &response); err != nil {
			t.Fatal(err)
		}
		if !result.Peer.NativeIPCVerified || result.Peer.BrowserIdentityVerified || response.Authority || response.ProductionEnabled || response.ConsentProduced || response.PreviewBytes != "" || response.PreviewSHA256 != "" {
			t.Fatalf("Root0 preview manufactured authority/body: %s", result.Result.Payload)
		}
		if operation == "resource_review" && response.Code != initial.Code {
			t.Fatalf("original refusal lost: %s vs %+v", result.Result.Payload, initial)
		}
	}
	// Caller-supplied approval and original-data selectors cannot enter this
	// private fixed Source path, including over the actual kernel channel.
	if _, err = localipc.Call(ctx, directory, localipc.Request{Version: localipc.Version, ID: "forged_review", Operation: "resource_review", Payload: json.RawMessage(`{"approved":true,"original":"forged"}`)}); err == nil {
		t.Fatal("caller approval/body accepted")
	}
	after, afterErr := os.ReadFile(journal)
	if !bytes.Equal(before, after) || (beforeErr == nil) != (afterErr == nil) {
		t.Fatal("failed Source review mutated original Store")
	}
	meter := runner.VerifyResourceMeter()
	if meter.ActiveWorkers != 0 || meter.VerifiedJobs != 0 || meter.VerifiedBytes != 0 {
		t.Fatalf("review dispatched work %+v", meter)
	}
	h, s := fixture(t, "https://rpc.example")
	h.ipcDirectory = directory
	ticket := pair(t, s)
	for _, route := range []string{"/api/resource_review", "/api/resource_review_cancel"} {
		code, _ := call(t, s, route, s.URL, ticket, map[string]any{})
		if code != 404 {
			t.Fatalf("read ticket gained native review route %s: %d", route, code)
		}
	}
	final := source.Snapshot()
	if final.NativeLinked != initial.NativeLinked || final.PartialAcquired != initial.PartialAcquired || final.FirstCauseCode != initial.FirstCauseCode || final.Current {
		t.Fatalf("Source owner replaced or rearmed %+v", final)
	}
	t.Logf("actual kernel Root0 native=%v original=%s partial=%v; no preview/approval/Store effect", final.NativeLinked, final.FirstCauseCode, final.PartialAcquired)
}
