//go:build darwin && cgo

package localipc

import (
	"bufio"
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestResourceCurrentActualCXXSameConnection(t *testing.T) {
	root, err := os.MkdirTemp(resourceTestBase(), "p09cxx-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	binary := filepath.Join(root, "current-client")
	build := exec.Command("xcrun", "--sdk", "macosx", "clang++", "-std=c++17", "-fobjc-arc", "-Wno-deprecated-declarations", "-Wall", "-Wextra", "-Werror", "-framework", "Foundation", "-lproc", "testdata/resource_current_client.mm", "-o", binary)
	if output, e := build.CombinedOutput(); e != nil {
		t.Fatalf("actual C++ compile: %s %v", output, e)
	}
	parent, err := ObserveProcessIdentity(context.Background(), int32(os.Getpid()))
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(root, "ipc")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, filepath.Join(directory, SocketName), strconv.Itoa(int(parent.PID)), parent.StartIdentity, parent.ImagePath, parent.ImageSHA256)
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		if !waited {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || scanner.Text() != "READY" {
		t.Fatal("C++ controlled readiness missing")
	}
	child, err := ObserveProcessIdentity(context.Background(), int32(command.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	runner, err := contribution.NewDisabled(filepath.Join(root, "resource.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Close()
	if err = runner.InitializeCurrentResource(context.Background(), resourcePublic); err != nil {
		t.Fatal(err)
	}
	server, err := Start(context.Background(), Config{Directory: directory, Handler: func(context.Context, Peer, Request) (Result, error) { return Result{}, ErrResourceHeld }, ResourceCurrent: &ResourceCurrentConfig{Runner: runner, SelectedResource: resourcePublic, ExpectedClient: child}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	_, _ = stdin.Write([]byte("g"))
	_ = stdin.Close()
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	err = command.Wait()
	waited = true
	if err != nil || !strings.Contains(strings.Join(lines, "\n"), "PASS PUBLIC_CONTROLLED_CXX_SAME_FD") {
		t.Fatalf("actual C++ original protocol: %v %v", lines, err)
	}
	untilNoDebt(t, server)
	t.Logf("%s; actual parent GoPID=%d child=%d starts and image pins independently observed; false issuer/Root", strings.Join(lines, "\n"), parent.PID, child.PID)
}
