package main_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

func ipcRoot(t *testing.T) string {
	t.Helper()
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("native kernel IPC intentionally unsupported on this platform; no UID fabrication")
	}
	base := os.TempDir()
	if runtime.GOOS == "darwin" {
		base = "/private/tmp"
	}
	base, err := filepath.EvalSymlinks(base)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(base, "ynx-ipc-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}
func ipcClose(t *testing.T, s *localipc.Server) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.Close(ctx); err != nil {
		t.Errorf("IPC close: %v", err)
	}
}
func ipcStatus(context.Context, localipc.Peer, localipc.Request) (localipc.Result, error) {
	return localipc.Result{Status: &localipc.Status{Service: "network-fixture", NodeControl: "unavailable", ResourceContribution: "disabled"}}, nil
}
func ipcRequest() localipc.Request {
	return localipc.Request{Version: localipc.Version, ID: "native_test_1", Operation: "status"}
}
func rawIPCCall(t *testing.T, path string, raw []byte) (int, []byte) {
	t.Helper()
	transport := &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", path)
	}}
	defer transport.CloseIdleConnections()
	request, _ := http.NewRequest(http.MethodPost, "http://localipc/v1/call", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Transport: transport, Timeout: 2 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, body
}
func TestNetworkLocalIPCRealKernelPeerAndStructuredPermission(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("platform does not implement native IPC; package fails closed")
	}
	dir := filepath.Join(ipcRoot(t), "ipc")
	seen := make(chan localipc.Peer, 2)
	server, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: func(ctx context.Context, p localipc.Peer, r localipc.Request) (localipc.Result, error) {
		seen <- p
		if r.Operation == "request_permission" {
			return localipc.Result{Permission: &localipc.PermissionResult{State: "pending", RequestID: r.ID}}, nil
		}
		return ipcStatus(ctx, p, r)
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer ipcClose(t, server)
	response, err := localipc.Call(context.Background(), dir, ipcRequest())
	if err != nil {
		t.Fatal(err)
	}
	p := <-seen
	if !p.Verified() || p.UID() != uint32(os.Geteuid()) || !response.Peer.NativeIPCVerified || response.Peer.BrowserIdentityVerified {
		t.Fatalf("kernel peer identity lost: %+v", response)
	}
	if pid, ok := p.PID(); ok && pid != int32(os.Getpid()) {
		t.Fatalf("kernel PID = %d, process = %d", pid, os.Getpid())
	} else if runtime.GOOS == "linux" && !ok {
		t.Fatal("Linux kernel PID missing")
	}
	if runtime.GOOS == "darwin" && !strings.Contains(p.CredentialSource(), "Xucred") {
		t.Fatal("Darwin real Xucred path missing")
	}
	request := localipc.Request{Version: localipc.Version, ID: "permission_1", Operation: "request_permission", Permission: &localipc.PermissionIntent{Capability: "node.manage", SubjectID: "owned_test_node", IntentSHA256: strings.Repeat("a", 64)}}
	response, err = localipc.Call(context.Background(), dir, request)
	if err != nil || response.Result.Permission.State != "pending" {
		t.Fatalf("permission request: %+v %v", response, err)
	}
	info, err := os.Lstat(dir)
	if err != nil || info.Mode().Perm() != 0o700 {
		t.Fatal("private directory mode")
	}
	info, err = os.Lstat(server.SocketPath())
	if err != nil || info.Mode().Perm() != 0o600 || info.Mode()&os.ModeSocket == 0 {
		t.Fatal("private socket mode/type")
	}
}
func TestNetworkLocalIPCUidPolicyUnitRejectsForeign(t *testing.T) {
	if localipc.SameUID(501, 502) == nil {
		t.Fatal("foreign UID accepted")
	}
	if localipc.SameUID(501, 501) != nil {
		t.Fatal("same UID rejected")
	}
	// This is a pure policy test, not a claim of a real foreign-UID process.
	var peer localipc.Peer
	raw := []byte(`{"uid":501,"verified":true}`)
	if json.Unmarshal(raw, &peer) != nil || peer.Verified() {
		t.Fatal("JSON fabricated a kernel credential")
	}
}
func TestNetworkLocalIPCPreservesUnknownSocketLockAndSymlinks(t *testing.T) {
	root := ipcRoot(t)
	for _, kind := range []string{"socket", "lock", "symlink", "wide-directory", "symlink-ancestor"} {
		t.Run(kind, func(t *testing.T) {
			dir := filepath.Join(root, kind)
			if err := os.Mkdir(dir, 0o700); err != nil {
				t.Fatal(err)
			}
			marker := []byte("unknown-preserve")
			switch kind {
			case "socket":
				if err := os.WriteFile(filepath.Join(dir, localipc.SocketName), marker, 0o600); err != nil {
					t.Fatal(err)
				}
			case "lock":
				if err := os.WriteFile(filepath.Join(dir, localipc.LockName), marker, 0o600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				target := filepath.Join(root, "target")
				if err := os.WriteFile(target, marker, 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, filepath.Join(dir, localipc.SocketName)); err != nil {
					t.Fatal(err)
				}
			case "wide-directory":
				if err := os.Chmod(dir, 0o755); err != nil {
					t.Fatal(err)
				}
			case "symlink-ancestor":
				link := filepath.Join(root, "linked")
				if err := os.Symlink(dir, link); err != nil {
					t.Fatal(err)
				}
				dir = filepath.Join(link, "ipc")
			}
			s, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: ipcStatus})
			if err == nil {
				ipcClose(t, s)
				t.Fatal("unsafe/unknown path accepted")
			}
			switch kind {
			case "socket", "lock":
				name := localipc.SocketName
				if kind == "lock" {
					name = localipc.LockName
				}
				raw, err := os.ReadFile(filepath.Join(dir, name))
				if err != nil || !bytes.Equal(raw, marker) {
					t.Fatal("unknown endpoint removed/changed")
				}
			case "symlink":
				if info, err := os.Lstat(filepath.Join(dir, localipc.SocketName)); err != nil || info.Mode()&os.ModeSymlink == 0 {
					t.Fatal("unknown symlink removed")
				}
			}
		})
	}
}
func TestNetworkLocalIPCStrictProtocolDoesNotDispatch(t *testing.T) {
	dir := filepath.Join(ipcRoot(t), "ipc")
	var calls atomic.Int64
	server, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: func(c context.Context, p localipc.Peer, r localipc.Request) (localipc.Result, error) {
		calls.Add(1)
		return ipcStatus(c, p, r)
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer ipcClose(t, server)
	for _, raw := range []string{
		`{"version":"YNX-NETWORK-LOCAL-IPC/v1","id":"x","operation":"status","operation":"request_permission"}`,
		`{"version":"YNX-NETWORK-LOCAL-IPC/v1","id":"x","Operation":"status"}`,
		`{"version":"YNX-NETWORK-LOCAL-IPC/v1","id":"x","operation":"shell","command":"rm"}`,
		`{"version":"YNX-NETWORK-LOCAL-IPC/v1","id":"x","operation":"status","uid":501}`,
		`{"version":"YNX-NETWORK-LOCAL-IPC/v1","id":"x","operation":"request_permission","permission":{"capability":"node.manage","subjectId":"../validator","intentSHA256":"` + strings.Repeat("a", 64) + `"}}`,
		strings.Repeat(" ", localipc.MaxMessageBytes+1),
	} {
		_, body := rawIPCCall(t, server.SocketPath(), []byte(raw))
		if !bytes.Contains(body, []byte(`"code":"INVALID"`)) {
			t.Fatalf("invalid input got %s", body)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid request reached dispatcher")
	}
}
func TestNetworkLocalIPCClientCancelAndServerCloseCancelDispatcher(t *testing.T) {
	for _, mode := range []string{"client-cancel", "server-close", "parent-cancel"} {
		t.Run(mode, func(t *testing.T) {
			dir := filepath.Join(ipcRoot(t), "ipc")
			entered, exited := make(chan struct{}), make(chan struct{})
			root, cancelRoot := context.WithCancel(context.Background())
			defer cancelRoot()
			server, err := localipc.Start(root, localipc.Config{Directory: dir, Handler: func(ctx context.Context, _ localipc.Peer, _ localipc.Request) (localipc.Result, error) {
				close(entered)
				<-ctx.Done()
				close(exited)
				return localipc.Result{}, ctx.Err()
			}})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { _, err := localipc.Call(ctx, dir, ipcRequest()); done <- err }()
			select {
			case <-entered:
			case <-time.After(2 * time.Second):
				t.Fatal("handler did not enter")
			}
			switch mode {
			case "client-cancel":
				cancel()
			case "server-close":
				ipcClose(t, server)
			case "parent-cancel":
				cancelRoot()
			}
			select {
			case <-exited:
			case <-time.After(2 * time.Second):
				t.Fatal("dispatcher context not cancelled")
			}
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("cancelled call succeeded")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("cancelled client stuck")
			}
			cancel()
			ipcClose(t, server)
			if _, err = os.Lstat(server.SocketPath()); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("owned socket not cleaned")
			}
			if _, err = os.Lstat(filepath.Join(dir, localipc.LockName)); err != nil {
				t.Fatal("known lock marker not retained")
			}
			restarted, restartErr := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: ipcStatus})
			if restartErr != nil {
				t.Fatalf("normal close did not release known kernel lock: %v", restartErr)
			}
			ipcClose(t, restarted)

		})
	}
}
func TestNetworkLocalIPCClosePreservesReplacedEndpoint(t *testing.T) {
	dir := filepath.Join(ipcRoot(t), "ipc")
	server, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: ipcStatus})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(server.SocketPath()); err != nil {
		t.Fatal(err)
	}
	marker := []byte("replacement is not server owned")
	if err = os.WriteFile(server.SocketPath(), marker, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err = server.Close(ctx); !errors.Is(err, localipc.ErrEndpointChanged) {
		t.Fatalf("replacement not reported: %v", err)
	}
	raw, err := os.ReadFile(server.SocketPath())
	if err != nil || !bytes.Equal(raw, marker) {
		t.Fatal("replacement was removed")
	}
}

