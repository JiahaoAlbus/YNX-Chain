//go:build (linux || darwin) && securelink_openssl && cgo

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// This is a PUBLIC mechanism test across actual PQ TLS, original SCM ingress,
// genuine Node inbound caller, continuation SCM, and genuine Go receiver. The
// PUBLIC child is not Auth's recognized inventory, grant or resource executor.
func TestOriginalTaskReadContinuationNativeTLSWholePath(t *testing.T) {
	for _, mode := range []string{"normal", "revoked"} {
		t.Run(mode, func(t *testing.T) { testTaskReadContinuationTLS(t, mode) })
	}
}

func testTaskReadContinuationTLS(t *testing.T, mode string) {
	uid := localTestUID(t)
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	repository := filepath.Clean(filepath.Join(wd, "../.."))
	for _, leaf := range []string{
		"cmd/ynx-secure-link-caller/build/caller.node", "cmd/ynx-secure-link-caller/native.c",
		"cmd/ynx-secure-link-caller/task-grant-transport.mjs", "cmd/ynx-secure-link-caller/task-grant-transport-private.mjs",
		"cmd/ynx-secure-link-caller/inbound-caller.mjs", "cmd/ynx-secure-link-caller/task-read-resource-caller.mjs",
		"cmd/ynx-secure-link-caller/task-read-resource-continuation.mjs", "cmd/ynx-secure-link-caller/task-read-continuation-tls-peer.mjs",
		"internal/securelink/task_read_continuation.go", "internal/securelink/task_read_continuation_unix.go",
		"internal/securelink/task_read_continuation_openssl_test.go", "internal/securelink/authority_ingress_unix.go",
	} {
		raw, e := os.ReadFile(filepath.Join(repository, leaf))
		if e != nil {
			t.Fatalf("matching TLS/continuation prerequisite %s: %v", leaf, e)
		}
		hash := sha256.Sum256(raw)
		t.Logf("PUBLIC_CONTINUATION_TLS_INPUT %s bytes=%d sha256=%s", leaf, len(raw), hex.EncodeToString(hash[:]))
	}
	dir, err := os.MkdirTemp("/tmp", "ctl-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	inboundSocket, resourceSocket := filepath.Join(dir, "i"), filepath.Join(dir, "r")
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repository, "cmd/ynx-secure-link-caller/task-read-continuation-tls-peer.mjs"),
		inboundSocket, resourceSocket, strconv.FormatUint(uint64(uid), 10), strconv.Itoa(os.Getpid()), mode)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	events := make(chan map[string]json.RawMessage, 16)
	readDone := make(chan error, 1)
	go func() {
		defer close(events)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 1024), 64<<10)
		for scanner.Scan() {
			var event map[string]json.RawMessage
			if e := json.Unmarshal(scanner.Bytes(), &event); e != nil {
				readDone <- e
				return
			}
			events <- event
		}
		readDone <- scanner.Err()
	}()
	waited := false
	t.Cleanup(func() {
		_ = stdin.Close()
		if !waited {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			<-readDone
		}
		if stderr.Len() != 0 {
			t.Logf("PUBLIC continuation Node stderr: %s", stderr.String())
		}
	})
	next := func(kind string) map[string]json.RawMessage {
		t.Helper()
		select {
		case event, ok := <-events:
			if !ok {
				t.Fatalf("actual Node ended before %s", kind)
			}
			var actual string
			if e := json.Unmarshal(event["event"], &actual); e != nil || actual != kind {
				t.Fatalf("expected %s, got %v", kind, event)
			}
			return event
		case <-ctx.Done():
			t.Fatalf("actual Node %s: %v", kind, ctx.Err())
			return nil
		}
	}
	ready := next("ready")
	var nodePID int
	if err = json.Unmarshal(ready["pid"], &nodePID); err != nil || nodePID != cmd.Process.Pid {
		t.Fatal("readiness must match actual owned Node")
	}
	var nodeVersion string
	if err = json.Unmarshal(ready["node"], &nodeVersion); err != nil || nodeVersion == "" {
		t.Fatal("actual Node runtime version must be observed")
	}

	body := []byte("{ \"PUBLIC\":\"original PQ TLS entity\", \"exactInteger\":9007199254740993 }\n")
	beforeFinal, resume := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-resume:
		default:
			close(resume)
		}
	}()
	type result struct {
		err           error
		denial        error
		joinError     error
		closeError    error
		currentDenied bool
		life          OriginalTaskReadContinuationLifetime
	}
	results := make(chan result, 1)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		out := result{}
		cap, e := OriginalTaskReadContinuationFromOriginalRequest(r)
		out.err = e
		if e == nil {
			defer func() {
				_ = cap.Retire()
				drain, stop := context.WithTimeout(context.Background(), 2*time.Second)
				defer stop()
				out.joinError = cap.Join(drain)
				out.closeError = cap.Close()
				out.life = cap.Lifetime()
				results <- out
			}()
			derived, x := OriginalTaskReadContinuationFromContext(r.Context())
			if x != nil || derived != cap {
				out.err = fmt.Errorf("original context lost continuation: %v", x)
			}
			actual, x := io.ReadAll(r.Body)
			if x != nil || !bytes.Equal(actual, body) {
				out.err = fmt.Errorf("original TLS entity changed: %v", x)
			}
			if out.err == nil {
				out.err = cap.Current(r.Context())
			}
			if out.err == nil {
				raw, x := cap.ReadOriginalRequestDATA(r.Context())
				hash := sha256.Sum256(body)
				want := fmt.Sprintf(`{"PUBLIC":"original TLS transport DATA","entitySHA256":%q}`, hex.EncodeToString(hash[:]))
				if x != nil || !bytes.Equal(raw, []byte(want)) {
					out.err = fmt.Errorf("original detached DATA differs: %v %q", x, raw)
				}
			}
			close(beforeFinal)
			select {
			case <-resume:
			case <-ctx.Done():
				out.err = ctx.Err()
			}
			if out.err == nil {
				x := cap.Current(r.Context())
				if mode == "revoked" {
					out.denial = x
					out.currentDenied = x != nil
					if x == nil {
						out.err = fmt.Errorf("revoked TLS Current succeeded")
					}
				} else {
					out.err = x
				}
			}
			if mode == "normal" && out.err == nil {
				out.err = cap.ClaimAtOriginalResourceFence(r.Context())
				if out.err == nil && cap.ClaimAtOriginalResourceFence(r.Context()) == nil {
					out.err = fmt.Errorf("second F was accepted")
				}
			}
		} else {
			close(beforeFinal)
			results <- out
		}
		if out.err != nil || mode == "revoked" {
			http.Error(w, "PUBLIC refused", http.StatusConflict)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
	resourceCfg := taskReadTestConfig(handler)
	resourceCfg.PeerPID = nodePID
	for i := range resourceCfg.Routes {
		resourceCfg.Routes[i].Timeout = 8 * time.Second
	}
	resource, err := NewOriginalTaskReadContinuationServer(resourceCfg)
	if err != nil {
		t.Fatal(err)
	}
	resourceListener, err := ListenPrivate(resourceSocket, uid)
	if err != nil {
		t.Fatal(err)
	}
	resourceDone := make(chan error, 1)
	go func() { resourceDone <- resource.Serve(resourceListener) }()
	t.Cleanup(func() {
		_ = resource.Retire()
		_ = resourceListener.Close()
		drain, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		if e := resource.Join(drain); e != nil {
			t.Errorf("actual resource drain: %v", e)
		}
		if e := resource.Close(); e != nil {
			t.Errorf("actual resource close: %v", e)
		}
		<-resourceDone
	})
	fixture := newTLSFixture(t)
	policy := fixture.policy(true)
	policy.Edges[0].Routes = nil
	ingressCfg := AuthorityIPCIngressConfig{Service: "desktop-grant-continuation-tls-test", SocketPath: inboundSocket, PeerUID: uid, PeerPID: nodePID}
	for _, suffix := range []string{"issue", "effect", "query", "effect-query", "effect-reconcile", "revoke", "management"} {
		path := "/internal/auth/task-grants/" + suffix
		ingressCfg.Routes = append(ingressCfg.Routes, AuthorityIngressRoute{Method: "POST", Path: path, MaxRequestBytes: 1 << 20, MaxResponseBytes: 1 << 20, Timeout: 10 * time.Second})
		policy.Edges[0].Routes = append(policy.Edges[0].Routes, Route{Method: "POST", Path: path, Risk: "write"})
	}
	ingress, err := NewDesktopTaskGrantIPCIngress(ingressCfg)
	if err != nil {
		t.Fatal(err)
	}
	gate, err := NewGate(policy)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewHTTPServer(HTTPServerConfig{TLS: fixture.config(true), Gate: gate, EdgeID: policy.Edges[0].ID, Handler: ingress})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	t.Cleanup(func() {
		_ = ingress.Retire()
		_ = server.Close()
		drain, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		if e := ingress.Join(drain); e != nil {
			t.Errorf("actual ingress drain: %v", e)
		}
		if e := ingress.Close(); e != nil {
			t.Errorf("actual ingress close: %v", e)
		}
		<-serveDone
	})
	conn := dialNative(t, fixture, listener.Addr().String())
	t.Cleanup(func() { _ = conn.Close() })
	request, err := http.NewRequest("POST", "https://adapter.ynx.test/internal/auth/task-grants/effect", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Close = true
	if err = request.Write(conn); err != nil {
		t.Fatal(err)
	}
	select {
	case <-beforeFinal:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if mode == "revoked" {
		count, e := gate.RevokeService("pay.ynx.test", 2)
		if e != nil || count != 1 {
			t.Fatalf("actual original TLS revoke count=%d: %v", count, e)
		}
	}
	close(resume)
	response, responseErr := http.ReadResponse(bufio.NewReader(conn), request)
	if responseErr == nil {
		returned, e := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if mode == "normal" && (e != nil || response.StatusCode != 200 || !bytes.Equal(returned, []byte(`{"PUBLIC":"normal"}`))) {
			t.Fatalf("whole response status=%d raw=%q: %v", response.StatusCode, returned, e)
		}
		if mode == "revoked" && response.StatusCode == 200 {
			t.Fatal("revoked incoming TLS returned success")
		}
	} else if mode == "normal" {
		t.Fatal(responseErr)
	}
	var out result
	select {
	case out = <-results:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if out.err != nil {
		t.Fatal(out.err)
	}
	if mode == "revoked" && !out.currentDenied {
		t.Fatal("original TLS revocation did not deny final Current")
	}
	// Cleanup returns the preserved operation first cause even after physical
	// drain. It must remain that exact denial, rather than become fake success.
	if out.joinError != out.denial || out.closeError != out.denial || out.life.FirstCause != out.denial {
		t.Fatalf("cleanup lost original denial: denial=%v join=%v close=%v life=%+v", out.denial, out.joinError, out.closeError, out.life)
	}
	if !out.life.Closed || !out.life.Joined || out.life.Calls != 0 || out.life.CleanupUnknown {
		t.Fatalf("actual Go child did not drain: %+v", out.life)
	}
	if out.life.ClaimSelected != (mode == "normal") {
		t.Fatal("Go F selection disagrees with original TLS state")
	}
	next("continuation-closed")
	completed := next("completed")
	var stats struct {
		Claims int `json:"claims"`
		Read   int `json:"read"`
	}
	if err = json.Unmarshal(completed["stats"], &stats); err != nil {
		t.Fatal(err)
	}
	wantClaims := 1
	if mode == "revoked" {
		wantClaims = 0
	}
	if stats.Claims != wantClaims || stats.Read != 1 {
		t.Fatalf("original Node child calls=%+v", stats)
	}
	if _, err = io.WriteString(stdin, "stop\n"); err != nil {
		t.Fatal(err)
	}
	next("closed")
	_ = stdin.Close()
	if err = <-readDone; err != nil {
		t.Fatal(err)
	}
	err = cmd.Wait()
	waited = true
	if err != nil {
		t.Fatalf("actual Node must exit normally: %v; %s", err, stderr.String())
	}
	t.Logf("PUBLIC_CONTINUATION_NATIVE_TLS mode=%s originalTLSRevoked=%t claims=%d NodePID=%d Node=%s GoPID=%d physicalDone=true normalExit=true RootAdmission=false SourceAdmission=false P08Store=false", mode, mode == "revoked", stats.Claims, nodePID, nodeVersion, os.Getpid())
}
