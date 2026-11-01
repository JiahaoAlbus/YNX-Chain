//go:build darwin && cgo

package localipc

import (
	"bufio"
	"context"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Standalone, test-only original Go fixture for the original LINK owner's
// frozen same-source caller. It is absent from the production helper CLI and
// cannot install Root/NAPI/fence authority. The broker supplies only the actual
// posix_spawn-owned native PID; this Go process observes it independently.
func TestP09ResourceCurrentLINKFixtureServer(t *testing.T) {
	if os.Getenv("YNX_PUBLIC_CURRENT_LINK_SERVER") != "1" {
		return
	}
	root := os.Getenv("YNX_PUBLIC_CURRENT_LINK_ROOT")
	if _, err := privateDirectory(root, uint32(os.Geteuid())); err != nil {
		t.Fatal(err)
	}
	selected := resourcePublic
	if os.Getenv("YNX_PUBLIC_CURRENT_LINK_MODE") == "chunked" {
		// Actual valid original stored identities at their supported256B bounds.
		// No new response fields, padding, alternate serializer or fake entity.
		selected = contribution.ResourceIdentity{SourceID: "PUBLIC-source-" + strings.Repeat("s", 242), InstanceID: "PUBLIC-instance-" + strings.Repeat("i", 240), ResourceKey: "PUBLIC-resource-" + strings.Repeat("r", 240)}
	}
	input := bufio.NewReader(os.Stdin)
	line, err := input.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.ParseInt(strings.TrimSpace(line), 10, 32)
	if err != nil || pid <= 0 {
		t.Fatal("actual parent-spawned native PID required")
	}
	caller, err := ObserveProcessIdentity(context.Background(), int32(pid))
	if err != nil {
		t.Fatal(err)
	}
	runner, err := contribution.NewDisabled(filepath.Join(root, "resource.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Close()
	if err = runner.InitializeCurrentResource(context.Background(), selected); err != nil {
		t.Fatal(err)
	}
	before, err := runner.ReadCurrentResourceDATA(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	server, err := Start(context.Background(), Config{Directory: filepath.Join(root, "ipc"), Handler: func(context.Context, Peer, Request) (Result, error) { return Result{}, ErrResourceHeld }, ResourceCurrent: &ResourceCurrentConfig{Runner: runner, SelectedResource: selected, ExpectedClient: caller}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	fmt.Println("GO_CURRENT_READY")
	line, err = input.ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "stop" {
		t.Fatal("original broker stop required", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err = server.Close(ctx); err != nil {
		t.Fatal("original reader drain", err)
	}
	after, err := runner.ReadCurrentResourceDATA(context.Background())
	if err != nil || before.Epoch != after.Epoch || before.Sequence != after.Sequence || before.Head != after.Head {
		t.Fatal("metadata interop changed original counters", err)
	}
	fmt.Println("GO_CURRENT_DRAINED_SAME_READER_COUNTERS_UNCHANGED_NO_ROOT")
}