func TestNetworkLocalIPCFixedTypedPayloadOperationsAndBoundaries(t *testing.T) {
	dir := filepath.Join(ipcRoot(t), "ipc")
	var calls atomic.Int64
	server, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: func(_ context.Context, _ localipc.Peer, r localipc.Request) (localipc.Result, error) {
		calls.Add(1)
		return localipc.Result{Payload: json.RawMessage(`{"state":"unsupported","nativeGrant":false}`)}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer ipcClose(t, server)
	operations := []string{"participation_prepare", "participation_review", "participation_cancel", "participation_reconcile", "participation_revoke", "participation_get", "participation_submit", "node_prepare", "node_install", "node_start", "node_status", "node_stop", "resource_status", "resource_meter", "resource_stop"}
	for _, operation := range operations {
		request := localipc.Request{Version: localipc.Version, ID: "typed_1", Operation: operation, Payload: json.RawMessage(`{"id":"local_reference"}`)}
		response, err := localipc.Call(context.Background(), dir, request)
		if err != nil || !bytes.Contains(response.Result.Payload, []byte("unsupported")) {
			t.Fatalf("fixed operation %s: %+v %v", operation, response, err)
		}
	}
	count := calls.Load()
	for _, request := range []localipc.Request{
		{Version: localipc.Version, ID: "bad_1", Operation: "status", Payload: json.RawMessage(`{}`)},
		{Version: localipc.Version, ID: "bad_2", Operation: "node_start", Payload: json.RawMessage(`"arbitrary shell"`)},
		{Version: localipc.Version, ID: "bad_3", Operation: "participation_submit"},
		{Version: localipc.Version, ID: "bad_4", Operation: "run_shell", Payload: json.RawMessage(`{}`)},
	} {
		if _, err = localipc.Call(context.Background(), dir, request); err == nil {
			t.Fatal("invalid payload contract accepted")
		}
	}
	if calls.Load() != count {
		t.Fatal("invalid operation reached typed business dispatcher")
	}
}

// The explicit subprocess branch is only an isolated real socket fixture.
func TestNetworkIPCSubprocessEntrypoint(t *testing.T) {
	if os.Getenv("YNX_NATIVE_IPC_CRASH_HELPER") != "1" {
		return
	}
	dir := os.Getenv("YNX_NATIVE_IPC_FIXTURE_DIR")
	server, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: ipcStatus})
	if err != nil {
		fmt.Fprintln(os.Stdout, "ERROR", err)
		os.Exit(2)
	}
	_ = server
	fmt.Fprintln(os.Stdout, "READY")
	select {}
}
func crashedIPCEndpoint(t *testing.T) (string, os.FileInfo) {
	t.Helper()
	dir := filepath.Join(ipcRoot(t), "ipc")
	process := exec.Command(os.Args[0], "-test.run=^TestNetworkIPCSubprocessEntrypoint$")
	process.Env = []string{"YNX_NATIVE_IPC_CRASH_HELPER=1", "YNX_NATIVE_IPC_FIXTURE_DIR=" + dir}
	output, err := process.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	process.Stderr = process.Stdout
	if err = process.Start(); err != nil {
		t.Fatal(err)
	}
	stopped := false
	t.Cleanup(func() {
		if !stopped {
			_ = process.Process.Kill()
			_ = process.Wait()
		}
	})
	ready := make(chan string, 1)
	go func() { line, _ := bufio.NewReader(output).ReadString('\n'); ready <- line }()
	select {
	case line := <-ready:
		if line != "READY\n" {
			t.Fatalf("fixture did not start: %s", line)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("fixture startup timed out")
	}
	response, err := localipc.Call(context.Background(), dir, ipcRequest())
	if err != nil || !response.Peer.NativeIPCVerified {
		t.Fatalf("subprocess real kernel call failed: %+v %v", response, err)
	}
	if duplicate, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: ipcStatus}); err == nil {
		ipcClose(t, duplicate)
		t.Fatal("live subprocess kernel owner was replaced")
	}
	socket, err := os.Lstat(filepath.Join(dir, localipc.SocketName))
	if err != nil {
		t.Fatal(err)
	}
	if err = process.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err = process.Wait(); err == nil {
		t.Fatal("SIGKILL fixture unexpectedly exited successfully")
	}
	stopped = true
	if after, err := os.Lstat(filepath.Join(dir, localipc.SocketName)); err != nil || !os.SameFile(socket, after) {
		t.Fatal("crash fixture did not retain original socket")
	}
	return dir, socket
}
func TestNetworkLocalIPCCrashRestartUsesKnownInodeAndKernelLock(t *testing.T) {
	dir, _ := crashedIPCEndpoint(t)
	oldRecordRaw, err := os.ReadFile(filepath.Join(dir, localipc.EndpointRecordName))
	if err != nil {
		t.Fatal(err)
	}
	var oldRecord map[string]any
	if json.Unmarshal(oldRecordRaw, &oldRecord) != nil {
		t.Fatal("old endpoint record")
	}
	restarted, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: ipcStatus})
	if err != nil {
		t.Fatalf("known crashed endpoint not recovered: %v", err)
	}
	defer ipcClose(t, restarted)
	response, err := localipc.Call(context.Background(), dir, ipcRequest())
	if err != nil || !response.Peer.NativeIPCVerified || response.Peer.BrowserIdentityVerified {
		t.Fatalf("recovered native call failed: %+v %v", response, err)
	}
	newRecordRaw, err := os.ReadFile(filepath.Join(dir, localipc.EndpointRecordName))
	if err != nil {
		t.Fatal(err)
	}
	var newRecord map[string]any
	if json.Unmarshal(newRecordRaw, &newRecord) != nil || newRecord["endpointId"] == oldRecord["endpointId"] {
		t.Fatal("recovery did not publish a new endpoint identity")
	}
}
func TestNetworkLocalIPCCrashNeverDeletesReplacedSocket(t *testing.T) {
	dir, _ := crashedIPCEndpoint(t)
	path := filepath.Join(dir, localipc.SocketName)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	replacement, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	replacement.SetUnlinkOnClose(false)
	defer replacement.Close()
	if err = os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	original, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if server, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: ipcStatus}); err == nil {
		ipcClose(t, server)
		t.Fatal("unknown replacement socket adopted")
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(original, after) {
		t.Fatal("unknown replacement socket was removed")
	}
}

func TestNetworkLocalIPCConcurrentCloseDrainsPreDispatchRequests(t *testing.T) {
	for round := 0; round < 8; round++ {
		dir := filepath.Join(ipcRoot(t), "ipc")
		entered := make(chan struct{}, 1)
		server, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: func(ctx context.Context, _ localipc.Peer, _ localipc.Request) (localipc.Result, error) {
			select {
			case entered <- struct{}{}:
			default:
			}
			<-ctx.Done()
			return localipc.Result{}, ctx.Err()
		}})
		if err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 8)
		for i := 0; i < 8; i++ {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_, err := localipc.Call(ctx, dir, ipcRequest())
				done <- err
			}()
		}
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatal("concurrent native request never dispatched")
		}
		ipcClose(t, server)
		for i := 0; i < 8; i++ {
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("cancelled dispatcher returned success")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("pre-dispatch native request survived shutdown")
			}
		}
	}
}
