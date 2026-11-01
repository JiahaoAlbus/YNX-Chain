//go:build darwin || linux

package localipc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
)

func TestResourceCurrentActualImageExecChange(t *testing.T) {
	if os.Getenv("YNX_PUBLIC_RESOURCE_EXEC_CHILD") == "1" {
		// This PUBLIC test-only env/JSON has no normal binary entry, native fence
		// or Root installation capability. It controls an actual isolated process.
		root := os.Getenv("YNX_PUBLIC_RESOURCE_ROOT")
		var expected ProcessIdentity
		if json.Unmarshal([]byte(os.Getenv("YNX_PUBLIC_RESOURCE_PARENT")), &expected) != nil {
			os.Exit(3)
		}
		runner, err := contribution.NewDisabled(filepath.Join(root, "resource.json"))
		if err != nil {
			os.Exit(4)
		}
		if runner.InitializeCurrentResource(context.Background(), resourcePublic) != nil {
			os.Exit(5)
		}
		_, err = Start(context.Background(), Config{Directory: filepath.Join(root, "ipc"), Handler: func(context.Context, Peer, Request) (Result, error) { return Result{}, ErrResourceHeld }, ResourceCurrent: &ResourceCurrentConfig{Runner: runner, SelectedResource: resourcePublic, ExpectedClient: expected}})
		if err != nil {
			fmt.Println(err)
			os.Exit(6)
		}
		fmt.Println("READY")
		var one [1]byte
		if _, err = os.Stdin.Read(one[:]); err != nil {
			os.Exit(7)
		}
		if err = syscall.Exec("/bin/sleep", []string{"sleep", "20"}, os.Environ()); err != nil {
			fmt.Println(err)
			os.Exit(8)
		}
		return
	}
	root, err := os.MkdirTemp(resourceTestBase(), "p09exec-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	parent, err := ObserveProcessIdentity(context.Background(), int32(os.Getpid()))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(parent)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestResourceCurrentActualImageExecChange$")
	child.Env = append(os.Environ(), "YNX_PUBLIC_RESOURCE_EXEC_CHILD=1", "YNX_PUBLIC_RESOURCE_ROOT="+root, "YNX_PUBLIC_RESOURCE_PARENT="+string(raw))
	stdin, _ := child.StdinPipe()
	stdout, _ := child.StdoutPipe()
	if err = child.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		if !waited {
			_ = child.Process.Kill()
			_ = child.Wait()
		}
	}()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || scanner.Text() != "READY" {
		t.Fatal("actual Go child readiness", scanner.Text())
	}
	expected, err := ObserveProcessIdentity(context.Background(), int32(child.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	rpc, err := OpenResourceCurrent(context.Background(), filepath.Join(root, "ipc"), expected, resourcePublic)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = stdin.Write([]byte("x"))
	_ = stdin.Close()
	var changed ProcessIdentity
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		changed, err = ObserveProcessIdentity(context.Background(), expected.PID)
		if err == nil && changed.ImagePath != expected.ImagePath {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if err != nil || changed.PID != expected.PID || changed.StartIdentity != expected.StartIdentity || changed.ImagePath == expected.ImagePath || changed.ImageSHA256 == expected.ImageSHA256 {
		t.Fatal("actual same-PID exec identity change not witnessed", expected, changed, err)
	}
	if _, err = rpc.Current(context.Background()); err == nil {
		t.Fatal("actual changed image accepted as original Go owner")
	}
	if complete, err := rpc.Close(context.Background()); complete || !errors.Is(err, ErrResourceRemoteUnknown) {
		t.Fatal("exec/lost stream falsely completed remote capture", complete, err)
	}
	_ = child.Process.Signal(syscall.SIGTERM)
	_ = child.Wait()
	waited = true
	t.Logf("PUBLIC_CONTROLLED actual same PID=%d start=%s exec changed Go image->%s; held source rejected/no redial, UNKNOWN retained", expected.PID, expected.StartIdentity, changed.ImagePath)
}
func TestResourceCurrentSameUIDForeignKernelPeer(t *testing.T) {
	if os.Getenv("YNX_PUBLIC_RESOURCE_FOREIGN_CHILD") == "1" {
		_, err := Call(context.Background(), os.Getenv("YNX_PUBLIC_RESOURCE_DIRECTORY"), Request{Version: Version, ID: "foreign_actual_peer", Operation: "resource_current", Payload: json.RawMessage(`{}`)})
		if err == nil {
			os.Exit(3)
		}
		fmt.Println("REFUSED_ACTUAL_SAME_UID_FOREIGN_PID")
		return
	}
	server, _, _, _ := resourceFixture(t, resourcePublic)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestResourceCurrentSameUIDForeignKernelPeer$")
	child.Env = append(os.Environ(), "YNX_PUBLIC_RESOURCE_FOREIGN_CHILD=1", "YNX_PUBLIC_RESOURCE_DIRECTORY="+server.directory)
	output, err := child.CombinedOutput()
	if err != nil || !bytes.Contains(output, []byte("REFUSED_ACTUAL_SAME_UID_FOREIGN_PID")) {
		t.Fatal("wrong native PID control", string(output), err)
	}
	if heldCount(server) != 0 {
		t.Fatal("same UID/Go image alone borrowed reader")
	}
}
